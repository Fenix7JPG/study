import type { ZodType } from 'zod'

// Cliente común de IA (fuente §5.1, research D3): todas las llamadas al
// modelo pasan por aquí. Exige JSON puro, tolera fences defensivamente,
// valida con zod y reintenta hasta 2 veces ante fallo de parseo/validación
// (1 llamada + 2 reintentos = 3 intentos).

export class ErrorIA extends Error {}

export interface ClienteIA {
  llamar<T>(esquema: ZodType<T>, promptSistema: string, entrada: string): Promise<T>
}

export interface OpcionesClienteIA {
  apiKey: string
  modelo: string
  // Inyectable para pruebas (stub determinista)
  fetchImpl?: typeof fetch
}

const MAX_INTENTOS = 3
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export function crearClienteOpenRouter(opciones: OpcionesClienteIA): ClienteIA {
  const fetchImpl = opciones.fetchImpl ?? fetch

  return {
    async llamar<T>(esquema: ZodType<T>, promptSistema: string, entrada: string): Promise<T> {
      let ultimoError = ''

      for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
        try {
          const respuesta = await fetchImpl(ENDPOINT, {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + opciones.apiKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: opciones.modelo,
              messages: [
                { role: 'system', content: promptSistema },
                { role: 'user', content: entrada }
              ]
            })
          })

          if (!respuesta.ok) {
            throw new Error('respuesta HTTP ' + respuesta.status)
          }

          const cuerpo = (await respuesta.json()) as {
            choices?: Array<{ message?: { content?: unknown } }>
          }
          const contenido = cuerpo?.choices?.[0]?.message?.content
          if (typeof contenido !== 'string') {
            throw new Error('la respuesta no tiene contenido de texto')
          }

          // Tolerancia defensiva a fences antes de declarar fallo de parseo
          const textoLimpio = quitarFences(contenido)
          const datos = JSON.parse(textoLimpio)
          const resultado = esquema.safeParse(datos)
          if (!resultado.success) {
            throw new Error('el JSON no cumple el esquema esperado: ' + resumirError(resultado.error))
          }

          return resultado.data
        } catch (error) {
          ultimoError = error instanceof Error ? error.message : String(error)
        }
      }

      throw new ErrorIA('La llamada a la IA falló tras ' + MAX_INTENTOS + ' intentos. Último error: ' + ultimoError)
    }
  }
}

// Recorta fences de código markdown si el modelo los añadió pese a la
// instrucción del prompt de sistema (antes de contar como fallo de parseo).
export function quitarFences(texto: string): string {
  const recortado = texto.trim()
  if (recortado.startsWith('```')) {
    const sinApertura = recortado.replace(/^```[a-zA-Z]*\s*/, '')
    const sinCierre = sinApertura.replace(/```\s*$/, '')
    return sinCierre.trim()
  }
  return recortado
}

// Resumen legible del primer problema de validación zod
export function resumirError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  if (error.issues.length === 0) {
    return 'error desconocido'
  }
  const primero = error.issues[0]
  const campo = primero.path.map(String).join('.')
  return campo === '' ? primero.message : campo + ': ' + primero.message
}
