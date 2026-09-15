import { z } from 'zod'
import type { Client } from '../../db/client.js'
import {
  listarFichasExportables,
  buscarPorFichaExterna,
  buscarPorIdNativo,
  aplicarImportacion,
  crearFicha,
  hayFichasDeSeccion
} from '../models/fichas.js'
import { buscarDocumentoImportado, crearDocumento, crearSeccionImportada, buscarSeccionImportada } from '../models/secciones.js'

// Servicio del Banco Personalizado (feature 002, fuente §8/§11.3/§11.4):
// validación estricta del formato, upsert atómico por archivo y exportación
// json/zip generada al vuelo (nunca persistida).

export const LIMITE_FICHAS = 2000
export const LIMITE_BYTES = 5 * 1024 * 1024

export interface ErrorImportacion {
  indice_ficha: number
  campo: string
  motivo: string
}

export interface ResumenImportacion {
  archivo: string
  creadas: number
  actualizadas: number
  rechazadas: ErrorImportacion[]
}

// ─── Validación estricta del formato §8 (contracts/banco.md) ─────────────

const ESQUEMA_ESTADO_SM2 = z.object({
  repeticiones: z.number().int('repeticiones debe ser entero').min(0, 'repeticiones debe ser ≥ 0'),
  intervalo_dias: z.number().int('intervalo_dias debe ser entero').min(0, 'intervalo_dias debe ser ≥ 0'),
  factor_facilidad: z.number().min(1.3, 'factor_facilidad debe ser ≥ 1.3'),
  fecha_proximo_repaso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha_proximo_repaso debe ser YYYY-MM-DD')
})

const ESQUEMA_FICHA_BANCO = z.object({
  id: z.string().min(1, 'id no puede estar vacío'),
  pregunta: z.string().min(1, 'pregunta no puede estar vacía'),
  respuesta: z.string().min(1, 'respuesta no puede estar vacía'),
  concepto_id: z.string().optional().default(''),
  concepto_tipo: z.string().optional().default(''),
  tipo_ficha: z.enum(['estandar', 'discriminacion'], { message: 'tipo_ficha debe ser estandar o discriminacion' }),
  prioridad_inicial: z.enum(['alta', 'baja'], { message: 'prioridad_inicial debe ser alta o baja' }),
  pendiente: z.boolean().optional().default(false),
  estado_sm2: ESQUEMA_ESTADO_SM2
})

const ESQUEMA_BANCO = z.object({
  version_formato: z.literal('1', { message: 'version_formato debe ser "1"' }),
  cuenta_id: z.string().min(1, 'cuenta_id no puede estar vacío'),
  documento_titulo: z.string().min(1, 'documento_titulo no puede estar vacío'),
  fecha_exportacion: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha_exportacion debe ser YYYY-MM-DD')
    .optional(),
  fichas: z.array(ESQUEMA_FICHA_BANCO)
})

export interface FichaBanco {
  id: string
  pregunta: string
  respuesta: string
  concepto_id: string
  concepto_tipo: string
  tipo_ficha: 'estandar' | 'discriminacion'
  prioridad_inicial: 'alta' | 'baja'
  pendiente: boolean
  estado_sm2: { repeticiones: number; intervalo_dias: number; factor_facilidad: number; fecha_proximo_repaso: string }
}

export interface BancoValido {
  cuenta_id: string
  documento_titulo: string
  fecha_exportacion?: string
  fichas: FichaBanco[]
}

export type ResultadoValidacionBanco =
  | { ok: true; datos: BancoValido }
  | { ok: false; errores: ErrorImportacion[] }

