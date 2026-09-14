import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'
import { crearStubIA, type StubIA } from '../helpers/stubIA.js'
import { cargarEnv } from '../../src/server/config/env.js'
import { crearApp } from '../../src/server/app.js'
import type { Client } from '@libsql/client'

// T049 (núcleo automatizado): recorrido E2E del MVP con 2 cuentas sobre
// HTTP real de la app (IA simulada con stub): salas → dumps 2 rondas →
// fichas → práctica → ranking por sesión → exportación.

function calif(cobertura: number, cubiertos: string[], faltantes: string[]): Record<string, unknown> {
  return {
    cobertura_porcentaje: cobertura,
    conceptos_cubiertos: cubiertos,
    conceptos_faltantes: faltantes,
    errores: faltantes.map(function (id) {
      return { id_concepto: id, descripcion_error: 'falló' }
    })
  }
}

async function avanzarFase(db: Client, token: string, seccionId: string): Promise<request.Response> {
  await db.execute({
    sql: "UPDATE ProgresoSeccion SET fase_termina_en = '2020-01-01T00:00:00.000Z' WHERE seccion_id = ?",
    args: [seccionId]
  })
  return request(app).post('/api/secciones/' + seccionId + '/dump/iniciar').set('Authorization', 'Bearer ' + token)
}

let app: Express
let db: Client
let stub: StubIA

async function cicloCompletoDeSeccion(token: string, seccionId: string, colas: { r1: unknown; r2: unknown; fichas: unknown }): Promise<void> {
  await request(app).post('/api/secciones/' + seccionId + '/dump/iniciar').set('Authorization', 'Bearer ' + token)
  await avanzarFase(db, token, seccionId)
  stub.fijar([colas.r1])
  const r1 = await request(app).post('/api/secciones/' + seccionId + '/dump/enviar').set('Authorization', 'Bearer ' + token).send({ texto: 'dump r1 de ' + token.slice(0, 6) })
  expect(r1.status).toBe(200)
  await avanzarFase(db, token, seccionId)
  await avanzarFase(db, token, seccionId)
  stub.fijar([colas.r2, colas.fichas])
  const r2 = await request(app).post('/api/secciones/' + seccionId + '/dump/enviar').set('Authorization', 'Bearer ' + token).send({ texto: 'dump r2 de ' + token.slice(0, 6) })
  expect(r2.status).toBe(200)
}

