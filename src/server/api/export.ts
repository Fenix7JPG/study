import { Router } from 'express'
import type { Client } from '../../db/client.js'
import { crearMiddlewareAuth } from './middleware/auth.js'
import { listarFichasConTitulos } from '../models/fichas.js'
import { mazosPorDocumento, mazosTodasLasFichas, generarApkg } from '../services/exportacion.js'

// Exportación .apkg (fuente §9, FR-038/039/040): se genera al vuelo a partir
// de los registros actuales de la cuenta y se envía como descarga directa.
// NUNCA se persiste en base de datos ni en disco.

export function crearRouterExport(db: Client, jwtSecret: string): Router {
  const router = Router()
  router.use(crearMiddlewareAuth(jwtSecret))

  function encabezadosDescarga(res: { setHeader(n: string, v: string): void }, nombreArchivo: string): void {
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', 'attachment; filename="fichas.apkg"; filename*=UTF-8\'\'' + encodeURIComponent(nombreArchivo) + '.apkg')
  }

  // ─── GET /api/export/apkg?documento_id=… (nivel 1: por documento) ───────
  router.get('/apkg', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const documentoId = typeof req.query.documento_id === 'string' ? req.query.documento_id : ''
    if (documentoId === '') {
      res.status(400).json({ error: 'documento_id faltante' })
      return
    }
    const fichas = await listarFichasConTitulos(db, cuentaId, documentoId)
    if (fichas.length === 0) {
      // Aviso en lugar de archivo vacío (supuesto del spec)
      res.status(404).json({ error: 'no tienes fichas para exportar en ese documento' })
      return
    }
    const tituloDocumento = fichas[0].tituloDocumento
    const mazos = mazosPorDocumento(tituloDocumento, fichas.map(function (f) { return { pregunta: f.pregunta, respuesta: f.respuesta } }))
    const bytes = await generarApkg(mazos)
    encabezadosDescarga(res, tituloDocumento)
    res.status(200).send(Buffer.from(bytes))
  })

  // ─── GET /api/export/apkg/todas (nivel 2: todas con subdecks) ───────────
  router.get('/apkg/todas', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const filas = await listarFichasConTitulos(db, cuentaId, null)
    if (filas.length === 0) {
      res.status(404).json({ error: 'no tienes fichas para exportar todavía' })
      return
    }
    const mazos = mazosTodasLasFichas(filas)
    const bytes = await generarApkg(mazos)
    encabezadosDescarga(res, 'todas-las-fichas')
    res.status(200).send(Buffer.from(bytes))
  })

  return router
}