// Valida TODO el archivo y recolecta TODOS los errores (índice + campo + motivo)
export function validarBanco(texto: string): ResultadoValidacionBanco {
  // Límite de tamaño en bytes (UTF-8), además del del middleware
  if (Buffer.byteLength(texto, 'utf8') > LIMITE_BYTES) {
    return { ok: false, errores: [{ indice_ficha: -1, campo: 'archivo', motivo: 'el archivo supera el límite de 5 MB' }] }
  }

  let json: unknown
  try {
    json = JSON.parse(texto)
  } catch {
    return { ok: false, errores: [{ indice_ficha: -1, campo: 'archivo', motivo: 'no es JSON válido' }] }
  }

  const base = ESQUEMA_BANCO.safeParse(json)
  if (!base.success) {
    const errores: ErrorImportacion[] = base.error.issues.map(function (issue) {
      const ruta = issue.path.map(String)
      // ruta como ['fichas', 3, 'estado_sm2', 'repeticiones'] → índice 3
      const indice = ruta.length > 1 && ruta[0] === 'fichas' && /^\d+$/.test(ruta[1]) ? Number(ruta[1]) : -1
      const campo = ruta.filter(function (parte, i) {
        return !(i <= 1 && ruta[0] === 'fichas')
      }).join('.') || 'archivo'
      return { indice_ficha: indice, campo: campo, motivo: issue.message }
    })
    return { ok: false, errores: errores }
  }

  // Límite de fichas (fuente §8)
  if (base.data.fichas.length > LIMITE_FICHAS) {
    return {
      ok: false,
      errores: [{ indice_ficha: -1, campo: 'fichas', motivo: 'el archivo supera el límite de ' + String(LIMITE_FICHAS) + ' fichas' }]
    }
  }

  return { ok: true, datos: base.data }
}

// ─── Upsert atómico (research D17, FR-108) ────────────────────────────────

export async function importarBanco(db: Client, cuentaId: string, nombreArchivo: string, texto: string): Promise<ResumenImportacion> {
  const validacion = validarBanco(texto)
  if (!validacion.ok) {
    return { archivo: nombreArchivo, creadas: 0, actualizadas: 0, rechazadas: validacion.errores }
  }
  const banco = validacion.datos

  // Documento importado reutilizable por titulo (FR-109)
  let documento = await buscarDocumentoImportado(db, cuentaId, banco.documento_titulo)
  if (documento === null) {
    documento = await crearDocumento(db, {
      titulo: banco.documento_titulo,
      jsonIngesta: null,
      cuentaCreadoraId: cuentaId,
      origen: 'importado'
    })
    await crearSeccionImportada(db, { documentoId: documento.id, titulo: banco.documento_titulo })
  }
  const seccion = await buscarSeccionImportada(db, documento.id)
  if (seccion === null) {
    return { archivo: nombreArchivo, creadas: 0, actualizadas: 0, rechazadas: [{ indice_ficha: -1, campo: 'archivo', motivo: 'no se encontró la sección del documento importado' }] }
  }

  // La validación ya pasó: a partir de aquí no hay rechazos por formato
  const resumen: ResumenImportacion = { archivo: nombreArchivo, creadas: 0, actualizadas: 0, rechazadas: [] }
  const bancoAjeno = banco.cuenta_id !== cuentaId

  for (const ficha of banco.fichas) {
    let destino: string | null = null
    if (!bancoAjeno) {
      // Regla 1: coincidencia por ficha_externa_id
      const porExterna = await buscarPorFichaExterna(db, cuentaId, ficha.id)
      if (porExterna !== null) {
        destino = porExterna.id
      } else {
        // Regla 2: id nativo sin ficha_externa_id (banco exportado por este sistema)
        const porNativa = await buscarPorIdNativo(db, cuentaId, ficha.id)
        if (porNativa !== null) {
          destino = porNativa.id
        }
      }
    }
    // Regla 3: crear (o banco ajeno: siempre nuevo, jamás toca fichas ajenas)
    if (destino !== null) {
      await aplicarImportacion(db, destino, {
        pregunta: ficha.pregunta,
        respuesta: ficha.respuesta,
        conceptoId: ficha.concepto_id,
        conceptoTipo: ficha.concepto_tipo === '' ? null : ficha.concepto_tipo,
        tipo: ficha.tipo_ficha,
        prioridadInicial: ficha.prioridad_inicial,
        pendiente: ficha.pendiente,
        fichaExternaId: ficha.id,
        estadoSm2: {
          repeticiones: ficha.estado_sm2.repeticiones,
          intervaloDias: ficha.estado_sm2.intervalo_dias,
          factorFacilidad: ficha.estado_sm2.factor_facilidad,
          fechaProximoRepaso: ficha.estado_sm2.fecha_proximo_repaso
        }
      })
      resumen.actualizadas = resumen.actualizadas + 1
    } else {
      const creada = await crearFicha(db, {
        cuentaId: cuentaId,
        seccionId: seccion.id,
        pregunta: ficha.pregunta,
        respuesta: ficha.respuesta,
        conceptoId: ficha.concepto_id,
        conceptoTipo: ficha.concepto_tipo === '' ? null : ficha.concepto_tipo,
        tipo: ficha.tipo_ficha,
        prioridadInicial: ficha.prioridad_inicial,
        pendiente: ficha.pendiente
      })
      // Fijar el id externo (id del archivo) sobre la ficha recién creada
      await db.execute({
        sql: 'UPDATE Ficha SET ficha_externa_id = ? WHERE id = ?',
        args: [ficha.id, creada.id]
      })
      resumen.creadas = resumen.creadas + 1
    }
  }

  return resumen
}

