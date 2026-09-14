import { apiFetch, escapar } from '../main'

// Ciclo de dump (T028/T033): lectura temporizada → escritura temporizada con
// auto-envío al expirar → resultados (con botón de recalificar si la IA
// falló) → ronda 2 → completada. El servidor valida todas las ventanas;
// el temporizador aquí es solo visual (fuente §14).

interface EstadoFase {
  ronda: number
  fase: string
  faseIniciaEn: string
  faseTerminaEn: string
  recalificarDisponible?: boolean
}

interface Bloque {
  tipo: 'texto' | 'tabla'
  valor?: string
  encabezados?: string[]
  filas?: string[][]
}

let temporizador: number | undefined

function detenerTemporizador(): void {
  if (temporizador !== undefined) {
    clearInterval(temporizador)
    temporizador = undefined
  }
}

// Cuenta atrás visible; al llegar a cero ejecuta la acción de expiración
function iniciarCuentaAtras(terminaEn: string, alExpirar: () => void, etiqueta: HTMLElement): void {
  detenerTemporizador()
  function actualizar(): void {
    const restante = new Date(terminaEn).getTime() - Date.now()
    if (restante <= 0) {
      detenerTemporizador()
      alExpirar()
      return
    }
    const minutos = Math.floor(restante / 60000)
    const segundos = Math.floor((restante % 60000) / 1000)
    etiqueta.textContent = 'Tiempo restante: ' + String(minutos) + ':' + (segundos < 10 ? '0' : '') + String(segundos)
  }
  actualizar()
  temporizador = setInterval(actualizar, 500) as unknown as number
}

// Renderiza los bloques de contenido (texto con "valor" y tablas)
function renderizarBloques(bloques: Bloque[]): string {
  return bloques
    .map(function (bloque) {
      if (bloque.tipo === 'texto') {
        return '<p>' + escapar(bloque.valor ?? '') + '</p>'
      }
      const encabezados = '<tr>' + (bloque.encabezados ?? []).map(function (e) { return '<th>' + escapar(e) + '</th>' }).join('') + '</tr>'
      const filas = (bloque.filas ?? [])
        .map(function (fila) {
          return '<tr>' + fila.map(function (celda) { return '<td>' + escapar(celda) + '</td>' }).join('') + '</tr>'
        })
        .join('')
      return '<table><thead>' + encabezados + '</thead><tbody>' + filas + '</tbody></table>'
    })
    .join('')
}

