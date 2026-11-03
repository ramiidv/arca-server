import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ArcaAuthError,
  ArcaRechazoError,
  ArcaResultadoIncierto,
  ArcaWSFEError,
  armarComprobante,
  CbteTipo,
} from '@ramiidv/arca-facturacion';
import type { FacturaResult, IntentoComprobante } from '@ramiidv/arca-facturacion';

// ------------------------------------------------------------
// Mocks: config, Prisma (en memoria) y el SDK de facturación
// ------------------------------------------------------------

vi.mock('../src/config', () => ({
  config: { afip: { cuit: '20123456786', recoveryDelayMs: 0, puntoVenta: 1, production: false } },
}));

const db = vi.hoisted(() => {
  const invoices = new Map<number, any>();
  const clients = new Map<number, any>();
  let nextId = 1;
  const conInclude = (inv: any) => (inv ? { ...inv, client: inv.clientId ? clients.get(inv.clientId) ?? null : null } : null);
  /** Subconjunto de los filtros de Prisma que usa el servicio: igualdad, `in`, `gte`/`lte`. */
  const cumple = (i: any, where: any = {}) =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object') {
        if ('in' in v) return v.in.includes(i[k]);
        return (v.gte === undefined || i[k] >= v.gte) && (v.lte === undefined || i[k] <= v.lte);
      }
      return i[k] === v;
    });
  const filtrar = (where: any) => [...invoices.values()].filter((i) => cumple(i, where));
  const prisma = {
    invoice: {
      findFirst: async ({ where }: any) => filtrar(where)[0] ?? null,
      count: async ({ where }: any) => filtrar(where).length,
      groupBy: async ({ where }: any) => {
        const grupos = new Map<number, { cbteTipo: number; _count: { id: number }; _sum: { impTotal: number } }>();
        for (const i of filtrar(where)) {
          const g = grupos.get(i.cbteTipo) ?? { cbteTipo: i.cbteTipo, _count: { id: 0 }, _sum: { impTotal: 0 } };
          g._count.id += 1;
          g._sum.impTotal += Number(i.impTotal);
          grupos.set(i.cbteTipo, g);
        }
        return [...grupos.values()];
      },
      findUnique: async ({ where }: any) => conInclude(invoices.get(where.id)),
      create: async ({ data }: any) => {
        for (const i of invoices.values()) {
          if (i.cbteTipo === data.cbteTipo && i.puntoVenta === data.puntoVenta && i.cbteNro === data.cbteNro) {
            throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
          }
        }
        const id = nextId++;
        const { items, ...rest } = data;
        const inv = { id, ...rest, items: items?.create ?? [] };
        invoices.set(id, inv);
        return conInclude(inv);
      },
      update: async ({ where, data }: any) => {
        const inv = invoices.get(where.id);
        if (!inv) throw new Error('Record not found');
        Object.assign(inv, data);
        return conInclude(inv);
      },
      delete: async ({ where }: any) => {
        const inv = invoices.get(where.id);
        invoices.delete(where.id);
        return inv;
      },
    },
    client: {
      findUnique: async ({ where }: any) => clients.get(where.id) ?? null,
    },
  };
  return {
    prisma,
    invoices,
    clients,
    reset() {
      invoices.clear();
      clients.clear();
      nextId = 1;
    },
  };
});

vi.mock('../src/lib/prisma', () => ({ prisma: db.prisma }));

const arcaMock = vi.hoisted(() => ({
  ultimoComprobante: vi.fn(),
  armarComprobante: vi.fn(),
  facturar: vi.fn(),
  notaCredito: vi.fn(),
  notaDebito: vi.fn(),
  recuperarComprobante: vi.fn(),
  urlQR: vi.fn(),
  wsaa: { now: () => new Date('2026-11-01T15:00:00Z') },
}));

vi.mock('../src/services/arca.service', () => ({ arca: arcaMock }));

import { invoiceService, RESULTADO } from '../src/services/invoice.service';
import { AppError } from '../src/middleware/errorHandler';

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

