import { defineConfig } from 'vitest/config'

// Configuración de pruebas: entorno node, variables de entorno de prueba
// cargadas antes de cualquier módulo (tests/helpers/entorno.ts).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/helpers/entorno.ts'],
    environment: 'node',
    testTimeout: 15000
  }
})
