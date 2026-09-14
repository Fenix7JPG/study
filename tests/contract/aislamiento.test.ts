import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, crearAppDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'

// T015: aislamiento por cuenta (FR-005, SC-002): B nunca ve datos de A.
// La cobertura de dumps/fichas/puntos/exportaciones se extiende en los tests
// de cada user story; aquí se verifican las salas (primer recurso con datos).

describe('aislamiento por cuenta (FR-005, SC-002)', function () {
  let app: Express
  let tokenAna: string
  let tokenBeto: string
  let salaDeAna: string

  beforeAll(async function () {
    const db = await crearDbDePrueba()
    app = crearAppDePrueba(db)
    tokenAna = await registrarCuenta(app, 'ana-aislada@test.dev', 'Ana')
    tokenBeto = await registrarCuenta(app, 'beto-intruso@test.dev', 'Beto')

    // Ana crea su sala
    const respuesta = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    salaDeAna = respuesta.body.sala.id
  })

  it('Beto no puede ver la sala de Ana (403)', async function () {
    const respuesta = await request(app)
      .get('/api/salas/' + salaDeAna)
      .set('Authorization', 'Bearer ' + tokenBeto)
    expect(respuesta.status).toBe(403)
  })

  it('Beto no puede configurar la sala de Ana (403)', async function () {
    const respuesta = await request(app)
      .patch('/api/salas/' + salaDeAna + '/config')
      .set('Authorization', 'Bearer ' + tokenBeto)
      .send({ config_tiempo_lectura: 1 })
    expect(respuesta.status).toBe(403)
  })

  it('el listado "mías" de Beto no incluye salas de Ana', async function () {
    const respuesta = await request(app).get('/api/salas/mias').set('Authorization', 'Bearer ' + tokenBeto)
    expect(respuesta.status).toBe(200)
    const ids = respuesta.body.salas.map(function (s: { sala: { id: string } }) { return s.sala.id })
    expect(ids).not.toContain(salaDeAna)
  })

  it('sin token nada se ve (401)', async function () {
    const sinToken = await request(app).get('/api/salas/' + salaDeAna)
    expect(sinToken.status).toBe(401)
  })
})
