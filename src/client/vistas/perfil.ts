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

      contenedor.innerHTML = [
        '<h1>Mi perfil</h1>',
        '<h2>Exportar mis fichas a Anki (.apkg)</h2>',
        '<p><button id="todas">Descargar TODAS mis fichas (mazos por documento::sección)</button></p>',
        botones === '' ? '<p>Aún no tienes fichas: completa un dump para generarlas.</p>' : botones,
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
    })
    .catch(function (e: Error) {
      contenedor.innerHTML = '<h1>Mi perfil</h1><p class="error">' + escapar(e.message) + '</p>'
    })
}
