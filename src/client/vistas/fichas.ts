import { apiFetch, escapar } from '../main'

// Fichas de una sección (T037): listado con estado SM-2 y botón de
// reintento de generación visible SOLO cuando aplica (FR-026).

interface Ficha {
  id: string
  pregunta: string
  respuesta: string
  conceptoId: string
  tipo: 'estandar' | 'discriminacion'
  prioridadInicial: 'alta' | 'baja'
  pendiente: boolean
  repeticiones: number
  intervaloDias: number
  factorFacilidad: number
  fechaProximoRepaso: string
}

export function renderFichas(contenedor: HTMLElement, seccionId: string): void {
  contenedor.innerHTML = '<h1>Mis fichas</h1><p>Cargando…</p>'

  function cargar(): void {
    apiFetch<{ fichas: Ficha[]; regenerarDisponible: boolean }>('/api/secciones/' + seccionId + '/fichas')
      .then(function (datos) {
        const filas = datos.fichas
          .map(function (f) {
            return [
              '<tr>',
              '<td>' + escapar(f.pregunta) + '</td>',
              '<td>' + (f.tipo === 'discriminacion' ? 'Discriminación' : 'Estándar') + '</td>',
              '<td>' + (f.prioridadInicial === 'alta' ? 'Alta' : 'Baja') + '</td>',
              '<td>' + (f.pendiente ? 'Sí' : 'No') + '</td>',
              '<td>rep ' + String(f.repeticiones) + ' · int ' + String(f.intervaloDias) + 'd · EF ' + String(f.factorFacilidad) + '</td>',
              '<td>' + escapar(f.fechaProximoRepaso) + '</td>',
              '</tr>'
            ].join('')
          })
          .join('')

        contenedor.innerHTML = [
          '<h1>Mis fichas de esta sección</h1>',
          datos.fichas.length === 0 ? '<p>Todavía no tienes fichas aquí.</p>' : '<table><thead><tr><th>Pregunta</th><th>Tipo</th><th>Prioridad</th><th>Pendiente</th><th>SM-2</th><th>Próximo repaso</th></tr></thead><tbody>' + filas + '</tbody></table>',
          datos.regenerarDisponible ? '<p><button id="regenerar">Reintentar generación de fichas</button></p>' : '',
          '<p><a href="#" id="volver">Volver</a></p>'
        ].join('')

        if (datos.regenerarDisponible) {
          document.getElementById('regenerar')?.addEventListener('click', function () {
            apiFetch('/api/secciones/' + seccionId + '/fichas/regenerar', { method: 'POST' })
              .then(function () {
                cargar()
              })
              .catch(function (e: Error) {
                contenedor.innerHTML += '<p class="error">' + escapar(e.message) + '</p>'
              })
          })
        }
        document.getElementById('volver')?.addEventListener('click', function (e) {
          e.preventDefault()
          history.back()
        })
      })
      .catch(function (e: Error) {
        contenedor.innerHTML = '<h1>Mis fichas</h1><p class="error">' + escapar(e.message) + '</p>'
      })
  }

  cargar()
}
