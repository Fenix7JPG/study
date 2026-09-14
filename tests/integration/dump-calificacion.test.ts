import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'
import { crearStubIA, type StubIA } from '../helpers/stubIA.js'
import { cargarEnv } from '../../src/server/config/env.js'
import { crearApp } from '../../src/server/app.js'
import type { Client } from '@libsql/client'

// T029/T032: calificación IA del dump, fallo tras reintentos → 502 con texto
// guardado, y recalificación que reutiliza el texto inmutable (FR-047).

function calificacion(cobertura: number): Record<string, unknown> {
  return {
    cobertura_porcentaje: cobertura,
    conceptos_cubiertos: ['s1-c1', 's1-c2'],
    conceptos_faltantes: [],
    errores: []
  }
}

async function avanzarFase(db: Client, app: Express, token: string, seccionId: string): Promise<request.Response> {
  await db.execute({
    sql: "UPDATE ProgresoSeccion SET fase_termina_en = '2020-01-01T00:00:00.000Z' WHERE seccion_id = ?",
    args: [seccionId]
  })
  return request(app).post('/api/secciones/' + seccionId + '/dump/iniciar').set('Authorization', 'Bearer ' + token)
}

describe('calificación IA del dump y recalificar (T029/T030/T032)', function () {
  let app: Express
  let db: Client
  let stub: StubIA
  let tokenAna: string
  let seccion: string

  beforeAll(async function () {
    db = await crearDbDePrueba()
    stub = crearStubIA()
    app = crearApp({ db: db, env: cargarEnv(), clienteIA: stub })
    tokenAna = await registrarCuenta(app, 'ana@calif.test', 'Ana')
    const sala = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    seccion = sala.body.secciones[0].id
    await request(app).post('/api/secciones/' + seccion + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenAna)
    await avanzarFase(db, app, tokenAna, seccion)
  })

  it('fallo de IA tras reintentos → 502, texto guardado e inmutable', async function () {
    stub.fijar([new Error('IA caída')])
    const respuesta = await request(app)
      .post('/api/secciones/' + seccion + '/dump/enviar')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ texto: 'Mi texto del dump que debe sobrevivir al fallo.' })
    expect(respuesta.status).toBe(502)
    expect(respuesta.body.error).toContain('reintentarla')
    expect(respuesta.body.intento_id).toBeTruthy()

    const resultado = await request(app).get('/api/secciones/' + seccion + '/dump/resultado/1').set('Authorization', 'Bearer ' + tokenAna)
    expect(resultado.body.estado).toBe('sin_calificacion')
    expect(resultado.body.texto).toBe('Mi texto del dump que debe sobrevivir al fallo.')
  })

  it('recalificar reutiliza el texto sin reescribir y completa la ronda (FR-047)', async function () {
    stub.fijar([calificacion(70)])
    const recalificacion = await request(app)
      .post('/api/secciones/' + seccion + '/dump/recalificar')
      .set('Authorization', 'Bearer ' + tokenAna)
    expect(recalificacion.status).toBe(200)
    expect(recalificacion.body.cobertura_porcentaje).toBe(70)
    expect(recalificacion.body.fase).toBe('resultados')

    const resultado = await request(app).get('/api/secciones/' + seccion + '/dump/resultado/1').set('Authorization', 'Bearer ' + tokenAna)
    expect(resultado.body.estado).toBe('calificado')
    expect(resultado.body.texto).toBe('Mi texto del dump que debe sobrevivir al fallo.')
  })

  it('recalificar sin pendiente → 409', async function () {
    const respuesta = await request(app)
      .post('/api/secciones/' + seccion + '/dump/recalificar')
      .set('Authorization', 'Bearer ' + tokenAna)
    expect(respuesta.status).toBe(409)
  })
})
