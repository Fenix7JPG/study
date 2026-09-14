// Cálculo de tiempos por sección (fuente §6.2, FR-010 y precedencia del
// analyze B2): si el administrador fijó un valor en la sala, ESE valor
// prevalece; si no, se calcula por sección a partir de num_palabras:
// - ≤400 palabras → 2 minutos.
// - Más palabras → proporcional: +1 minuto por cada 130–150 palabras
//   adicionales (usamos 140, punto medio del rango), redondeado al minuto
//   más cercano.

const PALABRAS_BASE = 400
const MINUTOS_BASE = 2
const PALABRAS_POR_MINUTO_EXTRA = 140

export function tiempoFaseSeccion(numPalabras: number, overrideAdmin: number | null): number {
  // Precedencia: el valor fijado por el administrador gana siempre
  if (overrideAdmin !== null && overrideAdmin !== undefined) {
    return overrideAdmin
  }
  if (numPalabras <= PALABRAS_BASE) {
    return MINUTOS_BASE
  }
  const proporcion = MINUTOS_BASE + (numPalabras - PALABRAS_BASE) / PALABRAS_POR_MINUTO_EXTRA
  return Math.round(proporcion)
}

// Tiempo de visualización de retroalimentación: por defecto 2 minutos,
// solo configurable por el administrador (no depende de num_palabras)
export function tiempoResultados(overrideAdmin: number | null): number {
  if (overrideAdmin !== null && overrideAdmin !== undefined) {
    return overrideAdmin
  }
  return MINUTOS_BASE
}