const HOY = '20261101';
const CAE = '73429843294823';

function aprobada(intento: IntentoComprobante, extra: Partial<FacturaResult> = {}): FacturaResult {
  return {
    cae: CAE,
    caeVencimiento: '20261111',
    cbteNro: intento.cbteNro,
    ptoVta: intento.ptoVta,
    cbteTipo: intento.cbteTipo,
    importes: { total: intento.importeTotal, neto: 1000, iva: 210, exento: 0, noGravado: 0, tributos: 0 },
    observaciones: [],
    eventos: [],
    fecha: intento.fecha,
    docTipo: intento.docTipo,
    docNro: intento.docNro,
    moneda: 'PES',
    cotizacion: 1,
    tipoCodAut: 'E',
    raw: {} as FacturaResult['raw'],
    ...extra,
  };
}

const facturaB = {
  cbteTipo: CbteTipo.FACTURA_B,
  docTipo: 99,
  docNro: '0',
  concepto: 1,
  puntoVenta: 1,
  items: [{ description: 'Producto', quantity: 1, unitPrice: 1000, ivaId: 5 }],
};

/** Intento esperado para la factura B de prueba con número `nro`. */
function intentoDe(nro: number): IntentoComprobante {
  return { ptoVta: 1, cbteTipo: CbteTipo.FACTURA_B, cbteNro: nro, importeTotal: 1210, docTipo: 99, docNro: 0, fecha: HOY };
}

function incierto(nro: number) {
  return new ArcaResultadoIncierto('FECAESolicitar', [intentoDe(nro)], { cause: new Error('timeout') });
}

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  arcaMock.ultimoComprobante.mockResolvedValue(41);
  // armarComprobante real del SDK: valida y arma el intento sin red.
  arcaMock.armarComprobante.mockImplementation((opts: any) => armarComprobante(opts));
  arcaMock.urlQR.mockReturnValue('https://www.arca.gob.ar/fe/qr/?p=xxx');
});

// ------------------------------------------------------------
// Tests
// ------------------------------------------------------------

