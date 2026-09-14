import { randomUUID } from 'node:crypto'
import type { Client } from '../../db/client.js'

// Acceso a datos de la entidad Cuenta (data-model.md).
// Todas las consultas filtran por la cuenta autenticada cuando aplica.

export interface FilaCuenta {
  id: string
  email: string
  passwordHash: string
  nombre: string
  fechaRegistro: string
}

export interface CuentaPublica {
  id: string
  email: string
  nombre: string
}

export interface DatosCuentaNueva {
  email: string
  passwordHash: string
  nombre: string
}

// Convierte una fila (orden de columnas del SELECT) a FilaCuenta
function mapearFila(fila: ArrayLike<unknown>): FilaCuenta {
  return {
    id: fila[0] as string,
    email: fila[1] as string,
    passwordHash: fila[2] as string,
    nombre: fila[3] as string,
    fechaRegistro: fila[4] as string
  }
}

export async function crearCuenta(db: Client, datos: DatosCuentaNueva): Promise<FilaCuenta> {
  const id = randomUUID()
  const fechaRegistro = new Date().toISOString()
  await db.execute({
    sql: 'INSERT INTO Cuenta (id, email, password_hash, nombre, fecha_registro) VALUES (?, ?, ?, ?, ?)',
    args: [id, datos.email, datos.passwordHash, datos.nombre, fechaRegistro]
  })
  return { id, email: datos.email, passwordHash: datos.passwordHash, nombre: datos.nombre, fechaRegistro: fechaRegistro }
}

// Busca por email (usado en registro para detectar duplicados y en login)
export async function buscarCuentaPorEmail(db: Client, email: string): Promise<FilaCuenta | null> {
  const resultado = await db.execute({
    sql: 'SELECT id, email, password_hash, nombre, fecha_registro FROM Cuenta WHERE email = ?',
    args: [email]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearFila(resultado.rows[0])
}

// Busca por id (usado por endpoints que ya validaron el JWT)
export async function buscarCuentaPorId(db: Client, id: string): Promise<FilaCuenta | null> {
  const resultado = await db.execute({
    sql: 'SELECT id, email, password_hash, nombre, fecha_registro FROM Cuenta WHERE id = ?',
    args: [id]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearFila(resultado.rows[0])
}

// Proyección pública: NUNCA expone el hash de la contraseña
export function cuentaPublica(cuenta: FilaCuenta): CuentaPublica {
  return { id: cuenta.id, email: cuenta.email, nombre: cuenta.nombre }
}
