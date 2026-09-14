import { renderLogin, renderRegistro } from './vistas/auth'
import { renderListaSalas, renderCrearSala, renderUnirse } from './vistas/salas'
import { renderSala } from './vistas/sala'
import { renderDumpSeccion } from './vistas/dump'
import { renderFichas } from './vistas/fichas'
import { renderPractica } from './vistas/practica'
import { renderPerfil } from './vistas/perfil'
import { renderRanking } from './vistas/ranking'

// Frontend base (T016): sesión con token en localStorage, helper de fetch con
// Bearer y manejo global de 401, y router por hash entre vistas.

const CLAVE_TOKEN = 'token_sesion'
const CLAVE_NOMBRE = 'nombre_visible'

export function obtenerToken(): string | null {
  return localStorage.getItem(CLAVE_TOKEN)
}

export function guardarSesion(token: string, nombre: string): void {
  localStorage.setItem(CLAVE_TOKEN, token)
  localStorage.setItem(CLAVE_NOMBRE, nombre)
}

export function cerrarSesion(): void {
  localStorage.removeItem(CLAVE_TOKEN)
  localStorage.removeItem(CLAVE_NOMBRE)
}

// Helper único de comunicación con la API: agrega el token y convierte
// errores del backend en excepciones con su mensaje.
export async function apiFetch<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const token = obtenerToken()
  const encabezados: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    encabezados['Authorization'] = 'Bearer ' + token
  }
  const respuesta = await fetch(ruta, { ...opciones, headers: encabezados })
  const datos = (await respuesta.json()) as { error?: string }

  // 401 global: la sesión terminó → volver al login
  if (respuesta.status === 401) {
    cerrarSesion()
    enrutar()
    throw new Error('Tu sesión terminó. Vuelve a iniciar sesión.')
  }
  if (!respuesta.ok) {
    throw new Error(datos.error ?? 'Error ' + String(respuesta.status))
  }
  return datos as T
}

// Navega y dibuja el marco (nav) + la vista correspondiente al hash
export function enrutar(): void {
  const app = document.getElementById('app')
  if (!app) return

  const hash = location.hash || '#/salas'
  const partes = hash.split('/')  // p. ej. '#/sala/ID' → ['#/sala', 'ID']
  const sesionIniciada = obtenerToken() !== null

  if (!sesionIniciada) {
    if (hash === '#/registro') {
      renderRegistro(app, irASalas)
    } else {
      renderLogin(app, irASalas)
    }
    return
  }

  const nombre = localStorage.getItem(CLAVE_NOMBRE) ?? ''
  const nav = dibujarNav(nombre)

  function montar(dibujar: (zona: HTMLElement) => void): void {
    app.innerHTML = nav + '<section id="vista"></section>'
    dibujar(document.getElementById('vista') as HTMLElement)
  }

  // Rutas simples
  if (partes[0] === '#/crear-sala') { montar(function (z) { renderCrearSala(z, irASalas) }); return }
  if (partes[0] === '#/unirse') { montar(function (z) { renderUnirse(z, irASalas) }); return }
  if (partes[0] === '#/perfil') { montar(renderPerfil); return }
  if (partes[0] === '#/salir') { cerrarSesion(); enrutar(); return }

  // Rutas con parámetro: #/sala/ID, #/seccion/ID, #/seccion/ID/fichas,
  // #/practica/SALAID, #/ranking/SALAID
  if (partes[0] === '#/sala' && partes[1]) { montar(function (z) { renderSala(z, partes[1]) }); return }
  if (partes[0] === '#/practica' && partes[1]) { montar(function (z) { renderPractica(z, partes[1]) }); return }
  if (partes[0] === '#/ranking' && partes[1]) { montar(function (z) { renderRanking(z, partes[1]) }); return }
  if (partes[0] === '#/seccion' && partes[1]) {
    if (partes[2] === 'fichas') { montar(function (z) { renderFichas(z, partes[1]) }); return }
    montar(function (z) { renderDumpSeccion(z, partes[1]) })
    return
  }

  // Por defecto: listado de salas
  montar(function (z) { renderListaSalas(z, irASalas) })
}

function irASalas(): void {
  location.hash = '#/salas'
  enrutar()
}

function dibujarNav(nombre: string): string {
  return [
    '<nav>',
    '<strong>Dump + Repaso Espaciado</strong>',
    '<span class="usuario">' + escapar(nombre) + '</span>',
    '<a href="#/salas">Mis salas</a>',
    '<a href="#/crear-sala">Crear sala</a>',
    '<a href="#/unirse">Unirse</a>',
    '<a href="#/perfil">Perfil / Exportar</a>',
    '<a href="#/salir">Salir</a>',
    '</nav>'
  ].join('')
}

// Escapa texto para insertarlo en HTML sin riesgo
export function escapar(texto: string): string {
  const div = document.createElement('div')
  div.textContent = texto
  return div.innerHTML
}

window.addEventListener('hashchange', enrutar)
enrutar()
