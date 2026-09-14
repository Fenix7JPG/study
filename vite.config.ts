import { defineConfig } from 'vite'

// El frontend (interfaz) se compila con Vite desde src/client
// y se sirve como estáticos desde el backend en producción.
export default defineConfig({
  root: 'src/client',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true
  }
})
