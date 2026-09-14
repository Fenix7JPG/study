import type { DumpIntento } from '../models/dumps.js'

// Helpers puros sobre los resultados de calificación de dump.

// Conceptos que SIGUEN fallando tras una ronda: faltantes ∪ ids con errores
// (fuente §6.3: tras la Ronda 2 definen pendiente = true)
export function listarConceptosFalladosDeRonda(intento: DumpIntento): Set<string> {
  const fallados = new Set<string>()

  if (intento.conceptosFaltantes !== null) {
    try {
      const faltantes = JSON.parse(intento.conceptosFaltantes)
      if (Array.isArray(faltantes)) {
        for (const id of faltantes) fallados.add(String(id))
      }
    } catch {
      // lista corrupta → se ignora (la calificación guarda JSON válido)
    }
  }

  if (intento.errores !== null) {
    try {
      const errores = JSON.parse(intento.errores)
      if (Array.isArray(errores)) {
        for (const error of errores) {
          if (error && typeof error.id_concepto === 'string') {
            fallados.add(error.id_concepto)
          }
        }
      }
    } catch {
      // idem
    }
  }

  return fallados
}
