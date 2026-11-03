import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// ------------------------------------------------------------
// Paginación y filtros de GET /api/invoices y GET /api/clients: valores
// inválidos o fuera de rango → 400 (no un skip negativo, un listado sin tope
// ni un filtro ignorado en silencio).
// ------------------------------------------------------------

const getInvoices = vi.hoisted(() => vi.fn());
vi.mock('../src/services/invoice.service', () => ({
  invoiceService: { getInvoices },
  RESULTADO: { APROBADA: 'A', PENDIENTE: 'P', CONFLICTO: 'C' },
}));

const findMany = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/prisma', () => ({
  prisma: { client: { findMany, count: async () => 0 } },
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: invoiceRoutes } = await import('../src/routes/invoices');
  const { default: clientRoutes } = await import('../src/routes/clients');
  const { errorHandler } = await import('../src/middleware/errorHandler');
  const app = express();
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/clients', clientRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  getInvoices.mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  findMany.mockResolvedValue([]);
});

async function get(pathname: string) {
  const res = await fetch(`${baseUrl}${pathname}`);
  return { status: res.status, body: await res.json() };
}

describe('GET /api/invoices', () => {
  it('sin query usa page 1 y limit 20', async () => {
    expect((await get('/invoices')).status).toBe(200);
    expect(getInvoices).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it('pasa los filtros convertidos a número', async () => {
    const r = await get('/invoices?page=2&limit=50&cbteTipo=6&clientId=7&resultado=P&from=20261101&to=20261130');
    expect(r.status).toBe(200);
    expect(getInvoices).toHaveBeenCalledWith({
      page: 2,
      limit: 50,
      cbteTipo: 6,
      clientId: 7,
      resultado: 'P',
      from: '20261101',
      to: '20261130',
    });
  });

  it.each([
    ['clientId=abc', 'clientId'],
    ['clientId=0', 'clientId'],
    ['page=0', 'page'],
    ['page=-1', 'page'],
    ['limit=1000', 'limit'],
    ['resultado=X', 'resultado'],
    ['from=2026-11-01', 'from'],
  ])('%s → 400', async (query, campo) => {
    const r = await get(`/invoices?${query}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain(campo);
    expect(getInvoices).not.toHaveBeenCalled();
  });
});

describe('GET /api/clients', () => {
  it('page y limit válidos → skip/take', async () => {
    const r = await get('/clients?page=3&limit=10');
    expect(r.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    expect(r.body.pagination).toEqual({ page: 3, limit: 10, total: 0, totalPages: 0 });
  });

  it.each(['page=abc', 'page=0', 'limit=0', 'limit=101'])('%s → 400', async (query) => {
    expect((await get(`/clients?${query}`)).status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });
});
