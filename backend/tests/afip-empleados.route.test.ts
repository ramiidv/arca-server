import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// Las rutas de /api/afip importan las instancias de los SDKs: se mockean para
// no leer certificados ni llamar a ARCA. Empleados no usa red (es el SDK real).
vi.mock('../src/services/arca.service', () => ({
  arca: {},
  padron: {},
  cdc: {},
  fecred: {},
  mtxca: {},
  sire: {},
  agro: {},
  reloadArca: vi.fn(),
}));

import afipRoutes from '../src/routes/afip';
import { errorHandler } from '../src/middleware/errorHandler';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/afip', afipRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/afip`;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const registros = [
  {
    tipo: 'alta',
    // "Ñ" es representable en ISO-8859-1 (0xD1): sirve para verificar la codificación.
    data: { cuil: '20-12345678-6', fechaInicio: '2026-11-02', modalidadContrato: 8, obraSocial: '126205', sucursal: 1, puesto: 'AÑO1' },
  },
  // fechaInicio (inicio del vínculo) es obligatoria en todos los movimientos (arca-empleados 0.5)
  { tipo: 'baja', data: { cuil: '20123456786', fechaInicio: '2020-03-01', fechaFin: '2026-10-31' } },
];

function post(query: string, body: unknown) {
  return fetch(`${baseUrl}/empleados-generar${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/afip/empleados-generar', () => {
  it('?formato=txt descarga el archivo en ISO-8859-1 con Content-Disposition', async () => {
    const res = await post('?formato=txt', { registros });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=ISO-8859-1');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="relaciones-laborales-\d{8}\.txt"$/);

    const bytes = Buffer.from(await res.arrayBuffer());
    const lineas = bytes.toString('latin1').split('\r\n').filter(Boolean);
    expect(lineas).toHaveLength(2);
    expect(lineas.every((l) => l.length === 130)).toBe(true);
    expect(lineas[0].startsWith('01AT')).toBe(true);
    expect(lineas[1].startsWith('01BT')).toBe(true);
    // Ñ en latin1 (un byte 0xD1), no en UTF-8 (0xC3 0x91)
    expect(bytes.includes(0xd1)).toBe(true);
    expect(bytes.includes(Buffer.from([0xc3, 0x91]))).toBe(false);
  });

  it('sin formato responde JSON con contenido, lineas, encoding y resumen (sin buffer)', async () => {
    const res = await post('', { registros });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.lineas).toHaveLength(2);
    expect(body.data.encoding).toBe('latin1');
    expect(body.data.resumen).toMatchObject({ totalRegistros: 2, altas: 1, bajas: 1 });
    expect(body.data).not.toHaveProperty('buffer');
  });

  it('novedad acepta cualquier código de movimiento', async () => {
    const res = await post('?formato=json', {
      registros: [{ tipo: 'novedad', data: { movimiento: 'NA', cuil: '20123456786', fechaInicio: '2020-03-01' } }],
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.lineas[0].startsWith('01NA')).toBe(true);
  });

  it('valida el request: registros vacío, tipo inválido o formato desconocido → 400', async () => {
    expect((await post('', { registros: [] })).status).toBe(400);
    expect((await post('', { registros: [{ tipo: 'cbu', data: {} }] })).status).toBe(400);
    expect((await post('?formato=pdf', { registros })).status).toBe(400);
    // Los tipos eliminados de la API vieja ya no existen
    expect((await post('', { cuitEmpleador: '20123456786', registros: [{ tipo: 'datosComplementarios', data: {} }] })).status).toBe(400);
  });

  it('baja sin fechaInicio → 400 (obligatoria en todos los movimientos)', async () => {
    const res = await post('', { registros: [{ tipo: 'baja', data: { cuil: '20123456786', fechaFin: '2026-10-31' } }] });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe('ARCA_VALIDATION_ERROR');
    expect(body.error).toMatch(/fechaInicio/);
  });

  it('propiedad desconocida (typo) → 400 en lugar de un campo vacío', async () => {
    const res = await post('', {
      registros: [{ tipo: 'alta', data: { ...registros[0].data, obraSocal: '126205' } }],
    });
    expect(res.status).toBe(400);
  });

  it('fechaReferencia: un alta con fechaInicio a más de 90 días se rechaza; válida si la referencia es cercana', async () => {
    const alta = { tipo: 'alta', data: { cuil: '20123456786', fechaInicio: '2027-06-01', modalidadContrato: 8, obraSocial: '126205', sucursal: 1 } };
    expect((await post('', { registros: [alta], fechaReferencia: '2026-11-01' })).status).toBe(400);
    expect((await post('', { registros: [alta], fechaReferencia: '2027-05-20' })).status).toBe(200);
    expect((await post('', { registros: [alta], fechaReferencia: 'mañana' })).status).toBe(400);
  });

  it('datos inválidos para el SDK → ArcaValidationError → 400 con details', async () => {
    const res = await post('?formato=txt', { registros: [{ tipo: 'alta', data: { cuil: '20123456789' } }] });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('ARCA_VALIDATION_ERROR');
    expect(Array.isArray(body.details)).toBe(true);
  });
});
