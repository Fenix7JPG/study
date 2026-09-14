import { randomUUID } from 'node:crypto'
import type { Client } from '../../db/client.js'

// Acceso a datos de Seccion y Documento (data-model.md).
// contenido y mapa_conceptos se guardan como JSON serializado tal cual
// vienen en el JSON de ingesta (NUNCA se regeneran, fuente §5.2).

export interface Seccion {
  id: string
  documentoId: string
  titulo: string
  orden: number
  numPalabras: number
  // JSON serializado de los bloques (texto/tabla)
  contenido: string
  // JSON serializado del mapa de conceptos
  mapaConceptos: string
}

export interface DatosSeccionNueva {
  documentoId: string
  titulo: string
  orden: number
  numPalabras: number
  contenido: string
  mapaConceptos: string
}

// Columnas: id, documento_id, titulo, orden, num_palabras, contenido, mapa_conceptos
const SELECT_SECCION = 'SELECT id, documento_id, titulo, orden, num_palabras, contenido, mapa_conceptos FROM Seccion'

function mapearSeccion(fila: ArrayLike<unknown>): Seccion {
  return {
    id: fila[0] as string,
    documentoId: fila[1] as string,
    titulo: fila[2] as string,
    orden: fila[3] as number,
    numPalabras: fila[4] as number,
    contenido: fila[5] as string,
    mapaConceptos: fila[6] as string
  }
}

export async function crearSeccion(db: Client, datos: DatosSeccionNueva): Promise<Seccion> {
  const id = randomUUID()
  await db.execute({
    sql: 'INSERT INTO Seccion (id, documento_id, titulo, orden, num_palabras, contenido, mapa_conceptos) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [id, datos.documentoId, datos.titulo, datos.orden, datos.numPalabras, datos.contenido, datos.mapaConceptos]
  })
  return {
    id: id,
    documentoId: datos.documentoId,
    titulo: datos.titulo,
    orden: datos.orden,
    numPalabras: datos.numPalabras,
    contenido: datos.contenido,
    mapaConceptos: datos.mapaConceptos
  }
}

export async function obtenerSeccion(db: Client, id: string): Promise<Seccion | null> {
  const resultado = await db.execute({
    sql: SELECT_SECCION + ' WHERE id = ?',
    args: [id]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearSeccion(resultado.rows[0])
}

export async function listarSeccionesDeDocumento(db: Client, documentoId: string): Promise<Seccion[]> {
  const resultado = await db.execute({
    sql: SELECT_SECCION + ' WHERE documento_id = ? ORDER BY orden ASC',
    args: [documentoId]
  })
  const salida: Seccion[] = []
  for (const fila of resultado.rows) {
    salida.push(mapearSeccion(fila))
  }
  return salida
}

// ─── Documento ────────────────────────────────────────────────────────────

export interface Documento {
  id: string
  titulo: string
  jsonIngesta: string
  fechaCarga: string
  cuentaCreadoraId: string
}

export async function crearDocumento(db: Client, datos: { titulo: string; jsonIngesta: string; cuentaCreadoraId: string }): Promise<Documento> {
  const id = randomUUID()
  const fechaCarga = new Date().toISOString()
  await db.execute({
    sql: 'INSERT INTO Documento (id, titulo, json_ingesta, fecha_carga, cuenta_creadora_id) VALUES (?, ?, ?, ?, ?)',
    args: [id, datos.titulo, datos.jsonIngesta, fechaCarga, datos.cuentaCreadoraId]
  })
  return { id: id, titulo: datos.titulo, jsonIngesta: datos.jsonIngesta, fechaCarga: fechaCarga, cuentaCreadoraId: datos.cuentaCreadoraId }
}

export async function obtenerDocumento(db: Client, id: string): Promise<Documento | null> {
  const resultado = await db.execute({
    sql: 'SELECT id, titulo, json_ingesta, fecha_carga, cuenta_creadora_id FROM Documento WHERE id = ?',
    args: [id]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  const fila = resultado.rows[0]
  return {
    id: fila[0] as string,
    titulo: fila[1] as string,
    jsonIngesta: fila[2] as string,
    fechaCarga: fila[3] as string,
    cuentaCreadoraId: fila[4] as string
  }
}
