// Validación estricta de variables de entorno (fuente §12, FR-044/045).
// Si falta alguna variable requerida, el proceso DEBE fallar el arranque con
// un mensaje claro; NUNCA se usan valores por defecto silenciosos para las
// variables críticas.

export interface Env {
  openrouterApiKey: string
  openrouterModel: string
  tursoDatabaseUrl: string
  tursoAuthToken: string
  jwtSecret: string
  nodeEnv: string
  port: number
}

// Nombres exactos exigidos por la fuente §12
const VARIABLES_REQUERIDAS = [
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'JWT_SECRET',
  'NODE_ENV',
  'PORT'
]

export class ErrorConfiguracion extends Error {}

export function cargarEnv(fuente: NodeJS.ProcessEnv = process.env): Env {
  // Detectar todas las faltantes de una sola vez para dar un mensaje completo
  const faltantes: string[] = []
  for (const nombre of VARIABLES_REQUERIDAS) {
    const valor = fuente[nombre]
    if (valor === undefined || valor === null || valor === '') {
      faltantes.push(nombre)
    }
  }
  if (faltantes.length > 0) {
    throw new ErrorConfiguracion(
      'Faltan variables de entorno requeridas: ' + faltantes.join(', ') +
      '. Configúralas en .env (local) o en el panel Environment de Render (producción).'
    )
  }

  // PORT debe ser numérico (Render la asigna automáticamente; 0 = puerto efímero en pruebas)
  const port = Number(fuente.PORT)
  if (!Number.isInteger(port) || port < 0) {
    throw new ErrorConfiguracion('La variable PORT debe ser un número entero no negativo, recibido: ' + String(fuente.PORT))
  }

  return {
    openrouterApiKey: fuente.OPENROUTER_API_KEY as string,
    openrouterModel: fuente.OPENROUTER_MODEL as string,
    tursoDatabaseUrl: fuente.TURSO_DATABASE_URL as string,
    tursoAuthToken: fuente.TURSO_AUTH_TOKEN as string,
    jwtSecret: fuente.JWT_SECRET as string,
    nodeEnv: fuente.NODE_ENV as string,
    port: port
  }
}
