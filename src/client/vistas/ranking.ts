import { apiFetch, escapar } from '../main'

// Ranking POR SESIÓN (T046): ordenado por puntos de la sesión, con el
// ganador señalado. Solo aparece si hay más de un participante reciente.

interface EntradaRanking {
  nombre: string
  puntosSesion: number
  ganador: boolean
}

export function renderRanking(contenedor: HTMLElement, salaId: string): void {
  contenedor.innerHTML = '<h1>Ranking</h1><p>Cargando…</p>'

  apiFetch<{ ranking: EntradaRanking[] | null }>('/api/salas/' + salaId + '/ranking')
    .then(function (datos) {
      if (datos.ranking === null) {
        contenedor.innerHTML = [
          '<h1>Ranking de la sesión</h1>',
          '<p>Todavía no hay suficientes participantes con sesión activa o reciente (últimas 24 horas) para mostrar un ranking.</p>',
          '<p><a href="#/sala/' + salaId + '">Volver a la sala</a></p>'
        ].join('')
        return
      }
      const filas = datos.ranking
        .map(function (entrada) {
          return [
            '<tr>',
            '<td>' + escapar(entrada.nombre) + '</td>',
            '<td>' + String(entrada.puntosSesion) + '</td>',
            '<td>' + (entrada.ganador ? '🏆 Ganador' : '') + '</td>',
            '</tr>'
          ].join('')
        })
        .join('')
      contenedor.innerHTML = [
        '<h1>Ranking de la sesión</h1>',
        '<p>Ordenado por los puntos de la sesión (dump + práctica de las últimas 24 horas).</p>',
        '<table><thead><tr><th>Cuenta</th><th>Puntos de la sesión</th><th></th></tr></thead><tbody>' + filas + '</tbody></table>',
        '<p><a href="#/sala/' + salaId + '">Volver a la sala</a></p>'
      ].join('')
    })
    .catch(function (e: Error) {
      contenedor.innerHTML = '<h1>Ranking</h1><p class="error">' + escapar(e.message) + '</p>'
    })
}
