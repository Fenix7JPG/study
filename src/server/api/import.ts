import { Router } from 'express'
import multer from 'multer'
import JSZip from 'jszip'
import type { Client } from '../../db/client.js'
import { crearMiddlewareAuth } from './middleware/auth.js'
import { importarBanco } from '../services/banco.js'

// Importación del banco personalizado (feature 002, FR-105..110):
// multipart con campo `archivos` (múltiple); acepta .json/.txt directos y
// .zip con .json internos. Límite 5 MB por archivo (middleware multer).
// Cada archivo se procesa de forma ATÓMICA (validación previa completa).

const MAX_BYTES = 5 * 1024 * 1024
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES }
})

export function crearRouterImport(db: Client, jwtSecret: string): Router {
  const router = Router()
  router.use(crearMiddlewareAuth(jwtSecret))

  router.post('/banco', subida.array('archivos', 20), async function (req, res) {
    const cuentaId = req.cuentaId as string
    const archivos = req.files as Express.Multer.File[] | undefined
    if (archivos === undefined || archivos.length === 0) {
      res.status(400).json({ error: 'no se recibieron archivos (campo `archivos`)' })
      return
    }

    const resultados: Array<{ archivo: string; creadas: number; actualizadas: number; rechazadas: Array<{ indice_ficha: number; campo: string; motivo: string }> }> = []

    for (const archivo of archivos) {
      // Contenido a procesar: el archivo directo o los .json dentro del .zip
      const contenidos: Array<{ nombre: string; texto: string }> = []
      if (archivo.originalname.toLowerCase().endsWith('.zip')) {
        try {
          const zip = await JSZip.loadAsync(archivo.buffer)
          for (const nombre of Object.keys(zip.files)) {
            const entrada = zip.files[nombre]
            if (!entrada.dir && nombre.toLowerCase().endsWith('.json')) {
              contenidos.push({ nombre: archivo.originalname + '::' + nombre, texto: await entrada.async('string') })
            }
          }
          if (contenidos.length === 0) {
            resultados.push({ archivo: archivo.originalname, creadas: 0, actualizadas: 0, rechazadas: [{ indice_ficha: -1, campo: 'archivo', motivo: 'el .zip no contiene archivos .json' }] })
          }
        } catch {
          resultados.push({ archivo: archivo.originalname, creadas: 0, actualizadas: 0, rechazadas: [{ indice_ficha: -1, campo: 'archivo', motivo: 'el .zip no se pudo abrir' }] })
        }
      } else {
        contenidos.push({ nombre: archivo.originalname, texto: archivo.buffer.toString('utf8') })
      }

      // Cada .json se importa de forma atómica (validación previa completa)
      for (const contenido of contenidos) {
        const resumen = await importarBanco(db, cuentaId, contenido.nombre, contenido.texto)
        resultados.push(resumen)
      }
    }

    res.status(200).json({ resultados: resultados })
  })

  return router
}
