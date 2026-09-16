import type { Client } from '../../db/client.js'

// Ranking POR SESIÓN (FR-034/036, research D8; corrección del usuario):
// - Participan las cuentas de la sala cuya última sesión de práctica tiene
//   fecha dentro de las últimas 24 horas (activa o cerrada).
// - Puntos de la sesión = puntos_obtenidos_total de ESA sesión + los puntos
//   de dump de los DumpIntento con timestamp ≥ fecha de inicio de la sesión.
// - Los dumps previos a la sesión vigente NO entran (quedan como histórico).
// - NO existe ranking acumulado histórico. Ganador = primera posición.

export const VENTANA_HORAS = 24

export interface EntradaRanking {
  cuentaId: string
  nombre: string
  puntosSesion: number
  sesionId: string
  ganador: boolean
}

export interface FilaRankingConNombre {
  cuentaId: string
  nombre: string
  puntosSesion: number
  sesionId: string
}

export async function calcularRanking(db: Client, salaId: string, ahora: Date): Promise<FilaRankingConNombre[]> {
  const limite = new Date(ahora.getTime() - VENTANA_HORAS * 60 * 60 * 1000).toISOString()

  // Última sesión de práctica de cada cuenta miembro de la sala, dentro de la ventana
  const resultado = await db.execute({
    sql: [
      'SELECT m.cuenta_id, c.nombre, s.id AS sesion_id, s.fecha, s.puntos_obtenidos_total',
      'FROM Membresia m',
      'JOIN Cuenta c ON c.id = m.cuenta_id',
      'JOIN SesionPractica s ON s.id = (',
      '  SELECT s2.id FROM SesionPractica s2',
      '  WHERE s2.cuenta_id = m.cuenta_id AND s2.sala_id = m.sala_id',
      '  ORDER BY s2.fecha DESC LIMIT 1',
      ')',
      'WHERE m.sala_id = ? AND s.fecha >= ?',
      'ORDER BY s.fecha DESC'
    ].join(' '),
    args: [salaId, limite]
  })

  const filas: Array<{ cuentaId: string; nombre: string; sesionId: string; fecha: string; puntosSesion: number }> = []
  for (const fila of resultado.rows) {
    const valores = fila
    filas.push({
      cuentaId: valores[0] as string,
      nombre: valores[1] as string,
      sesionId: valores[2] as string,
      fecha: valores[3] as string,
      // puntos de práctica de la sesión (en sesión activa es el parcial)
      puntosSesion: valores[4] as number
    })
  }

  // Sumar los puntos de dump realizados desde el inicio de la sesión vigente
  for (const fila of filas) {
    const dumps = await db.execute({
      sql: [
        'SELECT COALESCE(SUM(puntos_obtenidos), 0) AS total FROM DumpIntento',
        'WHERE cuenta_id = ? AND timestamp >= ? AND puntos_obtenidos IS NOT NULL'
      ].join(' '),
      args: [fila.cuentaId, fila.fecha]
    })
    const totalDump = (dumps.rows[0])[0] as number
    fila.puntosSesion = fila.puntosSesion + totalDump
  }

  // Orden descendente por puntos de la sesión
  filas.sort(function (a, b) {
    return b.puntosSesion - a.puntosSesion
  })

  return filas.map(function (fila) {
    return {
      cuentaId: fila.cuentaId,
      nombre: fila.nombre,
      puntosSesion: fila.puntosSesion,
      sesionId: fila.sesionId
    }
  })
}

// Agrega la marca de ganador (primera posición). marcarGanador=false deja
// el ranking visible "en vivo" sin ganador aún (Modo 2 en curso, FR-116).
export function conGanador(filas: FilaRankingConNombre[], marcarGanador = true): EntradaRanking[] {
  return filas.map(function (fila, indice) {
    return {
      cuentaId: fila.cuentaId,
      nombre: fila.nombre,
      puntosSesion: fila.puntosSesion,
      sesionId: fila.sesionId,
      ganador: marcarGanador && indice === 0 && filas.length > 0
    }
  })
}

// ¿La sesión está cerrada? = cierre explícito del host (feature 004) o
// respondió todas las fichas de su cola
async function sesionCerrada(db: Client, sesionId: string): Promise<boolean> {
  const sesion = await db.execute({
    sql: 'SELECT fichas_ids, cerrada_en FROM SesionPractica WHERE id = ?',
    args: [sesionId]
  })
  if (sesion.rows.length === 0) return true
  const valores = sesion.rows[0] as ArrayLike<unknown>
  if (valores[1] !== null && valores[1] !== undefined) {
    return true // cerrada_en: cierre explícito del host
  }
  let total = 0
  try {
    const cola = JSON.parse(String(valores[0]) ?? '[]')
    total = Array.isArray(cola) ? cola.length : 0
  } catch {
    total = 0
  }
  const respondidas = await db.execute({
    sql: 'SELECT COUNT(*) FROM RespuestaPractica WHERE sesion_practica_id = ?',
    args: [sesionId]
  })
  const n = Number((respondidas.rows[0] as ArrayLike<unknown>)[0])
  return total === 0 || n >= total
}

// Ranking completo de una sala para la API (Modo 1 y Modo 2, FR-116/117):
// - Modo 1 (dump): igual que 001 — ganador = primera cuando hay >1 participantes.
// - Modo 2 (multijugador): ranking visible en vivo SIN ganador; el ganador se
//   marca cuando TODAS las sesiones activas de los miembros cerraron o el host
//   cerró la sala (cerrada_en no NULL, que además congela el ranking).
export async function calcularRankingDeSala(db: Client, salaId: string): Promise<{ ranking: EntradaRanking[] | null; salaCerrada: boolean }> {
  const infoSala = await db.execute({
    sql: 'SELECT modo, cerrada_en FROM Sala WHERE id = ?',
    args: [salaId]
  })
  if (infoSala.rows.length === 0) {
    return { ranking: null, salaCerrada: false }
  }
  const modo = String((infoSala.rows[0] as ArrayLike<unknown>)[0]) === 'multijugador' ? 'multijugador' : 'dump'
  const cerradaEn = (infoSala.rows[0] as ArrayLike<unknown>)[1] as string | null
  const salaCerrada = cerradaEn !== null

  const filas = await calcularRanking(db, salaId, new Date())
  if (filas.length === 0) {
    return { ranking: null, salaCerrada: salaCerrada }
  }

  if (modo === 'dump') {
    // Feature 001: ganador con >1 participantes. Feature 004: con UN solo
    // participante, el ganador se marca cuando su sesión cerró (fin del dump)
    let cerrada = true
    for (const fila of filas) {
      if (!(await sesionCerrada(db, fila.sesionId))) {
        cerrada = false
        break
      }
    }
    const marcar = filas.length > 1 || cerrada
    return { ranking: conGanador(filas, marcar), salaCerrada: salaCerrada }
  }

  if (salaCerrada) {
    // Sala cerrada por el host: ganador señalado, ranking congelado
    return { ranking: conGanador(filas, true), salaCerrada: true }
  }

  if (filas.length === 1) {
    return { ranking: null, salaCerrada: false }
  }

  // ¿Todas las sesiones de los participantes cerraron?
  let todasCerradas = true
  for (const fila of filas) {
    if (!(await sesionCerrada(db, fila.sesionId))) {
      todasCerradas = false
      break
    }
  }
  if (todasCerradas) {
    return { ranking: conGanador(filas, true), salaCerrada: false }
  }
  return { ranking: conGanador(filas, false), salaCerrada: false }
}
