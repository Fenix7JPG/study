import { apiFetch, escapar, obtenerToken } from '../main'

// Perfil (T044): exportación de fichas a .apkg en cualquier momento
// (fuente §9/§6.8: disponible sin esperar fin de sesión).

interface SalaResumen {
  sala: { id: string; documentoId: string }
  documentoTitulo: string
  rol: 'administrador' | 'participante'
}

// Descarga binaria con el token: fetch directo → blob → enlace temporal
// (apiFetch parsea JSON; los .apkg son binarios)
function descargar(ruta: string, nombreArchivo: string): void {
  const token = obtenerToken()
  fetch(ruta, { headers: { Authorization: 'Bearer ' + (token ?? '') } })
    .then(function (respuesta) {
      if (!respuesta.ok) {
        return respuesta.json().then(function (datos) {
          throw new Error((datos as { error?: string }).error ?? 'Error al descargar')
        })
      }
      return respuesta.blob()
    })
    .then(function (blob) {
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = nombreArchivo
      enlace.click()
      URL.revokeObjectURL(url)
    })
    .catch(function (e: Error) {
      window.alert(e.message)
    })
}

export function renderPerfil(contenedor: HTMLElement): void {
  contenedor.innerHTML = '<h1>Mi perfil</h1><p>Cargando…</p>'

  apiFetch<{ salas: SalaResumen[] }>('/api/salas/mias')
    .then(function (datos) {
      const botones = datos.salas
        .map(function (entrada) {
          return [
            '<p>',
            '<strong>' + escapar(entrada.documentoTitulo) + '</strong> — ',
            '<button data-ruta="/api/export/apkg?documento_id=' + entrada.sala.documentoId + '" data-nombre="' + escapar(entrada.documentoTitulo) + '.apkg">Exportar este documento</button>',
            '</p>'
          ].join('')
        })
        .join('')

      const botonesBanco = datos.salas
        .filter(function (entrada) { return entrada.sala.documentoId !== null })
        .map(function (entrada) {
          return '<p><strong>' + escapar(entrada.documentoTitulo) + '</strong> — <button data-banco="' + entrada.sala.documentoId + '" data-nombre="' + escapar(entrada.documentoTitulo) + '.json">Descargar banco (.json)</button></p>'
        })
        .join('')

      contenedor.innerHTML = [
        '<h1>Mi perfil</h1>',
        '<h2>Exportar mis fichas</h2>',
        '<p><button id="banco-todas">Descargar banco personalizado (.zip de .json por documento)</button></p>',
        botonesBanco === '' ? '' : botonesBanco,
        '<p><button id="todas">Descargar TODAS mis fichas para Anki (.apkg, mazos por documento::sección)</button></p>',
        botones === '' ? '<p>Aún no tienes fichas: completa un dump o importa un banco.</p>' : botones,
        '<h2>Importar banco personalizado (.json o .zip)</h2>',
        '<form id="forma-importar-perfil">',
        '<label>Archivos <input type="file" id="archivos-banco" multiple accept=".json,.zip,.txt" /></label>',
        '<button type="submit">Importar banco</button>',
        '<p class="error" id="error-importar" hidden></p>',
        '</form>',
        '<div id="resultado-importar"></div>',
        '<p class="error" id="error-perfil" hidden></p>'
      ].join('')

      document.getElementById('todas')?.addEventListener('click', function () {
        descargar('/api/export/apkg/todas', 'todas-las-fichas.apkg')
      })
      contenedor.querySelectorAll('button[data-ruta]').forEach(function (boton) {
        const elemento = boton as HTMLButtonElement
        elemento.addEventListener('click', function () {
          descargar(elemento.dataset.ruta as string, elemento.dataset.nombre as string)
        })
      })
      contenedor.querySelectorAll('button[data-banco]').forEach(function (boton) {
        const elemento = boton as HTMLButtonElement
        elemento.addEventListener('click', function () {
          descargar('/api/export/banco?documento_id=' + elemento.dataset.banco, elemento.dataset.nombre as string)
        })
      })
      document.getElementById('banco-todas')?.addEventListener('click', function () {
        descargar('/api/export/banco/todas', 'banco-personalizado.zip')
      })

      const formaImportar = document.getElementById('forma-importar-perfil') as HTMLFormElement
      formaImportar.addEventListener('submit', function (evento) {
        evento.preventDefault()
        const entrada = document.getElementById('archivos-banco') as HTMLInputElement
        const error = document.getElementById('error-importar') as HTMLElement
        if (entrada.files === null || entrada.files.length === 0) {
          error.hidden = false
          error.textContent = 'Selecciona al menos un archivo .json o .zip'
          return
        }
        const datos = new FormData()
        for (const archivo of entrada.files) {
          datos.append('archivos', archivo)
        }
        fetch('/api/import/banco', { method: 'POST', headers: { Authorization: 'Bearer ' + (obtenerToken() ?? '') }, body: datos })
          .then(function (r) { return r.json() })
          .then(function (respuesta) {
            const zona = document.getElementById('resultado-importar') as HTMLElement
            const lineas = (respuesta.resultados as Array<{ archivo: string; creadas: number; actualizadas: number; rechazadas: Array<{ campo: string; motivo: string }> }>)
              .map(function (r) {
                return '<li><strong>' + escapar(r.archivo) + '</strong>: ' + String(r.creadas) + ' creadas, ' + String(r.actualizadas) + ' actualizadas' +
                  (r.rechazadas.length > 0 ? ' — RECHAZADAS: ' + r.rechazadas.map(function (x) { return escapar(x.campo + ': ' + x.motivo) }).join('; ') : '') + '</li>'
              })
              .join('')
            zona.innerHTML = '<ul>' + lineas + '</ul>'
          })
          .catch(function (e: Error) {
            error.hidden = false
            error.textContent = e.message
          })
      })
    })
    .catch(function (e: Error) {
      contenedor.innerHTML = '<h1>Mi perfil</h1><p class="error">' + escapar(e.message) + '</p>'
    })
}
