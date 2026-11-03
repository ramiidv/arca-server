import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1';
}

function getEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer`);
  }
  return parsed;
}

/**
 * `TRUST_PROXY` → valor de `app.set('trust proxy', ...)` de Express. Sin definir,
 * vacío, `false` o `0`: no se confía en `X-Forwarded-For` (el server recibe las
 * conexiones directo). Detrás de un proxy (nginx en Docker Compose) usar `1`
 * (cantidad de saltos) para que el rate limit vea la IP real del cliente.
 * Acepta `true`, un número o una lista de IPs/subredes separadas por coma
 * (`loopback`, `10.0.0.0/8`...), que Express interpreta tal cual.
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string {
  const value = raw?.trim() ?? '';
  const lower = value.toLowerCase();
  if (lower === '' || lower === 'false' || lower === '0') return false;
  if (lower === 'true') return true;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value;
}

export const config = {
  port: getEnvInt('PORT', 3001),
  // Orígenes permitidos por CORS (separados por coma). Default: el dev server de Vite.
  corsOrigin: getEnv('CORS_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  databaseUrl: getEnv('DATABASE_URL'),
  jwtSecret: getEnv('JWT_SECRET'),
  jwtExpiresIn: getEnv('JWT_EXPIRES_IN', '7d'),
  afip: {
    cuit: getEnv('AFIP_CUIT', ''),
    // Certificado y clave: los leen los SDKs y los escriben /generate-cert y /renew-cert.
    // Rutas relativas: respecto del directorio desde el que se ejecuta el server.
    certPath: path.resolve(getEnv('AFIP_CERT_PATH', path.resolve(__dirname, '../../certs/cert.crt'))),
    keyPath: path.resolve(getEnv('AFIP_KEY_PATH', path.resolve(__dirname, '../../certs/key.key'))),
    puntoVenta: getEnvInt('AFIP_PUNTO_VENTA', 1),
    production: getEnvBool('AFIP_PRODUCTION', false),
    // Espera antes de consultar a ARCA un comprobante con resultado incierto (ARCA puede seguir procesándolo)
    recoveryDelayMs: getEnvInt('AFIP_RECOVERY_DELAY_MS', 3000),
    // Directorio donde se persisten los Tickets de Acceso de WSAA (compartido por todos los SDKs)
    ticketsDir: path.resolve(getEnv('AFIP_TICKETS_DIR', path.resolve(__dirname, '../../certs/tickets'))),
  },
};

export default config;
