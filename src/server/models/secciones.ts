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
  jsonIngesta: string | null
  fechaCarga: string
  cuentaCreadoraId: string
  origen: 'ingesta' | 'importado'
}

export async function crearDocumento(db: Client, datos: { titulo: string; jsonIngesta: string | null; cuentaCreadoraId: string; origen?: 'ingesta' | 'importado' }): Promise<Documento> {
  const id = randomUUID()
  const fechaCarga = new Date().toISOString()
  const origen = datos.origen ?? 'ingesta'
  // Documento importado sin ingesta: centinela 'null' (SQLite mantiene NOT
  // NULL en la columna; mismo criterio que las secciones importadas)
  const jsonIngesta = datos.jsonIngesta ?? 'null'
  await db.execute({
    sql: 'INSERT INTO Documento (id, titulo, json_ingesta, fecha_carga, cuenta_creadora_id, origen) VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, datos.titulo, jsonIngesta, fechaCarga, datos.cuentaCreadoraId, origen]
  })
  return { id: id, titulo: datos.titulo, jsonIngesta: datos.jsonIngesta, fechaCarga: fechaCarga, cuentaCreadoraId: datos.cuentaCreadoraId, origen: origen }
}

export async function obtenerDocumento(db: Client, id: string): Promise<Documento | null> {
  const resultado = await db.execute({
    sql: 'SELECT id, titulo, json_ingesta, fecha_carga, cuenta_creadora_id, origen FROM Documento WHERE id = ?',
    args: [id]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  const fila = resultado.rows[0]
  return {
    id: fila[0] as string,
    titulo: fila[1] as string,
    jsonIngesta: (fila[2] as string | null) ?? null,
    fechaCarga: fila[3] as string,
    cuentaCreadoraId: fila[4] as string,
    origen: (fila[5] as 'ingesta' | 'importado' | null) ?? 'ingesta'
  }
}

// Documento importado (feature 002, FR-109): creado al primer import de un
// documento_titulo para la cuenta y reutilizado después; contenedor SEPARADO
// de cualquier Documento de ingesta con el mismo titulo (research D18).

export async function buscarDocumentoImportado(db: Client, cuentaId: string, titulo: string): Promise<Documento | null> {
  const resultado = await db.execute({
    sql: "SELECT id, titulo, json_ingesta, fecha_carga, cuenta_creadora_id, origen FROM Documento WHERE cuenta_creadora_id = ? AND titulo = ? AND origen = 'importado' LIMIT 1",
    args: [cuentaId, titulo]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  const fila = resultado.rows[0]
  return { id: fila[0] as string, titulo: fila[1] as string, jsonIngesta: null, fechaCarga: fila[3] as string, cuentaCreadoraId: fila[4] as string, origen: 'importado' }
}

// Seccion contenedora de un documento importado (UNA por archivo). SQLite no
// permite quitar NOT NULL sin reconstruir la tabla: contenido y mapa usan el
// centinela 'null' y num_palabras 0 (documentado en data-model.md).
export async function buscarSeccionImportada(db: Client, documentoId: string): Promise<Seccion | null> {
  const secciones = await listarSeccionesDeDocumento(db, documentoId)
  return secciones.length > 0 ? secciones[0] : null
}

export async function crearSeccionImportada(db: Client, datos: { documentoId: string; titulo: string }): Promise<Seccion> {
  return crearSeccion(db, {
    documentoId: datos.documentoId,
    titulo: datos.titulo,
    orden: 1,
    // el CHECK de la tabla exige >= 1 (no se puede relajar sin reconstruir);
    // 1 actúa como centinela: las secciones importadas nunca tienen dump
    numPalabras: 1,
    contenido: 'null',
    mapaConceptos: 'null'
  })
}
