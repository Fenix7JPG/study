import { Router } from 'express'
import type { Client } from '../../db/client.js'
import { crearMiddlewareAuth } from './middleware/auth.js'
import { validarIngesta } from '../services/ingesta.js'
import { VALORES_DEFECTO } from '../services/puntos.js'
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
  actualizarConfigSala
} from '../models/salas.js'

// Endpoints de salas (fuente §6.1/§6.2, contracts/api.md):
// - POST /api/salas: valida el JSON de ingesta contra el esquema congelado
//   del prompt maestro; si no cumple NO se persiste nada (FR-007/008).
// - GET /mias, POST /unirse, GET /:id, PATCH /:id/config (solo admin).

export function crearRouterSalas(db: Client, jwtSecret: string): Router {
  const router = Router()

  // Todas las rutas de salas requieren cuenta autenticada (FR-004)
  router.use(crearMiddlewareAuth(jwtSecret))

  // ─── POST /api/salas ────────────────────────────────────────────────────
  router.post('/', async function (req, res) {
    const cuerpo = req.body ?? {}
    const cuentaId = req.cuentaId as string

    // Validación estricta ANTES de cualquier inserción (nada se persiste si falla)
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