describe('invoice.service: emisión', () => {
  it('reserva el número, fija la fecha y guarda la factura aprobada con QR', async () => {
    arcaMock.facturar.mockImplementation(async (opts: any) => aprobada(intentoDe(opts.cbteNro)));

    const { invoice, afipResponse } = await invoiceService.createInvoice(facturaB);

    expect(arcaMock.facturar).toHaveBeenCalledTimes(1);
    expect(arcaMock.facturar.mock.calls[0][0]).toMatchObject({ cbteNro: 42, fecha: HOY, ptoVta: 1, cbteTipo: 6 });
    expect(invoice).toMatchObject({ cbteNro: 42, cbteFch: HOY, resultado: RESULTADO.APROBADA, cae: CAE });
    expect(invoice.qrUrl).toContain('arca.gob.ar/fe/qr');
    expect(arcaMock.urlQR).toHaveBeenCalledWith(expect.objectContaining({ cae: CAE, cbteNro: 42 }));
    expect(afipResponse.resultado).toBe('A');
    expect((invoice.emision as any).estado).toBe('autorizado');
  });

  it('guarda el intento ANTES de enviar (la factura existe como pendiente durante el envío)', async () => {
    let durante: any;
    arcaMock.facturar.mockImplementation(async (opts: any) => {
      const inv = [...db.invoices.values()][0];
      durante = { resultado: inv.resultado, emision: structuredClone(inv.emision) };
      return aprobada(intentoDe(opts.cbteNro));
    });

    await invoiceService.createInvoice(facturaB);

    expect(durante.resultado).toBe(RESULTADO.PENDIENTE);
    expect(durante.emision).toMatchObject({ estado: 'enviando', operacion: 'facturar', intento: intentoDe(42) });
  });

  it('un rechazo de ARCA (ArcaWSFEError) no deja la factura guardada', async () => {
    arcaMock.facturar.mockRejectedValue(new ArcaWSFEError([{ code: 10015, msg: 'DocNro inválido' }]));

    await expect(invoiceService.createInvoice(facturaB)).rejects.toBeInstanceOf(ArcaWSFEError);
    expect(db.invoices.size).toBe(0);
  });

  it('un ArcaAuthError (600/601 o login WSAA) en el primer envío no deja la factura guardada', async () => {
    const cause = new ArcaWSFEError([{ code: 600, msg: 'ValidacionDeToken: No aparecio CUIT en lista de relaciones' }]);
    arcaMock.facturar.mockRejectedValue(new ArcaAuthError('ticket rechazado', { cause, faultCode: '600' }));

    await expect(invoiceService.createInvoice(facturaB)).rejects.toBeInstanceOf(ArcaAuthError);
    expect(db.invoices.size).toBe(0);
  });

  it('consumidor final (docTipo 99) sin condicionIva: el SDK completa 5', async () => {
    arcaMock.facturar.mockImplementation(async (opts: any) => aprobada(intentoDe(opts.cbteNro)));
    await invoiceService.createInvoice(facturaB);

    expect(arcaMock.facturar.mock.calls[0][0]).not.toHaveProperty('condicionIva');
    const { request } = armarComprobante(arcaMock.armarComprobante.mock.calls[0][0]);
    expect(request.condicionIvaReceptorId).toBe(5);
  });

  it('un rechazo (ArcaRechazoError) no deja la factura guardada', async () => {
    arcaMock.facturar.mockRejectedValue(
      new ArcaRechazoError('FECAESolicitar: ARCA rechazó el comprobante', {
        operacion: 'FECAESolicitar',
        observaciones: [{ code: 10048, msg: 'Importe inválido' }],
      }),
    );

    const error = await invoiceService.createInvoice(facturaB).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    // Mismo status que un ArcaWSFEError (422), en español y con las observaciones de ARCA.
    expect(error.statusCode).toBe(422);
    expect(error.message).toBe('ARCA rechazó el comprobante: 10048: Importe inválido');
    expect(error.errors).toEqual([{ code: 10048, msg: 'Importe inválido' }]);
    expect(db.invoices.size).toBe(0);
  });

  it('sin concepto usa 1 (Productos), como la UI, y no envía fechas de servicio', async () => {
    arcaMock.facturar.mockImplementation(async (opts: any) => aprobada(intentoDe(opts.cbteNro)));
    const { concepto: _omitido, ...sinConcepto } = facturaB;

    const { invoice } = await invoiceService.createInvoice({
      ...sinConcepto,
      fchServDesde: '20261001',
      fchServHasta: '20261031',
    });

    const enviado = arcaMock.facturar.mock.calls[0][0];
    expect(enviado.concepto).toBe(1);
    expect(enviado).not.toHaveProperty('servicio');
    expect(invoice).toMatchObject({ concepto: 1, fchServDesde: undefined, fchServHasta: undefined });
  });

  it('concepto 2 (Servicios) envía el período de servicio', async () => {
    arcaMock.facturar.mockImplementation(async (opts: any) => aprobada(intentoDe(opts.cbteNro)));

    await invoiceService.createInvoice({ ...facturaB, concepto: 2, fchServDesde: '20261001', fchServHasta: '20261031' });

    expect(arcaMock.facturar.mock.calls[0][0].servicio).toEqual({ desde: '20261001', hasta: '20261031', vtoPago: HOY });
  });
});

