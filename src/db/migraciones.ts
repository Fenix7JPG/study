import type { Client } from './client.js'

// Migraciones incrementales idempotentes (research D16): para BDs ya
// existentes, CREATE TABLE IF NOT EXISTS no añade columnas, así que cada
// columna nueva del feature 002 se añade con ALTER TABLE solo si falta.

const MIGRACIONES: Array<{ tabla: string; columna: string; ddl: string }> = [
  { tabla: 'Documento', columna: 'origen', ddl: "ALTER TABLE Documento ADD COLUMN origen TEXT NOT NULL DEFAULT 'ingesta'" },
  { tabla: 'Sala', columna: 'modo', ddl: "ALTER TABLE Sala ADD COLUMN modo TEXT NOT NULL DEFAULT 'dump'" },
  { tabla: 'Sala', columna: 'cerrada_en', ddl: 'ALTER TABLE Sala ADD COLUMN cerrada_en TEXT' },
  { tabla: 'Ficha', columna: 'concepto_tipo', ddl: 'ALTER TABLE Ficha ADD COLUMN concepto_tipo TEXT' },
  { tabla: 'Ficha', columna: 'ficha_externa_id', ddl: 'ALTER TABLE Ficha ADD COLUMN ficha_externa_id TEXT' },
  { tabla: 'SesionPractica', columna: 'cerrada_en', ddl: 'ALTER TABLE SesionPractica ADD COLUMN cerrada_en TEXT' }
]

// SQLite no puede relajar un NOT NULL con ALTER TABLE: si Sala.documento_id
// fue creada NOT NULL (BDs del feature 001), se reconstruye la tabla
// (CREATE nuevo + copia + DROP + RENAME). Las claves foráneas de SQLite están
// desactivadas por conexión por defecto, así que el DROP no cascada.
async function reconstruirSalaSiDocumentoNotNull(db: Client): Promise<void> {
  const info = await db.execute('PRAGMA table_info(Sala)')
  if (info.rows.length === 0) {
    return // la tabla no existe aún: el DDL nuevo ya la crea bien
  }
  const documento = info.rows.find(function (fila: ArrayLike<unknown>) {
    return String(fila[1]) === 'documento_id'
  })
  if (documento === undefined || Number(documento[3]) === 0) {
    return // no existe la columna o ya es nullable
  }

  const ddl = [
    'DROP TABLE IF EXISTS Sala_reconstruida;',
    'CREATE TABLE Sala_reconstruida (',
    '  id TEXT PRIMARY KEY,',
    '  documento_id TEXT REFERENCES Documento(id),',
    '  codigo_invitacion TEXT NOT NULL UNIQUE,',
    '  administrador_cuenta_id TEXT NOT NULL REFERENCES Cuenta(id),',
    '  config_tiempo_lectura INTEGER CHECK (config_tiempo_lectura IS NULL OR config_tiempo_lectura >= 1),',
    '  config_tiempo_escritura INTEGER CHECK (config_tiempo_escritura IS NULL OR config_tiempo_escritura >= 1),',
    '  config_tiempo_resultados INTEGER CHECK (config_tiempo_resultados IS NULL OR config_tiempo_resultados >= 1),',
    '  config_tamano_sesion_practica INTEGER NOT NULL DEFAULT 30 CHECK (config_tamano_sesion_practica >= 1),',
    '  config_valores_puntuacion TEXT NOT NULL,',
    "  modo TEXT NOT NULL DEFAULT 'dump',",
    '  cerrada_en TEXT',
    ');',
    "INSERT INTO Sala_reconstruida (id, documento_id, codigo_invitacion, administrador_cuenta_id, config_tiempo_lectura, config_tiempo_escritura, config_tiempo_resultados, config_tamano_sesion_practica, config_valores_puntuacion, modo, cerrada_en) SELECT id, documento_id, codigo_invitacion, administrador_cuenta_id, config_tiempo_lectura, config_tiempo_escritura, config_tiempo_resultados, config_tamano_sesion_practica, config_valores_puntuacion, 'dump', NULL FROM Sala;",
    'DROP TABLE Sala;',
    'ALTER TABLE Sala_reconstruida RENAME TO Sala;'
  ].join(String.fromCharCode(10))

  await db.executeMultiple(ddl)
}

export async function ejecutarMigraciones(db: Client): Promise<void> {
  await reconstruirSalaSiDocumentoNotNull(db)
  for (const migracion of MIGRACIONES) {
    const info = await db.execute('PRAGMA table_info(' + migracion.tabla + ')')
    const existe = info.rows.some(function (fila: ArrayLike<unknown>) {
      return String(fila[1]) === migracion.columna
    })
    if (!existe) {
      await db.execute(migracion.ddl)
    }
  }
}
