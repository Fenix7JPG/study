// Algoritmo SM-2 clásico, EXACTO a la fuente §6.7 (contrato Constitution III):
// 1. EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)); piso 1.3 (siempre).
// 2. q < 3 (fallo): repeticiones = 0, intervalo_dias = 1.
// 3. q >= 3 (acierto): intervalo 1 (repeticiones==0), 6 (==1),
//    round(intervalo_anterior * EF') (>=2); luego repeticiones + 1.
// 4. fecha_proximo_repaso = fecha_actual + intervalo_dias días.

export interface EstadoSm2 {
  repeticiones: number
  intervaloDias: number
  factorFacilidad: number
}

export interface ResultadoSm2 extends EstadoSm2 {
  // Fecha del próximo repaso en formato YYYY-MM-DD (UTC)
  fechaProximoRepaso: string
}

export const EF_MINIMO = 1.3

export function aplicarSm2(estado: EstadoSm2, q: number, fechaActual: Date): ResultadoSm2 {
  // Paso 1: el factor de facilidad se actualiza SIEMPRE, sin importar q
  let factorFacilidad = estado.factorFacilidad + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  if (factorFacilidad < EF_MINIMO) {
    factorFacilidad = EF_MINIMO
  }

  let repeticiones = estado.repeticiones
  let intervaloDias: number

  if (q < 3) {
    // Paso 2: fallo — reinicio
    repeticiones = 0
    intervaloDias = 1
  } else {
    // Paso 3: acierto
    if (estado.repeticiones === 0) {
      intervaloDias = 1
    } else if (estado.repeticiones === 1) {
      intervaloDias = 6
    } else {
      intervaloDias = Math.round(estado.intervaloDias * factorFacilidad)
    }
    repeticiones = repeticiones + 1
  }

  // Paso 4: fecha_proximo_repaso = fecha_actual + intervalo_dias días
  const fecha = new Date(fechaActual.getTime())
  fecha.setUTCDate(fecha.getUTCDate() + intervaloDias)

  return {
    repeticiones: repeticiones,
    intervaloDias: intervaloDias,
    factorFacilidad: factorFacilidad,
    fechaProximoRepaso: fecha.toISOString().slice(0, 10)
  }
}

// Valores iniciales de una ficha nueva (fuente §6.7 paso 6)
export const ESTADO_SM2_INICIAL: EstadoSm2 = {
  repeticiones: 0,
  intervaloDias: 0,
  factorFacilidad: 2.5
}
