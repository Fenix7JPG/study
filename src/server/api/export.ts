import { Router } from 'express'
import type { Client } from '../../db/client.js'
import { crearMiddlewareAuth } from './middleware/auth.js'
import { listarFichasConTitulos } from '../models/fichas.js'
import { mazosPorDocumento, mazosTodasLasFichas, generarApkg } from '../services/exportacion.js'
import { construirBancoDocumento, construirBancosTodas } from '../services/banco.js'

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

  // ─── GET /api/export/banco?documento_id=… (banco §8 de un documento) ────
  router.get('/banco', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const documentoId = typeof req.query.documento_id === 'string' ? req.query.documento_id : ''
    if (documentoId === '') {
      res.status(400).json({ error: 'documento_id faltante' })
      return
    }
    const banco = await construirBancoDocumento(db, cuentaId, documentoId)
    if (banco === null) {
      res.status(404).json({ error: 'no tienes fichas para exportar en ese documento' })
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(banco.nombreArchivo))
    res.status(200).send(banco.contenido)
  })

  // ─── GET /api/export/banco/todas (.zip con un .json por documento) ─────
  router.get('/banco/todas', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const bancos = await construirBancosTodas(db, cuentaId)
    if (bancos === null) {
      res.status(404).json({ error: 'no tienes fichas para exportar todavía' })
      return
    }
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    for (const banco of bancos) {
      zip.file(banco.titulo + '.json', banco.contenido)
    }
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="banco-personalizado.zip"')
    res.status(200).send(bytes)
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
