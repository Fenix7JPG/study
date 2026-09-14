// Fórmulas de puntos (fuente §8.1 y §8.2) con valores configurables por el
// administrador de la sala; los valores por defecto son los de la fuente.

export interface ValoresPuntuacion {
  puntoPorCubierto: number
  puntoPorFaltante: number
  penalizacionPorError: number
  bonusMejora: number
  penalizacionAlucinacion: number
}

export const VALORES_DEFECTO: ValoresPuntuacion = {
  puntoPorCubierto: 10,
  puntoPorFaltante: 0,
  penalizacionPorError: 5,
  bonusMejora: 20,
  penalizacionAlucinacion: 15
}

// §8.1: puntos de una ronda de dump (sin el bonus de mejora)
export function puntosPorRonda(
  cantCubiertos: number,
  cantFaltantes: number,
  cantErrores: number,
  valores: ValoresPuntuacion = VALORES_DEFECTO
): number {
  return (
    cantCubiertos * valores.puntoPorCubierto +
    cantFaltantes * valores.puntoPorFaltante -
    cantErrores * valores.penalizacionPorError
  )
}

// §8.1 bonus de mejora: +valores.bonusMejora UNA sola vez si la cobertura de
// la Ronda 2 es mayor que la de la Ronda 1 de la misma sección
export function bonusPorMejora(
  coberturaRonda1: number | null,
  coberturaRonda2: number,
  valores: ValoresPuntuacion = VALORES_DEFECTO
): number {
  if (coberturaRonda1 !== null && coberturaRonda2 > coberturaRonda1) {
    return valores.bonusMejora
  }
  return 0
}

// §8.2: puntos de una pregunta de práctica. Puede resultar NEGATIVO y NO se
// aplica piso en 0 (para desincentivar inventar información).
export function puntosPractica(
  puntuacionCalidad: number,
  huboAlucinacion: boolean,
  valores: ValoresPuntuacion = VALORES_DEFECTO
): number {
  const puntosBase = puntuacionCalidad * 10
  const penalizacion = huboAlucinacion ? valores.penalizacionAlucinacion : 0
  return puntosBase - penalizacion
}

// Lee config_valores_puntuacion (JSON) de la sala y la combina con los
// valores por defecto; cualquier campo ausente o inválido usa el defecto.
export function valoresDeSala(configValoresPuntuacion: string): ValoresPuntuacion {
  const valores: ValoresPuntuacion = { ...VALORES_DEFECTO }
  try {
    const datos = JSON.parse(configValoresPuntuacion) as Record<string, unknown>
    const claves: Array<[keyof ValoresPuntuacion, string]> = [
      ['puntoPorCubierto', 'punto_por_cubierto'],
      ['puntoPorFaltante', 'punto_por_faltante'],
      ['penalizacionPorError', 'penalizacion_por_error'],
      ['bonusMejora', 'bonus_mejora'],
      ['penalizacionAlucinacion', 'penalizacion_alucinacion']
    ]
    for (const par of claves) {
      const valor = datos[par[1]]
      if (typeof valor === 'number' && Number.isFinite(valor)) {
        valores[par[0]] = valor
      }
    }
  } catch {
    // JSON inválido o ausente → valores por defecto
  }
  return valores
}