// ─── Exportación (FR-101..103) ────────────────────────────────────────────

interface FichaBancoExport {
  id: string
  pregunta: string
  respuesta: string
  concepto_id: string
  concepto_tipo: string
  tipo_ficha: string
  prioridad_inicial: string
  pendiente: boolean
  estado_sm2: { repeticiones: number; intervalo_dias: number; factor_facilidad: number; fecha_proximo_repaso: string }
}

function fichaABanco(ficha: { id: string; pregunta: string; respuesta: string; conceptoId: string; conceptoTipo: string | null; tipo: string; prioridadInicial: string; pendiente: boolean; repeticiones: number; intervaloDias: number; factorFacilidad: number; fechaProximoRepaso: string; fichaExternaId: string | null }): FichaBancoExport {
  return {
    id: ficha.fichaExternaId ?? ficha.id,
    pregunta: ficha.pregunta,
    respuesta: ficha.respuesta,
    concepto_id: ficha.conceptoId,
    concepto_tipo: ficha.conceptoTipo ?? '',
    tipo_ficha: ficha.tipo,
    prioridad_inicial: ficha.prioridadInicial,
    pendiente: ficha.pendiente,
    estado_sm2: {
      repeticiones: ficha.repeticiones,
      intervalo_dias: ficha.intervaloDias,
      factor_facilidad: ficha.factorFacilidad,
      fecha_proximo_repaso: ficha.fechaProximoRepaso
    }
  }
}

// Banco §8 de UN documento de la cuenta; null si no tiene fichas ahí
export async function construirBancoDocumento(db: Client, cuentaId: string, documentoId: string): Promise<{ nombreArchivo: string; contenido: string } | null> {
  const filas = await listarFichasExportables(db, cuentaId, documentoId)
  if (filas.length === 0) {
    return null
  }
  const titulo = filas[0].tituloDocumento
  const banco = {
    version_formato: '1',
    cuenta_id: cuentaId,
    documento_titulo: titulo,
    fecha_exportacion: new Date().toISOString().slice(0, 10),
    fichas: filas.map(function (fila) {
      return fichaABanco(fila.ficha)
    })
  }
  return { nombreArchivo: titulo + '.json', contenido: JSON.stringify(banco, null, 2) }
}

// Banco §8 de TODAS las fichas: {tituloDocumento: contenido}
export async function construirBancosTodas(db: Client, cuentaId: string): Promise<Array<{ titulo: string; contenido: string }> | null> {
  const filas = await listarFichasExportables(db, cuentaId, null)
  if (filas.length === 0) {
    return null
  }
  const porDocumento = new Map<string, Array<FichaBancoExport>>()
  for (const fila of filas) {
    const lista = porDocumento.get(fila.tituloDocumento)
    if (lista === undefined) {
      porDocumento.set(fila.tituloDocumento, [fichaABanco(fila.ficha)])
    } else {
      lista.push(fichaABanco(fila.ficha))
    }
  }
  const hoy = new Date().toISOString().slice(0, 10)
  const bancos: Array<{ titulo: string; contenido: string }> = []
  const usados = new Set<string>()
  for (const par of porDocumento) {
    // Desambiguar títulos repetidos (documento de ingesta + importado con el
    // mismo nombre son contenedores separados, research D18)
    let nombre = par[0]
    let sufijo = 2
    while (usados.has(nombre)) {
      nombre = par[0] + ' (' + String(sufijo) + ')'
      sufijo = sufijo + 1
    }
    usados.add(nombre)
    const banco = {
      version_formato: '1',
      cuenta_id: cuentaId,
      documento_titulo: par[0],
      fecha_exportacion: hoy,
      fichas: par[1]
    }
    bancos.push({ titulo: nombre, contenido: JSON.stringify(banco, null, 2) })
  }
  return bancos
}
