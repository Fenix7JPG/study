import { createClient, type Client } from '@libsql/client'

// Capa de acceso a la única base de datos del sistema: Turso (libSQL),
// configurada con las variables de entorno (fuente §5.2).

export type { Client }

export function crearClienteDb(url: string, authToken: string): Client {
  return createClient({ url, authToken })
}

// Aplica el esquema (CREATE TABLE IF NOT EXISTS ...) a la base de datos.
export async function inicializarSchema(db: Client): Promise<void> {
  const { SCHEMA_SQL } = await import('./schema.js')
  await db.executeMultiple(SCHEMA_SQL)
}
