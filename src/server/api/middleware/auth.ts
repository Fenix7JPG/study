import type { NextFunction, Request, RequestHandler, Response } from 'express'
import jwt from 'jsonwebtoken'

// Middleware de autenticación (FR-004): valida el JWT del header
// `Authorization: Bearer <token>` en toda ruta que devuelve o modifica
// datos de una cuenta. Rechaza con 401 si falta, es inválido o expiró.

export function firmarToken(cuentaId: string, jwtSecret: string): string {
  // Expiración de 7 días fijada por la fuente §3.1
  return jwt.sign({ sub: cuentaId }, jwtSecret, { expiresIn: '7d' })
}

export function crearMiddlewareAuth(jwtSecret: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const encabezado = req.headers.authorization

    // Sin header o sin formato Bearer → 401
    if (!encabezado || !encabezado.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Falta el token de sesión (Authorization: Bearer <token>)' })
      return
    }

    const token = encabezado.slice('Bearer '.length).trim()

    try {
      const payload = jwt.verify(token, jwtSecret)
      // El sujeto del token es el id de la cuenta autenticada
      if (typeof payload === 'string' || typeof payload.sub !== 'string') {
        res.status(401).json({ error: 'Token inválido' })
        return
      }
      req.cuentaId = payload.sub
      next()
    } catch {
      // Firma inválida o token expirado
      res.status(401).json({ error: 'Token inválido o expirado' })
    }
  }
}
