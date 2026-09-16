import { apiFetch, escapar, obtenerToken } from '../main'

// Vistas de salas (T021): listar mis salas, crear sala subiendo el JSON de
// ingesta, y unirse con el código de invitación (fuente §6.1, US2).

interface SalaResumen {
  sala: {
    id: string
    codigoInvitacion: string
    configTiempoLectura: number | null
    configTamanoSesionPractica: number
  }
  documentoTitulo: string
  rol: 'administrador' | 'participante'
}

interface RespuestaCrearSala {
  sala: { id: string; codigoInvitacion: string; modo: 'dump' | 'multijugador' }
  documento?: { id: string; titulo: string }
  secciones?: Array<{ id: string; titulo: string; orden: number; num_palabras: number }>
}

export function renderListaSalas(contenedor: HTMLElement, _irASalas: () => void): void {
  contenedor.innerHTML = '<h1>Mis salas</h1><p>Cargando…</p>'

  apiFetch<{ salas: SalaResumen[] }>('/api/salas/mias')
    .then(function (datos) {
      if (datos.salas.length === 0) {
        contenedor.innerHTML = [
          '<h1>Mis salas</h1>',
          '<p>Todavía no perteneces a ninguna sala.</p>',
          '<p><a href="#/crear-sala">Crear una sala</a> o <a href="#/unirse">unirte con un código</a>.</p>'
        ].join('')
        return
      }
      const filas = datos.salas.map(function (entrada) {
        return [
          '<tr>',
          '<td><a href="#/sala/' + entrada.sala.id + '">' + escapar(entrada.documentoTitulo) + '</a></td>',
          '<td><code>' + escapar(entrada.sala.codigoInvitacion) + '</code></td>',
          '<td>' + (entrada.rol === 'administrador' ? 'Administrador' : 'Participante') + '</td>',
          '<td>' + String(entrada.sala.configTamanoSesionPractica) + ' preguntas/sesión</td>',
          '</tr>'
        ].join('')
      })
      contenedor.innerHTML = [
        '<h1>Mis salas</h1>',
        '<table><thead><tr><th>Documento</th><th>Código</th><th>Rol</th><th>Configuración</th></tr></thead>',
        '<tbody>' + filas.join('') + '</tbody></table>'
      ].join('')
    })
    .catch(function (e: Error) {
      contenedor.innerHTML = '<h1>Mis salas</h1><p class="error">' + escapar(e.message) + '</p>'
    })
}

// Quita tolerancias de la respuesta del chat de IA: fences de código
// markdown y el marcador CONTINUAR fuera del JSON (regla 12 del prompt maestro)
export function limpiarRespuestaIA(texto: string): string {
  let limpio = texto.trim()
  if (limpio.startsWith('```')) {
    limpio = limpio.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim()
  }
  const ultimaLlave = limpio.lastIndexOf('}')
  if (ultimaLlave >= 0 && ultimaLlave < limpio.length - 1) {
    const cola = limpio.slice(ultimaLlave + 1).trim()
    if (cola.toUpperCase().startsWith('CONTINUAR')) {
      limpio = limpio.slice(0, ultimaLlave + 1)
    }
  }
  return limpio
}

