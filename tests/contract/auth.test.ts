import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import type { Client } from '@libsql/client'
import { crearDbDePrueba, crearAppDePrueba } from '../helpers/prueba.js'
import { crearMiddlewareAuth, firmarToken } from '../../src/server/api/middleware/auth.js'
import express from 'express'

// T006: contract tests de autenticación (FR-001..004, SC-001)

describe('auth (T005/T006)', function () {
  let app: Express
  let tokenAna: string

  beforeAll(async function () {
    const db = await crearDbDePrueba()
    app = crearAppDePrueba(db)
  })

  it('registra una cuenta nueva con 201 y devuelve token', async function () {
    const respuesta = await request(app)
      .post('/api/auth/registro')
      .send({ email: 'ana@estudio.dev', contrasena: 'claveSegura1', nombre: 'Ana' })
    expect(respuesta.status).toBe(201)
    expect(respuesta.body.token).toBeTruthy()
    expect(respuesta.body.cuenta.email).toBe('ana@estudio.dev')
    expect(respuesta.body.cuenta.nombre).toBe('Ana')
    expect(respuesta.body.cuenta.password_hash).toBeUndefined()
    tokenAna = respuesta.body.token
  })

  it('rechaza email duplicado con 409', async function () {
    const respuesta = await request(app)
      .post('/api/auth/registro')
      .send({ email: 'ana@estudio.dev', contrasena: 'otraClave1', nombre: 'Otra Ana' })
    expect(respuesta.status).toBe(409)
  })

  it('rechaza contraseña corta con 400', async function () {
    const respuesta = await request(app)
      .post('/api/auth/registro')
      .send({ email: 'b@estudio.dev', contrasena: 'corta', nombre: 'B' })
    expect(respuesta.status).toBe(400)
    expect(respuesta.body.error).toContain('8')
  })

  it('rechaza email con formato inválido con 400', async function () {
    const respuesta = await request(app)
      .post('/api/auth/registro')
      .send({ email: 'no-es-un-email', contrasena: 'claveSegura1', nombre: 'C' })
    expect(respuesta.status).toBe(400)
  })

  it('loguea con credenciales correctas y devuelve token de 7 días', async function () {
    const respuesta = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@estudio.dev', contrasena: 'claveSegura1' })
    expect(respuesta.status).toBe(200)
    expect(respuesta.body.token).toBeTruthy()
    // El JWT expira en ~7 días (604800 s de tolerancia de la librería)
    const payload = JSON.parse(Buffer.from(respuesta.body.token.split('.')[1], 'base64url').toString('utf8'))
    const dias = (payload.exp - payload.iat) / 86400
    expect(dias).toBeCloseTo(7, 1)
  })

  it('rechaza login con contraseña incorrecta con 401', async function () {
    const respuesta = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@estudio.dev', contrasena: 'incorrecta1' })
    expect(respuesta.status).toBe(401)
  })

  it('el token del registro valida correctamente en el middleware', async function () {
    expect(tokenAna).toBeTruthy()
    const mini = express()
    mini.use(express.json())
    mini.use(crearMiddlewareAuth(process.env.JWT_SECRET as string))
    mini.get('/prueba', function (req, res) {
      res.status(200).json({ cuentaId: req.cuentaId })
    })
    const ok = await request(mini).get('/prueba').set('Authorization', 'Bearer ' + tokenAna)
    expect(ok.status).toBe(200)
    expect(ok.body.cuentaId).toBeTruthy()
  })
})

describe('middleware JWT (T004)', function () {
  let db: Client

  beforeAll(async function () {
    db = await crearDbDePrueba()
  })

  function miniApp(): Express {
    const mini = express()
    mini.use(crearMiddlewareAuth(process.env.JWT_SECRET as string))
    mini.get('/secreto', function (req, res) {
      res.status(200).json({ cuentaId: req.cuentaId })
    })
    return mini
  }

  it('401 sin header Authorization', async function () {
    const respuesta = await request(miniApp()).get('/secreto')
    expect(respuesta.status).toBe(401)
  })

  it('401 con token inválido', async function () {
    const respuesta = await request(miniApp()).get('/secreto').set('Authorization', 'Bearer no-es-un-token')
    expect(respuesta.status).toBe(401)
  })

  it('401 con token firmado con otro secreto (firma inválida)', async function () {
    const tokenAjeno = firmarToken('cuenta-x', 'otro-secreto-distinto')
    const respuesta = await request(miniApp()).get('/secreto').set('Authorization', 'Bearer ' + tokenAjeno)
    expect(respuesta.status).toBe(401)
  })

  it('401 con token expirado', async function () {
    const jsonwebtoken = await import('jsonwebtoken')
    const expirado = jsonwebtoken.sign({ sub: 'cuenta-x' }, process.env.JWT_SECRET as string, { expiresIn: '-1s' })
    const respuesta = await request(miniApp()).get('/secreto').set('Authorization', 'Bearer ' + expirado)
    expect(respuesta.status).toBe(401)
  })
})
