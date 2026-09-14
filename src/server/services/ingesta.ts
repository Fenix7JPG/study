import { z } from 'zod'

// Validador del JSON de ingesta (FR-007, fuente §11).
// ✅ CONGELADO (Q1, opción A): el contrato es el esquema EXACTO del archivo
// `prompt_maestro_ingesta.md` (archivado junto a este spec). Se validan las
// reglas 1–10 de ese archivo: estructura del esquema, tipos de bloque,
// enum de tipo de concepto, e ids secuenciales con formato regla 8/10.

export const TIPOS_CONCEPTO = ['definicion', 'dato', 'proceso', 'relacion', 'ejemplo'] as const
export type TipoConcepto = (typeof TIPOS_CONCEPTO)[number]

export interface BloqueIngesta {
  tipo: 'texto' | 'tabla'
  // Bloque de texto: el campo es "valor" (prompt maestro, esquema exacto)
  valor?: string
  // Bloque de tabla
  encabezados?: string[]
  filas?: string[][]
}

export interface ConceptoIngesta {
  id: string
  concepto: string
  explicacion: string
  tipo: TipoConcepto
}

export interface JsonIngestaValido {
  documento: {
    titulo: string
    secciones: Array<{
      id: string
      titulo: string
      orden: number
      num_palabras: number
      contenido: BloqueIngesta[]
      mapa_conceptos: ConceptoIngesta[]
    }>
  }
}

// ─── Esquema base (estructura y tipos del "ESQUEMA EXACTO A SEGUIR") ──────

const BloqueTexto = z.object({
  tipo: z.literal('texto'),
  valor: z.string()
})

const BloqueTabla = z.object({
  tipo: z.literal('tabla'),
  encabezados: z.array(z.string()),
  filas: z.array(z.array(z.string()))
})

const Concepto = z.object({
  id: z.string(),
  concepto: z.string(),
  explicacion: z.string(),
  tipo: z.enum(TIPOS_CONCEPTO)
})

const Seccion = z.object({
  id: z.string(),
  titulo: z.string(),
  orden: z.number().int('orden debe ser entero'),
  num_palabras: z.number().int('num_palabras debe ser entero'),
  contenido: z.array(z.union([BloqueTexto, BloqueTabla])),
  mapa_conceptos: z.array(Concepto)
})

export const ESQUEMA_INGESTA = z.object({
  documento: z.object({
    titulo: z.string(),
    secciones: z.array(Seccion)
  })
})

// ─── Validación con mensajes específicos por campo (fuente §6.1) ──────────

export type ResultadoValidacionIngesta =
  | { ok: true; datos: JsonIngestaValido }
  | { ok: false; error: string }

export function validarIngesta(json: unknown): ResultadoValidacionIngesta {
  // 1) Estructura y tipos según el esquema exacto
  const base = ESQUEMA_INGESTA.safeParse(json)
  if (!base.success) {
    const primero = base.error.issues[0]
    const campo = primero.path.map(String).join('.')
    const mensaje = campo === '' ? primero.message : 'campo "' + campo + '": ' + primero.message
    return { ok: false, error: mensaje }
  }

  // 2) Regla 10: ids de sección únicos y secuenciales "s1", "s2", ... en orden
  const secciones = base.data.documento.secciones
  for (let i = 0; i < secciones.length; i++) {
    const esperado = 's' + String(i + 1)
    if (secciones[i].id !== esperado) {
      return {
        ok: false,
        error: 'campo "documento.secciones[' + String(i) + '].id": debe ser "' + esperado + '" (los id de sección deben ser secuenciales s1, s2, s3... en el orden del documento, regla 10)'
      }
    }

    // 3) Regla 8: id de concepto con formato "{id_seccion}-cN" y únicos en la sección
    const vistos = new Set<string>()
    for (let j = 0; j < secciones[i].mapa_conceptos.length; j++) {
      const concepto = secciones[i].mapa_conceptos[j]
      const patron = new RegExp('^' + esperado + '-c[0-9]+$')
      if (!patron.test(concepto.id)) {
        return {
          ok: false,
          error: 'campo "documento.secciones[' + String(i) + '].mapa_conceptos[' + String(j) + '].id": "' + concepto.id + '" no cumple el formato "' + esperado + '-cN" (regla 8)'
        }
      }
      if (vistos.has(concepto.id)) {
        return {
          ok: false,
          error: 'campo "documento.secciones[' + String(i) + '].mapa_conceptos[' + String(j) + '].id": "' + concepto.id + '" está duplicado en la sección (regla 8)'
        }
      }
      vistos.add(concepto.id)
    }
  }

  return { ok: true, datos: base.data }
}
