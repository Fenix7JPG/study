import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'
import { crearStubIA, type StubIA } from '../helpers/stubIA.js'
import { cargarEnv } from '../../src/server/config/env.js'
import { crearApp } from '../../src/server/app.js'
import type { Client } from '@libsql/client'

// Feature 004: práctica del dump infinita — sin tamaño, sin cierre por conteo,
// re-selección automática, y cierre por el host con resumen (FR-301..305).

function calif(cobertura: number): Record<string, unknown> {
  return { cobertura_porcentaje: cobertura, conceptos_cubiertos: ['s1-c1', 's1-c2'], conceptos_faltantes: [], errores: [] }
}

async function avanzarFase(db: Client, app: Express, token: string, seccionId: string): Promise<void> {
  await db.execute({
    sql: "UPDATE ProgresoSeccion SET fase_termina_en = '2020-01-01T00:00:00.000Z' WHERE seccion_id = ?",
    args: [seccionId]
  })
  await request(app).post('/api/secciones/' + seccionId + '/dump/iniciar').set('Authorization', 'Bearer ' + token)
}

describe('dump infinito (feature 004)', function () {
  let app: Express
  let db: Client
  let stub: StubIA
  let tokenHost: string
  let salaId: string

  beforeAll(async function () {
    db = await crearDbDePrueba()
    stub = crearStubIA()
    app = crearApp({ db: db, env: cargarEnv(), clienteIA: stub })
    tokenHost = await registrarCuenta(app, 'host@inf.test', 'Host')

    const sala = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenHost)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    salaId = sala.body.sala.id
    const seccion = sala.body.secciones[0].id

    // Banco: 2 rondas + 2 fichas
    await request(app).post('/api/secciones/' + seccion + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenHost)
    await avanzarFase(db, app, tokenHost, seccion)
    stub.fijar([calif(50)])
    await request(app).post('/api/secciones/' + seccion + '/dump/enviar').set('Authorization', 'Bearer ' + tokenHost).send({ texto: 'r1' })
    await avanzarFase(db, app, tokenHost, seccion)
    await avanzarFase(db, app, tokenHost, seccion)
    stub.fijar([
      // Ronda 2 falla ambos conceptos → ambas fichas nacen PENDIENTES (siempre
      // incluidas en la re-selección, sin importar la fecha de repaso)
      { cobertura_porcentaje: 0, conceptos_cubiertos: [], conceptos_faltantes: ['s1-c1', 's1-c2'], errores: [] },
      { fichas: [
        { pregunta: 'f1', respuesta: 'r1', concepto_id: 's1-c1', tipo: 'estandar', prioridad_inicial: 'baja' },
        { pregunta: 'f2', respuesta: 'r2', concepto_id: 's1-c2', tipo: 'estandar', prioridad_inicial: 'baja' }
      ] }
    ])
    await request(app).post('/api/secciones/' + seccion + '/dump/enviar').set('Authorization', 'Bearer ' + tokenHost).send({ texto: 'r2' })
  })

  it('inicia práctica en dump sin tamaño y la cola se EXTIENDE al agotarse (FR-301/302)', async function () {
    // Responder 3 veces seguidas con solo 2 fichas: la cola debe re-seleccionar
    const inicio = await request(app).post('/api/practica/iniciar').set('Authorization', 'Bearer ' + tokenHost).send({ sala_id: salaId })
    expect(inicio.status).toBe(201)
    const sesionId = inicio.body.sesion.id

    for (let i = 0; i < 3; i++) {
      const siguiente = await request(app).get('/api/practica/' + sesionId + '/siguiente').set('Authorization', 'Bearer ' + tokenHost)
      if (siguiente.body.sesion_cerrada) console.log('SIGUIENTE BODY:', JSON.stringify(siguiente.body))
      expect(siguiente.body.sesion_cerrada).toBe(false)
      expect(siguiente.body.ficha).not.toBeNull()
      stub.fijar([{ puntuacion_calidad: [4, 2, 4][i], alucinacion_detectada: false, explicacion: 'ok' }])
      const respuesta = await request(app)
        .post('/api/practica/' + sesionId + '/responder')
        .set('Authorization', 'Bearer ' + tokenHost)
        .send({ ficha_id: siguiente.body.ficha.id, respuesta: 'respuesta de prueba' })
      expect(respuesta.status).toBe(200)
    }

    // Con 2 fichas y 3 respuestas, la cola creció por re-selección (infinito)
    const sesion = await db.execute({ sql: 'SELECT LENGTH(fichas_ids) - LENGTH(REPLACE(fichas_ids, \',\', \'\')) + 1 AS n FROM SesionPractica WHERE id = ?', args: [sesionId] })
    const tamañoCola = Number((sesion.rows[0] as ArrayLike<unknown>)[0])
    expect(tamañoCola).toBeGreaterThanOrEqual(3)
  })

  it('el host TERMINA la sesión → cerrada para todos + ranking con ganador (FR-303/SC-302/303)', async function () {
    const terminar = await request(app).post('/api/salas/' + salaId + '/terminar-practica').set('Authorization', 'Bearer ' + tokenHost)
    expect(terminar.status).toBe(200)
    expect(terminar.body.sesiones_cerradas).toBeGreaterThanOrEqual(1)

    // Cualquier /siguiente de una sesión cerrada responde cerrada
    const inicioViejo = await request(app).post('/api/practica/iniciar').set('Authorization', 'Bearer ' + tokenHost).send({ sala_id: salaId })
    const sesionId = inicioViejo.body.sesion.id
    await request(app).post('/api/salas/' + salaId + '/terminar-practica').set('Authorization', 'Bearer ' + tokenHost)
    const siguiente = await request(app).get('/api/practica/' + sesionId + '/siguiente').set('Authorization', 'Bearer ' + tokenHost)
    console.log('TRAS CERRAR:', JSON.stringify(siguiente.body))
    expect(siguiente.body.sesion_cerrada).toBe(true)
    expect(siguiente.body.cerrada_por_host).toBe(true)

    // Resumen disponible tras el cierre
    const resumen = await request(app).get('/api/practica/' + sesionId + '/resumen').set('Authorization', 'Bearer ' + tokenHost)
    expect(resumen.status).toBe(200)

    // Ranking con un solo participante y sesión cerrada → ganador
    const ranking = await request(app).get('/api/salas/' + salaId + '/ranking').set('Authorization', 'Bearer ' + tokenHost)
    console.log('RANKING BODY:', JSON.stringify(ranking.body))
    expect(ranking.body.ranking).not.toBeNull()
    expect(ranking.body.ranking[0].ganador).toBe(true)
  })

  it('solo el host puede terminar (403)', async function () {
    const tokenOtro = await registrarCuenta(app, 'otro@inf.test', 'Otro')
    const otra = await request(app).post('/api/salas').set('Authorization', 'Bearer ' + tokenOtro).send({ json_ingesta: jsonIngestaDePrueba() })
    const respuesta = await request(app).post('/api/salas/' + otra.body.sala.id + '/terminar-practica').set('Authorization', 'Bearer ' + tokenHost)
    expect(respuesta.status).toBe(403)
  })

  it('"Mis salas" solo muestra salas activas o recientes (FR-305)', async function () {
    // Cerrar la sala por completo (simula "todo terminó hace 2 días")
    await db.execute({
      sql: "UPDATE SesionPractica SET cerrada_en = '2020-01-01T00:00:00.000Z', fecha = '2020-01-01T00:00:00.000Z' WHERE sala_id = ?",
      args: [salaId]
    })
    const mias = await request(app).get('/api/salas/mias').set('Authorization', 'Bearer ' + tokenHost)
    const ids = mias.body.salas.map(function (s: { sala: { id: string } }) { return s.sala.id })
    expect(ids).not.toContain(salaId) // sin actividad reciente → oculta
  })
})