describe('invoice.service: estadísticas del dashboard', () => {
  function guardar(cbteTipo: number, impTotal: number, cbteFch: string, resultado: string = RESULTADO.APROBADA) {
    const id = db.invoices.size + 100;
    db.invoices.set(id, { id, cbteTipo, impTotal, cbteFch, resultado, clientId: null });
  }

  it('cuenta los comprobantes del mes (Argentina) y resta las notas de crédito en los montos', async () => {
    guardar(CbteTipo.FACTURA_B, 1210, '20261101');
    guardar(CbteTipo.FACTURA_A, 2420, '20261115');
    guardar(CbteTipo.NOTA_CREDITO_B, 210, '20261120');
    guardar(CbteTipo.NOTA_DEBITO_B, 100, '20261030'); // mes anterior
    guardar(CbteTipo.FACTURA_C, 5000, '20261105', RESULTADO.PENDIENTE); // no cuenta

    const stats = await invoiceService.getInvoiceStats(new Date('2026-11-25T15:00:00Z'));

    expect(stats.totalCount).toBe(4);
    // Las cantidades separan facturas de NC/ND (coherente con "Monto Total (neto de NC)").
    expect(stats.invoiceCount).toBe(2);
    expect(stats.creditNoteCount).toBe(1);
    expect(stats.debitNoteCount).toBe(1);
    expect(stats.pendingCount).toBe(1);
    expect(stats.totalAmount).toBe(1210 + 2420 - 210 + 100);
    expect(stats.monthlyInvoices).toBe(2);
    expect(stats.monthlyCreditNotes).toBe(1);
    expect(stats.monthlyDebitNotes).toBe(0);
    expect(stats.monthlyAmount).toBe(1210 + 2420 - 210);
  });

  it('el mes se toma con la fecha calendario de Argentina', async () => {
    guardar(CbteTipo.FACTURA_B, 1000, '20261031');
    guardar(CbteTipo.FACTURA_B, 500, '20261101');

    // 2026-11-01T01:00Z = 31/10 22:00 en Argentina → mes de octubre.
    const stats = await invoiceService.getInvoiceStats(new Date('2026-11-01T01:00:00Z'));

    expect(stats.monthlyInvoices).toBe(1);
    expect(stats.monthlyAmount).toBe(1000);
  });
});

