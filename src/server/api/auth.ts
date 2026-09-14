import { Router } from 'express'
import bcrypt from 'bcryptjs'
import type { Client } from '../../db/client.js'
import { crearCuenta, buscarCuentaPorEmail, cuentaPublica } from '../models/cuentas.js'
import { firmarToken } from './middleware/auth.js'

// Endpoints de autenticación (fuente §3.1):
// - Registro: email único con formato, contraseña ≥ 8, nombre visible.
// - Login: email + contraseña → JWT firmado con 7 días de expiración.
// - Contraseñas SOLO como hash bcrypt con factor de costo 12.

const COSTO_BCRYPT = 12
const DIAS_TOKEN = 7

// Validación simple de formato de email
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function crearRouterAuth(db: Client, jwtSecret: string): Router {
  const router = Router()

  // POST /api/auth/registro
  router.post('/registro', async (req, res) => {
    const cuerpo = req.body ?? {}
    const email = typeof cuerpo.email === 'string' ? cuerpo.email.trim().toLowerCase() : ''
    const contrasena = typeof cuerpo.contrasena === 'string' ? cuerpo.contrasena : ''
    const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''

    // Validaciones con mensaje específico (FR-001)
    if (email === '' || !FORMATO_EMAIL.test(email)) {
      res.status(400).json({ error: 'email inválido o faltante' })
      return
    }
    if (contrasena.length < 8) {
      res.status(400).json({ error: 'la contraseña debe tener al menos 8 caracteres' })
      return
    }
    if (nombre === '') {
      res.status(400).json({ error: 'nombre faltante' })
      return
    }

    // Email único: rechazo preventivo con 409
    const existente = await buscarCuentaPorEmail(db, email)
    if (existente !== null) {
      res.status(409).json({ error: 'el email ya está registrado' })
      return
    }

    // La contraseña se guarda SOLO como hash bcrypt costo 12 (FR-002)
    const passwordHash = await bcrypt.hash(contrasena, COSTO_BCRYPT)
    const cuenta = await crearCuenta(db, { email: email, passwordHash: passwordHash, nombre: nombre })

    res.status(201).json({
      token: firmarToken(cuenta.id, jwtSecret),
      cuenta: cuentaPublica(cuenta)
    })
  })

  // POST /api/auth/login
  router.post('/login', async (req, res) => {
    const cuerpo = req.body ?? {}
    const email = typeof cuerpo.email === 'string' ? cuerpo.email.trim().toLowerCase() : ''
    const contrasena = typeof cuerpo.contrasena === 'string' ? cuerpo.contrasena : ''

    const cuenta = await buscarCuentaPorEmail(db, email)
    if (cuenta === null) {
      res.status(401).json({ error: 'credenciales inválidas' })
      return
    }

    // Comparación contra el hash almacenado
    const coincide = await bcrypt.compare(contrasena, cuenta.passwordHash)
    if (!coincide) {
      res.status(401).json({ error: 'credenciales inválidas' })
      return
    }

    // Token válido por 7 días (FR-003)
    res.status(200).json({
      token: firmarToken(cuenta.id, jwtSecret),
      cuenta: cuentaPublica(cuenta)
    })
  })

  return router
}
