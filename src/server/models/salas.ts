import { randomUUID } from 'node:crypto'
import type { Client } from '../../db/client.js'

// Acceso a datos de Sala y Membresia (data-model.md).
// SELECTs documentados por posición de columna para mapeo determinista.

export interface Sala {
  id: string
  documentoId: string | null
  codigoInvitacion: string
  administradorCuentaId: string
  configTiempoLectura: number | null
  configTiempoEscritura: number | null
  configTiempoResultados: number | null
  configTamanoSesionPractica: number
  configValoresPuntuacion: string
  modo: 'dump' | 'multijugador'
  cerradaEn: string | null
}

export interface DatosSalaNueva {
  documentoId: string | null
  administradorCuentaId: string
  modo: 'dump' | 'multijugador'
  codigoInvitacion: string
  configTiempoLectura: number | null
  configTiempoEscritura: number | null
  configTiempoResultados: number | null
  configTamanoSesionPractica: number
  configValoresPuntuacion: string
}

// Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L) para códigos legibles
const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generarCodigoInvitacion(): string {
  let codigo = ''
  for (let i = 0; i < 8; i++) {
    const indice = Math.floor(Math.random() * ALFABETO_CODIGO.length)
    codigo = codigo + ALFABETO_CODIGO.charAt(indice)
  }
  return codigo
}

// Columnas del SELECT: id, documento_id, codigo_invitacion, administrador_cuenta_id,
// config_tiempo_lectura, config_tiempo_escritura, config_tiempo_resultados,
// config_tamano_sesion_practica, config_valores_puntuacion
const SELECT_SALA = 'SELECT id, documento_id, codigo_invitacion, administrador_cuenta_id, config_tiempo_lectura, config_tiempo_escritura, config_tiempo_resultados, config_tamano_sesion_practica, config_valores_puntuacion, modo, cerrada_en FROM Sala'

function mapearSala(fila: ArrayLike<unknown>): Sala {
  return {
    id: fila[0] as string,
    documentoId: (fila[1] as string | null) ?? null,
    codigoInvitacion: fila[2] as string,
    administradorCuentaId: fila[3] as string,
    configTiempoLectura: (fila[4] as number | null) ?? null,
    configTiempoEscritura: (fila[5] as number | null) ?? null,
    configTiempoResultados: (fila[6] as number | null) ?? null,
    configTamanoSesionPractica: fila[7] as number,
    configValoresPuntuacion: fila[8] as string,
    modo: (fila[9] as 'dump' | 'multijugador' | null) ?? 'dump',
    cerradaEn: (fila[10] as string | null) ?? null
  }
}

export async function crearSala(db: Client, datos: DatosSalaNueva): Promise<Sala> {
  const id = randomUUID()
  await db.execute({
    sql: [
      'INSERT INTO Sala (id, documento_id, codigo_invitacion, administrador_cuenta_id,',
      'config_tiempo_lectura, config_tiempo_escritura, config_tiempo_resultados,',
      'config_tamano_sesion_practica, config_valores_puntuacion, modo)',
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ].join(' '),
    args: [
      id,
      datos.documentoId,
      datos.codigoInvitacion,
      datos.administradorCuentaId,
      datos.configTiempoLectura,
      datos.configTiempoEscritura,
      datos.configTiempoResultados,
      datos.configTamanoSesionPractica,
      datos.configValoresPuntuacion,
      datos.modo
    ]
  })
  const sala = await obtenerSala(db, id)
  if (sala === null) {
    throw new Error('la sala no se creó correctamente')
  }
  return sala
}

