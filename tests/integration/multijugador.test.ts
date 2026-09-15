import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'
import { crearStubIA, type StubIA } from '../helpers/stubIA.js'
import { cargarEnv } from '../../src/server/config/env.js'
import { crearApp } from '../../src/server/app.js'
import type { Client } from '@libsql/client'

// T110/T111/T112/T113: Modo 2 Anki multijugador — salas sin documento,
// importación en la sala, pool completo, práctica paralela, ranking con
// cierre y ganador (SC-104/SC-105).

function bancoDe(titulo: string, cuentaId: string, ids: string[]): Record<string, unknown> {
  return {
    version_formato: '1',
    cuenta_id: cuentaId,
    documento_titulo: titulo,
    fichas: ids.map(function (id) {
      return {
        id: id,
        pregunta: 'Pregunta ' + id,
        respuesta: 'Respuesta ' + id,
        concepto_id: '',
        concepto_tipo: 'definicion',
        tipo_ficha: 'estandar',
        prioridad_inicial: 'alta',
        pendiente: false,
        estado_sm2: { repeticiones: 0, intervalo_dias: 0, factor_facilidad: 2.5, fecha_proximo_repaso: '2026-09-15' }
      }
    })
  }
}

describe('modo multijugador (feature 002)', function () {
  let app: Express
  let db: Client
  let stub: StubIA
  let tokenHost: string
  let tokenJugador: string
  let salaId: string

  beforeAll(async function () {
    db = await crearDbDePrueba()
    stub = crearStubIA()
    app = crearApp({ db: db, env: cargarEnv(), clienteIA: stub })
    tokenHost = await registrarCuenta(app, 'host@multi.test', 'Host')
    tokenJugador = await registrarCuenta(app, 'jugador@multi.test', 'Jugador')
  })

  it('crea sala multijugador SIN documento ni ingesta (FR-111)', async function () {
    const respuesta = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenHost)
      .send({ modo: 'multijugador' })
    expect(respuesta.status).toBe(201)
    expect(respuesta.body.sala.modo).toBe('multijugador')
    expect(respuesta.body.sala.documentoId).toBeNull()
    expect(respuesta.body.sala.codigoInvitacion).toBeTruthy()
    salaId = respuesta.body.sala.id
  })

  it('rechaza multijugador con json_ingesta y dump sin ingesta', async function () {
    const conJson = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenHost)
      .send({ modo: 'multijugador', json_ingesta: jsonIngestaDePrueba() })
    expect(conJson.status).toBe(400)
  })

  it('sin fichas importadas NO se puede practicar (FR-112, SC-105)', async function () {
    const union = await request(app)
      .post('/api/salas/unirse')
      .set('Authorization', 'Bearer ' + tokenJugador)
      .send({ codigo_invitacion: (await request(app).get('/api/salas/' + salaId).set('Authorization', 'Bearer ' + tokenHost)).body.sala.codigoInvitacion })
    expect(union.status).toBe(200)

    const practica = await request(app)
      .post('/api/practica/iniciar')
      .set('Authorization', 'Bearer ' + tokenJugador)
      .send({ sala_id: salaId })
    expect(practica.status).toBe(400)
  })

  it('importa el banco en la sala (multipart) y habilita la práctica', async function () {
    const hostId = (await request(app).get('/api/salas/' + salaId).set('Authorization', 'Bearer ' + tokenHost)).body.sala.administradorCuentaId
    const importacion = await request(app)
      .post('/api/import/banco')
      .set('Authorization', 'Bearer ' + tokenHost)
      .attach('archivos', Buffer.from(JSON.stringify(bancoDe('Mi Anki', hostId, ['e1', 'e2']))), 'mi-banco.json')
    expect(importacion.status).toBe(200)
    expect(importacion.body.resultados[0].creadas).toBe(2)

    const practica = await request(app)
      .post('/api/practica/iniciar')
      .set('Authorization', 'Bearer ' + tokenHost)
      .send({ sala_id: salaId, tamano: 2 })
    expect(practica.status).toBe(201)
    // El pool del Modo 2 es TODAS las fichas de la cuenta (importadas aquí)
    expect(practica.body.total).toBe(2)
    // Ambas fichas son pendientes+alta: el orden interno es arbitrario
    expect(practica.body.ficha.pregunta).toMatch(/Pregunta e[12]/)
  })

  it('el pool del Modo 2 incluye también fichas generadas en Modo 1 (SC-105)', async function () {
    // El jugador genera fichas en una sala dump y luego las usa en la multijugador
    const tokenJ2 = tokenJugador
    const salaDump = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenJ2)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    const seccion = salaDump.body.secciones[0].id

    async function avanzar(): Promise<void> {
      await db.execute({
        sql: "UPDATE ProgresoSeccion SET fase_termina_en = '2020-01-01T00:00:00.000Z' WHERE seccion_id = ?",
        args: [seccion]
      })
      await request(app).post('/api/secciones/' + seccion + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenJ2)
    }
    await request(app).post('/api/secciones/' + seccion + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenJ2)
    await avanzar()
    stub.fijar([{ cobertura_porcentaje: 0, conceptos_cubiertos: [], conceptos_faltantes: ['s1-c1'], errores: [] }])
    await request(app).post('/api/secciones/' + seccion + '/dump/enviar').set('Authorization', 'Bearer ' + tokenJ2).send({ texto: 'a' })
    await avanzar()
    await avanzar()
    stub.fijar([
      { cobertura_porcentaje: 0, conceptos_cubiertos: [], conceptos_faltantes: ['s1-c1'], errores: [] },
      { fichas: [
        { pregunta: 'Modo1 f1', respuesta: 'r', concepto_id: 's1-c1', tipo: 'estandar', prioridad_inicial: 'alta' }
      ] }
    ])
    await request(app).post('/api/secciones/' + seccion + '/dump/enviar').set('Authorization', 'Bearer ' + tokenJ2).send({ texto: 'b' })

    // Práctica en la sala multijugador: mezcla fichas importadas (ninguna para
    // J2) y de Modo 1 (1 ficha)
    const practica = await request(app)
      .post('/api/practica/iniciar')
      .set('Authorization', 'Bearer ' + tokenJ2)
      .send({ sala_id: salaId })
    expect(practica.status).toBe(201)
    expect(practica.body.total).toBe(1)
    expect(practica.body.ficha.pregunta).toBe('Modo1 f1')
  })

  it('ranking en vivo SIN ganador mientras hay sesiones abiertas; con cierre del host, ganador (FR-116/117)', async function () {
    // El host responde su primera pregunta (sesión abierta)
    const inicio = await request(app).post('/api/practica/iniciar').set('Authorization', 'Bearer ' + tokenHost).send({ sala_id: salaId, tamano: 2 })
    const siguiente = await request(app).get('/api/practica/' + inicio.body.sesion.id + '/siguiente').set('Authorization', 'Bearer ' + tokenHost)
    stub.fijar([{ puntuacion_calidad: 5, alucinacion_detectada: false, explicacion: 'ok' }])
    await request(app).post('/api/practica/' + inicio.body.sesion.id + '/responder')
      .set('Authorization', 'Bearer ' + tokenHost)
      .send({ ficha_id: siguiente.body.ficha.id, respuesta: 'respuesta' })

    const enVivo = await request(app).get('/api/salas/' + salaId + '/ranking').set('Authorization', 'Bearer ' + tokenHost)
    expect(enVivo.body.ranking).not.toBeNull()
    expect(enVivo.body.ranking[0].ganador).toBe(false) // en vivo, sin ganador

    // Host cierra la sala → ganador señalado y sala congelada
    const cierre = await request(app).patch('/api/salas/' + salaId + '/cerrar').set('Authorization', 'Bearer ' + tokenHost)
    expect(cierre.status).toBe(200)
    const conGanador = await request(app).get('/api/salas/' + salaId + '/ranking').set('Authorization', 'Bearer ' + tokenHost)
    expect(conGanador.body.ranking[0].ganador).toBe(true)
    expect(conGanador.body.salaCerrada).toBe(true)

    // Doble cierre → 409
    const otraVez = await request(app).patch('/api/salas/' + salaId + '/cerrar').set('Authorization', 'Bearer ' + tokenHost)
    expect(otraVez.status).toBe(409)
  })

  it('no-admin no puede cerrar la sala (403)', async function () {
    const otra = await request(app).post('/api/salas').set('Authorization', 'Bearer ' + tokenHost).send({ modo: 'multijugador' })
    const respuesta = await request(app).patch('/api/salas/' + otra.body.sala.id + '/cerrar').set('Authorization', 'Bearer ' + tokenJugador)
    expect(respuesta.status).toBe(403)
  })
})
