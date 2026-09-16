import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, registrarCuenta } from '../helpers/prueba.js'
import { crearStubIA, type StubIA } from '../helpers/stubIA.js'
import { cargarEnv } from '../../src/server/config/env.js'
import { crearApp } from '../../src/server/app.js'
import JSZip from 'jszip'

// Feature 003: crear sala dump subiendo el Word (FR-201..205, SC-201/202).
// El stub de IA devuelve la ingesta; el .docx mínimo se genera en el test.

async function crearDocx(textoParrafos: string[]): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.folder('_rels')?.file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const parrafos = textoParrafos
    .map(function (t) { return '<w:p><w:r><w:t>' + t + '</w:t></w:r></w:p>' })
    .join('')
  zip.folder('word')?.file('document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + parrafos + '</w:body></w:document>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

function ingestaValida(): Record<string, unknown> {
  return {
    documento: {
      titulo: 'Capítulo de prueba',
      secciones: [
        {
          id: 's1',
          titulo: 'Sección única',
          orden: 1,
          num_palabras: 40,
          contenido: [{ tipo: 'texto', valor: 'Texto de la sección.' }],
          mapa_conceptos: [
            { id: 's1-c1', concepto: 'Concepto A', explicacion: 'Explicación del concepto A.', tipo: 'definicion' }
          ]
        }
      ]
    }
  }
}

describe('crear sala dump desde Word (feature 003)', function () {
  let app: Express
  let stub: StubIA
  let tokenHost: string

  beforeAll(async function () {
    const db = await crearDbDePrueba()
    stub = crearStubIA()
    app = crearApp({ db: db, env: cargarEnv(), clienteIA: stub })
    tokenHost = await registrarCuenta(app, 'host@word.test', 'Host')
  })

  it('crea la sala desde el .docx con la ingesta generada por IA (SC-201)', async function () {
    stub.fijar([ingestaValida()])
    const docx = await crearDocx([
      'La fotosíntesis convierte la luz en glucosa.',
      'La clorofila es el pigmento verde que absorbe la luz.'
    ])
    const respuesta = await request(app)
      .post('/api/salas/dump-desde-word')
      .set('Authorization', 'Bearer ' + tokenHost)
      .attach('archivo', docx, 'capitulo.docx')
    expect(respuesta.status).toBe(201)
    expect(respuesta.body.documento.titulo).toBe('Capítulo de prueba')
    expect(respuesta.body.secciones.length).toBe(1)
    expect(respuesta.body.sala.modo).toBe('dump')
    expect(respuesta.body.sala.codigoInvitacion).toBeTruthy()
    // El stub recibió el texto extraído del documento como entrada
    expect(stub.ultimaEntrada()).toContain('fotosíntesis')
  })

  it('respuesta de IA inválida → 400 con campo específico y nada creado (SC-202)', async function () {
    const ingestaRota = { documento: { titulo: 'Roto', secciones: [{ id: 's9', titulo: 'X', orden: 1, num_palabras: 10, contenido: [], mapa_conceptos: [] }] } }
    stub.fijar([ingestaRota])
    const docx = await crearDocx(['Texto suficiente para pasar el mínimo de longitud del documento de prueba.'])
    const respuesta = await request(app)
      .post('/api/salas/dump-desde-word')
      .set('Authorization', 'Bearer ' + tokenHost)
      .attach('archivo', docx, 'roto.docx')
    expect(respuesta.status).toBe(400)
    expect(respuesta.body.error).toContain('s2') // regla 10: ids secuenciales
    // Verificar que no se creó el documento consultando mis salas
    const mias = await request(app).get('/api/salas/mias').set('Authorization', 'Bearer ' + tokenHost)
    expect(mias.body.salas.every(function (s: { documentoTitulo: string }) { return s.documentoTitulo !== 'Roto' })).toBe(true)
  })

  it('IA caída tras reintentos → 502 con sugerencia de la vía manual', async function () {
    stub.fijar([new Error('IA caída')])
    const docx = await crearDocx(['Texto de prueba suficiente para el mínimo establecido en el endpoint.'])
    const respuesta = await request(app)
      .post('/api/salas/dump-desde-word')
      .set('Authorization', 'Bearer ' + tokenHost)
      .attach('archivo', docx, 'x.docx')
    expect(respuesta.status).toBe(502)
    expect(respuesta.body.error).toContain('vía manual')
  })

  it('rechaza archivos que no son .docx/.txt (400)', async function () {
    const respuesta = await request(app)
      .post('/api/salas/dump-desde-word')
      .set('Authorization', 'Bearer ' + tokenHost)
      .attach('archivo', Buffer.from('imagen falsa'), 'foto.png')
    expect(respuesta.status).toBe(400)
  })

  it('rechaza documento demasiado corto (400)', async function () {
    stub.fijar([ingestaValida()])
    const docx = await crearDocx(['corto'])
    const respuesta = await request(app)
      .post('/api/salas/dump-desde-word')
      .set('Authorization', 'Bearer ' + tokenHost)
      .attach('archivo', docx, 'corto.docx')
    expect(respuesta.status).toBe(400)
    expect(respuesta.body.error).toContain('demasiado corto')
  })
})
