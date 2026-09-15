import { describe, expect, it, beforeAll } from 'vitest'
import type { Client } from '@libsql/client'
import { crearDbDePrueba } from '../helpers/prueba.js'
import { crearCuenta } from '../../src/server/models/cuentas.js'
import { crearDocumento, crearSeccion } from '../../src/server/models/secciones.js'
import { crearSala, crearMembresia } from '../../src/server/models/salas.js'
import { crearSesion } from '../../src/server/models/practica.js'
import { crearDumpIntento, guardarCalificacionDump } from '../../src/server/models/dumps.js'
import { calcularRanking, conGanador } from '../../src/server/services/ranking.js'

// T013: ranking POR SESIÓN con ventana 24 h (FR-034/036, research D8)

describe('calcularRanking', function () {
  let db: Client
  let salaId: string
  let seccionId: string

  beforeAll(async function () {
    db = await crearDbDePrueba()

    const ana = await crearCuenta(db, { email: 'ana@test.dev', passwordHash: 'x', nombre: 'Ana' })
    const beto = await crearCuenta(db, { email: 'beto@test.dev', passwordHash: 'x', nombre: 'Beto' })
    const carla = await crearCuenta(db, { email: 'carla@test.dev', passwordHash: 'x', nombre: 'Carla' })

    const documento = await crearDocumento(db, { titulo: 'Historia', jsonIngesta: '{}', cuentaCreadoraId: ana.id })
    const seccion = await crearSeccion(db, {
      documentoId: documento.id,
      titulo: 'Capítulo 1',
      orden: 1,
      numPalabras: 300,
      contenido: '[]',
      mapaConceptos: '{"conceptos":[]}'
    })
    seccionId = seccion.id

    const sala = await crearSala(db, {
      documentoId: documento.id,
      administradorCuentaId: ana.id,
      modo: 'dump',
      codigoInvitacion: 'CODIGO1',
      configTiempoLectura: 2,
      configTiempoEscritura: 2,
      configTiempoResultados: 2,
      configTamanoSesionPractica: 30,
      configValoresPuntuacion: '{}'
    })
    salaId = sala.id

    await crearMembresia(db, ana.id, salaId)
    await crearMembresia(db, beto.id, salaId)
    await crearMembresia(db, carla.id, salaId)

    const ahora = Date.now()

    // Ana: sesión de hace 1 h con 50 puntos de práctica; dumps +30 y -5 → 75 total
    const sesionAna = await crearSesion(db, { cuentaId: ana.id, salaId: salaId, numeroDePreguntas: 30, fichasIds: [] })
    await db.execute({
      sql: 'UPDATE SesionPractica SET fecha = ?, puntos_obtenidos_total = 50 WHERE id = ?',
      args: [new Date(ahora - 1 * 60 * 60 * 1000).toISOString(), sesionAna.id]
    })
    const dump1 = await crearDumpIntento(db, { cuentaId: ana.id, seccionId: seccionId, ronda: 1, texto: 'd1' })
    await guardarCalificacionDump(db, dump1.id, { coberturaPorcentaje: 60, conceptosCubiertos: [], conceptosFaltantes: [], errores: [], puntosObtenidos: 30 })
    const dump2 = await crearDumpIntento(db, { cuentaId: ana.id, seccionId: seccionId, ronda: 2, texto: 'd2' })
    await guardarCalificacionDump(db, dump2.id, { coberturaPorcentaje: 80, conceptosCubiertos: [], conceptosFaltantes: [], errores: [], puntosObtenidos: -5 })

    // Beto: sesión de hace 25 h → FUERA de la ventana aunque tenga 100 puntos
    const sesionBeto = await crearSesion(db, { cuentaId: beto.id, salaId: salaId, numeroDePreguntas: 30, fichasIds: [] })
    await db.execute({
      sql: 'UPDATE SesionPractica SET fecha = ?, puntos_obtenidos_total = 100 WHERE id = ?',
      args: [new Date(ahora - 25 * 60 * 60 * 1000).toISOString(), sesionBeto.id]
    })

    // Carla: sesión de hace 2 h con 40 puntos y sin dumps
    const sesionCarla = await crearSesion(db, { cuentaId: carla.id, salaId: salaId, numeroDePreguntas: 30, fichasIds: [] })
    await db.execute({
      sql: 'UPDATE SesionPractica SET fecha = ?, puntos_obtenidos_total = 40 WHERE id = ?',
      args: [new Date(ahora - 2 * 60 * 60 * 1000).toISOString(), sesionCarla.id]
    })
  })

  it('incluye solo sesiones dentro de 24 h y ordena por puntos de la sesión', async function () {
    const filas = await calcularRanking(db, salaId, new Date())
    expect(filas.map(function (f) { return f.nombre })).toEqual(['Ana', 'Carla'])
    expect(filas[0].puntosSesion).toBe(75) // 50 de práctica + 30 - 5 de dumps
    expect(filas[1].puntosSesion).toBe(40)
  })

  it('excluye la sesión de hace 25 h aunque tenga más puntos', async function () {
    const filas = await calcularRanking(db, salaId, new Date())
    const beto = filas.find(function (f) { return f.nombre === 'Beto' })
    expect(beto).toBeUndefined()
  })

  it('marca el ganador en la primera posición', async function () {
    const filas = await calcularRanking(db, salaId, new Date())
    const entradas = conGanador(filas)
    expect(entradas[0].ganador).toBe(true)
    expect(entradas[1].ganador).toBe(false)
  })
})
