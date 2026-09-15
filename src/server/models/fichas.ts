import { randomUUID } from 'node:crypto'
import type { Client } from '../../db/client.js'

// Acceso a datos de Ficha (data-model.md). Las fichas son SIEMPRE por cuenta
// (fuente §6.5) y sus respuestas provienen únicamente del mapa de conceptos.

export interface Ficha {
  id: string
  cuentaId: string
  seccionId: string
  pregunta: string
  respuesta: string
  conceptoId: string
  tipo: 'estandar' | 'discriminacion'
  prioridadInicial: 'alta' | 'baja'
  pendiente: boolean
  repeticiones: number
  intervaloDias: number
  factorFacilidad: number
  // Fecha YYYY-MM-DD (UTC) del próximo repaso
  fechaProximoRepaso: string
  // feature 002: tipo del concepto (banco §8) e id del archivo importado
  conceptoTipo: string | null
  fichaExternaId: string | null
}

export interface DatosFichaNueva {
  cuentaId: string
  seccionId: string
  pregunta: string
  respuesta: string
  conceptoId: string
  conceptoTipo?: string | null
  tipo: 'estandar' | 'discriminacion'
  prioridadInicial: 'alta' | 'baja'
  pendiente: boolean
}

// Columnas: id, cuenta_id, seccion_id, pregunta, respuesta, concepto_id, tipo,
// prioridad_inicial, pendiente, repeticiones, intervalo_dias, factor_facilidad, fecha_proximo_repaso
const SELECT_FICHA = [
  'SELECT id, cuenta_id, seccion_id, pregunta, respuesta, concepto_id, tipo,',
  'prioridad_inicial, pendiente, repeticiones, intervalo_dias, factor_facilidad, fecha_proximo_repaso,',
  'concepto_tipo, ficha_externa_id',
  'FROM Ficha'
].join(' ')

function mapearFicha(fila: ArrayLike<unknown>): Ficha {
  return {
    id: fila[0] as string,
    cuentaId: fila[1] as string,
    seccionId: fila[2] as string,
    pregunta: fila[3] as string,
    respuesta: fila[4] as string,
    conceptoId: fila[5] as string,
    tipo: fila[6] as 'estandar' | 'discriminacion',
    prioridadInicial: fila[7] as 'alta' | 'baja',
    pendiente: (fila[8] as number) === 1,
    repeticiones: fila[9] as number,
    intervaloDias: fila[10] as number,
    factorFacilidad: fila[11] as number,
    fechaProximoRepaso: fila[12] as string,
    conceptoTipo: (fila[13] as string | null) ?? null,
    fichaExternaId: (fila[14] as string | null) ?? null
  }
}

// Crea la ficha con valores SM-2 iniciales (§6.7 paso 6): repeticiones 0,
// intervalo 0, EF 2.5, próximo repaso hoy.
export async function crearFicha(db: Client, datos: DatosFichaNueva): Promise<Ficha> {
  const id = randomUUID()
  const hoy = new Date().toISOString().slice(0, 10)
  await db.execute({
    sql: [
      'INSERT INTO Ficha (id, cuenta_id, seccion_id, pregunta, respuesta, concepto_id, tipo,',
      'prioridad_inicial, pendiente, repeticiones, intervalo_dias, factor_facilidad, fecha_proximo_repaso, concepto_tipo)',
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 2.5, ?, ?)'
    ].join(' '),
    args: [
      id,
      datos.cuentaId,
      datos.seccionId,
      datos.pregunta,
      datos.respuesta,
      datos.conceptoId,
      datos.tipo,
      datos.prioridadInicial,
      datos.pendiente ? 1 : 0,
      hoy,
      datos.conceptoTipo ?? null
    ]
  })
  return {
    id: id,
    cuentaId: datos.cuentaId,
    seccionId: datos.seccionId,
    pregunta: datos.pregunta,
    respuesta: datos.respuesta,
    conceptoId: datos.conceptoId,
    tipo: datos.tipo,
    prioridadInicial: datos.prioridadInicial,
    pendiente: datos.pendiente,
    repeticiones: 0,
    intervaloDias: 0,
    factorFacilidad: 2.5,
    fechaProximoRepaso: hoy,
    conceptoTipo: datos.conceptoTipo ?? null,
    fichaExternaId: null
  }
}

// Fichas de UNA cuenta en una sección (aislamiento por cuenta, FR-005)
export async function listarFichasDeSeccion(db: Client, cuentaId: string, seccionId: string): Promise<Ficha[]> {
  const resultado = await db.execute({
    sql: SELECT_FICHA + ' WHERE cuenta_id = ? AND seccion_id = ? ORDER BY prioridad_inicial ASC, id ASC',
    args: [cuentaId, seccionId]
  })
  const salida: Ficha[] = []
  for (const fila of resultado.rows) {
    salida.push(mapearFicha(fila))
  }
  return salida
}

