import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { config } from '../config';

export interface AuthPayload {
  userId: number;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Check for API key first
  const apiKey = req.header('X-API-Key');
  if (apiKey) {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    prisma.apiKey
      .findUnique({ where: { key: keyHash }, include: { user: true } })
      .then((record) => {
        if (!record) {
          res.status(401).json({ success: false, error: 'API key inválida' });
          return;
        }
        req.user = { userId: record.user.id, email: record.user.email, role: record.user.role };
        prisma.apiKey.update({ where: { id: record.id }, data: { lastUsed: new Date() } }).catch(() => {});
        next();
      })
      .catch(() => {
        res.status(500).json({ success: false, error: 'Error de autenticación' });
      });
    return;
  }

  // Check for Bearer token
  const authHeader = req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Acceso denegado: falta el token (Authorization: Bearer <jwt>) o la API key (X-API-Key).' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Token inválido o vencido' });
  }
}

/**
 * Solo administradores (el primer usuario registrado, o los que cree un admin
 * con rol admin). Se usa después de `authMiddleware`. Con API key, el rol es el
 * del usuario dueño de la key.
 */
export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Esta operación requiere un usuario administrador' });
    return;
  }
  next();
}
