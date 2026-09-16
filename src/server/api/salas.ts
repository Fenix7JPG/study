import express, { Router } from 'express'
import multer from 'multer'
import type { Client } from '../../db/client.js'
import { crearMiddlewareAuth } from './middleware/auth.js'
import { validarIngesta, ESQUEMA_BASE_INGESTA } from '../services/ingesta.js'
import { VALORES_DEFECTO } from '../services/puntos.js'
import type { ClienteIA } from '../ai/openrouter.js'
import { PROMPT_MAESTRO_INGESTA } from '../ai/prompts.js'
import { crearDocumento, crearSeccion } from '../models/secciones.js'
import {
  crearSala,
  generarCodigoInvitacion,
  buscarSalaPorCodigo,
  obtenerSala,
  listarSalasDeCuenta,
  crearMembresia,
  esMiembro,
  esAdministrador,
  actualizarConfigSala,
  cerrarSala
} from '../models/salas.js'

// Endpoints de salas (fuente §6.1/§6.2, contracts/api.md):
// - POST /api/salas: valida el JSON de ingesta contra el esquema congelado
//   del prompt maestro; si no cumple NO se persiste nada (FR-007/008).
// - GET /mias, POST /unirse, GET /:id, PATCH /:id/config (solo admin).

export function crearRouterSalas(db: Client, jwtSecret: string, clienteIA: ClienteIA): Router {
  const router = Router()

  // Todas las rutas de salas requieren cuenta autenticada (FR-004)
  router.use(crearMiddlewareAuth(jwtSecret))

  // ─── POST /api/salas ────────────────────────────────────────────────────
  router.post('/', async function (req, res) {
    const cuerpo = req.body ?? {}
    const cuentaId = req.cuentaId as string

    // Modo de la sala (feature 002): 'dump' (default) o 'multijugador'
    const modo = cuerpo.modo === 'multijugador' ? 'multijugador' : 'dump'

    if (modo === 'multijugador') {
      // Sin documento ni ingesta (fuente §7.1)
      if (cuerpo.json_ingesta !== undefined) {
        res.status(400).json({ error: 'una sala multijugador no lleva JSON de ingesta' })
        return
      }
      const tamano = cuerpo.config_tamano_sesion_practica !== undefined
        ? enteroPositivo(cuerpo.config_tamano_sesion_practica)
        : 30
      if (tamano === 'invalido') {
        res.status(400).json({ error: 'config_tamano_sesion_practica debe ser un entero ≥ 1' })
        return
      }
      let salaMJ = null
      for (let intento = 0; intento < 5 && salaMJ === null; intento++) {
        try {
          salaMJ = await crearSala(db, {
            documentoId: null,
            administradorCuentaId: cuentaId,
            modo: 'multijugador',
            codigoInvitacion: generarCodigoInvitacion(),
            configTiempoLectura: null,
            configTiempoEscritura: null,
            configTiempoResultados: null,
            configTamanoSesionPractica: tamano,
            configValoresPuntuacion: JSON.stringify(VALORES_DEFECTO)
          })
        } catch {
          // colisión de código: reintenta
        }
      }
      if (salaMJ === null) {
        res.status(500).json({ error: 'no se pudo generar un código de invitación único' })
        return
      }
      await crearMembresia(db, cuentaId, salaMJ.id)
      res.status(201).json({ sala: salaMJ })
      return
    }

    // Modo dump: exige JSON de ingesta y lo valida estrictamente ANTES de
    // cualquier inserción (nada se persiste si falla)
    const validacion = validarIngesta(cuerpo.json_ingesta)
    if (!validacion.ok) {
      res.status(400).json({ error: validacion.error })
      return
    }


    // Configuración opcional del admin (null = calcular por sección después)
    const lectura = enteroPositivoONull(cuerpo.config_tiempo_lectura)
    const escritura = enteroPositivoONull(cuerpo.config_tiempo_escritura)
    const resultados = enteroPositivoONull(cuerpo.config_tiempo_resultados)
    const tamano = cuerpo.config_tamano_sesion_practica !== undefined
      ? enteroPositivo(cuerpo.config_tamano_sesion_practica)
      : 30
    if (lectura === 'invalido' || escritura === 'invalido' || resultados === 'invalido' || tamano === 'invalido') {
      res.status(400).json({ error: 'la configuración debe ser números enteros ≥ 1' })
      return
    }

    // Documento con el JSON tal cual (nunca se regenera, fuente §5.2)
    const documento = await crearDocumento(db, {
      titulo: validacion.datos.documento.titulo,
      jsonIngesta: JSON.stringify(cuerpo.json_ingesta),
      cuentaCreadoraId: cuentaId
    })

    // Un registro Seccion por sección, ordenadas por su campo orden
    const seccionesOrdenadas = validacion.datos.documento.secciones.slice().sort(function (a, b) {
      return a.orden - b.orden
    })
    const seccionesCreadas: Array<{ id: string; titulo: string; orden: number; num_palabras: number }> = []
    for (const seccion of seccionesOrdenadas) {
      const creada = await crearSeccion(db, {
        documentoId: documento.id,
        titulo: seccion.titulo,
        orden: seccion.orden,
        numPalabras: seccion.num_palabras,
        contenido: JSON.stringify(seccion.contenido),
        mapaConceptos: JSON.stringify(seccion.mapa_conceptos)
      })
      seccionesCreadas.push({
        id: creada.id,
        titulo: creada.titulo,
        orden: creada.orden,
        num_palabras: creada.numPalabras
      })
    }

    // Sala con código de invitación único (reintenta ante colisión improbable)
    let sala = null
    for (let intento = 0; intento < 5 && sala === null; intento++) {
      try {
        sala = await crearSala(db, {
          documentoId: documento.id,
          administradorCuentaId: cuentaId,
          modo: 'dump',
          codigoInvitacion: generarCodigoInvitacion(),
          configTiempoLectura: lectura,
          configTiempoEscritura: escritura,
          configTiempoResultados: resultados,
          configTamanoSesionPractica: tamano,
          configValoresPuntuacion: JSON.stringify(VALORES_DEFECTO)
        })
      } catch {
        // Colisión de código UNIQUE: reintenta con otro código
      }
    }
    if (sala === null) {
      res.status(500).json({ error: 'no se pudo generar un código de invitación único' })
      return
    }

    // El creador queda como administrador Y miembro de la sala
    await crearMembresia(db, cuentaId, sala.id)

    res.status(201).json({
      sala: sala,
      documento: { id: documento.id, titulo: documento.titulo },
      secciones: seccionesCreadas
    })
  })

  // ─── GET /api/salas/mias ────────────────────────────────────────────────
  router.get('/mias', async function (req, res) {
    const salas = await listarSalasDeCuenta(db, req.cuentaId as string)
    res.status(200).json({
      salas: salas.map(function (entrada) {
        return {
          sala: entrada.sala,
          documentoTitulo: entrada.documentoTitulo,
          rol: entrada.rol
        }
      })
    })
  })

  // ─── POST /api/salas/unirse ─────────────────────────────────────────────
  router.post('/unirse', async function (req, res) {
    const cuerpo = req.body ?? {}
    const codigo = typeof cuerpo.codigo_invitacion === 'string' ? cuerpo.codigo_invitacion.trim().toUpperCase() : ''
    if (codigo === '') {
      res.status(400).json({ error: 'codigo_invitacion faltante' })
      return
    }
    const sala = await buscarSalaPorCodigo(db, codigo)
    if (sala === null) {
      res.status(404).json({ error: 'código de invitación inválido' })
      return
    }
    const cuentaId = req.cuentaId as string
    const yaMiembro = await esMiembro(db, cuentaId, sala.id)
    if (!yaMiembro) {
      await crearMembresia(db, cuentaId, sala.id)
    }
    res.status(200).json({ sala: sala, yaMiembro: yaMiembro })
  })

  // ─── GET /api/salas/:id ─────────────────────────────────────────────────
  router.get('/:id', async function (req, res) {
    const sala = await obtenerSala(db, req.params.id)
    if (sala === null) {
      res.status(404).json({ error: 'sala no encontrada' })
      return
    }
    const cuentaId = req.cuentaId as string
    // Solo miembros de la sala ven su información (aislamiento FR-005)
    if (!(await esMiembro(db, cuentaId, sala.id))) {
      res.status(403).json({ error: 'no eres miembro de esta sala' })
      return
    }
    if (sala.modo === 'multijugador') {
      // Sin documento ni secciones: cada quien importa su banco (fuente §7.2)
      res.status(200).json({
        sala: sala,
        documentoTitulo: null,
        secciones: [],
        rol: (await esAdministrador(db, cuentaId, sala.id)) ? 'administrador' : 'participante'
      })
      return
    }
    const secciones = await db.execute({
      sql: 'SELECT s.id, s.titulo, s.orden, s.num_palabras, d.titulo FROM Seccion s JOIN Documento d ON d.id = s.documento_id WHERE s.documento_id = ? ORDER BY s.orden ASC',
      args: [sala.documentoId]
    })
    let documentoTitulo = ''
    const listado: Array<{ id: string; titulo: string; orden: number; num_palabras: number }> = []
    for (const fila of secciones.rows) {
      const valores = Array.from(fila)
      documentoTitulo = valores[4] as string
      listado.push({
        id: valores[0] as string,
        titulo: valores[1] as string,
        orden: valores[2] as number,
        num_palabras: valores[3] as number
      })
    }
    res.status(200).json({
      sala: sala,
      documentoTitulo: documentoTitulo,
      secciones: listado,
      rol: (await esAdministrador(db, cuentaId, sala.id)) ? 'administrador' : 'participante'
    })
  })

  // ─── PATCH /api/salas/:id/config (solo administrador) ───────────────────
  router.patch('/:id/config', async function (req, res) {
    const sala = await obtenerSala(db, req.params.id)
    if (sala === null) {
      res.status(404).json({ error: 'sala no encontrada' })
      return
    }
    const cuentaId = req.cuentaId as string
    if (!(await esAdministrador(db, cuentaId, sala.id))) {
      res.status(403).json({ error: 'solo el administrador de la sala puede cambiar la configuración' })
      return
    }
    const cuerpo = req.body ?? {}
    const lectura = enteroPositivoOUndefined(cuerpo.config_tiempo_lectura)
    const escritura = enteroPositivoOUndefined(cuerpo.config_tiempo_escritura)
    const resultados = enteroPositivoOUndefined(cuerpo.config_tiempo_resultados)
    const tamano = cuerpo.config_tamano_sesion_practica !== undefined
      ? enteroPositivo(cuerpo.config_tamano_sesion_practica)
      : undefined
    if (lectura === 'invalido' || escritura === 'invalido' || resultados === 'invalido' || tamano === 'invalido') {
      res.status(400).json({ error: 'la configuración debe ser números enteros ≥ 1' })
      return
    }
    // Solo se actualizan los campos enviados (undefined = sin cambio)
    await actualizarConfigSala(db, sala.id, {
      configTiempoLectura: lectura,
      configTiempoEscritura: escritura,
      configTiempoResultados: resultados,
      configTamanoSesionPractica: tamano
    })
    res.status(200).json({ sala: await obtenerSala(db, sala.id) })
  })

  // ─── POST /api/salas/dump-desde-word (feature 003, FR-201..204) ─────────
  // Crea una sala dump a partir de un documento Word: extrae el texto con
  // mammoth, genera la ingesta con la IA (prompt maestro congelado) y la
  // valida contra el esquema congelado ANTES de crear nada.
  const subidaWord = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
  })

  router.post('/dump-desde-word', subidaWord.single('archivo'), async function (req, res) {
    const cuentaId = req.cuentaId as string
    const archivo = req.file
    if (archivo === undefined) {
      res.status(400).json({ error: 'falta el archivo del documento (campo `archivo`)' })
      return
    }
    const nombre = archivo.originalname.toLowerCase()
    if (!nombre.endsWith('.docx') && !nombre.endsWith('.txt')) {
      res.status(400).json({ error: 'el archivo debe ser .docx o .txt' })
      return
    }

    // Extraer texto del documento
    let textoDocumento = ''
    try {
      if (nombre.endsWith('.txt')) {
        textoDocumento = archivo.buffer.toString('utf8')
      } else {
        const mammoth = await import('mammoth')
        const extraido = await mammoth.extractRawText({ buffer: archivo.buffer })
        textoDocumento = extraido.value
      }
    } catch {
      res.status(400).json({ error: 'el documento no se pudo leer (¿es un .docx válido?)' })
      return
    }
    if (textoDocumento.trim().length < 50) {
      res.status(400).json({ error: 'el documento está vacío o es demasiado corto para generar una ingesta' })
      return
    }

    // Generar la ingesta con la IA y validar el esquema congelado
    let calificacionIA
    try {
      calificacionIA = await clienteIA.llamar(
        ESQUEMA_BASE_INGESTA,
        PROMPT_MAESTRO_INGESTA,
        textoDocumento
      )
    } catch {
      res.status(502).json({ error: 'la generación de la ingesta falló tras reintentos; verifica tu OPENROUTER_MODEL o usa la vía manual (pegar el JSON)' })
      return
    }

    const validacion = validarIngesta(calificacionIA)
    if (!validacion.ok) {
      res.status(400).json({ error: 'la ingesta generada por la IA no cumple el esquema: ' + validacion.error })
      return
    }

    // Configuración opcional (igual que la vía JSON)
    const cuerpo = req.body ?? {}
    const tamano = cuerpo.config_tamano_sesion_practica !== undefined
      ? enteroPositivo(cuerpo.config_tamano_sesion_practica)
      : 30
    if (tamano === 'invalido') {
      res.status(400).json({ error: 'config_tamano_sesion_practica debe ser un entero ≥ 1' })
      return
    }

    // Creación idéntica a la vía JSON (documento + secciones + sala + membresía)
    const documento = await crearDocumento(db, {
      titulo: validacion.datos.documento.titulo,
      jsonIngesta: JSON.stringify(calificacionIA),
      cuentaCreadoraId: cuentaId
    })
    const seccionesOrdenadas = validacion.datos.documento.secciones.slice().sort(function (a, b) {
      return a.orden - b.orden
    })
    const seccionesCreadas: Array<{ id: string; titulo: string; orden: number; num_palabras: number }> = []
    for (const seccion of seccionesOrdenadas) {
      const creada = await crearSeccion(db, {
        documentoId: documento.id,
        titulo: seccion.titulo,
        orden: seccion.orden,
        numPalabras: seccion.num_palabras,
        contenido: JSON.stringify(seccion.contenido),
        mapaConceptos: JSON.stringify(seccion.mapa_conceptos)
      })
      seccionesCreadas.push({ id: creada.id, titulo: creada.titulo, orden: creada.orden, num_palabras: creada.numPalabras })
    }

    let sala = null
    for (let intento = 0; intento < 5 && sala === null; intento++) {
      try {
        sala = await crearSala(db, {
          documentoId: documento.id,
          administradorCuentaId: cuentaId,
          modo: 'dump',
          codigoInvitacion: generarCodigoInvitacion(),
          configTiempoLectura: null,
          configTiempoEscritura: null,
          configTiempoResultados: null,
          configTamanoSesionPractica: tamano,
          configValoresPuntuacion: JSON.stringify(VALORES_DEFECTO)
        })
      } catch {
        // colisión de código: reintenta
      }
    }
    if (sala === null) {
      res.status(500).json({ error: 'no se pudo generar un código de invitación único' })
      return
    }
    await crearMembresia(db, cuentaId, sala.id)

    res.status(201).json({
      sala: sala,
      documento: { id: documento.id, titulo: documento.titulo },
      secciones: seccionesCreadas
    })
  })

  // ─── PATCH /api/salas/:id/cerrar (solo host, FR-117) ────────────────────
  router.patch('/:id/cerrar', async function (req, res) {
    const sala = await obtenerSala(db, req.params.id)
    if (sala === null) {
      res.status(404).json({ error: 'sala no encontrada' })
      return
    }
    const cuentaId = req.cuentaId as string
    if (!(await esAdministrador(db, cuentaId, sala.id))) {
      res.status(403).json({ error: 'solo el administrador de la sala puede cerrarla' })
      return
    }
    if (sala.cerradaEn !== null) {
      res.status(409).json({ error: 'la sala ya está cerrada' })
      return
    }
    await cerrarSala(db, sala.id)
    res.status(200).json({ sala: await obtenerSala(db, sala.id) })
  })

  // Middleware de error: cualquier excepción no capturada en los handlers
  // (Express 5 propaga los rechazos async aquí) responde SIEMPRE JSON
  router.use(function (error: unknown, _req: unknown, res: express.Response, _next: unknown): void {
    res.status(500).json({ error: 'error interno: ' + (error instanceof Error ? error.message : String(error)) })
  })

  return router
}

// Valida entero ≥ 1; devuelve el número, null si no vino, o 'invalido'
function enteroPositivoONull(valor: unknown): number | null | 'invalido' {
  if (valor === undefined || valor === null) {
    return null
  }
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1) {
    return 'invalido'
  }
  return valor
}

// Igual que arriba pero con undefined para PATCH (sin cambio de campo)
function enteroPositivoOUndefined(valor: unknown): number | undefined | 'invalido' {
  if (valor === undefined || valor === null) {
    return undefined
  }
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1) {
    return 'invalido'
  }
  return valor
}

function enteroPositivo(valor: unknown): number | 'invalido' {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1) {
    return 'invalido'
  }
  return valor
}
