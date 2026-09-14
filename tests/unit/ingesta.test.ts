import { describe, expect, it } from 'vitest'
import { validarIngesta } from '../../src/server/services/ingesta.js'

// T012: validador del JSON de ingesta (FR-007) congelado con el esquema
// EXACTO de prompt_maestro_ingesta.md (Q1=A, entregado por el usuario).

function jsonValido(): Record<string, unknown> {
  return {
    documento: {
      titulo: 'Historia Universal',
      secciones: [
        {
          id: 's1',
          titulo: 'Revolución Francesa',
          orden: 1,
          num_palabras: 350,
          contenido: [
            { tipo: 'texto', valor: 'La Revolución Francesa comenzó en 1789.' },
            { tipo: 'tabla', encabezados: ['Año', 'Hecho'], filas: [['1789', 'Toma de la Bastilla']] }
          ],
          mapa_conceptos: [
            { id: 's1-c1', concepto: 'Toma de la Bastilla', explicacion: 'Evento del 14 de julio de 1789.', tipo: 'dato' },
            { id: 's1-c2', concepto: 'Reinado del Terror', explicacion: 'Periodo de ejecuciones masivas.', tipo: 'definicion' }
          ]
        },
        {
          id: 's2',
          titulo: 'Restauración',
          orden: 2,
          num_palabras: 120,
          contenido: [{ tipo: 'texto', valor: 'Tras Napoleón se restauró la monarquía.' }],
          mapa_conceptos: [
            { id: 's2-c1', concepto: 'Congreso de Viena', explicacion: 'Reordenamiento europeo de 1815.', tipo: 'relacion' }
          ]
        }
      ]
    }
  }
}

describe('validarIngesta (FR-007, esquema congelado del prompt maestro)', function () {
  it('acepta un JSON que cumple el esquema y las reglas 8/10', function () {
    const resultado = validarIngesta(jsonValido())
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.documento.titulo).toBe('Historia Universal')
      expect(resultado.datos.documento.secciones.length).toBe(2)
      // El bloque de texto usa "valor" (no "texto")
      const bloque = resultado.datos.documento.secciones[0].contenido[0]
      expect(bloque.tipo).toBe('texto')
      expect(bloque.valor).toContain('1789')
    }
  })

  it('exige el envoltorio documento.titulo', function () {
    const json = jsonValido() as Record<string, unknown>
    delete json.documento
    const resultado = validarIngesta(json)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.error).toContain('documento')
    }
  })

  it('rechaza secciones fuera de la secuencia s1, s2, ... (regla 10)', function () {
    const json = jsonValido()
    const secciones = (json.documento as { secciones: Array<{ id: string }> }).secciones
    secciones[1].id = 's5'
    const resultado = validarIngesta(json)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.error).toContain('s2')
    }
  })

  it('rechaza ids de concepto con formato incorrecto (regla 8)', function () {
    const json = jsonValido()
    const conceptos = (json.documento as { secciones: Array<{ mapa_conceptos: Array<{ id: string }> }> }).secciones[0].mapa_conceptos
    conceptos[0].id = 'concepto-1'
    const resultado = validarIngesta(json)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.error).toContain('s1-cN')
    }
  })

  it('rechaza ids de concepto duplicados dentro de la sección (regla 8)', function () {
    const json = jsonValido()
    const conceptos = (json.documento as { secciones: Array<{ mapa_conceptos: Array<{ id: string }> }> }).secciones[0].mapa_conceptos
    conceptos[1].id = 's1-c1'
    const resultado = validarIngesta(json)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.error).toContain('duplicado')
    }
  })

  it('rechaza un tipo de concepto fuera del enum (regla 8)', function () {
    const json = jsonValido()
    const conceptos = (json.documento as { secciones: Array<{ mapa_conceptos: Array<{ tipo: string }> }> }).secciones[0].mapa_conceptos
    conceptos[0].tipo = 'opinion'
    const resultado = validarIngesta(json)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.error).toContain('tipo')
    }
  })

  it('rechaza un bloque de texto sin "valor" nombrando el campo exacto (esquema exacto)', function () {
    const json = jsonValido()
    const bloques = (json.documento as { secciones: Array<{ contenido: Array<Record<string, unknown>> }> }).secciones[0].contenido
    delete bloques[0].valor
    const resultado = validarIngesta(json)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      // La unión texto|tabla señala el bloque exacto que no cumple ninguno
      expect(resultado.error).toContain('documento.secciones.0.contenido.0')
    }
  })

  it('rechaza num_palabras no entero', function () {
    const json = jsonValido()
    const secciones = (json.documento as { secciones: Array<{ num_palabras: number }> }).secciones
    secciones[0].num_palabras = 350.5
    const resultado = validarIngesta(json)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.error).toContain('num_palabras')
    }
  })
})
