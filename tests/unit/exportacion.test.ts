import { describe, expect, it } from 'vitest'
import { mazosPorDocumento, mazosTodasLasFichas, generarApkg } from '../../src/server/services/exportacion.js'

// T014: generación .apkg al vuelo (FR-038/039): nombres de mazos/subdecks y
// paquete real generado en memoria (sin red, sql.js local).

describe('nombres de mazos', function () {
  it('nivel 1: un solo mazo con el titulo del documento', function () {
    const mazos = mazosPorDocumento('Historia Universal', [
      { pregunta: 'p1', respuesta: 'r1' },
      { pregunta: 'p2', respuesta: 'r2' }
    ])
    expect(mazos.length).toBe(1)
    expect(mazos[0].nombre).toBe('Historia Universal')
    expect(mazos[0].pares.length).toBe(2)
  })

  it('nivel 2: un mazo "doc::sec" por documento/sección (convención subdecks)', function () {
    const mazos = mazosTodasLasFichas([
      { tituloDocumento: 'Doc1', tituloSeccion: 'S1', pregunta: 'p1', respuesta: 'r1' },
      { tituloDocumento: 'Doc1', tituloSeccion: 'S2', pregunta: 'p2', respuesta: 'r2' },
      { tituloDocumento: 'Doc1', tituloSeccion: 'S1', pregunta: 'p3', respuesta: 'r3' },
      { tituloDocumento: 'Doc2', tituloSeccion: 'S1', pregunta: 'p4', respuesta: 'r4' }
    ])
    const nombres = mazos.map(function (m) { return m.nombre }).sort()
    expect(nombres).toEqual(['Doc1::S1', 'Doc1::S2', 'Doc2::S1'])
    const doc1s1 = mazos.find(function (m) { return m.nombre === 'Doc1::S1' })
    expect(doc1s1?.pares.length).toBe(2)
  })
})

describe('generarApkg', function () {
  it('genera bytes de un zip real (firma PK) en memoria', async function () {
    const bytes = await generarApkg([{ nombre: 'Mazo de prueba', pares: [{ pregunta: '¿2+2?', respuesta: '4' }] }])
    expect(bytes.length).toBeGreaterThan(100)
    // Los .apkg son zip: comienzan con la firma "PK"
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })

  it('rechaza una lista de mazos vacía', async function () {
    await expect(generarApkg([])).rejects.toThrowError(/no hay fichas/)
  })
})
