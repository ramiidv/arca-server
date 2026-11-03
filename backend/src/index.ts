import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';
import authRoutes from './routes/auth';
import invoiceRoutes from './routes/invoices';
import clientRoutes from './routes/clients';
import afipRoutes from './routes/afip';
import { ambienteArca, nombreAmbiente } from './services/arca.service';

// Mensajes de validación por defecto de Zod en español (los propios de cada schema ya lo están).
z.config(z.locales.es());

const app = express();

// Detrás de un proxy (nginx en Docker Compose) Express tiene que confiar en
// X-Forwarded-For para que el rate limit cuente por IP de cliente y no por la
// IP del proxy. Se configura con TRUST_PROXY (default: false, conexión directa).
app.set('trust proxy', config.trustProxy);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // El QR de las facturas es un link a https://www.arca.gob.ar/fe/qr/ (no se
      // carga como imagen): no hace falta permitir dominios externos.
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

app.use(cors({
  // CORS_ORIGIN: lista separada por comas. "*" permite cualquier origen (no recomendado).
  origin: config.corsOrigin.length === 1 && config.corsOrigin[0] === '*' ? '*' : config.corsOrigin,
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiadas solicitudes. Probá de nuevo en unos minutos.' },
});
app.use(limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos de autenticación. Probá de nuevo en unos minutos.' },
});

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check (public)
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    message: 'ARCA Server funcionando',
    timestamp: new Date().toISOString(),
  });
});

// Auth routes (login, registration-status y el primer registro son públicos; con
// usuarios existentes, register exige un admin). Tienen su propio rate limiter.
app.use('/api/auth', authLimiter, authRoutes);

// Protected routes — require JWT or API key
app.use('/api/invoices', authMiddleware, invoiceRoutes);
app.use('/api/clients', authMiddleware, clientRoutes);
app.use('/api/afip', authMiddleware, afipRoutes);

// Error handler (must be last)
app.use(errorHandler);

// Start server
app.listen(config.port, () => {
  console.log(`[Server] ARCA Server running on port ${config.port}`);
  console.log(`[Server] Ambiente de ARCA: ${nombreAmbiente(ambienteArca()).toUpperCase()}`);
});

export default app;
