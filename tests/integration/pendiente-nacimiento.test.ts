import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'
import { crearStubIA, type StubIA } from '../helpers/stubIA.js'
import { cargarEnv } from '../../src/server/config/env.js'
import { crearApp } from '../../src/server/app.js'
import type { Client } from '@libsql/client'

// T104/T114: pendiente de nacimiento por set COMBINADO (FR-119, SC-106):
// un concepto faltante en la ronda 1 pero CORRECTO en la ronda 2 nace
// pendiente (regla v2); el que estuvo correcto en ambas nace libre.

async function avanzarFase(db: Client, app: Express, token: string, seccionId: string): Promise<void> {
  await db.execute({
    sql: "UPDATE ProgresoSeccion SET fase_termina_en = '2020-01-01T00:00:00.000Z' WHERE seccion_id = ?",
    args: [seccionId]
  })
  await request(app).post('/api/secciones/' + seccionId + '/dump/iniciar').set('Authorization', 'Bearer ' + token)
}

describe('pendiente de nacimiento por set combinado (FR-119)', function () {
  let app: Express
  let db: Client
  let stub: StubIA
  let tokenAna: string
  let seccion: string

  beforeAll(async function () {
    db = await crearDbDePrueba()
    stub = crearStubIA()
    app = crearApp({ db: db, env: cargarEnv(), clienteIA: stub })
    tokenAna = await registrarCuenta(app, 'ana@pend.test', 'Ana')

    const sala = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    seccion = sala.body.secciones[0].id

    // Ronda 1: c1 FALTANTE (c2 cubierto)
    await request(app).post('/api/secciones/' + seccion + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenAna)
    await avanzarFase(db, app, tokenAna, seccion)
    stub.fijar([{ cobertura_porcentaje: 50, conceptos_cubiertos: ['s1-c2'], conceptos_faltantes: ['s1-c1'], errores: [] }])
    await request(app).post('/api/secciones/' + seccion + '/dump/enviar').set('Authorization', 'Bearer ' + tokenAna).send({ texto: 'r1' })

    // Ronda 2: AMBOS cubiertos, sin errores
    await avanzarFase(db, app, tokenAna, seccion)
    await avanzarFase(db, app, tokenAna, seccion)
    stub.fijar([
      { cobertura_porcentaje: 100, conceptos_cubiertos: ['s1-c1', 's1-c2'], conceptos_faltantes: [], errores: [] },
      { fichas: [
        { pregunta: 'f c1', respuesta: 'r1', concepto_id: 's1-c1', tipo: 'estandar', prioridad_inicial: 'baja' },
        { pregunta: 'f c2', respuesta: 'r2', concepto_id: 's1-c2', tipo: 'estandar', prioridad_inicial: 'baja' }
      ] }
    ])
    await request(app).post('/api/secciones/' + seccion + '/dump/enviar').set('Authorization', 'Bearer ' + tokenAna).send({ texto: 'r2' })
  })

  it('c1 (faltante en ronda 1, correcto en ronda 2) nace PENDIENTE; c2 nace libre', async function () {
    const listado = await request(app).get('/api/secciones/' + seccion + '/fichas').set('Authorization', 'Bearer ' + tokenAna)
    expect(listado.status).toBe(200)
    const fichas = listado.body.fichas
    expect(fichas.length).toBe(2)
    const f1 = fichas.find(function (f: { conceptoId: string }) { return f.conceptoId === 's1-c1' })
    const f2 = fichas.find(function (f: { conceptoId: string }) { return f.conceptoId === 's1-c2' })
    expect(f1.pendiente).toBe(true)  // set combinado incluye la ronda 1
    expect(f2.pendiente).toBe(false) // correcta en ambas rondas
  })
})
