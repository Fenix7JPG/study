import { z } from 'zod'

// Los 3 esquemas de salida de la IA (contracts/ai.md, fuente §6.4/§6.5/§6.6).
// El backend valida cada respuesta con el esquema correspondiente antes de
// procesarla; el modelo NUNCA calcula puntos.

// A. Calificación de dump (sin puntos_obtenidos: los calcula el backend §8.1)
export const ESQUEMA_CALIFICACION_DUMP = z.object({
  cobertura_porcentaje: z.number().min(0).max(100),
  conceptos_cubiertos: z.array(z.string()),
  conceptos_faltantes: z.array(z.string()),
  errores: z.array(
    z.object({
      id_concepto: z.string(),
      descripcion_error: z.string()
    })
  )
})

export type CalificacionIADump = z.infer<typeof ESQUEMA_CALIFICACION_DUMP>

// B. Generación del banco de fichas
export const ESQUEMA_GENERACION_FICHAS = z.object({
  fichas: z
    .array(
      z.object({
        pregunta: z.string(),
        respuesta: z.string(),
        concepto_id: z.string(),
        tipo: z.enum(['estandar', 'discriminacion']),
        prioridad_inicial: z.enum(['alta', 'baja'])
      })
    )
    .min(1, 'la respuesta debe incluir al menos una ficha')
})

export type FichasIAGeneradas = z.infer<typeof ESQUEMA_GENERACION_FICHAS>

// C. Calificación de práctica (cap de calidad ≤2 si hay alucinación)
export const ESQUEMA_CALIFICACION_PRACTICA = z.object({
  puntuacion_calidad: z.number().int().min(0).max(5),
  alucinacion_detectada: z.boolean(),
  explicacion: z.string()
})

export type CalificacionIAPractica = z.infer<typeof ESQUEMA_CALIFICACION_PRACTICA>
