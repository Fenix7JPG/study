import { Router, type Response } from 'express'
import type { Client } from '../../db/client.js'
import { crearMiddlewareAuth } from './middleware/auth.js'
import type { ClienteIA } from '../ai/openrouter.js'
import { ESQUEMA_CALIFICACION_DUMP, type CalificacionIADump } from '../ai/esquemas.js'
import { PROMPT_CALIFICACION_DUMP } from '../ai/prompts.js'
import { tiempoFaseSeccion, tiempoResultados } from '../services/tiempos.js'
import { puntosPorRonda, bonusPorMejora, valoresDeSala } from '../services/puntos.js'
import { generarBancoFichas } from '../services/fichas.js'
import { listarFichasDeSeccion, hayFichasDeSeccion } from '../models/fichas.js'
import { obtenerSeccion, type Seccion } from '../models/secciones.js'
import { buscarSalaPorDocumento, esMiembro, type Sala } from '../models/salas.js'
import { obtenerProgreso, crearProgreso, actualizarFase, type ProgresoSeccion, type FaseDump } from '../models/progreso.js'
import { crearDumpIntento, obtenerDumpDeRonda, guardarCalificacionDump, type DumpIntento, type CalificacionDump } from '../models/dumps.js'

// Ciclo de dump de 2 rondas + fichas (fuente §6.3–§6.5, US3/US4/US5).
// Las ventanas de fase se validan SIEMPRE en el servidor (research D10);
// el temporizador del cliente es solo visual.

