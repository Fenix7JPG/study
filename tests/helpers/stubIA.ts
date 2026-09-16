import type { ZodType } from 'zod'
import type { ClienteIA } from '../../src/server/ai/openrouter.js'

// Stub determinista de la IA para tests (research D3/D6): una cola de
// respuestas que se consume por llamada; un Error en la cola simula fallo.
// Ningún test depende de red.

export interface StubIA extends ClienteIA {
  fijar: (cola: Array<unknown | Error>) => void
  llamadas: () => number
  ultimaEntrada: () => string
}

export function crearStubIA(): StubIA {
  const cola: Array<unknown | Error> = []
  let total = 0
  let ultima = ''
  return {
    async llamar<T>(esquema: ZodType<T>, _prompt: string, entrada: string): Promise<T> {
      total = total + 1
      ultima = entrada
      const siguiente = cola.length > 0 ? cola.shift() : new Error('stub sin respuesta configurada')
      if (siguiente instanceof Error) {
        throw siguiente
      }
      const parsed = esquema.safeParse(siguiente)
      if (!parsed.success) {
        throw new Error('la respuesta del stub no cumple el esquema: ' + JSON.stringify(siguiente))
      }
      return parsed.data
    },
    fijar: function (nueva: Array<unknown | Error>): void {
      cola.length = 0
      for (const item of nueva) cola.push(item)
    },
    llamadas: function (): number {
      return total
    },
    ultimaEntrada: function (): string {
      return ultima
    }
  }
}
