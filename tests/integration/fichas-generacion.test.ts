import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'
import { crearStubIA, type StubIA } from '../helpers/stubIA.js'
import { cargarEnv } from '../../src/server/config/env.js'
import { crearApp } from '../../src/server/app.js'
import type { Client } from '@libsql/client'

// T031/T034/T036: generación automática del banco de fichas tras la ronda 2
// (reglas del prompt maestro §6.5), valores SM-2 iniciales, pendientes y
// botón de regenerar (FR-026).

const FICHAS = {
  fichas: [
    { pregunta: '¿Qué fue la Toma de la Bastilla?', respuesta: 'Evento del 14 de julio de 1789.', concepto_id: 's1-c1', tipo: 'estandar', prioridad_inicial: 'alta' },
    { pregunta: '¿Qué fue el Reinado del Terror?', respuesta: 'Periodo de ejecuciones masivas (1793-1794).', concepto_id: 's1-c2', tipo: 'estandar', prioridad_inicial: 'alta' },
    { pregunta: '¿En qué se diferencia la Toma de la Bastilla del Reinado del Terror?', respuesta: 'La Toma fue un evento puntual de 1789; el Terror fue un periodo de 1793-1794.', concepto_id: 's1-c1', tipo: 'discriminacion', prioridad_inicial: 'alta' }
  ]
}

function calif(cobertura: number, faltantes: string[], errores: Array<{ id_concepto: string; descripcion_error: string }>): Record<string, unknown> {
  return {
    cobertura_porcentaje: cobertura,
    conceptos_cubiertos: ['s1-c1', 's1-c2', 's2-c1'].filter(function (id) { return !faltantes.includes(id) }),
    conceptos_faltantes: faltantes,
    errores: errores
  }
}

async function avanzarFase(db: Client, app: Express, token: string, seccionId: string): Promise<request.Response> {
  await db.execute({
    sql: "UPDATE ProgresoSeccion SET fase_termina_en = '2020-01-01T00:00:00.000Z' WHERE seccion_id = ?",
    args: [seccionId]
  })
  return request(app).post('/api/secciones/' + seccionId + '/dump/iniciar').set('Authorization', 'Bearer ' + token)
}

async function completarDosRondas(app: Express, token: string, db: Client, seccionId: string, stub: StubIA, colas: Array<Array<unknown | Error>>): Promise<void> {
  await request(app).post('/api/secciones/' + seccionId + '/dump/iniciar').set('Authorization', 'Bearer ' + token)
  await avanzarFase(db, app, token, seccionId)
  stub.fijar(colas[0])
  const r1 = await request(app).post('/api/secciones/' + seccionId + '/dump/enviar').set('Authorization', 'Bearer ' + token).send({ texto: 'dump ronda 1' })
  expect(r1.status).toBe(200)
  await avanzarFase(db, app, token, seccionId)
  await avanzarFase(db, app, token, seccionId)
  stub.fijar(colas[1])
  const r2 = await request(app).post('/api/secciones/' + seccionId + '/dump/enviar').set('Authorization', 'Bearer ' + token).send({ texto: 'dump ronda 2' })
  expect(r2.status).toBe(200)
}

describe('banco de fichas (T031/T034/T036)', function () {
  let app: Express
  let db: Client
  let stub: StubIA
  let tokenAna: string
  let seccion1: string
  let seccion2: string

  beforeAll(async function () {
    db = await crearDbDePrueba()
    stub = crearStubIA()
    app = crearApp({ db: db, env: cargarEnv(), clienteIA: stub })
    tokenAna = await registrarCuenta(app, 'ana@fichas.test', 'Ana')
    const sala = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    seccion1 = sala.body.secciones[0].id
    seccion2 = sala.body.secciones[1].id
  })

  it('tras la ronda 2 genera y guarda el banco automáticamente (sin acción manual)', async function () {
    // Ronda 1: c2 faltante; ronda 2: errores en c1 y c2 (confundidos entre sí)
    await completarDosRondas(app, tokenAna, db, seccion1, stub, [
      [calif(50, ['s1-c2'], [])],
      [calif(100, [], [
        { id_concepto: 's1-c1', descripcion_error: 'lo confundió con c2' },
        { id_concepto: 's1-c2', descripcion_error: 'lo confundió con c1' }
      ]), FICHAS]
    ])

    // La generación ocurre en el mismo ciclo de backend: sin llamada extra al stub
    const listado = await request(app).get('/api/secciones/' + seccion1 + '/fichas').set('Authorization', 'Bearer ' + tokenAna)
    expect(listado.status).toBe(200)
    expect(listado.body.fichas.length).toBe(3) // c1, c2, discriminación
    expect(listado.body.regenerarDisponible).toBe(false)

    // SM-2 inicial exacto y pendientes según la ronda 2
    for (const ficha of listado.body.fichas) {
      expect(ficha.repeticiones).toBe(0)
      expect(ficha.intervaloDias).toBe(0)
      expect(ficha.factorFacilidad).toBe(2.5)
      expect(ficha.pendiente).toBe(true) // c1 y c2 fallaron en la ronda 2
    }
    const discriminacion = listado.body.fichas.find(function (f: { tipo: string }) { return f.tipo === 'discriminacion' })
    expect(discriminacion).toBeTruthy()
  })

  it('fallo de generación → aviso, regenerarDisponible y POST regenerar funciona (FR-026)', async function () {
    stub.fijar([new Error('generación caída'), new Error('generación caída'), new Error('generación caída')])
    await completarDosRondas(app, tokenAna, db, seccion2, stub, [
      [calif(50, [], [])],
      [calif(90, [], [])]
    ])

    // La generación automática falló: el listado muestra el botón de reintento
    const listado = await request(app).get('/api/secciones/' + seccion2 + '/fichas').set('Authorization', 'Bearer ' + tokenAna)
    expect(listado.body.fichas.length).toBe(0)
    expect(listado.body.regenerarDisponible).toBe(true)

    // Regenerar con la IA recuperada
    stub.fijar([FICHAS])
    const regenerar = await request(app).post('/api/secciones/' + seccion2 + '/fichas/regenerar').set('Authorization', 'Bearer ' + tokenAna)
    expect(regenerar.status).toBe(200)
    expect(regenerar.body.fichas_creadas).toBeGreaterThanOrEqual(1)

    // Ya existen fichas → regenerar de nuevo da 409 y el botón desaparece
    const deNuevo = await request(app).post('/api/secciones/' + seccion2 + '/fichas/regenerar').set('Authorization', 'Bearer ' + tokenAna)
    expect(deNuevo.status).toBe(409)
    const listadoFinal = await request(app).get('/api/secciones/' + seccion2 + '/fichas').set('Authorization', 'Bearer ' + tokenAna)
    expect(listadoFinal.body.regenerarDisponible).toBe(false)
  })
})
