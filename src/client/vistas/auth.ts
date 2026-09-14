import { guardarSesion, apiFetch, escapar } from '../main'

// Vistas de autenticación (T016): registro y login (fuente §3.1).

interface RespuestaAuth {
  token: string
  cuenta: { id: string; email: string; nombre: string }
}

export function renderLogin(contenedor: HTMLElement, alEntrar: () => void): void {
  contenedor.innerHTML = [
    '<h1>Iniciar sesión</h1>',
    '<form id="forma-login">',
    '<label>Email <input type="email" name="email" required /></label>',
    '<label>Contraseña <input type="password" name="contrasena" required /></label>',
    '<button type="submit">Entrar</button>',
    '<p class="error" id="error-login" hidden></p>',
    '</form>',
    '<p>¿No tienes cuenta? <a href="#/registro">Regístrate</a></p>'
  ].join('')

  const forma = document.getElementById('forma-login') as HTMLFormElement
  const error = document.getElementById('error-login') as HTMLElement
  forma.addEventListener('submit', function (evento) {
    evento.preventDefault()
    const datos = new FormData(forma)
    apiFetch<RespuestaAuth>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: String(datos.get('email')),
        contrasena: String(datos.get('contrasena'))
      })
    })
      .then(function (respuesta) {
        guardarSesion(respuesta.token, escapar(respuesta.cuenta.nombre))
        alEntrar()
      })
      .catch(function (e: Error) {
        error.hidden = false
        error.textContent = e.message
      })
  })
}

export function renderRegistro(contenedor: HTMLElement, alEntrar: () => void): void {
  contenedor.innerHTML = [
    '<h1>Crear cuenta</h1>',
    '<form id="forma-registro">',
    '<label>Nombre visible <input type="text" name="nombre" required /></label>',
    '<label>Email <input type="email" name="email" required /></label>',
    '<label>Contraseña (mínimo 8 caracteres) <input type="password" name="contrasena" minlength="8" required /></label>',
    '<button type="submit">Registrarme</button>',
    '<p class="error" id="error-registro" hidden></p>',
    '</form>',
    '<p>¿Ya tienes cuenta? <a href="#/salas">Inicia sesión</a></p>'
  ].join('')

  const forma = document.getElementById('forma-registro') as HTMLFormElement
  const error = document.getElementById('error-registro') as HTMLElement
  forma.addEventListener('submit', function (evento) {
    evento.preventDefault()
    const datos = new FormData(forma)
    apiFetch<RespuestaAuth>('/api/auth/registro', {
      method: 'POST',
      body: JSON.stringify({
        nombre: String(datos.get('nombre')),
        email: String(datos.get('email')),
        contrasena: String(datos.get('contrasena'))
      })
    })
      .then(function (respuesta) {
        guardarSesion(respuesta.token, escapar(respuesta.cuenta.nombre))
        alEntrar()
      })
      .catch(function (e: Error) {
        error.hidden = false
        error.textContent = e.message
      })
  })
}
