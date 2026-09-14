// Variables de entorno para las pruebas: se fijan ANTES de que cualquier
// módulo valide la configuración. Ninguna credencial real aquí (research D6).

process.env.OPENROUTER_API_KEY = 'clave-de-prueba'
process.env.OPENROUTER_MODEL = 'modelo-de-prueba'
process.env.TURSO_DATABASE_URL = 'file:.tmp-tests/global.db'
process.env.TURSO_AUTH_TOKEN = 'token-de-prueba'
process.env.JWT_SECRET = 'secreto-de-prueba-para-tests'
process.env.NODE_ENV = 'test'
process.env.PORT = '0'
