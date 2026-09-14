import { describe, expect, it } from 'vitest'
import { cargarEnv, ErrorConfiguracion } from '../../src/server/config/env.js'

// T003: validación estricta de variables de entorno (FR-044/045, SC-008)

function envCompleto(): Record<string, string> {
  return {
    OPENROUTER_API_KEY: 'clave',
    OPENROUTER_MODEL: 'modelo',
    TURSO_DATABASE_URL: 'file:datos.db',
    TURSO_AUTH_TOKEN: 'token',
    JWT_SECRET: 'secreto',
    NODE_ENV: 'test',
    PORT: '3000'
  }
}

describe('cargarEnv', function () {
  it('acepta un entorno completo y tipa los valores', function () {
    const env = cargarEnv(envCompleto())
    expect(env.openrouterApiKey).toBe('clave')
    expect(env.port).toBe(3000)
  })

  it('falla nombrando la variable faltante', function () {
    const sinApiKey = envCompleto()
    delete sinApiKey.OPENROUTER_API_KEY
    expect(function () {
      cargarEnv(sinApiKey)
    }).toThrowError(/OPENROUTER_API_KEY/)
  })

  it('falla nombrando TODAS las variables faltantes de una vez', function () {
    const parcial = envCompleto()
    delete parcial.TURSO_DATABASE_URL
    delete parcial.JWT_SECRET
    delete parcial.PORT
    let mensaje = ''
    try {
      cargarEnv(parcial)
    } catch (e) {
      mensaje = e instanceof Error ? e.message : ''
    }
    expect(mensaje).toContain('TURSO_DATABASE_URL')
    expect(mensaje).toContain('JWT_SECRET')
    expect(mensaje).toContain('PORT')
  })

  it('rechaza PORT no numérico', function () {
    const conPortMalo = envCompleto()
    conPortMalo.PORT = 'abc'
    expect(function () {
      cargarEnv(conPortMalo)
    }).toThrowError(ErrorConfiguracion)
  })

  it('no acepta cadenas vacías como valor', function () {
    const conVacio = envCompleto()
    conVacio.JWT_SECRET = ''
    expect(function () {
      cargarEnv(conVacio)
    }).toThrowError(/JWT_SECRET/)
  })
})
