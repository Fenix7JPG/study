import type { ClienteIA } from '../ai/openrouter.js'
import { ESQUEMA_CALIFICACION_PRACTICA, type CalificacionIAPractica } from '../ai/esquemas.js'
import { PROMPT_CALIFICACION_PRACTICA } from '../ai/prompts.js'
import type { Ficha } from '../models/fichas.js'

// Selección de fichas para una sesión de práctica (fuente §6.6, FR-028):
// 1. Las fichas con pendiente = true se incluyen SIEMPRE, sin excepción.
// 2. Luego las fichas con fecha_proximo_repaso ya vencida.
// 3. El resto del cupo se completa con las no vencidas de prioridad más
//    alta primero ("alta" antes que "baja").
// Devuelve las fichas en el orden en que se preguntarán.

export function seleccionarFichas(fichas: Ficha[], tamano: number): Ficha[] {
  const hoy = new Date().toISOString().slice(0, 10)
  const seleccion: Ficha[] = []
  const incluidas = new Set<string>()

  function agregar(lista: Ficha[]): void {
    for (const ficha of lista) {
      if (seleccion.length < tamano && !incluidas.has(ficha.id)) {
        seleccion.push(ficha)
        incluidas.add(ficha.id)
      }
    }
  }

  agregar(fichas.filter(function (f) { return f.pendiente }))
  agregar(fichas.filter(function (f) { return !f.pendiente && f.fechaProximoRepaso <= hoy }))
  agregar(fichas.filter(function (f) { return !f.pendiente && f.fechaProximoRepaso > hoy && f.prioridadInicial === 'alta' }))
  agregar(fichas.filter(function (f) { return !f.pendiente && f.fechaProximoRepaso > hoy && f.prioridadInicial === 'baja' }))

  return seleccion
}

// Llama a la IA para calificar una respuesta de práctica (prompt C, §6.6)
export async function calificarPracticaConIA(
  clienteIA: ClienteIA,
  ficha: Ficha,
  respuestaEscrita: string
): Promise<CalificacionIAPractica> {
  const entrada = JSON.stringify({
    pregunta: ficha.pregunta,
    respuesta_correcta: ficha.respuesta,
    respuesta_escrita: respuestaEscrita
  })
  return clienteIA.llamar(ESQUEMA_CALIFICACION_PRACTICA, PROMPT_CALIFICACION_PRACTICA, entrada)
}
