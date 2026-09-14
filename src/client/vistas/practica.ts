import { apiFetch, escapar } from '../main'

// Sesión de práctica (T042): pregunta → respuesta escrita → feedback con
// respuesta correcta, explicación y puntos → resumen final con ranking
// por sesión (fuente §6.6–§6.8).

interface FichaPractica {
  id: string
  pregunta: string
}

export function renderPractica(contenedor: HTMLElement, salaId: string): void {
  contenedor.innerHTML = [
    '<h1>Práctica</h1>',
    '<form id="forma-inicio">',
    '<label>Tamaño de la sesión (vacío = configurado en la sala) <input type="number" min="1" name="tamano" /></label>',
    '<button type="submit">Iniciar sesión</button>',
    '<p class="error" id="error-inicio" hidden></p>',
    '</form>',
    '<div id="zona"></div>'
  ].join('')

  const forma = document.getElementById('forma-inicio') as HTMLFormElement
  const zona = document.getElementById('zona') as HTMLElement

  function responderYPreguntar(sesionId: string, respondidas: number, total: number): void {
    if (respondidas >= total) {
      resumen(sesionId)
      return
    }
    apiFetch<{ ficha: FichaPractica | null; respondidas: number; total: number; sesion_cerrada: boolean }>('/api/practica/' + sesionId + '/siguiente')
      .then(function (datos) {
        if (datos.ficha === null || datos.sesion_cerrada) {
          resumen(sesionId)
          return
        }
        zona.innerHTML = [
          '<h2>Pregunta ' + String(datos.respondidas + 1) + ' de ' + String(datos.total) + '</h2>',
          '<p><strong>' + escapar(datos.ficha.pregunta) + '</strong></p>',
          '<form id="forma-respuesta">',
          '<textarea name="respuesta" rows="6" cols="80" placeholder="Escribe tu respuesta completa…"></textarea>',
          '<br /><button type="submit">Responder</button>',
          '<p class="error" id="error-respuesta" hidden></p>',
          '</form>'
        ].join('')

        const formaRespuesta = document.getElementById('forma-respuesta') as HTMLFormElement
        formaRespuesta.addEventListener('submit', function (evento) {
          evento.preventDefault()
          const campo = formaRespuesta.querySelector('textarea') as HTMLTextAreaElement
          apiFetch<{ puntuacion_calidad: number; alucinacion_detectada: boolean; explicacion: string; respuesta_correcta: string; puntos_obtenidos: number }>('/api/practica/' + sesionId + '/responder', {
            method: 'POST',
            body: JSON.stringify({ ficha_id: datos.ficha?.id, respuesta: campo.value })
          })
            .then(function (resultado) {
              const penalizacion = resultado.alucinacion_detectada ? '<p class="error">⚠ Alucinación detectada: calidad limitada a 2 y penalización aplicada.</p>' : ''
              zona.innerHTML = [
                '<h2>Resultado</h2>',
                '<p>Calidad: <strong>' + String(resultado.puntuacion_calidad) + '/5</strong> · Puntos: <strong>' + String(resultado.puntos_obtenidos) + '</strong></p>',
                penalizacion,
                '<p>Explicación: ' + escapar(resultado.explicacion) + '</p>',
                '<p>Respuesta correcta: ' + escapar(resultado.respuesta_correcta) + '</p>',
                '<button id="siguiente">Siguiente</button>'
              ].join('')
              document.getElementById('siguiente')?.addEventListener('click', function () {
                responderYPreguntar(sesionId, datos.respondidas, datos.total)
              })
            })
            .catch(function (e: Error) {
              const error = document.getElementById('error-respuesta') as HTMLElement
              error.hidden = false
              error.textContent = e.message
            })
        })
      })
      .catch(function (e: Error) {
        zona.innerHTML = '<p class="error">' + escapar(e.message) + '</p>'
      })
  }

  function resumen(sesionId: string): void {
    apiFetch<{ puntos_obtenidos_total: number; respondidas: number; total: number; por_pregunta: Array<{ calidad: number; puntos: number }>; ranking: Array<{ nombre: string; puntosSesion: number; ganador: boolean }> | null }>('/api/practica/' + sesionId + '/resumen')
      .then(function (datos) {
        const detalle = datos.por_pregunta
          .map(function (r, i) {
            return '<li>Pregunta ' + String(i + 1) + ': calidad ' + String(r.calidad) + ' (' + String(r.puntos) + ' pts)</li>'
          })
          .join('')
        const ranking =
          datos.ranking !== null
            ? '<h3>Ranking de la sesión</h3><ol>' +
              datos.ranking
                .map(function (f) {
                  return '<li>' + escapar(f.nombre) + ': ' + String(f.puntosSesion) + ' pts' + (f.ganador ? ' 🏆 ganador' : '') + '</li>'
                })
                .join('') +
              '</ol>'
            : ''
        zona.innerHTML = [
          '<h2>Sesión completada</h2>',
          '<p>Puntaje total: <strong>' + String(datos.puntos_obtenidos_total) + '</strong> (' + String(datos.respondidas) + ' preguntas)</p>',
          '<ul>' + detalle + '</ul>',
          ranking,
          '<p><a href="#/perfil">Descargar mis fichas (.apkg)</a> · <a href="#/sala/' + salaId + '">Volver a la sala</a></p>'
        ].join('')
      })
      .catch(function (e: Error) {
        zona.innerHTML = '<p class="error">' + escapar(e.message) + '</p>'
      })
  }

  forma.addEventListener('submit', function (evento) {
    evento.preventDefault()
    const datos = new FormData(forma)
    const cuerpo: Record<string, unknown> = { sala_id: salaId }
    if (String(datos.get('tamano')) !== '') {
      cuerpo.tamano = Number(datos.get('tamano'))
    }
    apiFetch<{ sesion: { id: string }; total: number }>('/api/practica/iniciar', { method: 'POST', body: JSON.stringify(cuerpo) })
      .then(function (inicio) {
        responderYPreguntar(inicio.sesion.id, 0, inicio.total)
      })
      .catch(function (e: Error) {
        const error = document.getElementById('error-inicio') as HTMLElement
        error.hidden = false
        error.textContent = e.message
      })
  })
}
