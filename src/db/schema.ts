// Esquema de la base de datos (data-model.md, fuente §10 + entidad auxiliar
// ProgresoSeccion justificada en plan.md). SQLite/libSQL.
// Incrustado como constante para funcionar igual en desarrollo, pruebas y
// build compilado. Los timestamps van en UTC ISO 8601 (research D11).

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS Cuenta (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nombre TEXT NOT NULL,
  fecha_registro TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Documento (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  json_ingesta TEXT NOT NULL,
  fecha_carga TEXT NOT NULL,
  cuenta_creadora_id TEXT NOT NULL REFERENCES Cuenta(id)
);

CREATE TABLE IF NOT EXISTS Seccion (
  id TEXT PRIMARY KEY,
  documento_id TEXT NOT NULL REFERENCES Documento(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  orden INTEGER NOT NULL,
  num_palabras INTEGER NOT NULL CHECK (num_palabras >= 1),
  contenido TEXT NOT NULL,
  mapa_conceptos TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Sala (
  id TEXT PRIMARY KEY,
  documento_id TEXT NOT NULL REFERENCES Documento(id),
  codigo_invitacion TEXT NOT NULL UNIQUE,
  administrador_cuenta_id TEXT NOT NULL REFERENCES Cuenta(id),
  -- Tiempos: NULL = el admin no fijó valor → se calcula por num_palabras (FR-010)
  config_tiempo_lectura INTEGER CHECK (config_tiempo_lectura IS NULL OR config_tiempo_lectura >= 1),
  config_tiempo_escritura INTEGER CHECK (config_tiempo_escritura IS NULL OR config_tiempo_escritura >= 1),
  config_tiempo_resultados INTEGER CHECK (config_tiempo_resultados IS NULL OR config_tiempo_resultados >= 1),
  config_tamano_sesion_practica INTEGER NOT NULL DEFAULT 30 CHECK (config_tamano_sesion_practica >= 1),
  config_valores_puntuacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Membresia (
  id TEXT PRIMARY KEY,
  cuenta_id TEXT NOT NULL REFERENCES Cuenta(id),
  sala_id TEXT NOT NULL REFERENCES Sala(id),
  fecha_union TEXT NOT NULL,
  UNIQUE (cuenta_id, sala_id)
);

CREATE TABLE IF NOT EXISTS DumpIntento (
  id TEXT PRIMARY KEY,
  cuenta_id TEXT NOT NULL REFERENCES Cuenta(id),
  seccion_id TEXT NOT NULL REFERENCES Seccion(id),
  ronda INTEGER NOT NULL CHECK (ronda IN (1, 2)),
  texto_enviado TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  -- Campos de calificación NULL mientras la calificación está pendiente o
  -- falló definitivamente (FR-047 permite recalificar reutilizando el texto).
  cobertura_porcentaje REAL,
  conceptos_cubiertos TEXT,
  conceptos_faltantes TEXT,
  errores TEXT,
  puntos_obtenidos INTEGER
);

CREATE INDEX IF NOT EXISTS idx_dump_cuenta_seccion
  ON DumpIntento (cuenta_id, seccion_id, ronda);

CREATE TABLE IF NOT EXISTS Ficha (
  id TEXT PRIMARY KEY,
  cuenta_id TEXT NOT NULL REFERENCES Cuenta(id),
  seccion_id TEXT NOT NULL REFERENCES Seccion(id),
  pregunta TEXT NOT NULL,
  respuesta TEXT NOT NULL,
  concepto_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('estandar', 'discriminacion')),
  prioridad_inicial TEXT NOT NULL CHECK (prioridad_inicial IN ('alta', 'baja')),
  pendiente INTEGER NOT NULL DEFAULT 0,
  repeticiones INTEGER NOT NULL DEFAULT 0,
  intervalo_dias INTEGER NOT NULL DEFAULT 0,
  factor_facilidad REAL NOT NULL DEFAULT 2.5,
  fecha_proximo_repaso TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ficha_cuenta_seccion ON Ficha (cuenta_id, seccion_id);
CREATE INDEX IF NOT EXISTS idx_ficha_repaso ON Ficha (cuenta_id, fecha_proximo_repaso);

CREATE TABLE IF NOT EXISTS RespuestaPractica (
  id TEXT PRIMARY KEY,
  ficha_id TEXT NOT NULL REFERENCES Ficha(id),
  cuenta_id TEXT NOT NULL REFERENCES Cuenta(id),
  sesion_practica_id TEXT NOT NULL REFERENCES SesionPractica(id),
  respuesta_escrita TEXT NOT NULL,
  puntuacion_calidad INTEGER NOT NULL CHECK (puntuacion_calidad BETWEEN 0 AND 5),
  alucinacion_detectada INTEGER NOT NULL DEFAULT 0,
  explicacion TEXT NOT NULL,
  puntos_obtenidos INTEGER NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_respuesta_sesion ON RespuestaPractica (sesion_practica_id);

CREATE TABLE IF NOT EXISTS SesionPractica (
  id TEXT PRIMARY KEY,
  cuenta_id TEXT NOT NULL REFERENCES Cuenta(id),
  sala_id TEXT NOT NULL REFERENCES Sala(id),
  fecha TEXT NOT NULL,
  numero_de_preguntas INTEGER NOT NULL CHECK (numero_de_preguntas >= 1),
  puntos_obtenidos_total INTEGER NOT NULL DEFAULT 0,
  -- Cola de fichas de la sesión (ids en orden): campo auxiliar para servir
  -- la sesión de práctica de forma determinista (ver plan.md Complexity)
  fichas_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_sesion_cuenta ON SesionPractica (cuenta_id, fecha);

-- Entidad auxiliar (fuera de la fuente §10): estado de fase del ciclo de dump
-- por cuenta y sección; permite validar ventanas y bloqueos en el servidor.
CREATE TABLE IF NOT EXISTS ProgresoSeccion (
  id TEXT PRIMARY KEY,
  cuenta_id TEXT NOT NULL REFERENCES Cuenta(id),
  seccion_id TEXT NOT NULL REFERENCES Seccion(id),
  ronda_actual INTEGER NOT NULL CHECK (ronda_actual IN (1, 2)),
  fase TEXT NOT NULL CHECK (fase IN ('lectura', 'escritura', 'calificacion', 'resultados', 'completada')),
  fase_inicia_en TEXT NOT NULL,
  fase_termina_en TEXT NOT NULL,
  UNIQUE (cuenta_id, seccion_id)
);
`
