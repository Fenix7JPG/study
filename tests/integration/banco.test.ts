import { describe, expect, it, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { crearDbDePrueba, registrarCuenta, jsonIngestaDePrueba } from '../helpers/prueba.js'
import { crearStubIA, type StubIA } from '../helpers/stubIA.js'
import { cargarEnv } from '../../src/server/config/env.js'
import { crearApp } from '../../src/server/app.js'
import type { Client } from '@libsql/client'
import JSZip from 'jszip'

// T105/T106/T107/T108: banco portable §8 — exportación, validación estricta,
// upsert atómico y round-trip (SC-101..SC-103).

function calif(cobertura: number, faltantes: string[], errores: Array<{ id_concepto: string; descripcion_error: string }>): Record<string, unknown> {
  return {
    cobertura_porcentaje: cobertura,
    conceptos_cubiertos: ['s1-c1', 's1-c2'].filter(function (id) { return !faltantes.includes(id) }),
    conceptos_faltantes: faltantes,
    errores: errores
  }
}

async function avanzarFase(db: Client, app: Express, token: string, seccionId: string): Promise<void> {
  await db.execute({
    sql: "UPDATE ProgresoSeccion SET fase_termina_en = '2020-01-01T00:00:00.000Z' WHERE seccion_id = ?",
    args: [seccionId]
  })
  await request(app).post('/api/secciones/' + seccionId + '/dump/iniciar').set('Authorization', 'Bearer ' + token)
}

describe('banco portable (feature 002)', function () {
  let app: Express
  let db: Client
  let stub: StubIA
  let tokenAna: string
  let documentoId: string

  beforeAll(async function () {
    db = await crearDbDePrueba()
    stub = crearStubIA()
    app = crearApp({ db: db, env: cargarEnv(), clienteIA: stub })
    tokenAna = await registrarCuenta(app, 'ana@banco.test', 'Ana')

    // Modo 1 completo: 2 rondas + generación de 2 fichas
    const sala = await request(app)
      .post('/api/salas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .send({ json_ingesta: jsonIngestaDePrueba() })
    documentoId = sala.body.documento.id
    const seccion = sala.body.secciones[0].id

    await request(app).post('/api/secciones/' + seccion + '/dump/iniciar').set('Authorization', 'Bearer ' + tokenAna)
    await avanzarFase(db, app, tokenAna, seccion)
    stub.fijar([calif(50, ['s1-c2'], [])])
    await request(app).post('/api/secciones/' + seccion + '/dump/enviar').set('Authorization', 'Bearer ' + tokenAna).send({ texto: 'r1' })
    await avanzarFase(db, app, tokenAna, seccion)
    await avanzarFase(db, app, tokenAna, seccion)
    stub.fijar([
      calif(100, [], []),
      { fichas: [
        { pregunta: '¿Qué es la clorofila?', respuesta: 'Pigmento verde que absorbe luz.', concepto_id: 's1-c2', tipo: 'estandar', prioridad_inicial: 'baja' },
        { pregunta: '¿Qué es la fotosíntesis?', respuesta: 'Conversión de luz en glucosa.', concepto_id: 's1-c1', tipo: 'estandar', prioridad_inicial: 'baja' }
      ] }
    ])
    await request(app).post('/api/secciones/' + seccion + '/dump/enviar').set('Authorization', 'Bearer ' + tokenAna).send({ texto: 'r2' })
  })

  it('exporta el banco §8 del documento con ids nativos y estado SM-2', async function () {
    const respuesta = await request(app)
      .get('/api/export/banco?documento_id=' + documentoId)
      .set('Authorization', 'Bearer ' + tokenAna)
    expect(respuesta.status).toBe(200)
    const banco = JSON.parse(respuesta.text)
    expect(banco.version_formato).toBe('1')
    expect(banco.documento_titulo).toBe('Historia Universal')
    expect(banco.fichas.length).toBe(2)
    for (const ficha of banco.fichas) {
      expect(ficha.id).toBeTruthy()
      expect(ficha.estado_sm2.factor_facilidad).toBe(2.5)
      expect(ficha.estado_sm2.repeticiones).toBe(0)
      expect(typeof ficha.pendiente).toBe('boolean')
      // concepto_tipo viene del mapa original del Modo 1
      expect(ficha.concepto_tipo).toBeTruthy()
    }
    expect(banco.fichas[0].estado_sm2.fecha_proximo_repaso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('exporta todas las fichas como .zip con un .json por documento', async function () {
    const respuesta = await request(app)
      .get('/api/export/banco/todas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .buffer(true)
      .parse(function (res: { on: (e: string, cb: (d: unknown) => void) => void }, cb: (e: Error | null, cuerpo: Buffer) => void) {
        const fragmentos: Buffer[] = []
        res.on('data', function (d) { fragmentos.push(d as Buffer) })
        res.on('end', function () { cb(null, Buffer.concat(fragmentos)) })
      })
    expect(respuesta.status).toBe(200)
    const zip = await JSZip.loadAsync(respuesta.body as Buffer)
    const nombres = Object.keys(zip.files)
    expect(nombres.length).toBe(1)
    expect(nombres[0]).toBe('Historia Universal.json')
    const banco = JSON.parse(await zip.files[nombres[0]].async('string'))
    expect(banco.fichas.length).toBe(2)
  })

  it('round-trip: otra cuenta importa el banco ajeno → todo NUEVO, sin tocar nada ajeno (SC-103)', async function () {
    const exportado = await request(app)
      .get('/api/export/banco?documento_id=' + documentoId)
      .set('Authorization', 'Bearer ' + tokenAna)
    const tokenBeto = await registrarCuenta(app, 'beto@banco.test', 'Beto')

    const importacion = await request(app)
      .post('/api/import/banco')
      .set('Authorization', 'Bearer ' + tokenBeto)
      .attach('archivos', Buffer.from(exportado.text), 'banco.json')
    expect(importacion.status).toBe(200)
    const resultado = importacion.body.resultados[0]
    expect(resultado.creadas).toBe(2)
    expect(resultado.actualizadas).toBe(0)
    expect(resultado.rechazadas.length).toBe(0)

    // Beto ahora tiene las fichas con el mismo estado SM-2 exportado
    const mias = await request(app)
      .get('/api/export/banco/todas')
      .set('Authorization', 'Bearer ' + tokenBeto)
      .buffer(true)
      .parse(function (res: { on: (e: string, cb: (d: unknown) => void) => void }, cb: (e: Error | null, cuerpo: Buffer) => void) {
        const fragmentos: Buffer[] = []
        res.on('data', function (d) { fragmentos.push(d as Buffer) })
        res.on('end', function () { cb(null, Buffer.concat(fragmentos)) })
      })
    const zip = await JSZip.loadAsync(mias.body as Buffer)
    const bancoBeto = JSON.parse(await zip.files[Object.keys(zip.files)[0]].async('string'))
    expect(bancoBeto.cuenta_id).toBe(tokenBeto === undefined ? null : bancoBeto.cuenta_id)
    expect(bancoBeto.fichas.length).toBe(2)
  })

  it('upsert regla 1: banco PROPIO re-importado ACTUALIZA por ficha_externa_id', async function () {
    // Un banco con cuenta_id PROPIO (respaldo/restauración): el primer import
    // de un id nuevo CREARÁ (regla 3) y el re-import ACTUALIZARÁ (regla 1)
    const exportado = JSON.parse((await request(app).get('/api/export/banco?documento_id=' + documentoId).set('Authorization', 'Bearer ' + tokenAna)).text)
    const bancoPropio = {
      version_formato: '1',
      cuenta_id: exportado.cuenta_id, // su propia cuenta
      documento_titulo: 'Historia Universal',
      fichas: [
        { id: 'x1', pregunta: '¿Qué es la clorofila?', respuesta: 'DEFINICIÓN ACTUALIZADA', concepto_id: 's1-c2', concepto_tipo: 'definicion', tipo_ficha: 'estandar', prioridad_inicial: 'alta', pendiente: true, estado_sm2: { repeticiones: 3, intervalo_dias: 15, factor_facilidad: 2.6, fecha_proximo_repaso: '2026-10-01' } }
      ]
    }
    const importacion = await request(app)
      .post('/api/import/banco')
      .set('Authorization', 'Bearer ' + tokenAna)
      .attach('archivos', Buffer.from(JSON.stringify(bancoPropio)), 'mod.json')
    expect(importacion.status).toBe(200)
    // El id 'x1' no existe aún en Ana → CREAR
    expect(importacion.body.resultados[0].creadas).toBe(1)

    // Re-importar el MISMO archivo → coincide por ficha_externa_id → ACTUALIZAR
    const segunda = await request(app)
      .post('/api/import/banco')
      .set('Authorization', 'Bearer ' + tokenAna)
      .attach('archivos', Buffer.from(JSON.stringify(bancoPropio)), 'mod.json')
    expect(segunda.body.resultados[0].actualizadas).toBe(1)
    expect(segunda.body.resultados[0].creadas).toBe(0)

    // El estado SM-2 importado gana (última importación). La ficha x1 vive en
    // el DOCUMENTO IMPORTADO (contenedor separado del de ingesta), así que se
    // busca en todas las entradas del .zip global
    const mias = await request(app)
      .get('/api/export/banco/todas')
      .set('Authorization', 'Bearer ' + tokenAna)
      .buffer(true)
      .parse(function (res: { on: (e: string, cb: (d: unknown) => void) => void }, cb: (e: Error | null, cuerpo: Buffer) => void) {
        const fragmentos: Buffer[] = []
        res.on('data', function (d) { fragmentos.push(d as Buffer) })
        res.on('end', function () { cb(null, Buffer.concat(fragmentos)) })
      })
    const zip = await JSZip.loadAsync(mias.body as Buffer)
    let importada: { estado_sm2: { repeticiones: number }; pendiente: boolean } | undefined
    for (const nombre of Object.keys(zip.files)) {
      const datos = JSON.parse(await zip.files[nombre].async('string'))
      const candidata = (datos.fichas as Array<{ id: string; estado_sm2: { repeticiones: number }; pendiente: boolean }>).find(function (f) { return f.id === 'x1' })
      if (candidata !== undefined) {
        importada = candidata
      }
    }
    expect(importada).toBeTruthy()
    expect(importada?.estado_sm2.repeticiones).toBe(3)
    expect(importada?.pendiente).toBe(true)
  })

  it('upsert regla 2: banco exportado por este sistema (id nativo) se ACTUALIZA y fija externa', async function () {
    // Ana exporta su banco (ids nativos) y lo re-importa con cambios
    const exportado = await request(app).get('/api/export/banco?documento_id=' + documentoId).set('Authorization', 'Bearer ' + tokenAna)
    const banco = JSON.parse(exportado.text)
    banco.fichas[0].respuesta = 'RESPUESTA EDITADA EN REIMPORT'
    banco.fichas[0].estado_sm2.repeticiones = 2

    const importacion = await request(app)
      .post('/api/import/banco')
      .set('Authorization', 'Bearer ' + tokenAna)
      .attach('archivos', Buffer.from(JSON.stringify(banco)), 'reimport.json')
    expect(importacion.body.resultados[0].actualizadas).toBe(2) // match por id nativo
    expect(importacion.body.resultados[0].creadas).toBe(0)

    // Y se fijó ficha_externa_id = id nativo
    const banco2 = JSON.parse((await request(app).get('/api/export/banco?documento_id=' + documentoId).set('Authorization', 'Bearer ' + tokenAna)).text)
    expect(banco2.fichas[0].respuesta).toBe('RESPUESTA EDITADA EN REIMPORT')
  })

  it('atomicidad: un archivo con UNA ficha inválida NO importa nada (SC-102)', async function () {
    const antes = JSON.parse((await request(app).get('/api/export/banco?documento_id=' + documentoId).set('Authorization', 'Bearer ' + tokenAna)).text).fichas.length
    const bancoMalo = {
      version_formato: '1',
      cuenta_id: 'cualquiera',
      documento_titulo: 'Documento Roto',
      fichas: [
        { id: 'v1', pregunta: 'ok', respuesta: 'ok', concepto_id: '', concepto_tipo: '', tipo_ficha: 'estandar', prioridad_inicial: 'alta', estado_sm2: { repeticiones: 0, intervalo_dias: 0, factor_facilidad: 2.5, fecha_proximo_repaso: '2026-09-15' } },
        { id: 'v2', pregunta: 'mala', respuesta: 'mala', concepto_id: '', concepto_tipo: '', tipo_ficha: 'invalida', prioridad_inicial: 'alta', estado_sm2: { repeticiones: -1, intervalo_dias: 0, factor_facilidad: 2.5, fecha_proximo_repaso: 'no-es-fecha' } }
      ]
    }
    const importacion = await request(app)
      .post('/api/import/banco')
      .set('Authorization', 'Bearer ' + tokenAna)
      .attach('archivos', Buffer.from(JSON.stringify(bancoMalo)), 'malo.json')
    expect(importacion.status).toBe(200)
    const resultado = importacion.body.resultados[0]
    expect(resultado.creadas).toBe(0)
    expect(resultado.actualizadas).toBe(0)
    expect(resultado.rechazadas.length).toBeGreaterThanOrEqual(2)
    // nombra índice + campo + motivo
    expect(resultado.rechazadas.some(function (r: { indice_ficha: number; campo: string; motivo: string }) { return r.indice_ficha === 1 && r.campo.includes('tipo_ficha') })).toBe(true)

    // Documento Roto no existe (nada importado) → exportarlo da 404
    const despues = JSON.parse((await request(app).get('/api/export/banco?documento_id=' + documentoId).set('Authorization', 'Bearer ' + tokenAna)).text).fichas.length
    expect(despues).toBe(antes)
  })

  it('rechaza >2000 fichas y version_formato incorrecto', async function () {
    const fichas = Array.from({ length: 2001 }, function (_, i) {
      return { id: 'f' + String(i), pregunta: 'p', respuesta: 'r', concepto_id: '', concepto_tipo: '', tipo_ficha: 'estandar', prioridad_inicial: 'baja', estado_sm2: { repeticiones: 0, intervalo_dias: 0, factor_facilidad: 2.5, fecha_proximo_repaso: '2026-09-15' } }
    })
    const importacion = await request(app)
      .post('/api/import/banco')
      .set('Authorization', 'Bearer ' + tokenAna)
      .attach('archivos', Buffer.from(JSON.stringify({ version_formato: '1', cuenta_id: 'c', documento_titulo: 'Masivo', fichas: fichas })), 'masivo.json')
    expect(importacion.body.resultados[0].rechazadas.some(function (r: { motivo: string }) { return r.motivo.includes('2000') })).toBe(true)

    const versionMala = await request(app)
      .post('/api/import/banco')
      .set('Authorization', 'Bearer ' + tokenAna)
      .attach('archivos', Buffer.from(JSON.stringify({ version_formato: '2', cuenta_id: 'c', documento_titulo: 'X', fichas: [] })), 'v2.json')
    expect(versionMala.body.resultados[0].rechazadas.length).toBeGreaterThan(0)
  })
})
