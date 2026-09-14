import { randomUUID } from 'node:crypto'
import type { Client } from '../../db/client.js'

// Acceso a datos de SesionPractica y RespuestaPractica (data-model.md).

export interface SesionPractica {
  id: string
  cuentaId: string
  salaId: string
  // Inicio UTC de la sesión (base de la ventana 24 h del ranking)
  fecha: string
  numeroDePreguntas: number
  // Puntos acumulados de la sesión (parcial mientras está activa)
  puntosObtenidosTotal: number
  // Cola de fichas en el orden en que se preguntarán (entidad auxiliar,
  // ver plan.md Complexity Tracking)
  fichasIds: string[]
}

export interface RespuestaPractica {
  id: string
  fichaId: string
  cuentaId: string
  sesionPracticaId: string
  respuestaEscrita: string
  puntuacionCalidad: number
  alucinacionDetectada: boolean
  explicacion: string
  puntosObtenidos: number
  timestamp: string
}

// Columnas: id, cuenta_id, sala_id, fecha, numero_de_preguntas, puntos_obtenidos_total
const SELECT_SESION = 'SELECT id, cuenta_id, sala_id, fecha, numero_de_preguntas, puntos_obtenidos_total, fichas_ids FROM SesionPractica'

function mapearSesion(fila: ArrayLike<unknown>): SesionPractica {
  let fichasIds: string[] = []
  try {
    const datos = JSON.parse((fila[6] as string) ?? '[]')
    if (Array.isArray(datos)) {
      fichasIds = datos as string[]
    }
  } catch {
    fichasIds = []
  }
  return {
    id: fila[0] as string,
    cuentaId: fila[1] as string,
    salaId: fila[2] as string,
    fecha: fila[3] as string,
    numeroDePreguntas: fila[4] as number,
    puntosObtenidosTotal: fila[5] as number,
    fichasIds: fichasIds
  }
}

export async function crearSesion(db: Client, datos: { cuentaId: string; salaId: string; numeroDePreguntas: number; fichasIds: string[] }): Promise<SesionPractica> {
  const id = randomUUID()
  const fecha = new Date().toISOString()
  await db.execute({
    sql: 'INSERT INTO SesionPractica (id, cuenta_id, sala_id, fecha, numero_de_preguntas, puntos_obtenidos_total, fichas_ids) VALUES (?, ?, ?, ?, ?, 0, ?)',
    args: [id, datos.cuentaId, datos.salaId, fecha, datos.numeroDePreguntas, JSON.stringify(datos.fichasIds)]
  })
  return {
    id: id,
    cuentaId: datos.cuentaId,
    salaId: datos.salaId,
    fecha: fecha,
    numeroDePreguntas: datos.numeroDePreguntas,
    puntosObtenidosTotal: 0,
    fichasIds: datos.fichasIds
  }
}

export async function obtenerSesion(db: Client, id: string): Promise<SesionPractica | null> {
  const resultado = await db.execute({
    sql: SELECT_SESION + ' WHERE id = ?',
    args: [id]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearSesion(resultado.rows[0])
}

// Suma puntos (positivos o negativos) al total de la sesión (§8.2)
export async function sumarPuntosSesion(db: Client, id: string, puntos: number): Promise<void> {
  await db.execute({
    sql: 'UPDATE SesionPractica SET puntos_obtenidos_total = puntos_obtenidos_total + ? WHERE id = ?',
    args: [puntos, id]
  })
}

export async function crearRespuestaPractica(db: Client, datos: {
  fichaId: string
  cuentaId: string
  sesionPracticaId: string
  respuestaEscrita: string
  puntuacionCalidad: number
  alucinacionDetectada: boolean
  explicacion: string
  puntosObtenidos: number
}): Promise<RespuestaPractica> {
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  await db.execute({
    sql: [
      'INSERT INTO RespuestaPractica (id, ficha_id, cuenta_id, sesion_practica_id, respuesta_escrita,',
      'puntuacion_calidad, alucinacion_detectada, explicacion, puntos_obtenidos, timestamp)',
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ].join(' '),
    args: [
      id,
      datos.fichaId,
      datos.cuentaId,
      datos.sesionPracticaId,
      datos.respuestaEscrita,
      datos.puntuacionCalidad,
      datos.alucinacionDetectada ? 1 : 0,
      datos.explicacion,
      datos.puntosObtenidos,
      timestamp
    ]
  })
  return {
    id: id,
    fichaId: datos.fichaId,
    cuentaId: datos.cuentaId,
    sesionPracticaId: datos.sesionPracticaId,
    respuestaEscrita: datos.respuestaEscrita,
    puntuacionCalidad: datos.puntuacionCalidad,
    alucinacionDetectada: datos.alucinacionDetectada,
    explicacion: datos.explicacion,
    puntosObtenidos: datos.puntosObtenidos,
    timestamp: timestamp
  }
}

// Resumen por pregunta de la sesión (FR-034): orden de respuesta real
export async function listarRespuestasDeSesion(db: Client, sesionId: string): Promise<RespuestaPractica[]> {
  const resultado = await db.execute({
    sql: [
      'SELECT id, ficha_id, cuenta_id, sesion_practica_id, respuesta_escrita,',
      'puntuacion_calidad, alucinacion_detectada, explicacion, puntos_obtenidos, timestamp',
      'FROM RespuestaPractica WHERE sesion_practica_id = ? ORDER BY timestamp ASC'
    ].join(' '),
    args: [sesionId]
  })
  const salida: RespuestaPractica[] = []
  for (const fila of resultado.rows) {
    const valores = fila
    salida.push({
      id: valores[0] as string,
      fichaId: valores[1] as string,
      cuentaId: valores[2] as string,
      sesionPracticaId: valores[3] as string,
      respuestaEscrita: valores[4] as string,
      puntuacionCalidad: valores[5] as number,
      alucinacionDetectada: (valores[6] as number) === 1,
      explicacion: valores[7] as string,
      puntosObtenidos: valores[8] as number,
      timestamp: valores[9] as string
    })
  }
  return salida
}

// Última sesión (activa o cerrada) de una cuenta en una sala
export async function ultimaSesionDeCuenta(db: Client, cuentaId: string, salaId: string): Promise<SesionPractica | null> {
  const resultado = await db.execute({
    sql: SELECT_SESION + ' WHERE cuenta_id = ? AND sala_id = ? ORDER BY fecha DESC LIMIT 1',
    args: [cuentaId, salaId]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearSesion(resultado.rows[0])
}
