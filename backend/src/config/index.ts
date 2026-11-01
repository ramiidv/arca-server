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

export const config = {
  port: getEnvInt('PORT', 3001),
  databaseUrl: getEnv('DATABASE_URL'),
  jwtSecret: getEnv('JWT_SECRET'),
  jwtExpiresIn: getEnv('JWT_EXPIRES_IN', '7d'),
  afip: {
    cuit: getEnv('AFIP_CUIT', ''),
    certPath: getEnv('AFIP_CERT_PATH', path.resolve(__dirname, '../../certs/cert.crt')),
    keyPath: getEnv('AFIP_KEY_PATH', path.resolve(__dirname, '../../certs/key.key')),
    puntoVenta: getEnvInt('AFIP_PUNTO_VENTA', 1),
    production: getEnvBool('AFIP_PRODUCTION', false),
    // Espera antes de consultar a ARCA un comprobante con resultado incierto (ARCA puede seguir procesándolo)
    recoveryDelayMs: getEnvInt('AFIP_RECOVERY_DELAY_MS', 3000),
    // Directorio donde se persisten los Tickets de Acceso de WSAA (compartido por todos los SDKs)
    ticketsDir: path.resolve(getEnv('AFIP_TICKETS_DIR', path.resolve(__dirname, '../../certs/tickets'))),
  },
};

export default config;
