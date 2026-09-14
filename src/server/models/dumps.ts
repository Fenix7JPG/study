import { randomUUID } from 'node:crypto'
import type { Client } from '../../db/client.js'

// Acceso a datos de DumpIntento (data-model.md). El texto_enviado es
// INMUTABLE una vez guardado (FR-014/015); solo se actualizan los campos de
// calificación (NULL mientras está pendiente o falló, FR-047).

export interface DumpIntento {
  id: string
  cuentaId: string
  seccionId: string
  ronda: number
  textoEnviado: string
  timestamp: string
  // Calificación: null mientras está pendiente o falló definitivamente
  coberturaPorcentaje: number | null
  conceptosCubiertos: string | null
  conceptosFaltantes: string | null
  errores: string | null
  puntosObtenidos: number | null
}

export interface CalificacionDump {
  coberturaPorcentaje: number
  conceptosCubiertos: string[]
  conceptosFaltantes: string[]
  errores: Array<{ id_concepto: string; descripcion_error: string }>
  puntosObtenidos: number
}

// Columnas: id, cuenta_id, seccion_id, ronda, texto_enviado, timestamp,
// cobertura_porcentaje, conceptos_cubiertos, conceptos_faltantes, errores, puntos_obtenidos
const SELECT_DUMP = [
  'SELECT id, cuenta_id, seccion_id, ronda, texto_enviado, timestamp,',
  'cobertura_porcentaje, conceptos_cubiertos, conceptos_faltantes, errores, puntos_obtenidos',
  'FROM DumpIntento'
].join(' ')

function mapearDump(fila: ArrayLike<unknown>): DumpIntento {
  return {
    id: fila[0] as string,
    cuentaId: fila[1] as string,
    seccionId: fila[2] as string,
    ronda: fila[3] as number,
    textoEnviado: fila[4] as string,
    timestamp: fila[5] as string,
    coberturaPorcentaje: (fila[6] as number | null) ?? null,
    conceptosCubiertos: (fila[7] as string | null) ?? null,
    conceptosFaltantes: (fila[8] as string | null) ?? null,
    errores: (fila[9] as string | null) ?? null,
    puntosObtenidos: (fila[10] as number | null) ?? null
  }
}

// Crea el intento con el texto bloqueado y calificación pendiente (NULL)
export async function crearDumpIntento(db: Client, datos: { cuentaId: string; seccionId: string; ronda: number; texto: string }): Promise<DumpIntento> {
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  await db.execute({
    sql: [
      'INSERT INTO DumpIntento (id, cuenta_id, seccion_id, ronda, texto_enviado, timestamp,',
      'cobertura_porcentaje, conceptos_cubiertos, conceptos_faltantes, errores, puntos_obtenidos)',
      'VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)'
    ].join(' '),
    args: [id, datos.cuentaId, datos.seccionId, datos.ronda, datos.texto, timestamp]
  })
  return {
    id: id,
    cuentaId: datos.cuentaId,
    seccionId: datos.seccionId,
    ronda: datos.ronda,
    textoEnviado: datos.texto,
    timestamp: timestamp,
    coberturaPorcentaje: null,
    conceptosCubiertos: null,
    conceptosFaltantes: null,
    errores: null,
    puntosObtenidos: null
  }
}

export async function obtenerDumpIntento(db: Client, id: string): Promise<DumpIntento | null> {
  const resultado = await db.execute({
    sql: SELECT_DUMP + ' WHERE id = ?',
    args: [id]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearDump(resultado.rows[0])
}

// Intento de una ronda concreta de una cuenta en una sección (para el bonus
// de mejora y la recalificación FR-047)
export async function obtenerDumpDeRonda(db: Client, cuentaId: string, seccionId: string, ronda: number): Promise<DumpIntento | null> {
  const resultado = await db.execute({
    sql: SELECT_DUMP + ' WHERE cuenta_id = ? AND seccion_id = ? AND ronda = ? ORDER BY timestamp DESC LIMIT 1',
    args: [cuentaId, seccionId, ronda]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearDump(resultado.rows[0])
}

// Guarda/actualiza la calificación de un intento (las listas como JSON)
export async function guardarCalificacionDump(db: Client, id: string, calificacion: CalificacionDump): Promise<void> {
  await db.execute({
    sql: [
      'UPDATE DumpIntento SET cobertura_porcentaje = ?, conceptos_cubiertos = ?,',
      'conceptos_faltantes = ?, errores = ?, puntos_obtenidos = ?',
      'WHERE id = ?'
    ].join(' '),
    args: [
      calificacion.coberturaPorcentaje,
      JSON.stringify(calificacion.conceptosCubiertos),
      JSON.stringify(calificacion.conceptosFaltantes),
      JSON.stringify(calificacion.errores),
      calificacion.puntosObtenidos,
      id
    ]
  })
}
