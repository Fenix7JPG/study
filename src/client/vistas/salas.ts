import { apiFetch, escapar } from '../main'

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
  sala: { id: string; codigoInvitacion: string }
  documento: { id: string; titulo: string }
  secciones: Array<{ id: string; titulo: string; orden: number; num_palabras: number }>
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

export function renderCrearSala(contenedor: HTMLElement, irASalas: () => void): void {
  contenedor.innerHTML = [
    '<h1>Crear sala</h1>',
    '<p>Pega el JSON generado con el <strong>prompt maestro de ingesta</strong> (debe cumplir su esquema exacto).</p>',
    '<form id="forma-crear">',
    '<label>JSON de ingesta<br /><textarea name="json" rows="10" cols="70" required></textarea></label>',
    '<fieldset><legend>Configuración opcional (vacío = calcular por sección)</legend>',
    '<label>Tiempo de lectura (min) <input type="number" name="lectura" min="1" /></label>',
    '<label>Tiempo de escritura (min) <input type="number" name="escritura" min="1" /></label>',
    '<label>Tiempo de resultados (min) <input type="number" name="resultados" min="1" /></label>',
    '<label>Tamaño de sesión de práctica <input type="number" name="tamano" min="1" value="30" /></label>',
    '</fieldset>',
    '<button type="submit">Crear sala</button>',
    '<p class="error" id="error-crear" hidden></p>',
    '</form>',
    '<div id="resultado-crear"></div>'
  ].join('')

  const forma = document.getElementById('forma-crear') as HTMLFormElement
  const error = document.getElementById('error-crear') as HTMLElement
  const resultado = document.getElementById('resultado-crear') as HTMLElement

  forma.addEventListener('submit', function (evento) {
    evento.preventDefault()
    error.hidden = true
    const datos = new FormData(forma)

    // El JSON se valida en el backend contra el esquema del prompt maestro
    let jsonIngesta: unknown
    try {
      jsonIngesta = JSON.parse(String(datos.get('json')))
    } catch {
      error.hidden = false
      error.textContent = 'El texto pegado no es JSON válido.'
      return
    }

    const cuerpo: Record<string, unknown> = { json_ingesta: jsonIngesta }
    const lectura = String(datos.get('lectura'))
    const escritura = String(datos.get('escritura'))
    const resultados = String(datos.get('resultados'))
    const tamano = String(datos.get('tamano'))
    if (lectura !== '') cuerpo.config_tiempo_lectura = Number(lectura)
    if (escritura !== '') cuerpo.config_tiempo_escritura = Number(escritura)
    if (resultados !== '') cuerpo.config_tiempo_resultados = Number(resultados)
    if (tamano !== '') cuerpo.config_tamano_sesion_practica = Number(tamano)

    apiFetch<RespuestaCrearSala>('/api/salas', { method: 'POST', body: JSON.stringify(cuerpo) })
      .then(function (respuesta) {
        const secciones = respuesta.secciones
          .map(function (s) {
            return '<li>' + escapar(s.titulo) + ' (' + String(s.num_palabras) + ' palabras)</li>'
          })
          .join('')
        resultado.innerHTML = [
          '<h2>Sala creada</h2>',
          '<p>Comparte este código de invitación con tu grupo:</p>',
          '<p class="codigo"><code>' + escapar(respuesta.sala.codigoInvitacion) + '</code></p>',
          '<p>Documento: <strong>' + escapar(respuesta.documento.titulo) + '</strong></p>',
          '<ul>' + secciones + '</ul>',
          '<p><a href="#/salas">Volver a mis salas</a></p>'
        ].join('')
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
