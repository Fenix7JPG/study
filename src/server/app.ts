import express, { type Express } from 'express'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Client } from '../db/client.js'
import type { Env } from './config/env.js'
import { crearRouterAuth } from './api/auth.js'
import { crearRouterSalas } from './api/salas.js'
import { crearRouterSecciones } from './api/secciones.js'
import { crearRouterPractica } from './api/practica.js'
import { crearRouterExport } from './api/export.js'
import { crearRouterRanking } from './api/ranking.js'
import { crearClienteOpenRouter, type ClienteIA } from './ai/openrouter.js'

// Fábrica de la aplicación Express (inyectable para pruebas).
// La identidad de la cuenta SIEMPRE proviene del token, nunca del nombre.

export interface DependenciasApp {
  db: Client
  env: Env
  // Inyectable para pruebas (stub determinista); por defecto usa OpenRouter
  clienteIA?: ClienteIA
}

export function crearApp(deps: DependenciasApp): Express {
  const app = express()

  // Cuerpos JSON (el JSON de ingesta puede ser grande)
  app.use(express.json({ limit: '2mb' }))

  // Healthcheck para Render: sin auth y sin exponer datos
  app.get('/health', function (_req, res) {
    res.status(200).json({ status: 'ok' })
  })

  // Cliente de IA (fuente §5.1): todas las llamadas pasan por aquí
  const clienteIA = deps.clienteIA ?? crearClienteOpenRouter({
    apiKey: deps.env.openrouterApiKey,
    modelo: deps.env.openrouterModel
  })

  // Autenticación (rutas públicas: registro y login)
  app.use('/api/auth', crearRouterAuth(deps.db, deps.env.jwtSecret))

  // Salas (rutas protegidas con el mismo middleware JWT dentro del router)
  app.use('/api/salas', crearRouterSalas(deps.db, deps.env.jwtSecret))

  // Secciones: ciclo de dump de 2 rondas, contenido y fichas
  app.use('/api/secciones', crearRouterSecciones(deps.db, deps.env.jwtSecret, clienteIA))

  // Práctica con calificación IA + SM-2
  app.use('/api/practica', crearRouterPractica(deps.db, deps.env.jwtSecret, clienteIA))

  // Ranking POR SESIÓN
  app.use('/api/salas', crearRouterRanking(deps.db, deps.env.jwtSecret))

  // Exportación .apkg
  app.use('/api/export', crearRouterExport(deps.db, deps.env.jwtSecret))

  // Interfaz: estáticos compilados por Vite (dist/client en producción,
  // src/client con tsx en desarrollo). El router del cliente usa hashes,
  // así que no se necesita fallback de rutas.
  app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), '../client')))

  return app
}
