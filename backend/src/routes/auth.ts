import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { authMiddleware, adminMiddleware, AuthPayload } from '../middleware/auth';

const router = Router();

const registerSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'La contraseña tiene que tener al menos 8 caracteres'),
  name: z.string().min(2, 'El nombre tiene que tener al menos 2 caracteres'),
  // Solo lo usa un admin al crear usuarios (el primer usuario siempre es admin).
  role: z.enum(['user', 'admin']).optional(),
});

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'La contraseña es obligatoria'),
});

const apiKeySchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(100),
});

function generateToken(user: { id: number; email: string; role: string }): string {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role } as AuthPayload,
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as unknown as number }
  );
}

const REGISTRO_CERRADO = 'El registro está cerrado: solo un administrador puede crear usuarios.';

/** Hay usuarios: el registro público está cerrado. */
async function hayUsuarios(): Promise<boolean> {
  return (await prisma.user.count()) > 0;
}

// GET /api/auth/registration-status - Público: { open } (true solo si todavía no hay usuarios)
router.get('/registration-status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { open: !(await hayUsuarios()) } });
  } catch (err) {
    next(err);
  }
});

/**
 * Con usuarios existentes, /register exige un admin autenticado (JWT o API key).
 * Sin usuarios es público: así se crea el primer admin.
 */
async function registroPermitido(req: Request, res: Response, next: NextFunction) {
  try {
    if (!(await hayUsuarios())) {
      next();
      return;
    }
    if (!req.header('Authorization') && !req.header('X-API-Key')) {
      res.status(403).json({ success: false, error: REGISTRO_CERRADO });
      return;
    }
    authMiddleware(req, res, () => adminMiddleware(req, res, next));
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/register
// - Sin usuarios: público. Crea el primer usuario como admin y devuelve su token.
// - Con usuarios: solo un admin. Crea un usuario (role "user" o "admin") y NO devuelve token.
router.post('/register', registroPermitido, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name, role: rolPedido } = registerSchema.parse(req.body);

    const hashedPassword = await bcrypt.hash(password, 12);

    // El conteo y el alta van en una transacción serializable: dos registros
    // simultáneos con la base vacía no pueden crear dos admins "primeros".
    const resultado = await prisma.$transaction(
      async (tx) => {
        const primero = (await tx.user.count()) === 0;
        // Otro registro creó el primer usuario mientras tanto: sin admin, ya no se puede.
        if (!primero && req.user?.role !== 'admin') return 'cerrado' as const;
        const existing = await tx.user.findUnique({ where: { email } });
        if (existing) return null;
        const role = primero ? 'admin' : (rolPedido ?? 'user');
        const user = await tx.user.create({
          data: { email, password: hashedPassword, name, role },
          select: { id: true, email: true, name: true, role: true, createdAt: true },
        });
        return { user, primero };
      },
      { isolationLevel: 'Serializable' },
    );

    if (resultado === 'cerrado') {
      res.status(403).json({ success: false, error: REGISTRO_CERRADO });
      return;
    }
    if (!resultado) {
      res.status(409).json({ success: false, error: 'El email ya está registrado' });
      return;
    }

    const { user, primero } = resultado;
    if (!primero) {
      // Alta hecha por un admin: no se devuelve un token del usuario nuevo.
      res.status(201).json({ success: true, user });
      return;
    }

    const token = generateToken({ id: user.id, email: user.email, role: user.role });
    res.status(201).json({ success: true, token, user });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ success: false, error: 'Credenciales inválidas' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Credenciales inválidas' });
      return;
    }

    const token = generateToken({ id: user.id, email: user.email, role: user.role });

    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    if (!user) {
      res.status(404).json({ success: false, error: 'Usuario no encontrado' });
      return;
    }
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
});

// --- API Keys ---

// GET /api/auth/api-keys
router.get('/api-keys', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { userId: req.user!.userId },
      select: { id: true, name: true, keyHint: true, lastUsed: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, apiKeys: keys });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/api-keys
router.post('/api-keys', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = apiKeySchema.parse(req.body);

    const keyCount = await prisma.apiKey.count({ where: { userId: req.user!.userId } });
    if (keyCount >= 5) {
      res.status(400).json({ success: false, error: 'Máximo 5 API keys por usuario' });
      return;
    }

    const rawKey = `arca_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyHint = rawKey.slice(0, 12) + '...' + rawKey.slice(-4);

    const apiKey = await prisma.apiKey.create({
      data: { name, key: keyHash, keyHint, userId: req.user!.userId },
      select: { id: true, name: true, createdAt: true },
    });

    // Return the full key only on creation — it cannot be retrieved again
    res.status(201).json({ success: true, apiKey: { ...apiKey, key: rawKey } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/auth/api-keys/:id
router.delete('/api-keys/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'ID de API key inválido' });
      return;
    }
    const apiKey = await prisma.apiKey.findFirst({
      where: { id, userId: req.user!.userId },
    });
    if (!apiKey) {
      res.status(404).json({ success: false, error: 'API key no encontrada' });
      return;
    }
    await prisma.apiKey.delete({ where: { id } });
    res.json({ success: true, message: 'API key eliminada' });
  } catch (err) {
    next(err);
  }
});

export default router;
