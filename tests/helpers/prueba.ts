import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient, type Client } from '@libsql/client'
import { inicializarSchema } from '../../src/db/client.js'
import { ejecutarMigraciones } from '../../src/db/migraciones.js'
import { crearApp } from '../../src/server/app.js'
import { cargarEnv } from '../../src/server/config/env.js'
import type { Express } from 'express'

// Helpers de prueba: base de datos libSQL local (modo file:) con esquema
// fresco por test, y app con el env de prueba ya cargado (research D6).

const DIR_TESTS = '.tmp-tests'

export async function crearDbDePrueba(): Promise<Client> {
  mkdirSync(DIR_TESTS, { recursive: true })
  const url = 'file:' + join(DIR_TESTS, 'test-' + randomUUID() + '.db')
  const db = createClient({ url: url })
  await inicializarSchema(db)
  await ejecutarMigraciones(db)
  return db
}

export function crearAppDePrueba(db: Client): Express {
  const env = cargarEnv()
  return crearApp({ db: db, env: env })
}

// Registra una cuenta de prueba y devuelve su token (atajo para contract tests)
export async function registrarCuenta(
  app: Express,
  email: string,
  nombre: string,
  contrasena = 'claveSegura1'
): Promise<string> {
  const { default: request } = await import('supertest')
  const respuesta = await request(app)
    .post('/api/auth/registro')
    .send({ email: email, contrasena: contrasena, nombre: nombre })
  if (respuesta.status !== 201) {
    throw new Error('el registro de prueba falló con estado ' + String(respuesta.status))
  }
  return respuesta.body.token as string
}

// JSON de ingesta válido de ejemplo (esquema del prompt maestro, 2 secciones)
export function jsonIngestaDePrueba(): Record<string, unknown> {
  return {
    documento: {
      titulo: 'Historia Universal',
      secciones: [
        {
          id: 's1',
          titulo: 'Revolución Francesa',
          orden: 1,
          num_palabras: 350,
          contenido: [{ tipo: 'texto', valor: 'La Revolución Francesa comenzó en 1789.' }],
          mapa_conceptos: [
            { id: 's1-c1', concepto: 'Toma de la Bastilla', explicacion: 'Evento del 14 de julio de 1789.', tipo: 'dato' },
            { id: 's1-c2', concepto: 'Reinado del Terror', explicacion: 'Periodo de ejecuciones masivas (1793-1794).', tipo: 'definicion' }
          ]
        },
        {
          id: 's2',
          titulo: 'Restauración',
          orden: 2,
          num_palabras: 120,
          contenido: [{ tipo: 'texto', valor: 'Tras Napoleón se restauró la monarquía borbónica.' }],
          mapa_conceptos: [
            { id: 's2-c1', concepto: 'Congreso de Viena', explicacion: 'Reordenamiento europeo de 1815.', tipo: 'relacion' }
          ]
        }
      ]
    }
  }
}