export function renderCrearSala(contenedor: HTMLElement, irASalas: () => void): void {
  contenedor.innerHTML = [
    '<h1>Crear sala</h1>',
    '<div class="pasos">',
    '<p><strong>Dump:</strong> sube tu documento Word y el sistema crea el contenido automáticamente, o usa el JSON si ya lo generaste fuera del sistema.</p>',
    '</div>',
    '<form id="forma-crear">',
    '<fieldset><legend>Modo de la sala</legend>',
    '<label><input type="radio" name="modo" value="dump" checked /> Dump (con documento; crea el banco)</label>',
    '<label><input type="radio" name="modo" value="multijugador" /> Anki multijugador (cada quien importa su banco)</label>',
    '</fieldset>',
    '<div id="zona-dump">',
    '<fieldset><legend>¿Cómo quieres crear el contenido de estudio?</legend>',
    '<label><input type="radio" name="via_ingesta" value="word" checked /> <strong>Adjuntar mi documento Word</strong> — el sistema crea el contenido automáticamente con IA</label>',
    '<label><input type="radio" name="via_ingesta" value="json" /> Ya tengo el JSON de ingesta (creado fuera del sistema) — sin gasto de IA</label>',
    '</fieldset>',
    '<div id="via-word">',
    '<label>Documento Word (.docx) <input type="file" id="cargar-word" accept=".docx,.txt" /></label>',
    '<p class="nota">Sube tu Word (solo texto y tablas, sin imágenes). El sistema lo segmenta y crea los conceptos automáticamente. Para documentos muy extensos usa la vía JSON.</p>',
    '</div>',
    '<div id="via-json" style="display:none">',
    '<label>Archivo JSON de ingesta (opcional) <input type="file" id="cargar-json" accept=".json,.txt,.md" /></label>',
    '<label>…o pega el JSON aquí<br /><textarea name="json" rows="10" cols="70" placeholder="{ &quot;documento&quot;: { … } }"></textarea></label>',
    '</div>',
    '<fieldset><legend>Configuración opcional (vacío = calcular por sección)</legend>',
    '<label>Tiempo de lectura (min) <input type="number" name="lectura" min="1" /></label>',
    '<label>Tiempo de escritura (min) <input type="number" name="escritura" min="1" /></label>',
    '<label>Tiempo de resultados (min) <input type="number" name="resultados" min="1" /></label>',
    '</fieldset>',
    '</div>',
    '<label>Tamaño de sesión de práctica <input type="number" name="tamano" min="1" value="30" /></label>',
    '<button type="submit">Crear sala</button>',
    '<p class="error" id="error-crear" hidden></p>',
    '</form>',
    '<div id="resultado-crear"></div>'
  ].join('')

  const forma = document.getElementById('forma-crear') as HTMLFormElement
  const error = document.getElementById('error-crear') as HTMLElement
  const resultado = document.getElementById('resultado-crear') as HTMLElement
  const areaJson = forma.querySelector('textarea') as HTMLTextAreaElement

  function alternarModo(): void {
    const multijugador = (forma.querySelector('input[name="modo"]:checked') as HTMLInputElement).value === 'multijugador'
    const zona = document.getElementById('zona-dump') as HTMLElement
    zona.style.display = multijugador ? 'none' : 'block'
    areaJson.required = false
  }
  forma.querySelectorAll('input[name="modo"]').forEach(function (radio) {
    radio.addEventListener('change', alternarModo)
  })

  // Vía de ingesta dentro del modo dump: Word (automático) o JSON (manual)
  function alternarVia(): void {
    const via = (forma.querySelector('input[name="via_ingesta"]:checked') as HTMLInputElement).value
    ;(document.getElementById('via-word') as HTMLElement).style.display = via === 'word' ? 'block' : 'none'
    ;(document.getElementById('via-json') as HTMLElement).style.display = via === 'json' ? 'block' : 'none'
  }
  forma.querySelectorAll('input[name="via_ingesta"]').forEach(function (radio) {
    radio.addEventListener('change', alternarVia)
  })
  alternarModo()
  alternarVia()

  // Cargar el archivo JSON y volcarlo (limpio) al cuadro de texto
  document.getElementById('cargar-json')?.addEventListener('change', function (evento) {
    const archivo = (evento.target as HTMLInputElement).files?.[0]
    if (archivo === undefined) return
    const lector = new FileReader()
    lector.onload = function () {
      areaJson.value = limpiarRespuestaIA(String(lector.result))
    }
    lector.readAsText(archivo)
  })

  function mostrarSalaCreada(respuesta: RespuestaCrearSala): void {
    const esMultijugador = respuesta.sala.modo === 'multijugador'
    const secciones = (respuesta.secciones ?? [])
      .map(function (s) {
        return '<li>' + escapar(s.titulo) + ' (' + String(s.num_palabras) + ' palabras)</li>'
      })
      .join('')
    resultado.innerHTML = [
      '<h2>Sala creada</h2>',
      '<p>Comparte este código de invitación con tu grupo:</p>',
      '<p class="codigo"><code>' + escapar(respuesta.sala.codigoInvitacion) + '</code></p>',
      esMultijugador
        ? '<p>Modo: <strong>Anki multijugador</strong>. Cada participante importa su banco al unirse.</p>'
        : '<p>Documento: <strong>' + escapar(respuesta.documento?.titulo ?? '') + '</strong></p><ul>' + secciones + '</ul>',
      '<p><a href="#/sala/' + respuesta.sala.id + '">Ir a la sala</a> · <a href="#/salas">Volver a mis salas</a></p>'
    ].join('')
  }

  forma.addEventListener('submit', async function (evento) {
    evento.preventDefault()
    error.hidden = true
    const datos = new FormData(forma)
    const esMultijugador = String(datos.get('modo')) === 'multijugador'

    // ─── Vía A (modo dump): subir el Word → ingesta automática con IA ────
    if (!esMultijugador && String(datos.get('via_ingesta')) === 'word') {
      const archivoWord = (document.getElementById('cargar-word') as HTMLInputElement).files?.[0]
      if (archivoWord === undefined) {
        error.hidden = false
        error.textContent = 'Adjunta tu documento Word (.docx) o cambia a la vía "Ya tengo el JSON".'
        return
      }
      const cuerpo = new FormData()
      cuerpo.append('archivo', archivoWord)
      const tamano = String(datos.get('tamano'))
      if (tamano !== '') cuerpo.append('config_tamano_sesion_practica', tamano)
      const boton = forma.querySelector('button[type="submit"]') as HTMLButtonElement
      boton.disabled = true
      error.hidden = false
      error.textContent = 'Generando la ingesta con IA… esto puede tardar un minuto en documentos largos.'
      fetch('/api/salas/dump-desde-word', { method: 'POST', headers: { Authorization: 'Bearer ' + (obtenerToken() ?? '') }, body: cuerpo })
        .then(async function (r) {
          const respuesta = await r.json()
          if (!r.ok) throw new Error(respuesta.error ?? 'Error ' + String(r.status))
          mostrarSalaCreada(respuesta)
          error.hidden = true
        })
        .catch(function (e: Error) {
          error.textContent = e.message
        })
        .finally(function () {
          boton.disabled = false
        })
      return
    }

    // ─── Vía B (modo dump): JSON adjuntado o pegado ───────────────────────
    let jsonIngesta: unknown = undefined
    if (!esMultijugador) {
      const archivoJson = (document.getElementById('cargar-json') as HTMLInputElement).files?.[0]
      const texto = archivoJson !== undefined ? await archivoJson.text() : String(datos.get('json'))
      try {
        jsonIngesta = JSON.parse(limpiarRespuestaIA(texto))
      } catch {
        error.hidden = false
        error.textContent = 'El contenido no es JSON válido. Debe ser la respuesta JSON del prompt maestro de ingesta (no el documento Word).'
        return
      }
    }

    const cuerpo: Record<string, unknown> = {}
    const tamano = String(datos.get('tamano'))
    if (tamano !== '') cuerpo.config_tamano_sesion_practica = Number(tamano)

    if (esMultijugador) {
      cuerpo.modo = 'multijugador'
    } else {
      cuerpo.modo = 'dump'
      cuerpo.json_ingesta = jsonIngesta
      const lectura = String(datos.get('lectura'))
      const escritura = String(datos.get('escritura'))
      const resultados = String(datos.get('resultados'))
      if (lectura !== '') cuerpo.config_tiempo_lectura = Number(lectura)
      if (escritura !== '') cuerpo.config_tiempo_escritura = Number(escritura)
      if (resultados !== '') cuerpo.config_tiempo_resultados = Number(resultados)
    }

    apiFetch<RespuestaCrearSala>('/api/salas', { method: 'POST', body: JSON.stringify(cuerpo) })
      .then(function (respuesta) {
        mostrarSalaCreada(respuesta)
        void irASalas
      })
      .catch(function (e: Error) {
        error.hidden = false
        error.textContent = e.message
      })
  })
}

