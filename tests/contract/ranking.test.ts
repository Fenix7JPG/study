import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, crearAppDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'

// T045: endpoint de ranking POR SESIÓN (FR-034/035/036, 24 h, ganador).

describe('ranking por sesión (T045)', function () {
  let app: Express
  let tokenAna: string
  let tokenBeto: string
  let salaId: string

  beforeAll(async function () {
    const db = await crearDbDePrueba()
    app = crearAppDePrueba(db)
    tokenAna = await registrarCuenta(app, 'ana@rank.test', 'Ana')
    tokenBeto = await registrarCuenta(app, 'beto@rank.test', 'Beto')

    const sala = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    salaId = sala.body.sala.id
    await request(app).post('/api/salas/unirse').set('Authorization', 'Bearer ' + tokenBeto).send({ codigo_invitacion: sala.body.sala.codigoInvitacion })

    // Sesiones recientes con puntos de práctica (dumps 0): Beto gana con 100
    const anaId = (await request(app).get('/api/salas/mias').set('Authorization', 'Bearer ' + tokenAna)).body.salas[0].sala.administradorCuentaId
    const ahora = Date.now()
    await db.execute({
      sql: "INSERT INTO SesionPractica (id, cuenta_id, sala_id, fecha, numero_de_preguntas, puntos_obtenidos_total) VALUES ('s-a', ?, ?, ?, 30, 40)",
      args: [anaId, salaId, new Date(ahora - 3600 * 1000).toISOString()]
    })
    const betoId = (await db.execute({ sql: "SELECT id FROM Cuenta WHERE email = 'beto@rank.test'" })).rows[0][0] as string
    await db.execute({
      sql: "INSERT INTO SesionPractica (id, cuenta_id, sala_id, fecha, numero_de_preguntas, puntos_obtenidos_total) VALUES ('s-b', ?, ?, ?, 30, 100)",
      args: [betoId, salaId, new Date(ahora - 3600 * 1000).toISOString()]
    })
  })

  it('ordena por puntos de la sesión y señala al ganador', async function () {
    const respuesta = await request(app).get('/api/salas/' + salaId + '/ranking').set('Authorization', 'Bearer ' + tokenAna)
    expect(respuesta.status).toBe(200)
    expect(respuesta.body.ranking).not.toBeNull()
    expect(respuesta.body.ranking[0].nombre).toBe('Beto')
    expect(respuesta.body.ranking[0].ganador).toBe(true)
    expect(respuesta.body.ranking[1].nombre).toBe('Ana')
    expect(respuesta.body.ranking[1].ganador).toBe(false)
  })

  it('no miembro de la sala recibe 403', async function () {
    const tokenC = await registrarCuenta(app, 'c@rank.test', 'C')
    const respuesta = await request(app).get('/api/salas/' + salaId + '/ranking').set('Authorization', 'Bearer ' + tokenC)
    expect(respuesta.status).toBe(403)
  })
})
