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
    '<p id="nota-modo">Cargando…</p>',
    '<form id="forma-inicio">',
    '<div id="zona-tamano">',
    '<label>Tamaño de la sesión (vacío = configurado en la sala) <input type="number" min="1" name="tamano" /></label>',
    '</div>',
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
          if (datos.sin_fichas_ahora) {
            zona.innerHTML = '<p>No hay fichas para repasar en este momento: vuelve cuando venza tu próximo repaso. La sesión sigue abierta hasta que el host la termine.</p><p><a href="#/sala/' + salaId + '">Volver a la sala</a></p>'
            return
          }
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
        detenerRankingEnVivo()
        zona.innerHTML = [
          '<h2>Sesión completada</h2>',
          '<p>Puntaje total: <strong>' + String(datos.puntos_obtenidos_total) + '</strong> (' + String(datos.respondidas) + ' preguntas)</p>',
          '<ul>' + detalle + '</ul>',
          ranking,
          '<p><button id="descargar-banco">Descargar banco personalizado (.zip)</button> · <a href="#/perfil">Exportar a Anki (.apkg)</a> · <a href="#/sala/' + salaId + '">Volver a la sala</a></p>'
        ].join('')
        document.getElementById('descargar-banco')?.addEventListener('click', function () {
          const token = localStorage.getItem('token_sesion') ?? ''
          fetch('/api/export/banco/todas', { headers: { Authorization: 'Bearer ' + token } })
            .then(function (r) { return r.blob() })
            .then(function (blob) {
              const url = URL.createObjectURL(blob)
              const enlace = document.createElement('a')
              enlace.href = url
              enlace.download = 'banco-personalizado.zip'
              enlace.click()
              URL.revokeObjectURL(url)
            })
        })
      })
      .catch(function (e: Error) {
        zona.innerHTML = '<p class="error">' + escapar(e.message) + '</p>'
      })
  }

  // Ranking EN VIVO (FR-116): consulta el ranking cada 10 s durante la sesión
  let temporizadorRanking: number | undefined
  function iniciarRankingEnVivo(): void {
    const zonaRanking = document.getElementById('zona-ranking')
    if (!zonaRanking) return
    temporizadorRanking = setInterval(function () {
      fetch('/api/salas/' + salaId + '/ranking', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('token_sesion') ?? '') } })
        .then(function (r) { return r.json() })
        .then(function (datos: { ranking: Array<{ nombre: string; puntosSesion: number; ganador: boolean }> | null }) {
          if (!zonaRanking) return
          if (datos.ranking === null) {
            zonaRanking.innerHTML = '<p class="ranking-vivo">Ranking: aún sin participantes recientes.</p>'
            return
          }
          zonaRanking.innerHTML = '<p class="ranking-vivo"><strong>Ranking en vivo:</strong> ' +
            datos.ranking.map(function (f) {
              return escapar(f.nombre) + ' ' + String(f.puntosSesion) + (f.ganador ? ' 🏆' : '')
            }).join(' · ') + '</p>'
        })
        .catch(function () { /* silencio: el siguiente tick reintenta */ })
    }, 10000) as unknown as number
  }
  function detenerRankingEnVivo(): void {
    if (temporizadorRanking !== undefined) {
      clearInterval(temporizadorRanking)
      temporizadorRanking = undefined
    }
  }

  // En dump la práctica es infinita (feature 004): sin tamaño; la cierra el host
  apiFetch<{ sala: { modo: 'dump' | 'multijugador' } }>('/api/salas/' + salaId)
    .then(function (detalle) {
      const zonaTamano = document.getElementById('zona-tamano') as HTMLElement
      const nota = document.getElementById('nota-modo') as HTMLElement
      if (detalle.sala.modo === 'dump') {
        zonaTamano.style.display = 'none'
        nota.textContent = 'Práctica continua: repasa hasta que el host termine la sesión.'
      } else {
        nota.textContent = 'Modo multijugador: tu cola termina al completar el tamaño elegido.'
      }
    })
    .catch(function () { /* la vista funciona igual sin la nota */ })

  forma.addEventListener('submit', function (evento) {
    evento.preventDefault()
    const datos = new FormData(forma)
    const cuerpo: Record<string, unknown> = { sala_id: salaId }
    if (String(datos.get('tamano')) !== '') {
      cuerpo.tamano = Number(datos.get('tamano'))
    }
    apiFetch<{ sesion: { id: string }; total: number }>('/api/practica/iniciar', { method: 'POST', body: JSON.stringify(cuerpo) })
      .then(function (inicio) {
        const zona = document.getElementById('zona') as HTMLElement
        zona.innerHTML += '<div id="zona-ranking"></div>'
        iniciarRankingEnVivo()
        responderYPreguntar(inicio.sesion.id, 0, inicio.total)
      })
      .catch(function (e: Error) {
        const error = document.getElementById('error-inicio') as HTMLElement
        error.hidden = false
        error.textContent = e.message
      })
  })
}
