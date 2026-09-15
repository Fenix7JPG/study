import type { Client } from '../../db/client.js'
import type { ClienteIA } from '../ai/openrouter.js'
import { ESQUEMA_GENERACION_FICHAS } from '../ai/esquemas.js'
import { PROMPT_GENERACION_FICHAS } from '../ai/prompts.js'
import { crearFicha, hayFichasDeSeccion, marcarPendiente } from '../models/fichas.js'
import { obtenerDumpDeRonda, type DumpIntento } from '../models/dumps.js'
import { obtenerSeccion, type Seccion } from '../models/secciones.js'
import { listarConceptosFalladosDeRonda } from './conceptos.js'

// Generación automática del banco de fichas (fuente §6.5, US5).
// Se dispara inmediatamente después de calificar la Ronda 2 de una sección
// para una cuenta, dentro del mismo ciclo de backend (sin acción manual).

export class ErrorGeneracionFichas extends Error {}

// ¿Ya está lista la generación para esta cuenta y sección? (FR-026):
// la ronda 2 está calificada Y existen fichas. Si la ronda 2 está calificada
// pero NO hay fichas, la generación falló → botón de reintento.
export async function generacionCompleta(db: Client, cuentaId: string, seccionId: string): Promise<boolean> {
  const ronda2 = await obtenerDumpDeRonda(db, cuentaId, seccionId, 2)
  if (ronda2 === null || ronda2.puntosObtenidos === null) {
    return false
  }
  return hayFichasDeSeccion(db, cuentaId, seccionId)
}

// Genera y guarda el banco de fichas de una cuenta para una sección
export async function generarBancoFichas(
  db: Client,
  clienteIA: ClienteIA,
  cuentaId: string,
  seccionId: string
): Promise<number> {
  const seccion = await obtenerSeccion(db, seccionId)
  if (seccion === null) {
    throw new ErrorGeneracionFichas('sección no encontrada')
  }
  const ronda1 = await obtenerDumpDeRonda(db, cuentaId, seccionId, 1)
  const ronda2 = await obtenerDumpDeRonda(db, cuentaId, seccionId, 2)
  if (ronda2 === null || ronda2.puntosObtenidos === null) {
    throw new ErrorGeneracionFichas('la ronda 2 no está calificada')
  }

  // Entrada: mapa_conceptos completo + faltantes y errores COMBINADOS de
  // las rondas 1 y 2 (fuente §6.5)
  const faltantes = combinarListas(leerLista(ronda1, 'conceptosFaltantes'), leerLista(ronda2, 'conceptosFaltantes'))
  const errores = [...leerErrores(ronda1), ...leerErrores(ronda2)]
  const entrada = JSON.stringify({
    mapa_conceptos: JSON.parse(seccion.mapaConceptos),
    conceptos_faltantes: faltantes,
    errores: errores
  })

  const respuesta = await clienteIA.llamar(ESQUEMA_GENERACION_FICHAS, PROMPT_GENERACION_FICHAS, entrada)

  // Pendiente de nacimiento (regla v2, FR-119): concepto en faltantes o
  // errores COMBINADOS de las rondas 1 y 2 (research D20)
  const falladosCombinados = new Set<string>()
  if (ronda1 !== null) {
    for (const id of listarConceptosFalladosDeRonda(ronda1)) falladosCombinados.add(id)
  }
  for (const id of listarConceptosFalladosDeRonda(ronda2)) falladosCombinados.add(id)

  // Tipo del concepto del mapa original (para el banco portable §8)
  const tiposPorId = new Map<string, string>()
  try {
    const mapa = JSON.parse(seccion.mapaConceptos) as Array<{ id?: string; tipo?: string }>
    for (const concepto of mapa) {
      if (typeof concepto.id === 'string' && typeof concepto.tipo === 'string') {
        tiposPorId.set(concepto.id, concepto.tipo)
      }
    }
  } catch {
    // mapa corrupto: concepto_tipo queda null
  }

  let creadas = 0
  for (const ficha of respuesta.fichas) {
    const pendiente = falladosCombinados.has(ficha.concepto_id)
    await crearFicha(db, {
      cuentaId: cuentaId,
      seccionId: seccionId,
      pregunta: ficha.pregunta,
      respuesta: ficha.respuesta,
      conceptoId: ficha.concepto_id,
      conceptoTipo: tiposPorId.get(ficha.concepto_id) ?? null,
      tipo: ficha.tipo,
      prioridadInicial: ficha.prioridad_inicial,
      pendiente: pendiente
    })
    creadas = creadas + 1
  }
  return creadas
}

// Combina listas de ids sin duplicados
function combinarListas(a: string[], b: string[]): string[] {
  const conjunto = new Set<string>()
  for (const id of a) conjunto.add(id)
  for (const id of b) conjunto.add(id)
  return Array.from(conjunto)
}

function leerLista(intento: DumpIntento | null, campo: 'conceptosFaltantes' | 'conceptosCubiertos'): string[] {
  if (intento === null || intento[campo] === null) {
    return []
  }
  try {
    const datos = JSON.parse(intento[campo] as string)
    return Array.isArray(datos) ? (datos as string[]) : []
  } catch {
    return []
  }
}

function leerErrores(intento: DumpIntento | null): Array<{ id_concepto: string; descripcion_error: string }> {
  if (intento === null || intento.errores === null) {
    return []
  }
  try {
    const datos = JSON.parse(intento.errores as string)
    return Array.isArray(datos) ? (datos as Array<{ id_concepto: string; descripcion_error: string }>) : []
  } catch {
    return []
  }
}

// Re-export para el router (evita importar modelos desde la API directamente)
export { obtenerSeccion, type Seccion }
