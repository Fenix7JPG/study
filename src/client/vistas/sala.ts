import { apiFetch, escapar } from '../main'

// Vista de detalle de sala: lista de secciones para estudiar, enlace al
// ranking y (si es admin) formulario de configuración (fuente §6.2).

interface SalaDetalle {
  sala: { id: string; codigoInvitacion: string; modo: 'dump' | 'multijugador'; cerradaEn: string | null; configTiempoLectura: number | null; configTiempoEscritura: number | null; configTiempoResultados: number | null; configTamanoSesionPractica: number }
  documentoTitulo: string | null
  secciones: Array<{ id: string; titulo: string; orden: number; num_palabras: number }>
  rol: 'administrador' | 'participante'
}

export function renderSala(contenedor: HTMLElement, salaId: string): void {
  contenedor.innerHTML = '<h1>Sala</h1><p>Cargando…</p>'

  apiFetch<SalaDetalle>('/api/salas/' + salaId)
    .then(function (detalle) {
      const esMultijugador = detalle.sala.modo === 'multijugador'
      const filas = detalle.secciones
        .map(function (s) {
          return [
            '<tr>',
            '<td>' + escapar(s.titulo) + '</td>',
            '<td>' + String(s.num_palabras) + ' palabras</td>',
            '<td><a href="#/seccion/' + s.id + '">Estudiar (dump)</a></td>',
            '</tr>'
          ].join('')
        })
        .join('')

      const config =
        detalle.rol === 'administrador' && !esMultijugador
          ? [
              '<h2>Configuración (administrador)</h2>',
              '<form id="forma-config">',
              '<label>Tiempo de lectura por sección, vacío = calcular <input type="number" min="1" name="lectura" value="' + (detalle.sala.configTiempoLectura ?? '') + '" /></label>',
              '<label>Tiempo de escritura por sección <input type="number" min="1" name="escritura" value="' + (detalle.sala.configTiempoEscritura ?? '') + '" /></label>',
              '<label>Tiempo de resultados <input type="number" min="1" name="resultados" value="' + (detalle.sala.configTiempoResultados ?? '') + '" /></label>',
              '<label>Tamaño de sesión de práctica <input type="number" min="1" name="tamano" value="' + String(detalle.sala.configTamanoSesionPractica) + '" /></label>',
              '<button type="submit">Guardar configuración</button>',
              '<p class="error" id="error-config" hidden></p>',
              '</form>'
            ].join('')
          : ''

      const titulo = detalle.documentoTitulo ?? 'Sala multijugador'
      const zonaMultijugador = esMultijugador
        ? [
            '<h2>Mi banco de fichas</h2>',
            '<p>Importa tu banco personalizado (.json o .zip del formato del sistema):</p>',
            '<form id="forma-importar">',
            '<label>Archivos <input type="file" id="archivos-banco" multiple accept=".json,.zip,.txt" /></label>',
            '<button type="submit">Importar banco</button>',
            '<p class="error" id="error-importar" hidden></p>',
            '</form>',
            '<div id="resultado-importar"></div>'
          ].join('')
        : ''

      const cierreHost = detalle.rol === 'administrador'
        ? (esMultijugador
            ? (detalle.sala.cerradaEn === null
                ? '<button id="cerrar-sala">Cerrar sala (congelar ranking y señalar ganador)</button>'
                : '<p>Sala cerrada el ' + escapar(detalle.sala.cerradaEn.slice(0, 10)) + '.</p>')
            : '<button id="terminar-practica">Terminar sesión de práctica (entrega los bancos a todos)</button>')
        : ''

      contenedor.innerHTML = [
        '<h1>' + escapar(titulo) + '</h1>',
        '<p>' + (esMultijugador ? 'Modo: <strong>Anki multijugador</strong>' : 'Modo: dump') + ' · Código de invitación: <code>' + escapar(detalle.sala.codigoInvitacion) + '</code> · Rol: ' + escapar(detalle.rol) + '</p>',
        '<p><a href="#/practica/' + salaId + '">Iniciar sesión de práctica</a> · <a href="#/ranking/' + salaId + '">Ver ranking</a></p>',
        esMultijugador ? zonaMultijugador : '<table><thead><tr><th>Sección</th><th>Extensión</th><th>Acción</th></tr></thead><tbody>' + filas + '</tbody></table>',
        cierreHost,
        config
      ].join('')

      if (esMultijugador) {
        const formaImportar = document.getElementById('forma-importar') as HTMLFormElement
        const errorImportar = document.getElementById('error-importar') as HTMLElement
        formaImportar.addEventListener('submit', function (evento) {
          evento.preventDefault()
          const entrada = document.getElementById('archivos-banco') as HTMLInputElement
          if (entrada.files === null || entrada.files.length === 0) {
            errorImportar.hidden = false
            errorImportar.textContent = 'Selecciona al menos un archivo .json o .zip'
            return
          }
          const datos = new FormData()
          for (const archivo of entrada.files) {
            datos.append('archivos', archivo)
          }
          fetch('/api/import/banco', { method: 'POST', headers: { Authorization: 'Bearer ' + (localStorage.getItem('token_sesion') ?? '') }, body: datos })
            .then(function (r) { return r.json() })
            .then(function (respuesta) {
              const contenedorResultado = document.getElementById('resultado-importar') as HTMLElement
              const lineas = (respuesta.resultados as Array<{ archivo: string; creadas: number; actualizadas: number; rechazadas: Array<{ indice_ficha: number; campo: string; motivo: string }> }>)
                .map(function (r) {
                  return '<li><strong>' + escapar(r.archivo) + '</strong>: ' + String(r.creadas) + ' creadas, ' + String(r.actualizadas) + ' actualizadas' +
                    (r.rechazadas.length > 0 ? ' — RECHAZADAS: ' + r.rechazadas.map(function (x) { return escapar(x.campo + ': ' + x.motivo) }).join('; ') : '') + '</li>'
                })
                .join('')
              contenedorResultado.innerHTML = '<ul>' + lineas + '</ul>'
            })
            .catch(function (e: Error) {
              errorImportar.hidden = false
              errorImportar.textContent = e.message
            })
        })
      }

      const botonTerminar = document.getElementById('terminar-practica')
      if (botonTerminar) {
        botonTerminar.addEventListener('click', function () {
          apiFetch('/api/salas/' + salaId + '/terminar-practica', { method: 'POST' })
            .then(function () {
              window.alert('Sesión de práctica terminada. Los participantes ya pueden ver su resumen y descargar su banco.')
            })
            .catch(function (e: Error) {
              window.alert(e.message)
            })
        })
      }

      const botonCerrar = document.getElementById('cerrar-sala')
      if (botonCerrar) {
        botonCerrar.addEventListener('click', function () {
          apiFetch('/api/salas/' + salaId + '/cerrar', { method: 'PATCH' })
            .then(function () {
              renderSala(contenedor, salaId)
            })
            .catch(function (e: Error) {
              window.alert(e.message)
            })
        })
      }

      if (detalle.rol === 'administrador' && !esMultijugador) {
        const forma = document.getElementById('forma-config') as HTMLFormElement
        const error = document.getElementById('error-config') as HTMLElement
        forma.addEventListener('submit', function (evento) {
          evento.preventDefault()
          const datos = new FormData(forma)
          const cuerpo: Record<string, unknown> = {}
          if (String(datos.get('lectura')) !== '') cuerpo.config_tiempo_lectura = Number(datos.get('lectura'))
          if (String(datos.get('escritura')) !== '') cuerpo.config_tiempo_escritura = Number(datos.get('escritura'))
          if (String(datos.get('resultados')) !== '') cuerpo.config_tiempo_resultados = Number(datos.get('resultados'))
          if (String(datos.get('tamano')) !== '') cuerpo.config_tamano_sesion_practica = Number(datos.get('tamano'))
          apiFetch('/api/salas/' + salaId + '/config', { method: 'PATCH', body: JSON.stringify(cuerpo) })
            .then(function () {
              renderSala(contenedor, salaId)
            })
            .catch(function (e: Error) {
              error.hidden = false
              error.textContent = e.message
            })
        })
      }
    })
    .catch(function (e: Error) {
      contenedor.innerHTML = '<h1>Sala</h1><p class="error">' + escapar(e.message) + '</p>'
    })
}