describe('invoice.service: resultado incierto → recuperar', () => {
  it('incierto y recuperado como autorizado → se persiste aprobada con el CAE recuperado', async () => {
    arcaMock.facturar.mockRejectedValue(incierto(42));
    arcaMock.recuperarComprobante.mockImplementation(async (intento: IntentoComprobante) => ({
      estado: 'autorizado',
      resultado: aprobada(intento),
    }));

    const { invoice, afipResponse } = await invoiceService.createInvoice(facturaB);

    expect(arcaMock.recuperarComprobante).toHaveBeenCalledWith(intentoDe(42));
    expect(arcaMock.facturar).toHaveBeenCalledTimes(1); // nunca se reenvía sin recuperar
    expect(invoice).toMatchObject({ resultado: 'A', cae: CAE });
    expect(afipResponse.resultado).toBe('A');
  });

  it('incierto y no emitido → se reenvía UNA vez con el mismo número y la misma fecha', async () => {
    arcaMock.facturar
      .mockRejectedValueOnce(incierto(42))
      .mockImplementationOnce(async (opts: any) => aprobada(intentoDe(opts.cbteNro)));
    arcaMock.recuperarComprobante.mockResolvedValue({ estado: 'no_emitido' });

    const { invoice } = await invoiceService.createInvoice(facturaB);

    expect(arcaMock.facturar).toHaveBeenCalledTimes(2);
    const [primero, reenvio] = arcaMock.facturar.mock.calls.map((c) => c[0]);
    expect(reenvio).toEqual(primero);
    expect(reenvio).toMatchObject({ cbteNro: 42, fecha: HOY });
    expect(arcaMock.ultimoComprobante).toHaveBeenCalledTimes(1); // no se pidió otro número
    expect(invoice.resultado).toBe('A');
    expect((invoice.emision as any).envios).toBe(2);
  });

  it('sigue incierto (no se pudo consultar) → queda pendiente, NO rechazada, y se recupera después', async () => {
    arcaMock.facturar.mockRejectedValue(incierto(42));
    arcaMock.recuperarComprobante.mockRejectedValueOnce(new Error('ECONNRESET'));

    const creada = await invoiceService.createInvoice(facturaB);

    expect(creada.invoice).toMatchObject({ resultado: RESULTADO.PENDIENTE, cae: null, cbteNro: 42 });
    expect(creada.afipResponse).toMatchObject({ pendiente: true, intento: intentoDe(42) });
    expect(db.invoices.size).toBe(1);

    // Más tarde: POST /invoices/:id/recuperar
    arcaMock.recuperarComprobante.mockImplementation(async (intento: IntentoComprobante) => ({
      estado: 'autorizado',
      resultado: aprobada(intento),
    }));
    const recuperada = await invoiceService.recuperarFactura(creada.invoice.id);

    expect(recuperada.invoice).toMatchObject({ resultado: 'A', cae: CAE });
    expect(arcaMock.recuperarComprobante).toHaveBeenLastCalledWith(intentoDe(42));
  });

  it('el 10016 por número (requiereRecuperacion) se trata como incierto', async () => {
    const msg = 'El numero o fecha del comprobante no se corresponde con el proximo a autorizar';
    arcaMock.facturar.mockRejectedValue(
      new ArcaRechazoError(msg, { operacion: 'FECAESolicitar', observaciones: [{ code: 10016, msg }] }),
    );
    arcaMock.recuperarComprobante.mockImplementation(async (intento: IntentoComprobante) => ({
      estado: 'autorizado',
      resultado: aprobada(intento),
    }));

    const { invoice } = await invoiceService.createInvoice(facturaB);

    expect(arcaMock.recuperarComprobante).toHaveBeenCalled();
    expect(invoice.resultado).toBe('A');
  });

  it('recuperarComprobante lo encuentra rechazado (ArcaRechazoError) → rechazo, no queda guardada', async () => {
    arcaMock.facturar.mockRejectedValue(incierto(42));
    arcaMock.recuperarComprobante.mockRejectedValue(
      new ArcaRechazoError('FECompConsultar: ARCA rechazó el comprobante 6-1-42', {
        operacion: 'FECompConsultar',
        observaciones: [{ code: 10048, msg: 'Importe inválido' }],
      }),
    );

    const error = await invoiceService.createInvoice(facturaB).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(422);
    expect(error.message).toBe('ARCA rechazó el comprobante: 10048: Importe inválido');
    expect(error.errors).toEqual([{ code: 10048, msg: 'Importe inválido' }]);
    expect(arcaMock.facturar).toHaveBeenCalledTimes(1);
    expect(db.invoices.size).toBe(0);
  });

  it('POST /:id/recuperar: recuperarComprobante lo encuentra rechazado → se borra el pendiente y responde 422', async () => {
    arcaMock.facturar.mockRejectedValue(incierto(42));
    arcaMock.recuperarComprobante.mockRejectedValueOnce(new Error('ECONNRESET'));
    const { invoice } = await invoiceService.createInvoice(facturaB);
    expect(db.invoices.size).toBe(1);

    arcaMock.recuperarComprobante.mockRejectedValue(
      new ArcaRechazoError('FECompConsultar: ARCA rechazó el comprobante 6-1-42', {
        operacion: 'FECompConsultar',
        observaciones: [{ code: 10048, msg: 'Importe inválido' }],
      }),
    );

    await expect(invoiceService.recuperarFactura(invoice.id)).rejects.toMatchObject({
      statusCode: 422,
      message: 'ARCA rechazó el comprobante: 10048: Importe inválido',
    });
    expect(arcaMock.facturar).toHaveBeenCalledTimes(1); // no se reenvía
    expect(db.invoices.size).toBe(0);
  });

  it('el 10016 por número como ArcaWSFEError (requiereRecuperacion) también se trata como incierto', async () => {
    arcaMock.facturar.mockRejectedValue(
      new ArcaWSFEError([{ code: 10016, msg: 'El numero o fecha del comprobante no se corresponde con el proximo a autorizar' }]),
    );
    arcaMock.recuperarComprobante.mockImplementation(async (intento: IntentoComprobante) => ({
      estado: 'autorizado',
      resultado: aprobada(intento),
    }));

    const { invoice } = await invoiceService.createInvoice(facturaB);

    expect(arcaMock.recuperarComprobante).toHaveBeenCalled();
    expect(invoice.resultado).toBe('A');
  });

  it('conflicto (el número existe con otros datos) → resultado C para revisión manual', async () => {
    arcaMock.facturar.mockRejectedValue(incierto(42));
    arcaMock.recuperarComprobante.mockResolvedValue({
      estado: 'conflicto',
      encontrado: { resultGet: { cbteFch: HOY, impTotal: 999, docTipo: 80, docNro: 30712345671, codAutorizacion: '1' } },
    });

    const { invoice, afipResponse } = await invoiceService.createInvoice(facturaB);

    expect(invoice.resultado).toBe(RESULTADO.CONFLICTO);
    expect(afipResponse).toMatchObject({ conflicto: true, pendiente: false });
    expect((invoice.emision as any).encontrado).toEqual({
      cbteFch: HOY,
      impTotal: 999,
      docTipo: 80,
      docNro: 30712345671,
      codAutorizacion: '1',
    });
  });

  it('no emitido y el reenvío es rechazado → se borra el pendiente (no se emitió) y responde 422', async () => {
    arcaMock.facturar.mockRejectedValue(incierto(42));
    arcaMock.recuperarComprobante.mockRejectedValueOnce(new Error('ECONNRESET'));
    const { invoice } = await invoiceService.createInvoice(facturaB);

    arcaMock.recuperarComprobante.mockResolvedValue({ estado: 'no_emitido' });
    arcaMock.facturar.mockRejectedValue(new ArcaWSFEError([{ code: 10016, msg: 'CbteFch fuera de rango' }]));

    await expect(invoiceService.recuperarFactura(invoice.id)).rejects.toMatchObject({ statusCode: 422 });
    expect(db.invoices.size).toBe(0);
  });

  it('no emitido y el reenvío es rechazado con resultado R (ArcaRechazoError) → se borra el pendiente y responde 422', async () => {
    arcaMock.facturar.mockRejectedValue(incierto(42));
    arcaMock.recuperarComprobante.mockRejectedValueOnce(new Error('ECONNRESET'));
    const { invoice } = await invoiceService.createInvoice(facturaB);

    arcaMock.recuperarComprobante.mockResolvedValue({ estado: 'no_emitido' });
    arcaMock.facturar.mockRejectedValue(
      new ArcaRechazoError('FECAESolicitar: ARCA rechazó el comprobante 6-1-42', {
        operacion: 'FECAESolicitar',
        observaciones: [{ code: 10048, msg: 'Importe inválido' }],
      }),
    );

    await expect(invoiceService.recuperarFactura(invoice.id)).rejects.toMatchObject({
      statusCode: 422,
      message: 'ARCA rechazó el comprobante: 10048: Importe inválido',
      errors: [{ code: 10048, msg: 'Importe inválido' }],
    });
    expect(db.invoices.size).toBe(0);
  });

  it('no emitido y el reenvío falla por token (600 → ArcaAuthError desde 6.1) → sigue pendiente, no se borra', async () => {
    arcaMock.facturar.mockRejectedValue(incierto(42));
    arcaMock.recuperarComprobante.mockRejectedValueOnce(new Error('ECONNRESET'));
    const { invoice } = await invoiceService.createInvoice(facturaB);

    arcaMock.recuperarComprobante.mockResolvedValue({ estado: 'no_emitido' });
    const cause = new ArcaWSFEError([{ code: 600, msg: 'ValidacionDeToken: No valido token' }]);
    arcaMock.facturar.mockRejectedValue(new ArcaAuthError('ticket rechazado', { cause, faultCode: '600' }));

    const r = await invoiceService.recuperarFactura(invoice.id);
    expect(r.afipResponse).toMatchObject({ pendiente: true });
    expect(db.invoices.size).toBe(1);
    expect(db.invoices.get(invoice.id)?.resultado).toBe('P');
    expect((db.invoices.get(invoice.id)?.emision as any).ultimoMensaje).toMatch(/No se pudo reenviar/);
  });

  it('no emitido y el reenvío da ArcaWSFEError 602 → sigue pendiente (no evalúa el comprobante)', async () => {
    arcaMock.facturar.mockRejectedValue(incierto(42));
    arcaMock.recuperarComprobante.mockRejectedValueOnce(new Error('ECONNRESET'));
    const { invoice } = await invoiceService.createInvoice(facturaB);

    arcaMock.recuperarComprobante.mockResolvedValue({ estado: 'no_emitido' });
    arcaMock.facturar.mockRejectedValue(new ArcaWSFEError([{ code: 602, msg: 'Sin Resultados' }]));

    await invoiceService.recuperarFactura(invoice.id);
    expect(db.invoices.get(invoice.id)?.resultado).toBe('P');
  });

  it('una factura pendiente bloquea nuevas emisiones del mismo tipo y punto de venta', async () => {
    arcaMock.facturar.mockRejectedValue(incierto(42));
    arcaMock.recuperarComprobante.mockRejectedValue(new Error('ECONNRESET'));
    await invoiceService.createInvoice(facturaB);

    await expect(invoiceService.createInvoice(facturaB)).rejects.toMatchObject({ statusCode: 409 });
    expect(arcaMock.facturar).toHaveBeenCalledTimes(1);
  });

  it('recuperarFactura de una factura aprobada no consulta ARCA', async () => {
    arcaMock.facturar.mockImplementation(async (opts: any) => aprobada(intentoDe(opts.cbteNro)));
    const { invoice } = await invoiceService.createInvoice(facturaB);

    const r = await invoiceService.recuperarFactura(invoice.id);

    expect(r.afipResponse.resultado).toBe('A');
    expect(arcaMock.recuperarComprobante).not.toHaveBeenCalled();
  });
});

