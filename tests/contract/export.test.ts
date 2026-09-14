import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'
import { crearStubIA, type StubIA } from '../helpers/stubIA.js'
import { cargarEnv } from '../../src/server/config/env.js'
import { crearApp } from '../../src/server/app.js'
import type { Client } from '@libsql/client'

// T043: exportación .apkg (FR-038/039/040): binario válido, aislamiento y
// aviso sin fichas (no archivo vacío).

// Parser de respuesta binaria para supertest
function parserBinario(
  res: { on: (evento: string, cb: (arg: unknown) => void) => void },
  callback: (err: Error | null, cuerpo: Buffer) => void
): void {
  const fragmentos: Buffer[] = []
  res.on('data', function (d) {
    fragmentos.push(d as Buffer)
  })
  res.on('end', function () {
    callback(null, Buffer.concat(fragmentos))
  })
}

async function avanzarFase(db: Client, app: Express, token: string, seccionId: string): Promise<request.Response> {
  await db.execute({
    sql: "UPDATE ProgresoSeccion SET fase_termina_en = '2020-01-01T00:00:00.000Z' WHERE seccion_id = ?",
    args: [seccionId]
  })
  return request(app).post('/api/secciones/' + seccionId + '/dump/iniciar').set('Authorization', 'Bearer ' + token)
}

describe('exportación .apkg (T043)', function () {
  let app: Express
  let db: Client
  let stub: StubIA
  let tokenAna: string
  let tokenBeto: string
  let documentoId: string

  beforeAll(async function () {
    db = await crearDbDePrueba()
    stub = crearStubIA()
    app = crearApp({ db: db, env: cargarEnv(), clienteIA: stub })
    tokenAna = await registrarCuenta(app, 'ana@export.test', 'Ana')
    tokenBeto = await registrarCuenta(app, 'beto@export.test', 'Beto')

    const sala = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    documentoId = sala.body.documento.id
    const seccion = sala.body.secciones[0].id

    // Ana genera fichas (ronda 1+2 + regenerar)
    await request(app).post('/api/secciones/' + seccion + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenAna)
    await avanzarFase(db, app, tokenAna, seccion)
    stub.fijar([{ cobertura_porcentaje: 0, conceptos_cubiertos: [], conceptos_faltantes: ['s1-c1'], errores: [] }])
    await request(app).post('/api/secciones/' + seccion + '/dump/enviar').set('Authorization', 'Bearer ' + tokenAna).send({ texto: 'a' })
    await avanzarFase(db, app, tokenAna, seccion)
    await avanzarFase(db, app, tokenAna, seccion)
    stub.fijar([{ cobertura_porcentaje: 0, conceptos_cubiertos: [], conceptos_faltantes: ['s1-c1'], errores: [] }])
    await request(app).post('/api/secciones/' + seccion + '/dump/enviar').set('Authorization', 'Bearer ' + tokenAna).send({ texto: 'b' })
    stub.fijar([{ fichas: [{ pregunta: 'p1', respuesta: 'r1', concepto_id: 's1-c1', tipo: 'estandar', prioridad_inicial: 'alta' }] }])
    await request(app).post('/api/secciones/' + seccion + '/fichas/regenerar').set('Authorization', 'Bearer ' + tokenAna)
  })

  it('exporta por documento: binario con firma PK y cabecera de descarga', async function () {
    const respuesta = await request(app)
      .get('/api/export/apkg?documento_id=' + documentoId)
      .set('Authorization', 'Bearer ' + tokenAna)
      .buffer(true)
      .parse(parserBinario as never)
    expect(respuesta.status).toBe(200)
    expect(respuesta.headers['content-disposition']).toContain('attachment')
    const bytes = respuesta.body as Buffer
    expect(bytes.length).toBeGreaterThan(100)
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })

  it('exporta todas las fichas con subdecks doc::sec', async function () {
    const respuesta = await request(app)
      .get('/api/export/apkg/todas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .buffer(true)
      .parse(parserBinario as never)
    expect(respuesta.status).toBe(200)
    expect((respuesta.body as Buffer)[0]).toBe(0x50)
  })

  it('cuenta sin fichas recibe 404 (aviso), no un archivo vacío', async function () {
    const respuesta = await request(app).get('/api/export/apkg/todas').set('Authorization', 'Bearer ' + tokenBeto)
    expect(respuesta.status).toBe(404)
    expect(respuesta.body.error).toContain('fichas')
  })

  it('Beto no puede exportar con el documento de Ana (aislamiento)', async function () {
    const respuesta = await request(app)
      .get('/api/export/apkg?documento_id=' + documentoId)
      .set('Authorization', 'Bearer ' + tokenBeto)
    expect(respuesta.status).toBe(404)
  })
})
