import { crearClienteDb, inicializarSchema } from '../db/client.js'
import { ejecutarMigraciones } from '../db/migraciones.js'
import { cargarEnv } from './config/env.js'
import { crearApp } from './app.js'

// Arranque del servidor (fuente §12):
// 1. Valida TODAS las variables de entorno antes de nada; si falta una,
//    el proceso falla con un mensaje claro (nunca defaults silenciosos).
// 2. Inicializa el esquema de la única base de datos (Turso/libSQL).
// 3. Escucha en process.env.PORT (Render la asigna automáticamente).

function main(): void {
  // Validación de configuración: falla el arranque si falta algo
  let env
  try {
    env = cargarEnv()
  } catch (error) {
    console.error('Error de configuración:', error instanceof Error ? error.message : error)
    process.exit(1)
    return
  }

  const db = crearClienteDb(env.tursoDatabaseUrl, env.tursoAuthToken)

  inicializarSchema(db)
    .then(function () {
      return ejecutarMigraciones(db)
    })
    .then(function () {
      const app = crearApp({ db: db, env: env })
      app.listen(env.port, function () {
        console.log('Servidor escuchando en el puerto ' + String(env.port) + ' (entorno ' + env.nodeEnv + ')')
      })
    })
    .catch(function (error) {
      console.error('Error al inicializar la base de datos:', error)
      process.exit(1)
    })
}

main()
