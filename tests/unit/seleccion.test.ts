import { describe, expect, it } from 'vitest'
import { seleccionarFichas } from '../../src/server/services/practica.js'
import type { Ficha } from '../../src/server/models/fichas.js'

// T038: selección de fichas (FR-028): pendientes SIEMPRE, vencidas primero,
// completar con prioridad alta antes que baja entre las no vencidas.

const HOY = new Date().toISOString().slice(0, 10)
const FUTURO = '2099-12-31'
const PASADO = '2020-01-01'

function ficha(id: string, datos: Partial<Ficha>): Ficha {
  return {
    id: id,
    cuentaId: 'c',
    seccionId: 's',
    pregunta: 'p ' + id,
    respuesta: 'r ' + id,
    conceptoId: 'c-' + id,
    tipo: 'estandar',
    prioridadInicial: 'baja',
    pendiente: false,
    repeticiones: 0,
    intervaloDias: 0,
    factorFacilidad: 2.5,
    fechaProximoRepaso: PASADO,
    conceptoTipo: null,
    fichaExternaId: null,
    ...datos
  }
}

describe('seleccionarFichas (FR-028)', function () {
  const fichas = [
    ficha('vencida-baja', { fechaProximoRepaso: PASADO, prioridadInicial: 'baja' }),
    ficha('no-vencida-alta', { fechaProximoRepaso: FUTURO, prioridadInicial: 'alta' }),
    ficha('pendiente', { pendiente: true, fechaProximoRepaso: FUTURO }),
    ficha('no-vencida-baja', { fechaProximoRepaso: FUTURO, prioridadInicial: 'baja' }),
    ficha('vencida-alta', { fechaProximoRepaso: HOY, prioridadInicial: 'alta' })
  ]

  it('pendientes SIEMPRE incluidas sin excepción, aunque no estén vencidas', function () {
    const seleccion = seleccionarFichas(fichas, 5)
    expect(seleccion.some(function (f) { return f.id === 'pendiente' })).toBe(true)
  })

  it('orden: pendientes → vencidas → no vencidas alta → no vencidas baja', function () {
    const seleccion = seleccionarFichas(fichas, 5)
    expect(seleccion.map(function (f) { return f.id })).toEqual([
      'pendiente',
      'vencida-baja',
      'vencida-alta', // vencida (fecha = hoy cuenta como vencida)
      'no-vencida-alta',
      'no-vencida-baja'
    ])
  })

  it('respeta el tamaño de la sesión sin duplicar fichas', function () {
    const seleccion = seleccionarFichas(fichas, 2)
    expect(seleccion.length).toBe(2)
    expect(seleccion.map(function (f) { return f.id })).toEqual(['pendiente', 'vencida-baja'])
    const ids = new Set(seleccion.map(function (f) { return f.id }))
    expect(ids.size).toBe(2)
  })
})
