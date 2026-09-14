import { describe, expect, it } from 'vitest'
import { aplicarSm2, ESTADO_SM2_INICIAL } from '../../src/server/services/sm2.js'

// T009: algoritmo SM-2 clásico EXACTO a la fuente §6.7 (SC-005).
// Valores esperados calculados a mano.

const FECHA_BASE = new Date('2026-09-14T12:00:00.000Z')

describe('aplicarSm2 (§6.7)', function () {
  it('ficha nueva con q=3: EF 2.5→2.36, intervalo 1, repeticiones 1, +1 día', function () {
    const r = aplicarSm2(ESTADO_SM2_INICIAL, 3, FECHA_BASE)
    expect(r.factorFacilidad).toBeCloseTo(2.36, 10)
    expect(r.intervaloDias).toBe(1)
    expect(r.repeticiones).toBe(1)
    expect(r.fechaProximoRepaso).toBe('2026-09-15')
  })

  it('q=4 tras la primera repetición: EF se mantiene, intervalo 6, repeticiones 2', function () {
    const r = aplicarSm2({ repeticiones: 1, intervaloDias: 1, factorFacilidad: 2.36 }, 4, FECHA_BASE)
    // EF' = 2.36 + (0.1 - 1*(0.08+0.02)) = 2.36
    expect(r.factorFacilidad).toBeCloseTo(2.36, 10)
    expect(r.intervaloDias).toBe(6)
    expect(r.repeticiones).toBe(2)
    expect(r.fechaProximoRepaso).toBe('2026-09-20')
  })

  it('q=5 con repeticiones>=2: intervalo = round(6 * 2.46) = 15', function () {
    const r = aplicarSm2({ repeticiones: 2, intervaloDias: 6, factorFacilidad: 2.36 }, 5, FECHA_BASE)
    // EF' = 2.36 + 0.1 = 2.46; round(6*2.46) = round(14.76) = 15
    expect(r.factorFacilidad).toBeCloseTo(2.46, 10)
    expect(r.intervaloDias).toBe(15)
    expect(r.repeticiones).toBe(3)
  })

  it('q=2 (fallo) reinicia: repeticiones 0, intervalo 1, EF baja a 2.14', function () {
    const r = aplicarSm2({ repeticiones: 3, intervaloDias: 15, factorFacilidad: 2.46 }, 2, FECHA_BASE)
    // EF' = 2.46 + (0.1 - 3*(0.08+0.06)) = 2.46 - 0.32 = 2.14
    expect(r.factorFacilidad).toBeCloseTo(2.14, 10)
    expect(r.repeticiones).toBe(0)
    expect(r.intervaloDias).toBe(1)
  })

  it('piso de EF en 1.3 ante fallos repetidos con q=0', function () {
    const paso1 = aplicarSm2({ repeticiones: 0, intervaloDias: 1, factorFacilidad: 2.14 }, 0, FECHA_BASE)
    // 2.14 + (0.1 - 5*(0.08+0.10)) = 2.14 - 0.8 = 1.34 (aún sobre el piso)
    expect(paso1.factorFacilidad).toBeCloseTo(1.34, 10)

    const paso2 = aplicarSm2({ repeticiones: 0, intervaloDias: 1, factorFacilidad: 1.34 }, 0, FECHA_BASE)
    // 1.34 - 0.8 = 0.54 → piso 1.3
    expect(paso2.factorFacilidad).toBeCloseTo(1.3, 10)
  })

  it('intervalo largo con repeticiones>=2: round(100 * 2.36) = 236', function () {
    const r = aplicarSm2({ repeticiones: 2, intervaloDias: 100, factorFacilidad: 2.5 }, 3, FECHA_BASE)
    expect(r.intervaloDias).toBe(236)
    expect(r.repeticiones).toBe(3)
  })

  it('redondea el próximo repaso al día en UTC', function () {
    const r = aplicarSm2(ESTADO_SM2_INICIAL, 5, new Date('2026-12-31T23:30:00.000Z'))
    expect(r.fechaProximoRepaso).toBe('2027-01-01')
  })
})
