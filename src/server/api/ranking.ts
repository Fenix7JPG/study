import { Router } from 'express'
import type { Client } from '../../db/client.js'
import { crearMiddlewareAuth } from './middleware/auth.js'
import { obtenerSala, esMiembro } from '../models/salas.js'
import { calcularRankingDeSala } from '../services/ranking.js'

// Ranking POR SESIÓN de la sala (fuente §6.8/§8.3, FR-034/035/036):
// solo se muestra si hay más de un participante con sesión activa o reciente
// (24 h); el ganador es la primera posición. NO es un ranking histórico.

export function crearRouterRanking(db: Client, jwtSecret: string): Router {
  const router = Router()
  router.use(crearMiddlewareAuth(jwtSecret))

  router.get('/:id/ranking', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const sala = await obtenerSala(db, req.params.id)
    if (sala === null || !(await esMiembro(db, cuentaId, sala.id))) {
      res.status(403).json({ error: 'sala no encontrada o sin acceso' })
      return
    }
    const resultado = await calcularRankingDeSala(db, sala.id)
    res.status(200).json({
      ranking: resultado.ranking,
      salaCerrada: resultado.salaCerrada
    })
  })

  return router
}
