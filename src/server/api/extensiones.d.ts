// Extensión de tipos de Express: el middleware JWT deja el id de cuenta
// autenticada en req.cuentaId (la identidad NUNCA se deduce del nombre).

declare global {
  namespace Express {
    interface Request {
      cuentaId?: string
    }
  }
}

export {}