// ¿La cuenta ya tiene fichas para la sección? (bloqueo de FR-026)
export async function hayFichasDeSeccion(db: Client, cuentaId: string, seccionId: string): Promise<boolean> {
  const resultado = await db.execute({
    sql: 'SELECT 1 FROM Ficha WHERE cuenta_id = ? AND seccion_id = ? LIMIT 1',
    args: [cuentaId, seccionId]
  })
  return resultado.rows.length > 0
}

// Ficha por id (la API verifica SIEMPRE que pertenezca a la cuenta autenticada)
export async function obtenerFichaPorId(db: Client, id: string): Promise<Ficha | null> {
  const resultado = await db.execute({
    sql: SELECT_FICHA + ' WHERE id = ?',
    args: [id]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearFicha(resultado.rows[0])
}

// Fichas de la cuenta en TODAS las secciones de una sala (para la práctica,
// FR-028): une Seccion → Documento → Sala
export async function listarFichasDeSala(db: Client, cuentaId: string, salaId: string): Promise<Ficha[]> {
  const resultado = await db.execute({
    sql: [
      'SELECT f.id, f.cuenta_id, f.seccion_id, f.pregunta, f.respuesta, f.concepto_id, f.tipo,',
      'f.prioridad_inicial, f.pendiente, f.repeticiones, f.intervalo_dias, f.factor_facilidad, f.fecha_proximo_repaso,',
      'f.concepto_tipo, f.ficha_externa_id',
      'FROM Ficha f',
      'JOIN Seccion s ON s.id = f.seccion_id',
      'JOIN Documento d ON d.id = s.documento_id',
      'JOIN Sala sa ON sa.documento_id = d.id',
      'WHERE f.cuenta_id = ? AND sa.id = ?',
      'ORDER BY f.id ASC'
    ].join(' '),
    args: [cuentaId, salaId]
  })
  const salida: Ficha[] = []
  for (const fila of resultado.rows) {
    salida.push(mapearFicha(fila))
  }
  return salida
}

// Fichas de la cuenta con títulos de documento y sección (exportación §9)
export async function listarFichasConTitulos(
  db: Client,
  cuentaId: string,
  documentoId: string | null
): Promise<Array<{ tituloDocumento: string; tituloSeccion: string; pregunta: string; respuesta: string }>> {
  const sql = [
    'SELECT d.titulo, sec.titulo, f.pregunta, f.respuesta',
    'FROM Ficha f',
    'JOIN Seccion sec ON sec.id = f.seccion_id',
    'JOIN Documento d ON d.id = sec.documento_id',
    'WHERE f.cuenta_id = ?'
  ]
  const args: string[] = [cuentaId]
  if (documentoId !== null) {
    sql.push('AND sec.documento_id = ?')
    args.push(documentoId)
  }
  sql.push('ORDER BY d.titulo ASC, sec.orden ASC, f.id ASC')
  const resultado = await db.execute({ sql: sql.join(' '), args: args })
  const salida: Array<{ tituloDocumento: string; tituloSeccion: string; pregunta: string; respuesta: string }> = []
  for (const fila of resultado.rows) {
    const valores = fila
    salida.push({
      tituloDocumento: valores[0] as string,
      tituloSeccion: valores[1] as string,
      pregunta: valores[2] as string,
      respuesta: valores[3] as string
    })
  }
  return salida
}

// Aplica el resultado del algoritmo SM-2 a la ficha (FR-031)
export async function actualizarSm2(
  db: Client,
  fichaId: string,
  resultado: { repeticiones: number; intervaloDias: number; factorFacilidad: number; fechaProximoRepaso: string }
): Promise<void> {
  await db.execute({
    sql: 'UPDATE Ficha SET repeticiones = ?, intervalo_dias = ?, factor_facilidad = ?, fecha_proximo_repaso = ? WHERE id = ?',
    args: [resultado.repeticiones, resultado.intervaloDias, resultado.factorFacilidad, resultado.fechaProximoRepaso, fichaId]
  })
}

// Marca/desmarca el pendiente (conceptos aún fallados tras la ronda 2, FR-017)
export async function marcarPendiente(db: Client, fichaId: string, pendiente: boolean): Promise<void> {
  await db.execute({
    sql: 'UPDATE Ficha SET pendiente = ? WHERE id = ?',
    args: [pendiente ? 1 : 0, fichaId]
  })
}

// ─── Feature 002: banco portable ──────────────────────────────────────────

// Busca por id externo (regla 1 del upsert, FR-108)
export async function buscarPorFichaExterna(db: Client, cuentaId: string, fichaExternaId: string): Promise<Ficha | null> {
  const resultado = await db.execute({
    sql: SELECT_FICHA + ' WHERE cuenta_id = ? AND ficha_externa_id = ? LIMIT 1',
    args: [cuentaId, fichaExternaId]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearFicha(resultado.rows[0])
}

// Busca por id nativo sin ficha_externa_id (regla 2 del upsert)
export async function buscarPorIdNativo(db: Client, cuentaId: string, id: string): Promise<Ficha | null> {
  const resultado = await db.execute({
    sql: SELECT_FICHA + ' WHERE cuenta_id = ? AND id = ? AND ficha_externa_id IS NULL LIMIT 1',
    args: [cuentaId, id]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearFicha(resultado.rows[0])
}

// Actualiza todos los campos portables del banco (última importación gana)
export async function aplicarImportacion(
  db: Client,
  fichaId: string,
  datos: { pregunta: string; respuesta: string; conceptoId: string; conceptoTipo: string | null; tipo: 'estandar' | 'discriminacion'; prioridadInicial: 'alta' | 'baja'; pendiente: boolean; fichaExternaId: string; estadoSm2: { repeticiones: number; intervaloDias: number; factorFacilidad: number; fechaProximoRepaso: string } }
): Promise<void> {
  await db.execute({
    sql: [
      'UPDATE Ficha SET pregunta = ?, respuesta = ?, concepto_id = ?, concepto_tipo = ?,',
      'tipo = ?, prioridad_inicial = ?, pendiente = ?, ficha_externa_id = ?,',
      'repeticiones = ?, intervalo_dias = ?, factor_facilidad = ?, fecha_proximo_repaso = ?',
      'WHERE id = ?'
    ].join(' '),
    args: [
      datos.pregunta,
      datos.respuesta,
      datos.conceptoId,
      datos.conceptoTipo,
      datos.tipo,
      datos.prioridadInicial,
      datos.pendiente ? 1 : 0,
      datos.fichaExternaId,
      datos.estadoSm2.repeticiones,
      datos.estadoSm2.intervaloDias,
      datos.estadoSm2.factorFacilidad,
      datos.estadoSm2.fechaProximoRepaso,
      fichaId
    ]
  })
}

// TODAS las fichas de la cuenta (pool del Modo 2, FR-113)
export async function listarFichasDeCuentaTodas(db: Client, cuentaId: string): Promise<Ficha[]> {
  const resultado = await db.execute({
    sql: SELECT_FICHA + ' WHERE cuenta_id = ? ORDER BY id ASC',
    args: [cuentaId]
  })
  const salida: Ficha[] = []
  for (const fila of resultado.rows) {
    salida.push(mapearFicha(fila))
  }
  return salida
}

// Fichas completas con documento para el banco §8 (FR-101)
export async function listarFichasExportables(
  db: Client,
  cuentaId: string,
  documentoId: string | null
): Promise<Array<{ ficha: Ficha; documentoId: string; tituloDocumento: string }>> {
  const sql = [
    'SELECT f.id, f.cuenta_id, f.seccion_id, f.pregunta, f.respuesta, f.concepto_id, f.tipo,',
    'f.prioridad_inicial, f.pendiente, f.repeticiones, f.intervalo_dias, f.factor_facilidad, f.fecha_proximo_repaso,',
    'f.concepto_tipo, f.ficha_externa_id,',
    'sec.documento_id, d.titulo',
    'FROM Ficha f',
    'JOIN Seccion sec ON sec.id = f.seccion_id',
    'JOIN Documento d ON d.id = sec.documento_id',
    'WHERE f.cuenta_id = ?'
  ]
  const args: string[] = [cuentaId]
  if (documentoId !== null) {
    sql.push('AND sec.documento_id = ?')
    args.push(documentoId)
  }
  sql.push('ORDER BY d.titulo ASC, sec.orden ASC, f.id ASC')
  const resultado = await db.execute({ sql: sql.join(' '), args: args })
  const salida: Array<{ ficha: Ficha; documentoId: string; tituloDocumento: string }> = []
  for (const fila of resultado.rows) {
    const valores = Array.from(fila)
    const ficha = mapearFicha(valores.slice(0, 15))
    salida.push({
      ficha: ficha,
      documentoId: valores[15] as string,
      tituloDocumento: valores[16] as string
    })
  }
  return salida
}