describe('invoice.service: notas de crédito y condición de IVA', () => {
  it('nota de crédito: tipo inferido, comprobante original asociado y condicionIva del cliente', async () => {
    db.clients.set(7, { id: 7, ivaCondition: 1 });
    db.invoices.set(100, {
      id: 100, cbteTipo: CbteTipo.FACTURA_A, puntoVenta: 1, cbteNro: 10, cbteFch: '20261020',
      concepto: 1, docTipo: 80, docNro: '30712345671', clientId: 7, cae: CAE, resultado: 'A', emision: null,
    });
    arcaMock.notaCredito.mockImplementation(async (opts: any) =>
      aprobada({ ...intentoDe(opts.cbteNro), cbteTipo: CbteTipo.NOTA_CREDITO_A, docTipo: 80, docNro: 30712345671 }),
    );

    const { invoice } = await invoiceService.createNotaCredito({
      originalInvoiceId: 100,
      puntoVenta: 1,
      items: [{ description: 'Devolución', quantity: 1, unitPrice: 1000, ivaId: 5 }],
    });

    const opts = arcaMock.notaCredito.mock.calls[0][0];
    expect(opts).toMatchObject({
      cbteNro: 42,
      condicionIva: 1,
      comprobanteOriginal: { tipo: CbteTipo.FACTURA_A, ptoVta: 1, nro: 10, fecha: '20261020' },
    });
    expect(arcaMock.ultimoComprobante).toHaveBeenCalledWith(1, CbteTipo.NOTA_CREDITO_A);
    expect(invoice).toMatchObject({ cbteTipo: CbteTipo.NOTA_CREDITO_A, resultado: 'A' });
  });

  it('factura a un receptor identificado sin condicionIva → ArcaValidationError antes de guardar nada', async () => {
    await expect(
      invoiceService.createInvoice({ ...facturaB, cbteTipo: CbteTipo.FACTURA_A, docTipo: 80, docNro: '30712345671' }),
    ).rejects.toThrow(/condicionIva/);
    expect(db.invoices.size).toBe(0);
    expect(arcaMock.facturar).not.toHaveBeenCalled();
  });
});