export function crearRouterSecciones(db: Client, jwtSecret: string, clienteIA: ClienteIA): Router {
  const router = Router()
  router.use(crearMiddlewareAuth(jwtSecret))

  // ─── Helpers internos ───────────────────────────────────────────────────

  // Carga sección + sala y verifica membresía; null = respondido ya
  async function cargarContexto(seccionId: string, cuentaId: string): Promise<{ seccion: Seccion; sala: Sala } | null> {
    const seccion = await obtenerSeccion(db, seccionId)
    if (seccion === null) {
      return null
    }
    const sala = await buscarSalaPorDocumento(db, seccion.documentoId)
    if (sala === null) {
      return null
    }
    if (!(await esMiembro(db, cuentaId, sala.id))) {
      return null
    }
    return { seccion: seccion, sala: sala }
  }

  function responderSinContexto(res: Response): void {
    res.status(404).json({ error: 'sección no encontrada o sin acceso' })
  }

  // Ventana temporal de cada fase según la config de la sala (FR-010)
  function ventanaDeFase(fase: FaseDump, sala: Sala, seccion: Seccion, ahora: Date): { inicia: string; termina: string } {
    let minutos: number
    if (fase === 'lectura') {
      minutos = tiempoFaseSeccion(seccion.numPalabras, sala.configTiempoLectura)
    } else if (fase === 'escritura') {
      minutos = tiempoFaseSeccion(seccion.numPalabras, sala.configTiempoEscritura)
    } else if (fase === 'resultados') {
      minutos = tiempoResultados(sala.configTiempoResultados)
    } else {
      minutos = 1 // calificación/completada: no gatean acciones
    }
    return { inicia: ahora.toISOString(), termina: new Date(ahora.getTime() + minutos * 60000).toISOString() }
  }

  // Califica un intento con la IA (prompt A) y aplica los puntos §8.1
  async function calificarConIA(sala: Sala, seccion: Seccion, intento: DumpIntento): Promise<CalificacionDump> {
    // El MISMO mapa de conceptos para todas las cuentas de la sección (FR-022)
    const entrada = JSON.stringify({
      texto_del_dump: intento.textoEnviado,
      mapa_conceptos: JSON.parse(seccion.mapaConceptos)
    })
    const respuesta: CalificacionIADump = await clienteIA.llamar(ESQUEMA_CALIFICACION_DUMP, PROMPT_CALIFICACION_DUMP, entrada)

    const valores = valoresDeSala(sala.configValoresPuntuacion)
    let total = puntosPorRonda(
      respuesta.conceptos_cubiertos.length,
      respuesta.conceptos_faltantes.length,
      respuesta.errores.length,
      valores
    )

    // Bonus de mejora: solo en la ronda 2, si cobertura > ronda 1 (una vez)
    if (intento.ronda === 2) {
      const ronda1 = await obtenerDumpDeRonda(db, intento.cuentaId, intento.seccionId, 1)
      const coberturaR1 = ronda1 !== null && ronda1.coberturaPorcentaje !== null ? ronda1.coberturaPorcentaje : null
      total = total + bonusPorMejora(coberturaR1, respuesta.cobertura_porcentaje, valores)
    }

    return {
      coberturaPorcentaje: respuesta.cobertura_porcentaje,
      conceptosCubiertos: respuesta.conceptos_cubiertos,
      conceptosFaltantes: respuesta.conceptos_faltantes,
      errores: respuesta.errores,
      puntosObtenidos: total
    }
  }

  // Crea el intento (texto inmutable) y califica; no modifica el progreso
  async function crearYCalificar(sala: Sala, seccion: Seccion, cuentaId: string, ronda: number, texto: string): Promise<{ intento: DumpIntento; calificacion: CalificacionDump | null; error?: Error }> {
    const intento = await crearDumpIntento(db, { cuentaId: cuentaId, seccionId: seccion.id, ronda: ronda, texto: texto })
    try {
      const calificacion = await calificarConIA(sala, seccion, intento)
      await guardarCalificacionDump(db, intento.id, calificacion)
      return { intento: intento, calificacion: calificacion }
    } catch (error) {
      return { intento: intento, calificacion: null, error: error as Error }
    }
  }

  // Avanza las fases expiradas (research D10). avanzarResultados=true permite
  // pasar de resultados a la siguiente ronda antes de que expire (el dump ya
  // está mostrado y bloqueado; la lectura NUNCA se salta).
  async function avanzarFases(sala: Sala, seccion: Seccion, cuentaId: string, avanzarResultados: boolean): Promise<ProgresoSeccion> {
    let progreso = await obtenerProgreso(db, cuentaId, seccion.id)
    if (progreso === null) {
      return progreso as unknown as ProgresoSeccion
    }
    const ahora = new Date()
    let cambio = true
    while (cambio) {
      cambio = false

      if (progreso.fase === 'lectura' && ahora > new Date(progreso.faseTerminaEn)) {
        // La lectura expiró: el contenido se oculta y no vuelve (FR-012/013)
        const ventana = ventanaDeFase('escritura', sala, seccion, ahora)
        await actualizarFase(db, progreso.id, { rondaActual: progreso.rondaActual, fase: 'escritura', faseIniciaEn: ventana.inicia, faseTerminaEn: ventana.termina })
        progreso = { ...progreso, fase: 'escritura', faseIniciaEn: ventana.inicia, faseTerminaEn: ventana.termina }
        cambio = true
      } else if (progreso.fase === 'escritura' && ahora > new Date(progreso.faseTerminaEn)) {
        // Expiró sin envío manual: se califica lo escrito (vacío) — supuesto B3
        const resultado = await crearYCalificar(sala, seccion, cuentaId, progreso.rondaActual, '')
        const fase: FaseDump = resultado.calificacion !== null ? 'resultados' : 'calificacion'
        const ventana = ventanaDeFase(resultado.calificacion !== null ? 'resultados' : 'calificacion', sala, seccion, ahora)
        await actualizarFase(db, progreso.id, { rondaActual: progreso.rondaActual, fase: fase, faseIniciaEn: ventana.inicia, faseTerminaEn: ventana.termina })
        progreso = { ...progreso, fase: fase, faseIniciaEn: ventana.inicia, faseTerminaEn: ventana.termina }
        cambio = true
      } else if (progreso.fase === 'resultados' && (avanzarResultados || ahora > new Date(progreso.faseTerminaEn))) {
        if (progreso.rondaActual === 1) {
          // Ronda 2 inmediatamente después de la ronda 1 (FR-016)
          const ventana = ventanaDeFase('lectura', sala, seccion, ahora)
          await actualizarFase(db, progreso.id, { rondaActual: 2, fase: 'lectura', faseIniciaEn: ventana.inicia, faseTerminaEn: ventana.termina })
          progreso = { ...progreso, rondaActual: 2, fase: 'lectura', faseIniciaEn: ventana.inicia, faseTerminaEn: ventana.termina }
        } else {
          // Fin de la ronda 2: sección completada; no hay rondas 3+ (FR-011)
          const ventana = ventanaDeFase('completada', sala, seccion, ahora)
          await actualizarFase(db, progreso.id, { rondaActual: 2, fase: 'completada', faseIniciaEn: ventana.inicia, faseTerminaEn: ventana.termina })
          progreso = { ...progreso, fase: 'completada', faseIniciaEn: ventana.inicia, faseTerminaEn: ventana.termina }
        }
        cambio = true
      }
    }
    return progreso
  }

  // ─── POST /api/secciones/:id/dump/iniciar ───────────────────────────────
  router.post('/:id/dump/iniciar', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const contexto = await cargarContexto(req.params.id, cuentaId)
    if (contexto === null) {
      responderSinContexto(res)
      return
    }
    const { seccion, sala } = contexto

    let progreso = await obtenerProgreso(db, cuentaId, seccion.id)
    if (progreso === null) {
      // Primera vez: ronda 1, fase de lectura (FR-011/012)
      const ventana = ventanaDeFase('lectura', sala, seccion, new Date())
      progreso = await crearProgreso(db, { cuentaId: cuentaId, seccionId: seccion.id, rondaActual: 1, fase: 'lectura', faseIniciaEn: ventana.inicia, faseTerminaEn: ventana.termina })
    } else {
      progreso = await avanzarFases(sala, seccion, cuentaId, true)
    }

    if (progreso.fase === 'completada') {
      res.status(409).json({ error: 'sección completada', fase: 'completada', ronda: 2 })
      return
    }

    res.status(200).json({
      ronda: progreso.rondaActual,
      fase: progreso.fase,
      faseIniciaEn: progreso.faseIniciaEn,
      faseTerminaEn: progreso.faseTerminaEn,
      // Generación de fichas fallida pendiente (FR-026) → botón de reintento
      recalificarDisponible: progreso.fase === 'calificacion'
    })
  })

  // ─── GET /api/secciones/:id/contenido (solo fase de lectura) ────────────
  router.get('/:id/contenido', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const contexto = await cargarContexto(req.params.id, cuentaId)
    if (contexto === null) {
      responderSinContexto(res)
      return
    }
    const { seccion, sala } = contexto

    const progreso = await avanzarFases(sala, seccion, cuentaId, false)
    if (progreso === null || progreso.fase !== 'lectura' || new Date() > new Date(progreso.faseTerminaEn)) {
      // Fuera de la ventana de lectura el contenido NO está disponible (FR-013)
      res.status(403).json({ error: 'el contenido solo está disponible durante la fase de lectura' })
      return
    }

    // NUNCA se incluye el mapa de conceptos aquí (regla §7.1)
    res.status(200).json({
      ronda: progreso.rondaActual,
      bloques: JSON.parse(seccion.contenido),
      faseTerminaEn: progreso.faseTerminaEn
    })
  })

  // ─── POST /api/secciones/:id/dump/enviar (solo fase de escritura) ───────
  router.post('/:id/dump/enviar', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const contexto = await cargarContexto(req.params.id, cuentaId)
    if (contexto === null) {
      responderSinContexto(res)
      return
    }
    const { seccion, sala } = contexto

    const progreso = await avanzarFases(sala, seccion, cuentaId, false)
    if (progreso === null || progreso.fase !== 'escritura') {
      res.status(409).json({ error: 'la fase de escritura no está activa (fase actual: ' + (progreso?.fase ?? 'sin iniciar') + ')' })
      return
    }
    if (new Date() > new Date(progreso.faseTerminaEn)) {
      res.status(403).json({ error: 'el tiempo de escritura expiró' })
      return
    }

    const cuerpo = req.body ?? {}
    if (typeof cuerpo.texto !== 'string' || (cuerpo.ronda !== undefined && cuerpo.ronda !== progreso.rondaActual)) {
      res.status(400).json({ error: 'texto faltante o ronda incorrecta' })
      return
    }

    // El texto queda bloqueado e inmutable al enviar (FR-014)
    const resultado = await crearYCalificar(sala, seccion, cuentaId, progreso.rondaActual, cuerpo.texto)

    if (resultado.calificacion === null) {
      // La IA falló tras reintentos: el texto queda guardado; se puede
      // recalificar sin reescribir (FR-047). La fase queda en calificación.
      const ventana = ventanaDeFase('calificacion', sala, seccion, new Date())
      await actualizarFase(db, progreso.id, { rondaActual: progreso.rondaActual, fase: 'calificacion', faseIniciaEn: ventana.inicia, faseTerminaEn: ventana.termina })
      res.status(502).json({ error: 'la calificación de IA falló; puedes reintentarla sin reescribir el texto', intento_id: resultado.intento.id })
      return
    }

    // Éxito: fase de visualización de resultados (FR-015)
    const ventana = ventanaDeFase('resultados', sala, seccion, new Date())
    await actualizarFase(db, progreso.id, { rondaActual: progreso.rondaActual, fase: 'resultados', faseIniciaEn: ventana.inicia, faseTerminaEn: ventana.termina })

    // Tras la ronda 2: generación automática del banco de fichas (§6.5)
    let avisoFichas: string | undefined
    if (progreso.rondaActual === 2) {
      try {
        await generarBancoFichas(db, clienteIA, cuentaId, seccion.id)
      } catch {
        avisoFichas = 'la generación de fichas falló; usa el botón de reintento en la sección'
      }
    }

    res.status(200).json({
      cobertura_porcentaje: resultado.calificacion.coberturaPorcentaje,
      conceptos_cubiertos: resultado.calificacion.conceptosCubiertos,
      conceptos_faltantes: resultado.calificacion.conceptosFaltantes,
      errores: resultado.calificacion.errores,
      puntos_obtenidos: resultado.calificacion.puntosObtenidos,
      fase: 'resultados',
      faseTerminaEn: ventana.termina,
      aviso_fichas: avisoFichas
    })
  })

  // ─── POST /api/secciones/:id/dump/recalificar (FR-047) ──────────────────
  router.post('/:id/dump/recalificar', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const contexto = await cargarContexto(req.params.id, cuentaId)
    if (contexto === null) {
      responderSinContexto(res)
      return
    }
    const { seccion, sala } = contexto

    const progreso = await obtenerProgreso(db, cuentaId, seccion.id)
    if (progreso === null || progreso.fase !== 'calificacion') {
      res.status(409).json({ error: 'no hay calificación pendiente para esta sección' })
      return
    }

    // Último intento de la ronda actual SIN calificar (texto inmutable)
    const intento = await obtenerDumpDeRonda(db, cuentaId, seccion.id, progreso.rondaActual)
    if (intento === null || intento.puntosObtenidos !== null) {
      res.status(404).json({ error: 'no hay intento pendiente de calificación' })
      return
    }

    try {
      const calificacion = await calificarConIA(sala, seccion, intento)
      await guardarCalificacionDump(db, intento.id, calificacion)

      const ventana = ventanaDeFase('resultados', sala, seccion, new Date())
      await actualizarFase(db, progreso.id, { rondaActual: progreso.rondaActual, fase: 'resultados', faseIniciaEn: ventana.inicia, faseTerminaEn: ventana.termina })

      let avisoFichas: string | undefined
      if (progreso.rondaActual === 2) {
        try {
          await generarBancoFichas(db, clienteIA, cuentaId, seccion.id)
        } catch {
          avisoFichas = 'la generación de fichas falló; usa el botón de reintento en la sección'
        }
      }

      res.status(200).json({
        cobertura_porcentaje: calificacion.coberturaPorcentaje,
        conceptos_cubiertos: calificacion.conceptosCubiertos,
        conceptos_faltantes: calificacion.conceptosFaltantes,
        errores: calificacion.errores,
        puntos_obtenidos: calificacion.puntosObtenidos,
        fase: 'resultados',
        faseTerminaEn: ventana.termina,
        aviso_fichas: avisoFichas
      })
    } catch {
      res.status(502).json({ error: 'la calificación de IA volvió a fallar; inténtalo de nuevo más tarde' })
    }
  })

  // ─── GET /api/secciones/:id/dump/resultado/:ronda ───────────────────────
  router.get('/:id/dump/resultado/:ronda', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const contexto = await cargarContexto(req.params.id, cuentaId)
    if (contexto === null) {
      responderSinContexto(res)
      return
    }
    const ronda = Number(req.params.ronda)
    if (ronda !== 1 && ronda !== 2) {
      res.status(400).json({ error: 'ronda inválida' })
      return
    }
    const intento = await obtenerDumpDeRonda(db, cuentaId, seccionIdDe(req), ronda)
    if (intento === null || intento.cuentaId !== cuentaId) {
      res.status(404).json({ error: 'sin intento para esa ronda' })
      return
    }
    res.status(200).json({
      ronda: intento.ronda,
      texto: intento.textoEnviado,
      timestamp: intento.timestamp,
      estado: intento.puntosObtenidos === null ? 'sin_calificacion' : 'calificado',
      cobertura_porcentaje: intento.coberturaPorcentaje,
      conceptos_cubiertos: intento.conceptosCubiertos === null ? null : JSON.parse(intento.conceptosCubiertos),
      conceptos_faltantes: intento.conceptosFaltantes === null ? null : JSON.parse(intento.conceptosFaltantes),
      errores: intento.errores === null ? null : JSON.parse(intento.errores),
      puntos_obtenidos: intento.puntosObtenidos
    })
  })

  // ─── POST /api/secciones/:id/fichas/regenerar (FR-026) ──────────────────
  router.post('/:id/fichas/regenerar', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const contexto = await cargarContexto(req.params.id, cuentaId)
    if (contexto === null) {
      responderSinContexto(res)
      return
    }
    const { seccion } = contexto

    const ronda2 = await obtenerDumpDeRonda(db, cuentaId, seccion.id, 2)
    if (ronda2 === null || ronda2.puntosObtenidos === null) {
      res.status(409).json({ error: 'la ronda 2 aún no está calificada' })
      return
    }
    // Solo si la generación anterior NO completó (FR-026: 409 si ya hay fichas)
    if (await hayFichasDeSeccion(db, cuentaId, seccion.id)) {
      res.status(409).json({ error: 'ya existen fichas para esta sección' })
      return
    }

    try {
      const creadas = await generarBancoFichas(db, clienteIA, cuentaId, seccion.id)
      res.status(200).json({ fichas_creadas: creadas })
    } catch (error) {
      if (error instanceof Error && error.message.includes('no está calificada')) {
        res.status(409).json({ error: error.message })
        return
      }
      res.status(502).json({ error: 'la generación de fichas volvió a fallar; inténtalo de nuevo más tarde' })
    }
  })

  // ─── GET /api/secciones/:id/fichas (solo propias) ───────────────────────
  router.get('/:id/fichas', async function (req, res) {
    const cuentaId = req.cuentaId as string
    const contexto = await cargarContexto(req.params.id, cuentaId)
    if (contexto === null) {
      responderSinContexto(res)
      return
    }
    const { seccion } = contexto
    const fichas = await listarFichasDeSeccion(db, cuentaId, seccion.id)
    const ronda2 = await obtenerDumpDeRonda(db, cuentaId, seccion.id, 2)
    const ronda2Calificada = ronda2 !== null && ronda2.puntosObtenidos !== null
    const hayFichas = await hayFichasDeSeccion(db, cuentaId, seccion.id)
    res.status(200).json({
      fichas: fichas,
      // Botón de reintento visible SOLO si la ronda 2 está calificada pero
      // la generación no completó (FR-026)
      regenerarDisponible: ronda2Calificada && !hayFichas
    })
  })

  return router
}

// Helper para leer el id de sección en la ruta de resultado
function seccionIdDe(req: { params: { id?: string } }): string {
  return typeof req.params.id === 'string' ? req.params.id : ''
}
