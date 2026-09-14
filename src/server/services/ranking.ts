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

// Agrega la marca de ganador (primera posición) para la respuesta de la API
export function conGanador(filas: FilaRankingConNombre[]): EntradaRanking[] {
  return filas.map(function (fila, indice) {
    return {
      cuentaId: fila.cuentaId,
      nombre: fila.nombre,
      puntosSesion: fila.puntosSesion,
      sesionId: fila.sesionId,
      ganador: indice === 0 && filas.length > 0
    }
  })
}