export async function obtenerSala(db: Client, id: string): Promise<Sala | null> {
  const resultado = await db.execute({
    sql: SELECT_SALA + ' WHERE id = ?',
    args: [id]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearSala(resultado.rows[0])
}

export async function buscarSalaPorCodigo(db: Client, codigo: string): Promise<Sala | null> {
  const resultado = await db.execute({
    sql: SELECT_SALA + ' WHERE codigo_invitacion = ?',
    args: [codigo]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearSala(resultado.rows[0])
}

// Sala asociada a un documento (una sala por documento, fuente §6.1)
export async function buscarSalaPorDocumento(db: Client, documentoId: string): Promise<Sala | null> {
  const resultado = await db.execute({
    sql: SELECT_SALA + ' WHERE documento_id = ? LIMIT 1',
    args: [documentoId]
  })
  if (resultado.rows.length === 0) {
    return null
  }
  return mapearSala(resultado.rows[0])
}

// Salas con membresía de la cuenta, con el título del documento y el rol
export async function listarSalasDeCuenta(
  db: Client,
  cuentaId: string
): Promise<Array<{ sala: Sala; documentoTitulo: string | null; rol: 'administrador' | 'participante' }>> {
  const resultado = await db.execute({
    sql: [
      'SELECT ' +
        's.id, s.documento_id, s.codigo_invitacion, s.administrador_cuenta_id,',
      's.config_tiempo_lectura, s.config_tiempo_escritura, s.config_tiempo_resultados,',
      's.config_tamano_sesion_practica, s.config_valores_puntuacion, s.modo, s.cerrada_en,',
      'd.titulo, s.administrador_cuenta_id = m.cuenta_id AS es_admin',
      'FROM Membresia m',
      'JOIN Sala s ON s.id = m.sala_id',
      'LEFT JOIN Documento d ON d.id = s.documento_id',
      // FR-305: solo salas activas o con actividad reciente (24 h) — lo
      // duradero del jugador es su banco portable, no la lista de salas
      "WHERE m.cuenta_id = ? AND (NOT EXISTS (SELECT 1 FROM SesionPractica sp WHERE sp.sala_id = s.id AND sp.cuenta_id = m.cuenta_id) OR EXISTS (SELECT 1 FROM SesionPractica sp WHERE sp.sala_id = s.id AND sp.cuenta_id = m.cuenta_id AND (sp.cerrada_en IS NULL OR sp.fecha >= ?)))",
      'ORDER BY m.fecha_union DESC'
    ].join(' '),
    args: [cuentaId, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]
  })

  const salida: Array<{ sala: Sala; documentoTitulo: string | null; rol: 'administrador' | 'participante' }> = []
  for (const fila of resultado.rows) {
    // La consulta trae 11 columnas de Sala + titulo del documento (NULL en
    // multijugador, d es CROSS-less JOIN: usamos LEFT JOIN implícito via COALESCE)
    const valores = Array.from(fila)
    salida.push({
      sala: mapearSala(valores.slice(0, 11)),
      documentoTitulo: (valores[11] as string | null) ?? null,
      rol: (valores[12] as number) === 1 ? 'administrador' : 'participante'
    })
  }
  return salida
}

// Actualiza los campos de configuración presentes en `campos` (solo admin)
export async function actualizarConfigSala(
  db: Client,
  salaId: string,
  campos: {
    configTiempoLectura?: number
    configTiempoEscritura?: number
    configTiempoResultados?: number
    configTamanoSesionPractica?: number
    configValoresPuntuacion?: string
  }
): Promise<void> {
  const asignaciones: string[] = []
  const args: Array<string | number> = []
  if (campos.configTiempoLectura !== undefined) {
    asignaciones.push('config_tiempo_lectura = ?')
    args.push(campos.configTiempoLectura)
  }
  if (campos.configTiempoEscritura !== undefined) {
    asignaciones.push('config_tiempo_escritura = ?')
    args.push(campos.configTiempoEscritura)
  }
  if (campos.configTiempoResultados !== undefined) {
    asignaciones.push('config_tiempo_resultados = ?')
    args.push(campos.configTiempoResultados)
  }
  if (campos.configTamanoSesionPractica !== undefined) {
    asignaciones.push('config_tamano_sesion_practica = ?')
    args.push(campos.configTamanoSesionPractica)
  }
  if (campos.configValoresPuntuacion !== undefined) {
    asignaciones.push('config_valores_puntuacion = ?')
    args.push(campos.configValoresPuntuacion)
  }
  if (asignaciones.length === 0) {
    return
  }
  args.push(salaId)
  await db.execute({
    sql: 'UPDATE Sala SET ' + asignaciones.join(', ') + ' WHERE id = ?',
    args: args
  })
}

// ─── Membresia ────────────────────────────────────────────────────────────

export async function crearMembresia(db: Client, cuentaId: string, salaId: string): Promise<void> {
  await db.execute({
    sql: 'INSERT INTO Membresia (id, cuenta_id, sala_id, fecha_union) VALUES (?, ?, ?, ?)',
    args: [randomUUID(), cuentaId, salaId, new Date().toISOString()]
  })
}

export async function esMiembro(db: Client, cuentaId: string, salaId: string): Promise<boolean> {
  const resultado = await db.execute({
    sql: 'SELECT 1 FROM Membresia WHERE cuenta_id = ? AND sala_id = ? LIMIT 1',
    args: [cuentaId, salaId]
  })
  return resultado.rows.length > 0
}

export async function esAdministrador(db: Client, cuentaId: string, salaId: string): Promise<boolean> {
  const resultado = await db.execute({
    sql: 'SELECT 1 FROM Sala WHERE id = ? AND administrador_cuenta_id = ? LIMIT 1',
    args: [salaId, cuentaId]
  })
  return resultado.rows.length > 0
}


// Cierre explícito de la sala por parte del host (FR-117)
export async function cerrarSala(db: Client, salaId: string): Promise<void> {
  await db.execute({
    sql: 'UPDATE Sala SET cerrada_en = ? WHERE id = ?',
    args: [new Date().toISOString(), salaId]
  })
}
