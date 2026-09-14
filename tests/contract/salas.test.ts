import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import type { Client } from '@libsql/client'
import { crearDbDePrueba, crearAppDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'

// T017: contract tests de salas (FR-007/008/009/010)

describe('salas (T018/T020)', function () {
  let app: Express
  let db: Client
  let tokenAdmin: string
  let salaId: string

  beforeAll(async function () {
    db = await crearDbDePrueba()
    app = crearAppDePrueba(db)
    tokenAdmin = await registrarCuenta(app, 'admin@test.dev', 'Admin')
  })

  it('crea sala con JSON válido: 201 con documento, secciones y código único', async function () {
    const respuesta = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAdmin)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    expect(respuesta.status).toBe(201)
    expect(respuesta.body.documento.titulo).toBe('Historia Universal')
    expect(respuesta.body.sala.codigoInvitacion).toMatch(/^[A-Z2-9]{8}$/)
    expect(respuesta.body.sala.configTiempoLectura).toBeNull() // sin override del admin
    expect(respuesta.body.sala.configTamanoSesionPractica).toBe(30) // defecto
    expect(respuesta.body.secciones.length).toBe(2)
    expect(respuesta.body.secciones[0].titulo).toBe('Revolución Francesa')
    expect(respuesta.body.secciones[0].id).toBeTruthy()
    // Las secciones NO exponen el mapa de conceptos
    expect(JSON.stringify(respuesta.body.secciones)).not.toContain('mapa_conceptos')
    salaId = respuesta.body.sala.id
  })

  it('rechaza JSON inválido con 400 nombrando el campo y no persiste nada', async function () {
    const jsonMalo = jsonIngestaDePrueba() as { documento: { secciones: Array<{ id: string }> } }
    jsonMalo.documento.secciones[1].id = 's9'
    const antes = await request(app).get('/api/salas/mias').set('Authorization', 'Bearer ' + tokenAdmin)
    const respuesta = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAdmin)
      .send({ json_ingesta: jsonMalo })
    expect(respuesta.status).toBe(400)
    expect(respuesta.body.error).toContain('s2')
    const despues = await request(app).get('/api/salas/mias').set('Authorization', 'Bearer ' + tokenAdmin)
    expect(despues.body.salas.length).toBe(antes.body.salas.length) // nada persistido
  })

  it('acepta configuración opcional del admin con 201', async function () {
    const respuesta = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAdmin)
      .send({ json_ingesta: jsonIngestaDePrueba(), config_tiempo_lectura: 5, config_tamano_sesion_practica: 10 })
    expect(respuesta.status).toBe(201)
    expect(respuesta.body.sala.configTiempoLectura).toBe(5)
    expect(respuesta.body.sala.configTamanoSesionPractica).toBe(10)
  })

  it('rechaza configuración no numérica con 400', async function () {
    const respuesta = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAdmin)
      .send({ json_ingesta: jsonIngestaDePrueba(), config_tiempo_lectura: 'mucho' })
    expect(respuesta.status).toBe(400)
  })

  it('un participante se une con el código (200) y ve la sala en "mías"', async function () {
    const tokenBeto = await registrarCuenta(app, 'beto@test.dev', 'Beto')
    const crear = await request(app).get('/api/salas/mias').set('Authorization', 'Bearer ' + tokenAdmin)
    const codigo = crear.body.salas[0].sala.codigoInvitacion as string

    const union = await request(app)
      .post('/api/salas/unirse')
      .set('Authorization', 'Bearer ' + tokenBeto)
      .send({ codigo_invitacion: codigo })
    expect(union.status).toBe(200)

    const mias = await request(app).get('/api/salas/mias').set('Authorization', 'Bearer ' + tokenBeto)
    expect(mias.body.salas.length).toBe(1)
    expect(mias.body.salas[0].rol).toBe('participante')
    void db
    void salaId
  })

  it('rechaza unirse con código inválido (404)', async function () {
    const tokenC = await registrarCuenta(app, 'carla@test.dev', 'Carla')
    const respuesta = await request(app)
      .post('/api/salas/unirse')
      .set('Authorization', 'Bearer ' + tokenC)
      .send({ codigo_invitacion: 'ZZZZ9999' })
    expect(respuesta.status).toBe(404)
  })

  it('GET /:id muestra metadata de secciones SIN el mapa de conceptos', async function () {
    const respuesta = await request(app).get('/api/salas/' + salaId).set('Authorization', 'Bearer ' + tokenAdmin)
    expect(respuesta.status).toBe(200)
    expect(respuesta.body.rol).toBe('administrador')
    expect(respuesta.body.secciones[0].num_palabras).toBe(350)
    expect(respuesta.text).not.toContain('Toma de la Bastilla') // el mapa nunca se expone aquí
  })

  it('PATCH config: participante recibe 403, admin puede cambiar', async function () {
    // Beto se une a la sala objetivo (salaId) usando SU código
    const mias = await request(app).get('/api/salas/mias').set('Authorization', 'Bearer ' + tokenAdmin)
    const objetivo = mias.body.salas.find(function (s: { sala: { id: string } }) { return s.sala.id === salaId })
    expect(objetivo).toBeTruthy()
    const tokenBeto = await registrarCuenta(app, 'beto2@test.dev', 'Beto2')
    await request(app)
      .post('/api/salas/unirse')
      .set('Authorization', 'Bearer ' + tokenBeto)
      .send({ codigo_invitacion: objetivo.sala.codigoInvitacion })

    const prohibido = await request(app)
      .patch('/api/salas/' + salaId + '/config')
      .set('Authorization', 'Bearer ' + tokenBeto)
      .send({ config_tiempo_lectura: 9 })
    expect(prohibido.status).toBe(403)

    const permitido = await request(app)
      .patch('/api/salas/' + salaId + '/config')
      .set('Authorization', 'Bearer ' + tokenAdmin)
      .send({ config_tiempo_lectura: 9 })
    expect(permitido.status).toBe(200)
    expect(permitido.body.sala.configTiempoLectura).toBe(9)
  })
})