export function renderUnirse(contenedor: HTMLElement, irASalas: () => void): void {
  contenedor.innerHTML = [
    '<h1>Unirse a una sala</h1>',
    '<form id="forma-unirse">',
    '<label>Código de invitación <input type="text" name="codigo" required maxlength="8" /></label>',
    '<button type="submit">Unirme</button>',
    '<p class="error" id="error-unirse" hidden></p>',
    '</form>',
    '<div id="resultado-unirse"></div>'
  ].join('')

  const forma = document.getElementById('forma-unirse') as HTMLFormElement
  const error = document.getElementById('error-unirse') as HTMLElement
  const resultado = document.getElementById('resultado-unirse') as HTMLElement

  forma.addEventListener('submit', function (evento) {
    evento.preventDefault()
    error.hidden = true
    const datos = new FormData(forma)
    apiFetch<{ sala: { codigoInvitacion: string } }>('/api/salas/unirse', {
      method: 'POST',
      body: JSON.stringify({ codigo_invitacion: String(datos.get('codigo')) })
    })
      .then(function () {
        resultado.innerHTML = '<p>Te uniste a la sala. <a href="#/salas">Ver mis salas</a></p>'
        void irASalas
      })
      .catch(function (e: Error) {
        error.hidden = false
        error.textContent = e.message
      })
  })
}
