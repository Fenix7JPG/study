import { apiFetch, escapar } from '../main'

// Vista de detalle de sala: lista de secciones para estudiar, enlace al
// ranking y (si es admin) formulario de configuración (fuente §6.2).

interface SalaDetalle {
  sala: { id: string; codigoInvitacion: string; configTiempoLectura: number | null; configTiempoEscritura: number | null; configTiempoResultados: number | null; configTamanoSesionPractica: number }
  documentoTitulo: string
  secciones: Array<{ id: string; titulo: string; orden: number; num_palabras: number }>
  rol: 'administrador' | 'participante'
}

export function renderSala(contenedor: HTMLElement, salaId: string): void {
  contenedor.innerHTML = '<h1>Sala</h1><p>Cargando…</p>'

  apiFetch<SalaDetalle>('/api/salas/' + salaId)
    .then(function (detalle) {
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
        detalle.rol === 'administrador'
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

      contenedor.innerHTML = [
        '<h1>' + escapar(detalle.documentoTitulo) + '</h1>',
        '<p>Código de invitación: <code>' + escapar(detalle.sala.codigoInvitacion) + '</code> · Rol: ' + escapar(detalle.rol) + '</p>',
        '<p><a href="#/practica/' + salaId + '">Iniciar sesión de práctica</a> · <a href="#/ranking/' + salaId + '">Ver ranking</a></p>',
        '<table><thead><tr><th>Sección</th><th>Extensión</th><th>Acción</th></tr></thead><tbody>' + filas + '</tbody></table>',
        config
      ].join('')

      if (detalle.rol === 'administrador') {
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
