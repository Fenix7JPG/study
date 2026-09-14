import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { crearClienteOpenRouter, ErrorIA, quitarFences } from '../../src/server/ai/openrouter.js'

// T007: cliente común de IA (FR-021): JSON puro, tolerancia a fences,
// reintentos ×2 ante fallo (3 intentos totales). Stub de fetch inyectable.

const ESQUEMA = z.object({ a: z.number() })

interface StubFetch {
  fetchImpl: typeof fetch
  llamadas: () => number
}

// Fetch falso que entrega una respuesta por llamada (la última se repite)
function crearStubFetch(contenidos: string[], statuses?: number[]): StubFetch {
  let llamada = 0
  const impl = async function (_url: unknown, _opciones: unknown): Promise<Response> {
    const indice = Math.min(llamada, contenidos.length - 1)
    const status = statuses !== undefined ? (statuses[Math.min(llamada, statuses.length - 1)] ?? 200) : 200
    llamada = llamada + 1
    return {
      ok: status >= 200 && status < 300,
      status: status,
      json: async function () {
        return { choices: [{ message: { content: contenidos[indice] } }] }
      }
    } as unknown as Response
  }
  return {
    fetchImpl: impl as typeof fetch,
    llamadas: function () {
      return llamada
    }
  }
}

describe('cliente OpenRouter', function () {
  it('parsea una respuesta JSON válida', async function () {
    const stub = crearStubFetch([JSON.stringify({ a: 1 })])
    const cliente = crearClienteOpenRouter({ apiKey: 'clave', modelo: 'modelo', fetchImpl: stub.fetchImpl })
    const datos = await cliente.llamar(ESQUEMA, 'prompt', 'entrada')
    expect(datos).toEqual({ a: 1 })
    expect(stub.llamadas()).toBe(1)
  })

  it('tolera fences de código markdown', async function () {
    const stub = crearStubFetch(['```json\n{"a": 2}\n```'])
    const cliente = crearClienteOpenRouter({ apiKey: 'clave', modelo: 'modelo', fetchImpl: stub.fetchImpl })
    const datos = await cliente.llamar(ESQUEMA, 'prompt', 'entrada')
    expect(datos).toEqual({ a: 2 })
  })

  it('reintenta hasta 2 veces y luego lanza ErrorIA (3 intentos)', async function () {
    const stub = crearStubFetch(['no es json'])
    const cliente = crearClienteOpenRouter({ apiKey: 'clave', modelo: 'modelo', fetchImpl: stub.fetchImpl })
    await expect(cliente.llamar(ESQUEMA, 'prompt', 'entrada')).rejects.toThrowError(ErrorIA)
    expect(stub.llamadas()).toBe(3)
  })

  it('reintenta cuando el JSON no cumple el esquema y acepta el intento válido', async function () {
    const stub = crearStubFetch([JSON.stringify({ a: 'texto' }), JSON.stringify({ a: 7 })])
    const cliente = crearClienteOpenRouter({ apiKey: 'clave', modelo: 'modelo', fetchImpl: stub.fetchImpl })
    const datos = await cliente.llamar(ESQUEMA, 'prompt', 'entrada')
    expect(datos).toEqual({ a: 7 })
    expect(stub.llamadas()).toBe(2)
  })

  it('reintenta ante error HTTP y acepta el intento válido', async function () {
    const stub = crearStubFetch([JSON.stringify({ a: 9 })], [500, 200])
    const cliente = crearClienteOpenRouter({ apiKey: 'clave', modelo: 'modelo', fetchImpl: stub.fetchImpl })
    const datos = await cliente.llamar(ESQUEMA, 'prompt', 'entrada')
    expect(datos).toEqual({ a: 9 })
    expect(stub.llamadas()).toBe(2)
  })
})

describe('quitarFences', function () {
  it('recorta fences json', function () {
    expect(quitarFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it('recorta fences sin lenguaje', function () {
    expect(quitarFences('```\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it('deja intacto un JSON puro', function () {
    expect(quitarFences('{"a":1}')).toBe('{"a":1}')
  })
})
