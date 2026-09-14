import { randomUUID } from 'node:crypto'
import type { Client } from '../../db/client.js'

// Entidad auxiliar ProgresoSeccion (data-model.md): estado de fase del ciclo
// de dump por cuenta y sección. Permite al servidor validar ventanas y
// bloqueos (FR-011..016) sin confiar solo en el cliente (research D10).

export type FaseDump = 'lectura' | 'escritura' | 'calificacion' | 'resultados' | 'completada'

export interface ProgresoSeccion {
  id: string
  cuentaId: string
  seccionId: string
  rondaActual: number
  fase: FaseDump
  faseIniciaEn: string
  faseTerminaEn: string
}

// Columnas: id, cuenta_id, seccion_id, ronda_actual, fase, fase_inicia_en, fase_termina_en
const SELECT_PROGRESO = 'SELECT id, cuenta_id, seccion_id, ronda_actual, fase, fase_inicia_en, fase_termina_en FROM ProgresoSeccion'

function mapearProgreso(fila: ArrayLike<unknown>): ProgresoSeccion {
  return {
    id: fila[0] as string,
    cuentaId: fila[1] as string,
    seccionId: fila[2] as string,
    rondaActual: fila[3] as number,
    fase: fila[4] as FaseDump,
    faseIniciaEn: fila[5] as string,
    faseTerminaEn: fila[6] as string
  }
}

export async function obtenerProgreso(db: Client, cuentaId: string, seccionId: string): Promise<ProgresoSeccion | null> {
  const resultado = await db.execute({
    sql: SELECT_PROGRESO + ' WHERE cuenta_id = ? AND seccion_id = ? LIMIT 1',
    args: [cuentaId, seccionId]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearProgreso(resultado.rows[0])
}

export async function crearProgreso(
  db: Client,
  datos: { cuentaId: string; seccionId: string; rondaActual: number; fase: FaseDump; faseIniciaEn: string; faseTerminaEn: string }
): Promise<ProgresoSeccion> {
  const id = randomUUID()
  await db.execute({
    sql: 'INSERT INTO ProgresoSeccion (id, cuenta_id, seccion_id, ronda_actual, fase, fase_inicia_en, fase_termina_en) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [id, datos.cuentaId, datos.seccionId, datos.rondaActual, datos.fase, datos.faseIniciaEn, datos.faseTerminaEn]
  })
  return {
    id: id,
    cuentaId: datos.cuentaId,
    seccionId: datos.seccionId,
    rondaActual: datos.rondaActual,
    fase: datos.fase,
    faseIniciaEn: datos.faseIniciaEn,
    faseTerminaEn: datos.faseTerminaEn
  }
}

// Avanza el estado de fase (ronda_actual puede cambiar al pasar a ronda 2)
export async function actualizarFase(
  db: Client,
  id: string,
  datos: { rondaActual: number; fase: FaseDump; faseIniciaEn: string; faseTerminaEn: string }
): Promise<void> {
  await db.execute({
    sql: 'UPDATE ProgresoSeccion SET ronda_actual = ?, fase = ?, fase_inicia_en = ?, fase_termina_en = ? WHERE id = ?',
    args: [datos.rondaActual, datos.fase, datos.faseIniciaEn, datos.faseTerminaEn, id]
  })
}
