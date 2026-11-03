import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// ------------------------------------------------------------
// Rutas /api/auth y permisos de admin con authMiddleware real (JWT) y Prisma
// en memoria. Sin red ni base de datos.
// ------------------------------------------------------------

// Un archivo donde AFIP_CERT_PATH espera un directorio: guardar el certificado falla (ENOTDIR).
const noEsDirectorio = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'arca-auth-')), 'archivo');
  fs.writeFileSync(archivo, '');
  return archivo;
});

vi.mock('../src/config', () => ({
  config: {
    jwtSecret: 'secreto-de-test',
    jwtExpiresIn: '1h',
    afip: {
      cuit: '20123456786',
      certPath: `${noEsDirectorio}/cert.crt`,
      keyPath: `${noEsDirectorio}/key.key`,
      production: false,
      puntoVenta: 1,
      recoveryDelayMs: 0,
      ticketsDir: '/no/existe/tickets',
    },
  },
}));

const db = vi.hoisted(() => {
  const users = new Map<number, any>();
  let nextId = 1;
  let cola: Promise<unknown> = Promise.resolve();
  const publico = (u: any, select?: Record<string, boolean>) => {
    if (!u) return null;
    if (!select) return { ...u };
    return Object.fromEntries(Object.keys(select).map((k) => [k, u[k]]));
  };
  const prisma: any = {
    user: {
      count: async () => users.size,
      findUnique: async ({ where, select }: any) =>
        publico(
          where.id !== undefined ? users.get(where.id) : [...users.values()].find((u) => u.email === where.email),
          select,
        ),
      create: async ({ data, select }: any) => {
        const user = { id: nextId++, createdAt: new Date(), ...data };
        users.set(user.id, user);
        return publico(user, select);
      },
    },
    apiKey: {
      // Sin API keys en estos tests: X-API-Key siempre es inválida.
      findUnique: async () => null,
    },
    // Transacción interactiva: el callback recibe el mismo cliente en memoria. Las
    // transacciones corren de a una, como si fueran serializables.
    $transaction: (fn: (tx: any) => Promise<unknown>) => {
      const resultado = cola.then(() => fn(prisma));
      cola = resultado.catch(() => undefined);
      return resultado;
    },
  };
  return {
    prisma,
    users,
    reset() {
      users.clear();
      nextId = 1;
    },
  };
});

vi.mock('../src/lib/prisma', () => ({ prisma: db.prisma }));

const createCertificate = vi.hoisted(() => vi.fn());
const renewCertificate = vi.hoisted(() => vi.fn());
vi.mock('arca-cert', async (importOriginal) => ({
  ...(await importOriginal<typeof import('arca-cert')>()),
  createCertificate,
  renewCertificate,
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: authRoutes } = await import('../src/routes/auth');
  const { default: afipRoutes } = await import('../src/routes/afip');
  const { authMiddleware } = await import('../src/middleware/auth');
  const { errorHandler } = await import('../src/middleware/errorHandler');

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/afip', authMiddleware, afipRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(path.dirname(noEsDirectorio), { recursive: true, force: true });
});

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function api(pathname: string, init?: { method?: string; body?: unknown; token?: string }) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.token && { Authorization: `Bearer ${init.token}` }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const admin = { name: 'Admin', email: 'admin@example.com', password: 'clave-segura-1' };
const otro = { name: 'Usuario', email: 'usuario@example.com', password: 'clave-segura-2' };

/** Registra el primer usuario (admin) y devuelve su token. */
async function primerAdmin(): Promise<string> {
  const r = await api('/auth/register', { method: 'POST', body: admin });
  expect(r.status).toBe(201);
  return r.body.token;
}

/** Crea un usuario común con el admin y devuelve su token (login). */
async function usuarioComun(tokenAdmin: string): Promise<string> {
  expect((await api('/auth/register', { method: 'POST', body: otro, token: tokenAdmin })).status).toBe(201);
  const login = await api('/auth/login', { method: 'POST', body: { email: otro.email, password: otro.password } });
  expect(login.status).toBe(200);
  return login.body.token;
}

