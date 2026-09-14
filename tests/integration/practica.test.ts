import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'
import { crearStubIA, type StubIA } from '../helpers/stubIA.js'
import { cargarEnv } from '../../src/server/config/env.js'
import { crearApp } from '../../src/server/app.js'
import type { Client } from '@libsql/client'

// T039/T040/T041: práctica completa — calificación IA 0–5 con cap de
// alucinación, SM-2 exacto y puntos §8.2 sin piso (pueden ser negativos).

async function avanzarFase(db: Client, app: Express, token: string, seccionId: string): Promise<request.Response> {
  await db.execute({
    sql: "UPDATE ProgresoSeccion SET fase_termina_en = '2020-01-01T00:00:00.000Z' WHERE seccion_id = ?",
    args: [seccionId]
  })
  return request(app).post('/api/secciones/' + seccionId + '/dump/iniciar').set('Authorization', 'Bearer ' + token)
}

describe('práctica con SM-2 y puntos (T039–T041)', function () {
  let app: Express
  let db: Client
  let stub: StubIA
  let tokenAna: string
  let seccion: string
  let sesionId: string

  beforeAll(async function () {
    db = await crearDbDePrueba()
    stub = crearStubIA()
    app = crearApp({ db: db, env: cargarEnv(), clienteIA: stub })
    tokenAna = await registrarCuenta(app, 'ana@practica.test', 'Ana')

    const sala = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    const salaId = sala.body.sala.id
    seccion = sala.body.secciones[0].id

    // Llenar el banco de fichas: 3 fichas via regenerar (después de ronda 2)
    await request(app).post('/api/secciones/' + seccion + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenAna)
    await avanzarFase(db, app, tokenAna, seccion)
    stub.fijar([{ cobertura_porcentaje: 0, conceptos_cubiertos: [], conceptos_faltantes: ['s1-c1', 's1-c2'], errores: [] }])
    await request(app).post('/api/secciones/' + seccion + '/dump/enviar').set('Authorization', 'Bearer ' + tokenAna).send({ texto: 'x' })
    await avanzarFase(db, app, tokenAna, seccion)
    await avanzarFase(db, app, tokenAna, seccion)
    stub.fijar([{ cobertura_porcentaje: 0, conceptos_cubiertos: [], conceptos_faltantes: ['s1-c1', 's1-c2'], errores: [] }])
    await request(app).post('/api/secciones/' + seccion + '/dump/enviar').set('Authorization', 'Bearer ' + tokenAna).send({ texto: 'y' })
    stub.fijar([{
      fichas: [
        { pregunta: 'f1', respuesta: 'r1', concepto_id: 's1-c1', tipo: 'estandar', prioridad_inicial: 'alta' },
        { pregunta: 'f2', respuesta: 'r2', concepto_id: 's1-c2', tipo: 'estandar', prioridad_inicial: 'alta' },
        { pregunta: 'f3', respuesta: 'r3', concepto_id: 's1-c1', tipo: 'discriminacion', prioridad_inicial: 'alta' }
      ]
    }])
    await request(app).post('/api/secciones/' + seccion + '/fichas/regenerar').set('Authorization', 'Bearer ' + tokenAna)
    void salaId
  })

  it('inicia sesión con tamaño configurable y entrega la primera ficha', async function () {
    const inicio = await request(app)
      .post('/api/practica/iniciar')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ sala_id: (await request(app).get('/api/salas/mias').set('Authorization', 'Bearer ' + tokenAna)).body.salas[0].sala.id, tamano: 3 })
    expect(inicio.status).toBe(201)
    expect(inicio.body.total).toBe(3)
    expect(inicio.body.ficha.pregunta).toBeTruthy()
    sesionId = inicio.body.sesion.id
  })

  it('responder sin alucinación: calidad 4, SM-2 primera repetición, +40 puntos', async function () {
    const siguiente = await request(app).get('/api/practica/' + sesionId + '/siguiente').set('Authorization', 'Bearer ' + tokenAna)
    stub.fijar([{ puntuacion_calidad: 4, alucinacion_detectada: false, explicacion: 'casi completa' }])
    const respuesta = await request(app)
      .post('/api/practica/' + sesionId + '/responder')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ ficha_id: siguiente.body.ficha.id, respuesta: 'mi respuesta' })
    expect(respuesta.status).toBe(200)
    expect(respuesta.body.puntuacion_calidad).toBe(4)
    expect(respuesta.body.puntos_obtenidos).toBe(40)
    expect(respuesta.body.respuesta_correcta).toBeTruthy()

    // SM-2: primera repetición acertada → repeticiones 1, intervalo 1
    const fichas = await request(app).get('/api/secciones/' + seccion + '/fichas').set('Authorization', 'Bearer ' + tokenAna)
    const respondida = fichas.body.fichas.find(function (f: { id: string }) { return f.id === siguiente.body.ficha.id })
    expect(respondida.repeticiones).toBe(1)
    expect(respondida.intervaloDias).toBe(1)
    // pendiente se limpia al acertar (q ≥ 3)
    expect(respondida.pendiente).toBe(false)
  })

  it('responder con alucinación: calidad capada a 2 y penalización −15 (FR-030/§8.2)', async function () {
    const siguiente = await request(app).get('/api/practica/' + sesionId + '/siguiente').set('Authorization', 'Bearer ' + tokenAna)
    stub.fijar([{ puntuacion_calidad: 5, alucinacion_detectada: true, explicacion: 'inventó cifras' }])
    const respuesta = await request(app)
      .post('/api/practica/' + sesionId + '/responder')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ ficha_id: siguiente.body.ficha.id, respuesta: 'inventé datos' })
    expect(respuesta.body.alucinacion_detectada).toBe(true)
    expect(respuesta.body.puntuacion_calidad).toBe(2) // cap: ≤2 sin excepción
    expect(respuesta.body.puntos_obtenidos).toBe(20 - 15)

    // SM-2 con q=2 (fallo): repeticiones 0, intervalo 1
    const fichas = await request(app).get('/api/secciones/' + seccion + '/fichas').set('Authorization', 'Bearer ' + tokenAna)
    const respondida = fichas.body.fichas.find(function (f: { id: string }) { return f.id === siguiente.body.ficha.id })
    expect(respondida.repeticiones).toBe(0)
    expect(respondida.intervaloDias).toBe(1)
  })

  it('responder alucinación con calidad 0 → puntos NEGATIVOS sin piso (§8.2)', async function () {
    const siguiente = await request(app).get('/api/practica/' + sesionId + '/siguiente').set('Authorization', 'Bearer ' + tokenAna)
    stub.fijar([{ puntuacion_calidad: 0, alucinacion_detectada: true, explicacion: 'nada relacionado' }])
    const respuesta = await request(app)
      .post('/api/practica/' + sesionId + '/responder')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ ficha_id: siguiente.body.ficha.id, respuesta: 'blablabla inventado' })
    expect(respuesta.body.puntos_obtenidos).toBe(-15)
  })

  it('no se puede responder una ficha que no es la actual', async function () {
    const siguiente = await request(app).get('/api/practica/' + sesionId + '/siguiente').set('Authorization', 'Bearer ' + tokenAna)
    if (siguiente.body.ficha === null) {
      return // sesión ya cerrada: no aplica
    }
    stub.fijar([{ puntuacion_calidad: 3, alucinacion_detectada: false, explicacion: 'ok' }])
    const respuesta = await request(app)
      .post('/api/practica/' + sesionId + '/responder')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ ficha_id: 'id-que-no-es-la-actual', respuesta: 'x' })
    expect(respuesta.status).toBe(409)
  })

  it('al completar el tamaño, la sesión cierra y el resumen coincide (SC-006)', async function () {
    const siguiente = await request(app).get('/api/practica/' + sesionId + '/siguiente').set('Authorization', 'Bearer ' + tokenAna)
    if (siguiente.body.ficha !== null) {
      stub.fijar([{ puntuacion_calidad: 3, alucinacion_detectada: false, explicacion: 'ok' }])
      await request(app)
        .post('/api/practica/' + sesionId + '/responder')
        .set('Authorization', 'Bearer ' + tokenAna)
        .send({ ficha_id: siguiente.body.ficha.id, respuesta: 'x' })
    }
    const cerrada = await request(app).get('/api/practica/' + sesionId + '/siguiente').set('Authorization', 'Bearer ' + tokenAna)
    expect(cerrada.body.sesion_cerrada).toBe(true)

    const masRespuestas = await request(app)
      .post('/api/practica/' + sesionId + '/responder')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ ficha_id: 'x', respuesta: 'x' })
    expect(masRespuestas.status).toBe(409)

    const resumen = await request(app).get('/api/practica/' + sesionId + '/resumen').set('Authorization', 'Bearer ' + tokenAna)
    expect(resumen.body.respondidas).toBe(3)
    // 40 + 5 + (−15) = 30
    expect(resumen.body.puntos_obtenidos_total).toBe(30)
    expect(resumen.body.por_pregunta.length).toBe(3)
  })
})
