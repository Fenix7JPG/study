import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, crearAppDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'
import { crearStubIA, type StubIA } from '../helpers/stubIA.js'
import { cargarEnv } from '../../src/server/config/env.js'
import { crearApp } from '../../src/server/app.js'
import type { Client } from '@libsql/client'

// T022/T024/T025/T026: ciclo de dump de 2 rondas con bloqueos server-side.
// Para simular el paso del tiempo se retro-datan las ventanas en la BD y se
// vuelve a llamar a `iniciar`, que avanza las fases (research D10).

function calificacionS1(cobertura: number, conErrores: boolean): Record<string, unknown> {
  return {
    cobertura_porcentaje: cobertura,
    conceptos_cubiertos: conErrores ? ['s1-c1'] : ['s1-c1', 's1-c2'],
    conceptos_faltantes: conErrores ? ['s1-c2'] : [],
    errores: conErrores ? [{ id_concepto: 's1-c2', descripcion_error: 'confundió las fechas' }] : []
  }
}

// Retro-data TODAS las fases de una sección a 2020 y llama a iniciar
async function avanzarFase(db: Client, app: Express, token: string, seccionId: string): Promise<request.Response> {
  await db.execute({
    sql: "UPDATE ProgresoSeccion SET fase_termina_en = '2020-01-01T00:00:00.000Z' WHERE seccion_id = ?",
    args: [seccionId]
  })
  return request(app).post('/api/secciones/' + seccionId + '/dump/iniciar').set('Authorization', 'Bearer ' + token)
}

describe('ciclo de dump (T022–T026)', function () {
  let app: Express
  let db: Client
  let stub: StubIA
  let tokenAna: string
  let tokenOtro: string
  let seccion1: string

  beforeAll(async function () {
    db = await crearDbDePrueba()
    stub = crearStubIA()
    app = crearAppDePrueba(db)
    // Re-creamos la app con el stub de IA inyectado
    app = crearApp({ db: db, env: cargarEnv(), clienteIA: stub })

    tokenAna = await registrarCuenta(app, 'ana@dump.test', 'Ana')
    tokenOtro = await registrarCuenta(app, 'otro@dump.test', 'Otro')

    const sala = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    seccion1 = sala.body.secciones[0].id
  })

  it('inicia en ronda 1 fase lectura y se puede reanudar en el mismo estado', async function () {
    const primera = await request(app).post('/api/secciones/' + seccion1 + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenAna)
    expect(primera.status).toBe(200)
    expect(primera.body.ronda).toBe(1)
    expect(primera.body.fase).toBe('lectura')
    expect(primera.body.recalificarDisponible).toBe(false)

    const reanudada = await request(app).post('/api/secciones/' + seccion1 + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenAna)
    expect(reanudada.body.fase).toBe('lectura')
  })

  it('el contenido solo se ve durante la lectura y sin el mapa de conceptos', async function () {
    const respuesta = await request(app).get('/api/secciones/' + seccion1 + '/contenido').set('Authorization', 'Bearer ' + tokenAna)
    expect(respuesta.status).toBe(200)
    expect(respuesta.body.bloques[0].tipo).toBe('texto')
    expect(respuesta.body.bloques[0].valor).toContain('1789')
    expect(respuesta.text).not.toContain('mapa_conceptos')
    expect(respuesta.text).not.toContain('Toma de la Bastilla')
  })

  it('cuenta sin membresía no puede iniciar (aislamiento)', async function () {
    const respuesta = await request(app).post('/api/secciones/' + seccion1 + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenOtro)
    expect(respuesta.status).toBe(404)
  })

  it('expirada la lectura: contenido 403 y avanzar lleva a escritura', async function () {
    const avanzar = await avanzarFase(db, app, tokenAna, seccion1)
    expect(avanzar.body.fase).toBe('escritura')

    const contenido = await request(app).get('/api/secciones/' + seccion1 + '/contenido').set('Authorization', 'Bearer ' + tokenAna)
    expect(contenido.status).toBe(403)
  })

  it('enviar en escritura califica, bloquea el texto y pasa a resultados', async function () {
    stub.fijar([calificacionS1(50, true)])
    const respuesta = await request(app)
      .post('/api/secciones/' + seccion1 + '/dump/enviar')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ texto: 'La Revolución Francesa empezó en 1789 con la Bastilla.' })
    expect(respuesta.status).toBe(200)
    expect(respuesta.body.cobertura_porcentaje).toBe(50)
    // §8.1: 1 cubierto (+10) − 1 error (−5) = 5
    expect(respuesta.body.puntos_obtenidos).toBe(5)
    expect(respuesta.body.fase).toBe('resultados')

    // El texto queda guardado e inmutable: segundo envío rechazado
    const repetido = await request(app)
      .post('/api/secciones/' + seccion1 + '/dump/enviar')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ texto: 'otra cosa' })
    expect(repetido.status).toBe(409)

    const resultado = await request(app).get('/api/secciones/' + seccion1 + '/dump/resultado/1').set('Authorization', 'Bearer ' + tokenAna)
    expect(resultado.body.texto).toBe('La Revolución Francesa empezó en 1789 con la Bastilla.')
    expect(resultado.body.estado).toBe('calificado')
  })

  it('ronda 2 inmediatamente después y al terminar queda completada (sin rondas 3+)', async function () {
    stub.fijar([calificacionS1(80, false)])
    await avanzarFase(db, app, tokenAna, seccion1) // resultados → ronda 2 lectura
    await avanzarFase(db, app, tokenAna, seccion1) // lectura → escritura
    const enviar = await request(app)
      .post('/api/secciones/' + seccion1 + '/dump/enviar')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ texto: 'Dump completo de la ronda 2.' })
    expect(enviar.status).toBe(200)
    // §8.1: 2 cubiertos (+20) + bonus de mejora (80 > 50, +20) = 40
    expect(enviar.body.puntos_obtenidos).toBe(40)

    const fin = await avanzarFase(db, app, tokenAna, seccion1) // resultados → completada
    expect(fin.status).toBe(409)
    expect(fin.body.error).toContain('completada')

    const deNuevo = await request(app).post('/api/secciones/' + seccion1 + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenAna)
    expect(deNuevo.status).toBe(409)
  })
})