describe('recorrido E2E del MVP (T049)', function () {
  let tokenAna: string
  let tokenBeto: string
  let salaId: string
  let seccion1: string

  beforeAll(async function () {
    db = await crearDbDePrueba()
    stub = crearStubIA()
    app = crearApp({ db: db, env: cargarEnv(), clienteIA: stub })
  })

  it('paso 1-3: registro, creación de sala y unión por código', async function () {
    tokenAna = await registrarCuenta(app, 'ana@e2e.test', 'Ana')
    tokenBeto = await registrarCuenta(app, 'beto@e2e.test', 'Beto')

    const sala = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    expect(sala.status).toBe(201)
    salaId = sala.body.sala.id
    seccion1 = sala.body.secciones[0].id

    const union = await request(app)
      .post('/api/salas/unirse')
      .set('Authorization', 'Bearer ' + tokenBeto)
      .send({ codigo_invitacion: sala.body.sala.codigoInvitacion })
    expect(union.status).toBe(200)
  })

  it('paso 4-5: ambos completan dumps de 2 rondas y reciben fichas', async function () {
    await cicloCompletoDeSeccion(tokenAna, seccion1, {
      r1: calif(50, ['s1-c1'], ['s1-c2']),
      r2: calif(100, ['s1-c1', 's1-c2'], []),
      fichas: { fichas: [
        { pregunta: 'f1', respuesta: 'r1', concepto_id: 's1-c1', tipo: 'estandar', prioridad_inicial: 'baja' },
        { pregunta: 'f2', respuesta: 'r2', concepto_id: 's1-c2', tipo: 'estandar', prioridad_inicial: 'alta' }
      ] }
    })
    await cicloCompletoDeSeccion(tokenBeto, seccion1, {
      r1: calif(0, [], ['s1-c1', 's1-c2']),
      r2: calif(50, ['s1-c1'], ['s1-c2']),
      fichas: { fichas: [
        { pregunta: 'f1', respuesta: 'r1', concepto_id: 's1-c1', tipo: 'estandar', prioridad_inicial: 'alta' },
        { pregunta: 'f2', respuesta: 'r2', concepto_id: 's1-c2', tipo: 'estandar', prioridad_inicial: 'alta' }
      ] }
    })

    const fichasAna = await request(app).get('/api/secciones/' + seccion1 + '/fichas').set('Authorization', 'Bearer ' + tokenAna)
    expect(fichasAna.body.fichas.length).toBe(2)
    const fichasBeto = await request(app).get('/api/secciones/' + seccion1 + '/fichas').set('Authorization', 'Bearer ' + tokenBeto)
    expect(fichasBeto.body.fichas.length).toBe(2)
  })

  it('paso 6-7: ambos practican, cierran sesión y el ranking señala al ganador', async function () {
    async function practicar(token: string, calidades: Array<{ q: number; aluc: boolean }>): Promise<string> {
      const inicio = await request(app)
        .post('/api/practica/iniciar')
        .set('Authorization', 'Bearer ' + token)
        .send({ sala_id: salaId })
      expect(inicio.status).toBe(201)
      for (let i = 0; i < inicio.body.total; i++) {
        const siguiente = await request(app).get('/api/practica/' + inicio.body.sesion.id + '/siguiente').set('Authorization', 'Bearer ' + token)
        if (siguiente.body.ficha === null) break
        stub.fijar([{ puntuacion_calidad: calidades[i].q, alucinacion_detectada: calidades[i].aluc, explicacion: 'ok' }])
        const respuesta = await request(app)
          .post('/api/practica/' + inicio.body.sesion.id + '/responder')
          .set('Authorization', 'Bearer ' + token)
          .send({ ficha_id: siguiente.body.ficha.id, respuesta: 'respuesta de prueba' })
        expect(respuesta.status).toBe(200)
      }
      const resumen = await request(app).get('/api/practica/' + inicio.body.sesion.id + '/resumen').set('Authorization', 'Bearer ' + token)
      expect(resumen.status).toBe(200)
      return resumen.body.puntos_obtenidos_total as string
    }

    const puntosAna = await practicar(tokenAna, [{ q: 5, aluc: false }, { q: 5, aluc: false }])
    const puntosBeto = await practicar(tokenBeto, [{ q: 4, aluc: false }, { q: 4, aluc: false }])
    expect(Number(puntosAna)).toBeGreaterThan(Number(puntosBeto))

    // Ana hizo dumps con bonus y práctica perfecta → Ana gana la sesión
    const ranking = await request(app).get('/api/salas/' + salaId + '/ranking').set('Authorization', 'Bearer ' + tokenAna)
    expect(ranking.body.ranking).not.toBeNull()
    expect(ranking.body.ranking[0].nombre).toBe('Ana')
    expect(ranking.body.ranking[0].ganador).toBe(true)
  })

  it('paso 8: la exportación .apkg de Ana descarga un archivo válido', async function () {
    const respuesta = await request(app)
      .get('/api/export/apkg/todas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .buffer(true)
      .parse(function (res: { on: (e: string, cb: (d: unknown) => void) => void }, cb: (e: Error | null, cuerpo: Buffer) => void) {
        const fragmentos: Buffer[] = []
        res.on('data', function (d) { fragmentos.push(d as Buffer) })
        res.on('end', function () { cb(null, Buffer.concat(fragmentos)) })
      })
    expect(respuesta.status).toBe(200)
    expect((respuesta.body as Buffer)[0]).toBe(0x50)
  })
})
