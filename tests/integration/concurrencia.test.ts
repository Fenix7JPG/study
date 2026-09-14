import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'
import { crearStubIA, type StubIA } from '../helpers/stubIA.js'
import { cargarEnv } from '../../src/server/config/env.js'
import { crearApp } from '../../src/server/app.js'
import type { Client } from '@libsql/client'

// T027: concurrencia (FR-037, SC-009): dos cuentas de la misma sala en fases
// DISTINTAS de la misma sección al mismo tiempo, sin bloquearse entre sí.

function calificacionOk(): Record<string, unknown> {
  return {
    cobertura_porcentaje: 90,
    conceptos_cubiertos: ['s1-c1', 's1-c2'],
    conceptos_faltantes: [],
    errores: []
  }
}

describe('concurrencia en la misma sala (FR-037, SC-009)', function () {
  let app: Express
  let db: Client
  let stub: StubIA
  let tokenAna: string
  let tokenBeto: string
  let seccion: string

  beforeAll(async function () {
    db = await crearDbDePrueba()
    stub = crearStubIA()
    app = crearApp({ db: db, env: cargarEnv(), clienteIA: stub })
    tokenAna = await registrarCuenta(app, 'ana@conc.test', 'Ana')
    tokenBeto = await registrarCuenta(app, 'beto@conc.test', 'Beto')

    const sala = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    seccion = sala.body.secciones[0].id
    const codigo = sala.body.sala.codigoInvitacion
    await request(app).post('/api/salas/unirse').set('Authorization', 'Bearer ' + tokenBeto).send({ codigo_invitacion: codigo })
  })

  it('A y B inician la misma sección; B no bloquea a A ni viceversa', async function () {
    const a = await request(app).post('/api/secciones/' + seccion + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenAna)
    const b = await request(app).post('/api/secciones/' + seccion + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenBeto)
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(a.body.fase).toBe('lectura')
    expect(b.body.fase).toBe('lectura')
  })

  it('A avanza a escritura mientras B sigue leyendo contenido sin problema', async function () {
    await db.execute({
      sql: "UPDATE ProgresoSeccion SET fase_termina_en = '2020-01-01T00:00:00.000Z' WHERE seccion_id = ? AND cuenta_id = (SELECT id FROM Cuenta WHERE email = 'ana@conc.test')",
      args: [seccion]
    })
    await request(app).post('/api/secciones/' + seccion + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenAna)

    // A está en escritura; B todavía puede ver el contenido en su lectura
    const contenidoB = await request(app).get('/api/secciones/' + seccion + '/contenido').set('Authorization', 'Bearer ' + tokenBeto)
    expect(contenidoB.status).toBe(200)
  })

  it('A envía su dump mientras B sigue en lectura; ambos estados coexisten', async function () {
    stub.fijar([calificacionOk()])
    const enviarA = await request(app)
      .post('/api/secciones/' + seccion + '/dump/enviar')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ texto: 'Dump de Ana.' })
    expect(enviarA.status).toBe(200)
    expect(enviarA.body.fase).toBe('resultados')

    const contenidoB = await request(app).get('/api/secciones/' + seccion + '/contenido').set('Authorization', 'Bearer ' + tokenBeto)
    expect(contenidoB.status).toBe(200)
  })
})