export function renderDumpSeccion(contenedor: HTMLElement, seccionId: string): void {
  detenerTemporizador()
  contenedor.innerHTML = '<h1>Dump</h1><p>Cargando…</p><p><a href="#" id="volver">Volver a la sala</a></p>'

  function estado(): void {
    apiFetch<EstadoFase>('/api/secciones/' + seccionId + '/dump/iniciar', { method: 'POST' })
      .then(function (estadoFase) {
        dibujarFase(estadoFase)
      })
      .catch(function (e: Error) {
        if (e.message.indexOf('completada') >= 0) {
          dibujarCompletada()
        } else {
          contenedor.innerHTML = '<h1>Dump</h1><p class="error">' + escapar(e.message) + '</p>'
        }
      })
  }

  function dibujarCompletada(): void {
    detenerTemporizador()
    contenedor.innerHTML = [
      '<h1>Sección completada</h1>',
      '<p>Terminaste las dos rondas de esta sección. Tus fichas de repaso ya están listas.</p>',
      '<p><a href="#/seccion/' + seccionId + '/fichas">Ver mis fichas</a> · <a href="#" id="volver2">Volver a la sala</a></p>'
    ].join('')
    const volver = document.getElementById('volver2')
    if (volver) volver.addEventListener('click', function (e) { e.preventDefault(); history.back() })
  }

  function dibujarFase(estadoFase: EstadoFase): void {
    if (estadoFase.fase === 'completada') {
      dibujarCompletada()
      return
    }

    let html = '<h1>Ronda ' + String(estadoFase.ronda) + '</h1><p class="reloj" id="reloj"></p>'

    if (estadoFase.fase === 'lectura') {
      html += '<div id="zona"><p>Cargando contenido…</p></div>'
      contenedor.innerHTML = html + '<p><a href="#" id="volver">Volver a la sala</a></p>'
      const reloj = document.getElementById('reloj') as HTMLElement
      iniciarCuentaAtras(estadoFase.faseTerminaEn, estado, reloj)
      apiFetch<{ bloques: Bloque[] }>('/api/secciones/' + seccionId + '/contenido')
        .then(function (datos) {
          const zona = document.getElementById('zona')
          if (zona) zona.innerHTML = renderizarBloques(datos.bloques)
        })
        .catch(function (e: Error) {
          // La ventana expiró en medio: volver a consultar el estado
          void e
          estado()
        })
      return
    }

    if (estadoFase.fase === 'escritura') {
      html += [
        '<p>Escribe todo lo que recuerdas de la sección (sin consultar el contenido):</p>',
        '<form id="forma-dump">',
        '<textarea name="texto" rows="10" cols="80" placeholder="Escribe aquí tu dump…"></textarea>',
        '<br /><button type="submit">Enviar dump</button>',
        '<p class="error" id="error-dump" hidden></p>',
        '</form>'
      ].join('')
      contenedor.innerHTML = html + '<p><a href="#" id="volver">Volver a la sala</a></p>'
      const reloj = document.getElementById('reloj') as HTMLElement
      const forma = document.getElementById('forma-dump') as HTMLFormElement

      function enviar(texto: string): void {
        detenerTemporizador()
        apiFetch<{ fase: string; cobertura_porcentaje: number; puntos_obtenidos: number; errores: Array<{ id_concepto: string; descripcion_error: string }>; aviso_fichas?: string }>('/api/secciones/' + seccionId + '/dump/enviar', {
          method: 'POST',
          body: JSON.stringify({ texto: texto })
        })
          .then(function () {
            estado()
          })
          .catch(function (e: Error) {
            // IA caída → fase de recalificación con el texto guardado
            detenerTemporizador()
            contenedor.innerHTML = [
              '<h1>Ronda ' + String(estadoFase.ronda) + '</h1>',
              '<p class="error">' + escapar(e.message) + '</p>',
              '<p>Tu texto quedó guardado: puedes reintentar la calificación sin reescribirlo.</p>',
              '<button id="boton-recalificar">Reintentar calificación</button>'
            ].join('')
            document.getElementById('boton-recalificar')?.addEventListener('click', function () {
              apiFetch('/api/secciones/' + seccionId + '/dump/recalificar', { method: 'POST' })
                .then(function () {
                  estado()
                })
                .catch(function (e2: Error) {
                  contenedor.innerHTML = '<p class="error">' + escapar(e2.message) + '</p>'
                })
            })
            void forma
          })
      }

      // Bloqueo automático: al expirar se envía lo escrito (supuesto B3)
      iniciarCuentaAtras(estadoFase.faseTerminaEn, function () {
        const campo = forma.querySelector('textarea') as HTMLTextAreaElement
        enviar(campo.value)
      }, reloj)

      forma.addEventListener('submit', function (evento) {
        evento.preventDefault()
        const campo = forma.querySelector('textarea') as HTMLTextAreaElement
        enviar(campo.value)
      })
      return
    }

    if (estadoFase.fase === 'resultados') {
      contenedor.innerHTML = html + '<div id="zona"><p>Cargando resultados…</p></div><p><button id="continuar">Continuar</button></p>'
      const reloj = document.getElementById('reloj') as HTMLElement
      iniciarCuentaAtras(estadoFase.faseTerminaEn, estado, reloj)
      apiFetch<{ cobertura_porcentaje: number; conceptos_cubiertos: string[]; conceptos_faltantes: string[]; errores: Array<{ id_concepto: string; descripcion_error: string }>; puntos_obtenidos: number }>('/api/secciones/' + seccionId + '/dump/resultado/' + String(estadoFase.ronda))
        .then(function (resultado) {
          const zona = document.getElementById('zona')
          if (!zona) return
          const erroresHtml = resultado.errores
            .map(function (e) {
              return '<li><strong>' + escapar(e.id_concepto) + '</strong>: ' + escapar(e.descripcion_error) + ' (−5)</li>'
            })
            .join('')
          zona.innerHTML = [
            '<h2>Resultados</h2>',
            '<p>Cobertura: <strong>' + String(resultado.cobertura_porcentaje) + '%</strong></p>',
            '<p>Puntos obtenidos: <strong>' + String(resultado.puntos_obtenidos) + '</strong></p>',
            '<p>Conceptos cubiertos: ' + escapar(resultado.conceptos_cubiertos.join(', ') || 'ninguno') + '</p>',
            '<p>Conceptos faltantes: ' + escapar(resultado.conceptos_faltantes.join(', ') || 'ninguno') + '</p>',
            erroresHtml === '' ? '<p>Sin errores. ¡Bien!</p>' : '<ul>' + erroresHtml + '</ul>'
          ].join('')
        })
        .catch(function (e: Error) {
          const zona = document.getElementById('zona')
          if (zona) zona.innerHTML = '<p class="error">' + escapar(e.message) + '</p>'
        })
      document.getElementById('continuar')?.addEventListener('click', estado)
      return
    }

    // calificacion (fallo previo de IA): botón de reintento (FR-047)
    contenedor.innerHTML = [
      '<h1>Ronda ' + String(estadoFase.ronda) + '</h1>',
      '<p class="error">La calificación de IA falló, pero tu texto está guardado.</p>',
      '<button id="boton-recalificar">Reintentar calificación</button>'
    ].join('')
    document.getElementById('boton-recalificar')?.addEventListener('click', function () {
      apiFetch('/api/secciones/' + seccionId + '/dump/recalificar', { method: 'POST' })
        .then(function () {
          estado()
        })
        .catch(function (e: Error) {
          contenedor.innerHTML = '<p class="error">' + escapar(e.message) + '</p>'
        })
    })
  }

  estado()
  void escapar
}
