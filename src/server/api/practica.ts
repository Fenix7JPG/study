import { Router } from 'express'
import type { Client } from '../../db/client.js'
import { crearMiddlewareAuth } from './middleware/auth.js'
import type { ClienteIA } from '../ai/openrouter.js'
import { seleccionarFichas, calificarPracticaConIA } from '../services/practica.js'
import { puntosPractica, valoresDeSala } from '../services/puntos.js'
import { listarFichasDeSala, listarFichasDeCuentaTodas, obtenerFichaPorId, actualizarSm2, marcarPendiente } from '../models/fichas.js'
import { crearSesion, obtenerSesion, sumarPuntosSesion, crearRespuestaPractica, listarRespuestasDeSesion, extenderCola } from '../models/practica.js'
import { esMiembro, obtenerSala } from '../models/salas.js'
import { aplicarSm2 } from '../services/sm2.js'

// Módulo de práctica (fuente §6.6–§6.8, US6): sesiones con calificación IA
// 0–5, cap de alucinación, SM-2 clásico y puntos §8.2 sin piso.

export function crearRouterPractica(db: Client, jwtSecret: string, clienteIA: ClienteIA): Router {
  const router = Router()
  router.use(crearMiddlewareAuth(jwtSecret))

  // ─── POST /api/practica/iniciar ─────────────────────────────────────────
  router.post('/iniciar', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const cuerpo = req.body ?? {}
    const salaId = typeof cuerpo.sala_id === 'string' ? cuerpo.sala_id : ''
    if (salaId === '') {
      res.status(400).json({ error: 'sala_id faltante' })
      return
    }
    const sala = await obtenerSala(db, salaId)
    if (sala === null || !(await esMiembro(db, cuentaId, salaId))) {
      res.status(403).json({ error: 'sala no encontrada o sin acceso' })
      return
    }

    // Tamaño: SOLO el modo multijugador lo usa (feature 004: en dump la
    // práctica es infinita y la cierra el host, FR-301)
    let tamano = sala.configTamanoSesionPractica
    if (sala.modo === 'multijugador' && cuerpo.tamano !== undefined) {
      if (typeof cuerpo.tamano !== 'number' || !Number.isInteger(cuerpo.tamano) || cuerpo.tamano < 1) {
        res.status(400).json({ error: 'tamano debe ser un entero ≥ 1' })
        return
      }
      tamano = cuerpo.tamano
    }
    if (sala.modo === 'dump') {
      // El tamaño de la cola inicial es el pool disponible; la sesión NO se
      // cierra por conteo (FR-302)
      const disponible = await listarFichasDeSala(db, cuentaId, salaId)
      tamano = Math.max(disponible.length, 1)
    }

    // Selección (FR-028 / FR-113): pendientes SIEMPRE → vencidas → prioridad
    // alta → baja. En multijugador el pool es TODAS las fichas de la cuenta
    // (Modo 1 o importadas); en dump, las del documento de la sala.
    const fichas = sala.modo === 'multijugador'
      ? await listarFichasDeCuentaTodas(db, cuentaId)
      : await listarFichasDeSala(db, cuentaId, salaId)
    const seleccion = seleccionarFichas(fichas, tamano)
    if (seleccion.length === 0) {
      res.status(400).json({ error: 'no hay fichas disponibles para practicar en esta sala' })
      return
    }

    const sesion = await crearSesion(db, {
      cuentaId: cuentaId,
      salaId: salaId,
      numeroDePreguntas: tamano,
      fichasIds: seleccion.map(function (f) { return f.id })
    })

    res.status(201).json({ sesion: sesion, total: seleccion.length, ficha: seleccion[0] })
  })

  // ─── GET /api/practica/:id/siguiente ────────────────────────────────────
  router.get('/:id/siguiente', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const sesion = await obtenerSesion(db, req.params.id)
    if (sesion === null || sesion.cuentaId !== cuentaId) {
      res.status(404).json({ error: 'sesión no encontrada' })
      return
    }
    const salaDeSesion = await obtenerSala(db, sesion.salaId)
    if (sesion.cerradaEn !== null) {
      // Cerrada por el host (FR-303): el participante ve su resumen
      res.status(200).json({ ficha: null, respondidas: 0, total: 0, sesion_cerrada: true, cerrada_por_host: true })
      return
    }

    const respuestas = await listarRespuestasDeSesion(db, sesion.id)
    let respondidas = respuestas.length
    let total = sesion.fichasIds.length

    // Cola agotada: en modo dump la sesión es INFINITA (FR-302) → nueva
    // selección de 6.6 con SOLO las fichas que califican ahora (pendientes o
    // vencidas); si no hay ninguna, la sesión queda abierta "sin fichas ahora"
    if (respondidas >= total && salaDeSesion !== null && salaDeSesion.modo === 'dump') {
      const hoy = new Date().toISOString().slice(0, 10)
      const pool = await listarFichasDeSala(db, cuentaId, sesion.salaId)
      const califican = pool.filter(function (f) {
        return f.pendiente || f.fechaProximoRepaso <= hoy
      })
      const nuevas = seleccionarFichas(califican, califican.length)
      if (nuevas.length > 0) {
        const nuevasIds = nuevas.map(function (f) { return f.id })
        await extenderCola(db, sesion.id, nuevasIds)
        sesion.fichasIds = sesion.fichasIds.concat(nuevasIds)
        total = sesion.fichasIds.length
      }
    }

    if (respondidas >= total) {
      // Multijugador: cola completada → cierre natural; dump: sin fichas ahora
      res.status(200).json({ ficha: null, respondidas: respondidas, total: total, sesion_cerrada: true, sin_fichas_ahora: salaDeSesion !== null && salaDeSesion.modo === 'dump' })
      return
    }
    const ficha = await obtenerFichaPorId(db, sesion.fichasIds[respondidas])
    res.status(200).json({ ficha: ficha, respondidas: respondidas, total: total, sesion_cerrada: false })
  })

  // ─── POST /api/practica/:id/responder ───────────────────────────────────
  router.post('/:id/responder', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const sesion = await obtenerSesion(db, req.params.id)
    if (sesion === null || sesion.cuentaId !== cuentaId) {
      res.status(404).json({ error: 'sesión no encontrada' })
      return
    }

    if (sesion.cerradaEn !== null) {
      res.status(409).json({ error: 'la sesión fue cerrada por el host' })
      return
    }
    const respuestas = await listarRespuestasDeSesion(db, sesion.id)
    const total = sesion.fichasIds.length
    if (respuestas.length >= total) {
      res.status(409).json({ error: 'la sesión ya está completa' })
      return
    }

    const cuerpo = req.body ?? {}
    const fichaId = typeof cuerpo.ficha_id === 'string' ? cuerpo.ficha_id : ''
    const respuestaEscrita = typeof cuerpo.respuesta === 'string' ? cuerpo.respuesta : ''
    if (fichaId === '') {
      res.status(400).json({ error: 'ficha_id faltante' })
      return
    }
    // Solo la ficha ACTUAL de la cola puede responderse (evita repetir/saltar)
    if (fichaId !== sesion.fichasIds[respuestas.length]) {
      res.status(409).json({ error: 'esa ficha no es la pregunta actual de la sesión' })
      return
    }

    const ficha = await obtenerFichaPorId(db, fichaId)
    if (ficha === null) {
      res.status(404).json({ error: 'ficha no encontrada' })
      return
    }

    // Calificación IA (prompt C): pregunta + respuesta correcta + escrita
    let calidadIA
    try {
      calidadIA = await calificarPracticaConIA(clienteIA, ficha, respuestaEscrita)
    } catch {
      res.status(502).json({ error: 'la calificación de IA falló; intenta enviar tu respuesta de nuevo' })
      return
    }

    // Cap defensivo: con alucinación la calidad NO pasa de 2 (FR-030)
    const calidad = calidadIA.alucinacion_detectada ? Math.min(calidadIA.puntuacion_calidad, 2) : calidadIA.puntuacion_calidad

    // SM-2 clásico exacto con q = calidad (FR-031)
    const resultado = aplicarSm2(ficha, calidad, new Date())
    await actualizarSm2(db, ficha.id, resultado)

    // Puntos §8.2 con la config de la sala (sin piso: puede ser negativo)
    const sala = await obtenerSala(db, sesion.salaId)
    const valores = valoresDeSala(sala !== null ? sala.configValoresPuntuacion : '{}')
    const puntos = puntosPractica(calidad, calidadIA.alucinacion_detectada, valores)
    await crearRespuestaPractica(db, {
      fichaId: ficha.id,
      cuentaId: cuentaId,
      sesionPracticaId: sesion.id,
      respuestaEscrita: respuestaEscrita,
      puntuacionCalidad: calidad,
      alucinacionDetectada: calidadIA.alucinacion_detectada,
      explicacion: calidadIA.explicacion,
      puntosObtenidos: puntos
    })
    await sumarPuntosSesion(db, sesion.id, puntos)

    // Concepto ya no pendiente si la respuesta fue correcta (q ≥ 3)
    if (ficha.pendiente && calidad >= 3) {
      await marcarPendiente(db, ficha.id, false)
    }

    res.status(200).json({
      puntuacion_calidad: calidad,
      alucinacion_detectada: calidadIA.alucinacion_detectada,
      explicacion: calidadIA.explicacion,
      respuesta_correcta: ficha.respuesta,
      puntos_obtenidos: puntos,
      respondidas: respuestas.length + 1,
      total: total
    })
  })

  // ─── GET /api/practica/:id/resumen ──────────────────────────────────────
  router.get('/:id/resumen', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const sesion = await obtenerSesion(db, req.params.id)
    if (sesion === null || sesion.cuentaId !== cuentaId) {
      res.status(404).json({ error: 'sesión no encontrada' })
      return
    }
    const respuestas = await listarRespuestasDeSesion(db, sesion.id)
    const porPregunta: Array<{ ficha_id: string; calidad: number; alucinacion: boolean; puntos: number }> = []
    for (const respuesta of respuestas) {
      porPregunta.push({
        ficha_id: respuesta.fichaId,
        calidad: respuesta.puntuacionCalidad,
        alucinacion: respuesta.alucinacionDetectada,
        puntos: respuesta.puntosObtenidos
      })
    }

    // Ranking POR SESIÓN si hay otros participantes con sesión activa o
    // reciente (24 h) — FR-034/036
    // Ranking POR SESIÓN (FR-034/036 Modo 1; FR-116/117 Modo 2)
    const { calcularRankingDeSala } = await import('../services/ranking.js')
    const resultado = await calcularRankingDeSala(db, sesion.salaId)
    const ranking = resultado.ranking

    res.status(200).json({
      puntos_obtenidos_total: sesion.puntosObtenidosTotal,
      respondidas: respuestas.length,
      total: sesion.fichasIds.length,
      por_pregunta: porPregunta,
      ranking: ranking,
      cerrada_por_host: sesion.cerradaEn !== null
    })
  })

  return router
}
