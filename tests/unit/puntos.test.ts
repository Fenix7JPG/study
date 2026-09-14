import { describe, expect, it } from 'vitest'
import {
  puntosPorRonda,
  bonusPorMejora,
  puntosPractica,
  VALORES_DEFECTO
} from '../../src/server/services/puntos.js'

// T010: fórmulas §8.1 y §8.2 con valores configurables (FR-019/032, SC-006)

describe('puntos por ronda de dump (§8.1)', function () {
  it('valores por defecto: +10 cubierto, 0 faltante, -5 error', function () {
    expect(puntosPorRonda(5, 2, 1)).toBe(5 * 10 - 1 * 5)
    expect(puntosPorRonda(0, 0, 0)).toBe(0)
    expect(puntosPorRonda(2, 3, 4)).toBe(20 - 20)
  })

  it('valores configurables por el administrador', function () {
    const valores = { ...VALORES_DEFECTO, puntoPorCubierto: 20, penalizacionPorError: 7 }
    expect(puntosPorRonda(3, 1, 2, valores)).toBe(60 - 14)
  })
})

describe('bonus de mejora (§8.1)', function () {
  it('aplica +20 UNA vez si la cobertura de la ronda 2 supera a la ronda 1', function () {
    expect(bonusPorMejora(50, 60)).toBe(20)
  })

  it('no aplica si la cobertura no mejoró o no hay ronda previa', function () {
    expect(bonusPorMejora(60, 60)).toBe(0)
    expect(bonusPorMejora(80, 40)).toBe(0)
    expect(bonusPorMejora(null, 90)).toBe(0)
  })
})

describe('puntos de práctica (§8.2)', function () {
  it('puntos_base = calidad × 10', function () {
    expect(puntosPractica(5, false)).toBe(50)
    expect(puntosPractica(0, false)).toBe(0)
  })

  it('penalización de alucinación configurable', function () {
    expect(puntosPractica(2, true)).toBe(20 - 15)
    expect(puntosPractica(3, true)).toBe(30 - 15)
    const valores = { ...VALORES_DEFECTO, penalizacionAlucinacion: 30 }
    expect(puntosPractica(2, true, valores)).toBe(-10)
  })

  it('puede resultar NEGATIVO sin piso en 0 (§8.2)', function () {
    expect(puntosPractica(0, true)).toBe(-15)
  })
})
