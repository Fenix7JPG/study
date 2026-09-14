// Generación de archivos .apkg al vuelo (fuente §9, FR-038/039).
// Librería: ankipack (research D4 — sustitución autorizada de
// anki-apkg-export, sin publicar desde hace ~6 años). ankipack es ESM-only,
// por lo que se importa dinámicamente desde este módulo CommonJS.
// El archivo NUNCA se persiste: se devuelve el buffer para enviarlo como
// descarga directa en la respuesta HTTP.

export interface ParFicha {
  pregunta: string
  respuesta: string
}

export interface MazoExport {
  // Nombre del mazo; con "::" para subdecks (convención de Anki)
  nombre: string
  pares: ParFicha[]
}

export interface FilaFichaPorSeccion {
  tituloDocumento: string
  tituloSeccion: string
  pregunta: string
  respuesta: string
}

// Nivel 1 (por documento/sala): UN mazo nombrado con el titulo del documento
// que incluye todas las fichas de la cuenta en ese documento (FR-039.1)
export function mazosPorDocumento(tituloDocumento: string, fichas: ParFicha[]): MazoExport[] {
  return [{ nombre: tituloDocumento, pares: fichas.slice() }]
}

// Nivel 2 (todas las fichas): un mazo "{titulo_documento}::{titulo_seccion}"
// por cada documento/sección en el que la cuenta tenga fichas (FR-039.2)
export function mazosTodasLasFichas(filas: FilaFichaPorSeccion[]): MazoExport[] {
  const grupos = new Map<string, ParFicha[]>()
  for (const fila of filas) {
    const nombre = fila.tituloDocumento + '::' + fila.tituloSeccion
    const actual = grupos.get(nombre)
    if (actual === undefined) {
      grupos.set(nombre, [{ pregunta: fila.pregunta, respuesta: fila.respuesta }])
    } else {
      actual.push({ pregunta: fila.pregunta, respuesta: fila.respuesta })
    }
  }
  const mazos: MazoExport[] = []
  for (const par of grupos) {
    mazos.push({ nombre: par[0], pares: par[1] })
  }
  return mazos
}

// Construye el paquete .apkg (bytes del zip) a partir de los mazos.
// Cada ficha se agrega como nota básica [pregunta, respuesta].
export async function generarApkg(mazos: MazoExport[]): Promise<Uint8Array> {
  if (mazos.length === 0) {
    throw new Error('no hay fichas para exportar')
  }

  // Imports dinámicos: ankipack es ESM-only y sql.js carga su WASM
  const sqlJs = await import('sql.js')
  const ankipack = await import('ankipack')

  const SQL = await sqlJs.default()
  const paquete = new ankipack.Package()
  const notetype = ankipack.Notetype.basic()

  for (const mazo of mazos) {
    const deck = new ankipack.Deck({
      name: mazo.nombre,
      config: new ankipack.DeckConfig({ name: 'Config ' + mazo.nombre })
    })
    for (const par of mazo.pares) {
      deck.addNote(new ankipack.Note({ notetype: notetype, fields: [par.pregunta, par.respuesta] }))
    }
    paquete.addDeck(deck)
  }

  // Bytes en memoria; NUNCA se escribe a disco ni se persiste (fuente §5.2)
  return paquete.toUint8Array(SQL)
}
