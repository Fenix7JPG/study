import { describe, expect, it } from 'vitest'
import { tiempoFaseSeccion, tiempoResultados } from '../../src/server/services/tiempos.js'

// T019: tiempos por sección (FR-010) con precedencia del admin (analyze B2)

describe('tiempoFaseSeccion', function () {
  it('≤400 palabras → 2 minutos', function () {
    expect(tiempoFaseSeccion(400, null)).toBe(2)
    expect(tiempoFaseSeccion(120, null)).toBe(2)
  })

  it('>400 palabras: proporcional con +1 min por cada 130–150 (140) adicionales, redondeado', function () {
    // 450 → 2 + 50/140 = 2.36 → redondeado 2
    expect(tiempoFaseSeccion(450, null)).toBe(2)
    // 480 → 2 + 80/140 = 2.57 → 3
    expect(tiempoFaseSeccion(480, null)).toBe(3)
    // 540 → 2 + 140/140 = 3 exacto
    expect(tiempoFaseSeccion(540, null)).toBe(3)
    // 680 → 2 + 280/140 = 4 exacto
    expect(tiempoFaseSeccion(680, null)).toBe(4)
    // 1000 → 2 + 600/140 = 6.29 → 6
    expect(tiempoFaseSeccion(1000, null)).toBe(6)
  })

  it('el valor fijado por el administrador PREVALECE sobre el cálculo', function () {
    expect(tiempoFaseSeccion(400, 5)).toBe(5)
    expect(tiempoFaseSeccion(1000, 3)).toBe(3)
  })
})

describe('tiempoResultados', function () {
  it('por defecto 2 minutos, configurable por el admin', function () {
    expect(tiempoResultados(null)).toBe(2)
    expect(tiempoResultados(4)).toBe(4)
  })
})