describe('registro cerrado después del primer usuario', () => {
  it('registration-status: abierto sin usuarios, cerrado después del primero', async () => {
    expect((await api('/auth/registration-status')).body).toEqual({ success: true, data: { open: true } });
    await primerAdmin();
    expect((await api('/auth/registration-status')).body).toEqual({ success: true, data: { open: false } });
  });

  it('el primer registro es público: crea un admin y devuelve token', async () => {
    const r = await api('/auth/register', { method: 'POST', body: { ...admin, role: 'user' } });
    expect(r.status).toBe(201);
    expect(r.body.token).toEqual(expect.any(String));
    // El primero es admin aunque pida otro rol.
    expect(r.body.user).toMatchObject({ email: admin.email, role: 'admin' });
    expect(r.body.user).not.toHaveProperty('password');
  });

  it('un segundo registro sin credenciales → 403 y no crea el usuario', async () => {
    await primerAdmin();
    const r = await api('/auth/register', { method: 'POST', body: otro });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/registro está cerrado/);
    expect(db.users.size).toBe(1);
  });

  it('un admin crea un usuario (con role): 201 sin token', async () => {
    const token = await primerAdmin();

    const comun = await api('/auth/register', { method: 'POST', body: otro, token });
    expect(comun.status).toBe(201);
    expect(comun.body).not.toHaveProperty('token');
    expect(comun.body.user).toMatchObject({ email: otro.email, role: 'user' });

    const otroAdmin = await api('/auth/register', {
      method: 'POST',
      body: { name: 'Admin 2', email: 'admin2@example.com', password: 'clave-segura-3', role: 'admin' },
      token,
    });
    expect(otroAdmin.status).toBe(201);
    expect(otroAdmin.body).not.toHaveProperty('token');
    expect(otroAdmin.body.user.role).toBe('admin');
  });

  it('un usuario no admin no puede crear usuarios → 403', async () => {
    const tokenAdmin = await primerAdmin();
    const tokenComun = await usuarioComun(tokenAdmin);

    const r = await api('/auth/register', {
      method: 'POST',
      body: { name: 'Tercero', email: 'tercero@example.com', password: 'clave-segura-4' },
      token: tokenComun,
    });
    expect(r.status).toBe(403);
    expect(db.users.size).toBe(2);
  });

  it('un token inválido al registrar con usuarios existentes → 401', async () => {
    await primerAdmin();
    expect((await api('/auth/register', { method: 'POST', body: otro, token: 'no-es-un-jwt' })).status).toBe(401);
  });

  it('dos registros simultáneos con la base vacía: solo uno crea el primer admin', async () => {
    const [a, b] = await Promise.all([
      api('/auth/register', { method: 'POST', body: admin }),
      api('/auth/register', { method: 'POST', body: otro }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 403]);
    expect(db.users.size).toBe(1);
    expect([...db.users.values()][0].role).toBe('admin');
  });

  it('email repetido → 409', async () => {
    const token = await primerAdmin();
    expect((await api('/auth/register', { method: 'POST', body: admin, token })).status).toBe(409);
  });
});

describe('operaciones de certificado solo para admin', () => {
  const pedido = { cuit: '20123456786', password: 'x', alias: 'test' };

  it('generate-cert y renew-cert con un usuario no admin → 403 sin llamar a arca-cert', async () => {
    const tokenComun = await usuarioComun(await primerAdmin());

    const gen = await api('/afip/generate-cert', { method: 'POST', body: pedido, token: tokenComun });
    const ren = await api('/afip/renew-cert', { method: 'POST', body: pedido, token: tokenComun });

    expect(gen.status).toBe(403);
    expect(ren.status).toBe(403);
    expect(gen.body.error).toMatch(/administrador/);
    expect(createCertificate).not.toHaveBeenCalled();
    expect(renewCertificate).not.toHaveBeenCalled();
  });

  it('sin credenciales → 401', async () => {
    expect((await api('/afip/generate-cert', { method: 'POST', body: pedido })).status).toBe(401);
  });

  it('un admin pasa el control de rol (llega a la validación del pedido)', async () => {
    const token = await primerAdmin();
    // Otro ambiente que el del server: 400 de la validación, no 403.
    const r = await api('/afip/generate-cert', { method: 'POST', body: { ...pedido, environment: 'production' }, token });
    expect(r.status).toBe(400);
    expect(createCertificate).not.toHaveBeenCalled();
  });

  it('si no se puede guardar el certificado → 500 con la causa, sin rutas del server', async () => {
    const token = await primerAdmin();
    createCertificate.mockResolvedValueOnce({ cert: 'contenido-del-cert', key: 'contenido-de-la-clave', alias: 'test', cuit: '20123456786', environment: 'testing' });

    const r = await api('/afip/generate-cert', { method: 'POST', body: pedido, token });

    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/No se pudo guardar el certificado: .*no es un directorio/);
    expect(r.body.error).toMatch(/ARCA ya emitió el certificado/);
    expect(r.body.error).not.toContain(noEsDirectorio);
    expect(JSON.stringify(r.body)).not.toMatch(/contenido-de/);
  });
});
