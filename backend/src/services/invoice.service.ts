import { Prisma } from '../generated/prisma/client';
import {
  IVA_RATES,
  Concepto,
  DocTipo,
  NOTA_CREDITO_MAP,
  NOTA_DEBITO_MAP,
  ArcaResultadoIncierto,
  ArcaRechazoError,
  ArcaResponseError,
  ArcaSoapError,
  ArcaWSFEError,
  requiereRecuperacion,
} from '@ramiidv/arca-facturacion';
import type {
  FacturarOpts,
  NotaCreditoOpts,
  NotaDebitoOpts,
  ComprobanteRef,
  LineItem,
  FacturaResult,
  IntentoComprobante,
  MensajeArca,
} from '@ramiidv/arca-facturacion';
import { formatDate, roundHalfEven } from '@ramiidv/arca-common';
import { prisma } from '../lib/prisma';
import { arca } from './arca.service';
import { config } from '../config';
import { AppError, mensajesArca } from '../middleware/errorHandler';

interface InvoiceItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  ivaId: number;
}

interface CreateInvoiceInput {
  cbteTipo: number;
  clientId?: number;
  docTipo: number;
  docNro: string;
  condicionIva?: number;
  concepto?: number;
  puntoVenta: number;
  items: InvoiceItemInput[];
  fchServDesde?: string;
  fchServHasta?: string;
  fchVtoPago?: string;
  observations?: string;
}

interface CreateNotaCreditoInput {
  originalInvoiceId: number;
  puntoVenta: number;
  condicionIva?: number;
  concepto?: number;
  items: InvoiceItemInput[];
  fchServDesde?: string;
  fchServHasta?: string;
  fchVtoPago?: string;
  observations?: string;
}

type CreateNotaDebitoInput = CreateNotaCreditoInput;

interface InvoiceFilters {
  page?: number;
  limit?: number;
  cbteTipo?: number;
  clientId?: number;
  resultado?: string;
  from?: string;
  to?: string;
}

/** Valores de `Invoice.resultado`. */
export const RESULTADO = {
  /** Autorizada por ARCA (con CAE). */
  APROBADA: 'A',
  /** Resultado incierto o envío interrumpido: hay que recuperarla (POST /invoices/:id/recuperar). */
  PENDIENTE: 'P',
  /** El número existe en ARCA con otros datos: revisión manual. */
  CONFLICTO: 'C',
} as const;

type Operacion = 'facturar' | 'notaCredito' | 'notaDebito';
type OptsEmision = FacturarOpts | NotaCreditoOpts | NotaDebitoOpts;

/**
 * Lo que se guarda en `Invoice.emision` (JSON) ANTES de enviar el comprobante:
 * alcanza para saber después si ARCA lo autorizó (`intento`) y para reenviarlo
 * con el mismo número y la misma fecha (`opts`).
 */
export interface EmisionGuardada {
  operacion: Operacion;
  /** Opciones enviadas, con `cbteNro` y `fecha` fijos. */
  opts: OptsEmision;
  intento: IntentoComprobante;
  estado: 'enviando' | 'incierto' | 'conflicto' | 'autorizado';
  /** Cantidad de envíos a ARCA (el primero más los reenvíos tras `no_emitido`). */
  envios: number;
  ultimoMensaje?: string;
  /** Conflicto: datos del comprobante que ARCA tiene con ese número (camelCase, como el SDK). */
  encontrado?: Record<string, unknown>;
  actualizado: string;
}

/** Desenlace de un envío o de una recuperación. */
type Desenlace =
  | { tipo: 'aprobada'; result: FacturaResult }
  | { tipo: 'incierta'; motivo: string }
  | { tipo: 'conflicto'; motivo: string; encontrado: Record<string, unknown> }
  | { tipo: 'rechazada'; motivo: string; observaciones: MensajeArca[] };

/** Rechazo de ARCA (`resultado` "R"): con certeza no se emitió. */
function rechazada(e: ArcaRechazoError): Desenlace {
  return { tipo: 'rechazada', motivo: mensajes(e.observaciones), observaciones: e.observaciones };
}

/** Redondeo a 2 decimales mitad al par, el mismo criterio que usan los SDKs (manual de WSFEv1). */
function roundTwo(n: number): number {
  return roundHalfEven(n, 2);
}

function processItemsForDB(items: InvoiceItemInput[]) {
  return items.map((item) => {
    const ivaRate = IVA_RATES[item.ivaId as keyof typeof IVA_RATES];
    if (ivaRate === undefined) {
      throw new AppError(400, `Alícuota de IVA inválida: ${item.ivaId}. Valores válidos: ${Object.keys(IVA_RATES).join(', ')}`);
    }
    const subtotal = roundTwo(item.quantity * item.unitPrice);
    const ivaAmount = roundTwo(subtotal * (ivaRate / 100));

    return {
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      ivaId: item.ivaId,
      ivaRate,
      subtotal,
      ivaAmount,
    };
  });
}

function mensajes(obs: MensajeArca[]): string {
  return obs.length > 0 ? mensajesArca(obs) : 'ARCA no informó el motivo';
}

/** Tipos de nota de crédito (A, B, C, E, M y FCE): restan en los montos del dashboard. */
const TIPOS_NOTA_CREDITO = new Set<number>(Object.values(NOTA_CREDITO_MAP));
/** Tipos de nota de débito: se cuentan aparte de las facturas en el dashboard (suman en los montos). */
const TIPOS_NOTA_DEBITO = new Set<number>(Object.values(NOTA_DEBITO_MAP));

function esServicio(concepto: number): boolean {
  return concepto === Concepto.SERVICIOS || concepto === Concepto.PRODUCTOS_Y_SERVICIOS;
}

function esperar(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

// Serializa las emisiones por (punto de venta, tipo de comprobante) dentro del
// proceso: el número se reserva como último autorizado + 1 y dos emisiones en
// paralelo tomarían el mismo.
const locks = new Map<string, Promise<void>>();

async function conLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previo = locks.get(key) ?? Promise.resolve();
  let liberar!: () => void;
  const actual = previo.then(() => new Promise<void>((resolve) => { liberar = resolve; }));
  locks.set(key, actual);
  await previo;
  try {
    return await fn();
  } finally {
    liberar();
    if (locks.get(key) === actual) locks.delete(key);
  }
}

/** URL del QR con el helper del SDK. Un QR que no se puede armar no invalida una factura autorizada. */
function qrDe(result: FacturaResult): string | null {
  try {
    return arca.urlQR(result);
  } catch (e) {
    console.error('[Facturación] No se pudo generar el QR:', (e as Error).message);
    return null;
  }
}

/** Llama a la operación del SDK que corresponde. */
function llamar(operacion: Operacion, opts: OptsEmision): Promise<FacturaResult> {
  switch (operacion) {
    case 'facturar':
      return arca.facturar(opts as FacturarOpts);
    case 'notaCredito':
      return arca.notaCredito(opts as NotaCreditoOpts);
    case 'notaDebito':
      return arca.notaDebito(opts as NotaDebitoOpts);
  }
}

/**
 * Envía el comprobante una vez y clasifica la respuesta:
 * - `aprobada`: ARCA otorgó el CAE (el SDK siempre devuelve un comprobante autorizado).
 * - `incierta`: `ArcaResultadoIncierto` (o un `ArcaSoapError`/`ArcaResponseError`
 *   incierto; el SDK ya los convierte en `ArcaResultadoIncierto` en las emisiones),
 *   o un 10016 por número que puede significar que un intento anterior se
 *   autorizó (`requiereRecuperacion`).
 * - `rechazada`: `ArcaRechazoError` (resultado "R", no se emitió).
 * Cualquier otro error se propaga: `ArcaWSFEError` (ARCA rechazó la solicitud,
 * no se emitió), `ArcaAuthError` (login WSAA fallido o ticket rechazado con
 * 600/601: no se procesó), o errores antes de enviar (validación, sin conexión).
 */
async function enviar(operacion: Operacion, opts: OptsEmision): Promise<Desenlace> {
  try {
    return { tipo: 'aprobada', result: await llamar(operacion, opts) };
  } catch (e) {
    if (
      e instanceof ArcaResultadoIncierto ||
      ((e instanceof ArcaSoapError || e instanceof ArcaResponseError) && e.uncertain)
    ) {
      return { tipo: 'incierta', motivo: e.message };
    }
    if (requiereRecuperacion(e)) {
      return { tipo: 'incierta', motivo: `ARCA respondió 10016 por número: ${(e as Error).message}` };
    }
    if (e instanceof ArcaRechazoError) return rechazada(e);
    throw e;
  }
}

/**
 * Resuelve un comprobante con resultado incierto según el flujo del README de
 * arca-facturacion:
 * - `autorizado`: ARCA lo autorizó → se usa ese CAE.
 * - `no_emitido`: no existe → se reenvía UNA vez con las mismas opciones
 *   (mismo `cbteNro` y misma fecha). Es seguro: si el intento original llegara
 *   a autorizarse después, ARCA rechaza el duplicado (10016), nunca emite dos.
 * - `conflicto`: el número existe con otros datos → revisión manual.
 * - `ArcaRechazoError`: el número existe con los datos del intento pero
 *   rechazado → se trata como rechazo (no se emitió).
 * Si la consulta o el reenvío no dan certeza, el comprobante sigue pendiente.
 */
async function resolverIncierto(emision: EmisionGuardada): Promise<{ desenlace: Desenlace; reenviado: boolean }> {
  let recuperacion;
  try {
    recuperacion = await arca.recuperarComprobante(emision.intento);
  } catch (e) {
    // El número existe con los datos del intento pero ARCA lo informa rechazado.
    if (e instanceof ArcaRechazoError) return { desenlace: rechazada(e), reenviado: false };
    return { desenlace: { tipo: 'incierta', motivo: `No se pudo consultar ARCA: ${(e as Error).message}` }, reenviado: false };
  }

  if (recuperacion.estado === 'autorizado') {
    return { desenlace: { tipo: 'aprobada', result: recuperacion.resultado }, reenviado: false };
  }

  if (recuperacion.estado === 'conflicto') {
    // FECompConsultarResult en camelCase; cbteFch y
    // codAutorizacion son opcionales (ARCA puede omitirlos).
    const r = recuperacion.encontrado.resultGet;
    return {
      desenlace: {
        tipo: 'conflicto',
        motivo: `El comprobante ${emision.intento.cbteTipo}-${emision.intento.ptoVta}-${emision.intento.cbteNro} existe en ARCA con otros datos`,
        encontrado: {
          cbteFch: r?.cbteFch,
          impTotal: r?.impTotal,
          docTipo: r?.docTipo,
          docNro: r?.docNro,
          codAutorizacion: r?.codAutorizacion,
        },
      },
      reenviado: false,
    };
  }

  // no_emitido: reenviar con el mismo número.
  try {
    return { desenlace: await enviar(emision.operacion, emision.opts), reenviado: true };
  } catch (e) {
    // ArcaWSFEError: ARCA evaluó el reenvío y lo rechazó → con certeza no se emitió.
    // Excepción: los códigos 6xx no evalúan el comprobante (el original puede seguir
    // en proceso). Desde arca-facturacion 6.1 el 600/601 (token/firma, CUIT no
    // relacionada) ya llega como ArcaAuthError y cae en la rama de abajo; el 602
    // ("no existen datos") sigue siendo ArcaWSFEError y se trata igual por las dudas.
    if (e instanceof ArcaWSFEError && !e.errors.some((err) => err.code >= 600 && err.code <= 699)) {
      return {
        desenlace: { tipo: 'rechazada', motivo: e.message, observaciones: e.errors },
        reenviado: true,
      };
    }
    // No se pudo enviar (ArcaAuthError de WSAA o 600/601, red, etc.): sigue
    // pendiente sin certeza sobre el envío original; se puede reintentar.
    return { desenlace: { tipo: 'incierta', motivo: `No se pudo reenviar: ${(e as Error).message}` }, reenviado: false };
  }
}

const includeDetalle = { items: true, client: true } as const;

class InvoiceService {
  /**
   * Emite un comprobante de forma segura:
   * 1. Reserva el número (último autorizado + 1) y fija la fecha con el reloj de ARCA.
   * 2. Arma el comprobante sin red (`armarComprobante`, valida igual que `facturar`).
   * 3. Guarda la factura como pendiente con el intento ANTES de enviar: si el
   *    proceso se cae a mitad del envío, queda en la DB para recuperarla.
   * 4. Envía y resuelve: aprobada, rechazada (se borra: no se emitió) o
   *    incierta (se intenta `recuperarComprobante`; si no hay certeza, queda pendiente).
   */
  private async emitir(params: {
    operacion: Operacion;
    cbteTipo: number;
    opts: OptsEmision;
    /** Opciones equivalentes para `armarComprobante` (con el tipo y los asociados resueltos). */
    optsArmado: FacturarOpts;
    processedItems: ReturnType<typeof processItemsForDB>;
    meta: {
      docTipo: number;
      docNro: string;
      concepto: number;
      clientId: number | null;
      observations?: string;
      servicio: boolean;
    };
  }) {
    const { operacion, cbteTipo, processedItems, meta } = params;
    const ptoVta = params.opts.ptoVta;

    return conLock(`${ptoVta}-${cbteTipo}`, async () => {
      const pendiente = await prisma.invoice.findFirst({
        where: { cbteTipo, puntoVenta: ptoVta, resultado: RESULTADO.PENDIENTE },
        select: { id: true, cbteNro: true },
      });
      if (pendiente) {
        throw new AppError(
          409,
          `Hay un comprobante pendiente de recuperación (factura #${pendiente.id}, número ${pendiente.cbteNro}) ` +
            'para este tipo y punto de venta. Recuperalo antes de emitir otro.',
        );
      }

      const cbteNro = (await arca.ultimoComprobante(ptoVta, cbteTipo)) + 1;
      // Fecha fija: el intento guardado y el envío (o un reenvío) tienen que coincidir.
      const fecha = formatDate(arca.wsaa.now());
      const opts = { ...params.opts, cbteNro, fecha } as OptsEmision;
      const { intento, importes } = arca.armarComprobante({ ...params.optsArmado, cbteNro, fecha });

      const emision: EmisionGuardada = {
        operacion,
        opts,
        intento,
        estado: 'enviando',
        envios: 1,
        actualizado: new Date().toISOString(),
      };

      const fechaServicio = (v: unknown) => (meta.servicio ? formatDate(v as string) : undefined);
      const servicio = (opts as FacturarOpts).servicio;

      const creada = await prisma.invoice.create({
        data: {
          cbteTipo,
          puntoVenta: ptoVta,
          cbteNro,
          cbteDesde: cbteNro,
          cbteHasta: cbteNro,
          cbteFch: intento.fecha,
          concepto: meta.concepto,
          docTipo: meta.docTipo,
          docNro: meta.docNro,
          impTotal: new Prisma.Decimal(importes.total),
          impTotConc: new Prisma.Decimal(importes.noGravado),
          impNeto: new Prisma.Decimal(importes.neto),
          impOpEx: new Prisma.Decimal(importes.exento),
          impIVA: new Prisma.Decimal(importes.iva),
          impTrib: new Prisma.Decimal(importes.tributos),
          cae: null,
          caeFchVto: null,
          resultado: RESULTADO.PENDIENTE,
          monId: 'PES',
          monCotiz: new Prisma.Decimal(1),
          fchServDesde: servicio ? fechaServicio(servicio.desde) : undefined,
          fchServHasta: servicio ? fechaServicio(servicio.hasta) : undefined,
          fchVtoPago: servicio ? fechaServicio(servicio.vtoPago) : undefined,
          qrUrl: null,
          clientId: meta.clientId,
          observations: meta.observations || null,
          emision: emision as unknown as Prisma.InputJsonValue,
          items: {
            create: processedItems.map((item) => ({
              description: item.description,
              quantity: new Prisma.Decimal(item.quantity),
              unitPrice: new Prisma.Decimal(item.unitPrice),
              ivaId: item.ivaId,
              ivaRate: new Prisma.Decimal(item.ivaRate),
              subtotal: new Prisma.Decimal(item.subtotal),
              ivaAmount: new Prisma.Decimal(item.ivaAmount),
            })),
          },
        },
      });

      let desenlace: Desenlace;
      try {
        desenlace = await enviar(operacion, opts);
      } catch (e) {
        // No se emitió: ARCA rechazó (ArcaWSFEError, o ArcaAuthError por 600/601),
        // o falló antes de enviar (validación, login WSAA).
        await prisma.invoice.delete({ where: { id: creada.id } });
        throw e;
      }

      if (desenlace.tipo === 'rechazada') {
        // ArcaRechazoError: ARCA evaluó el comprobante y lo rechazó (no se emitió).
        // Mismo status y forma que un ArcaWSFEError: 422 con `errors` y `details`.
        await prisma.invoice.delete({ where: { id: creada.id } });
        throw new AppError(
          422,
          `ARCA rechazó el comprobante: ${desenlace.motivo}`,
          true,
          desenlace.observaciones,
          desenlace.observaciones,
        );
      }

      if (desenlace.tipo === 'incierta') {
        console.warn(`[Facturación] Resultado incierto para la factura #${creada.id}: ${desenlace.motivo}`);
        await this.guardarEmision(creada.id, { ...emision, estado: 'incierto', ultimoMensaje: desenlace.motivo });
        await esperar(config.afip.recoveryDelayMs);
        const resuelto = await resolverIncierto({ ...emision, estado: 'incierto' });
        const envios = emision.envios + (resuelto.reenviado ? 1 : 0);
        return this.aplicarDesenlace(creada.id, { ...emision, envios }, resuelto.desenlace);
      }

      return this.aplicarDesenlace(creada.id, emision, desenlace);
    });
  }

  private async guardarEmision(id: number, emision: EmisionGuardada) {
    await prisma.invoice.update({
      where: { id },
      data: { emision: { ...emision, actualizado: new Date().toISOString() } as unknown as Prisma.InputJsonValue },
    });
  }

  /** Persiste el desenlace y arma la respuesta. */
  private async aplicarDesenlace(id: number, emision: EmisionGuardada, desenlace: Desenlace) {
    const actualizado = new Date().toISOString();

    if (desenlace.tipo === 'aprobada') {
      const result = desenlace.result;
      const qrUrl = qrDe(result);
      const invoice = await prisma.invoice.update({
        where: { id },
        data: {
          cae: result.cae ?? null,
          caeFchVto: result.caeVencimiento ?? null,
          resultado: RESULTADO.APROBADA,
          qrUrl,
          emision: { ...emision, estado: 'autorizado', ultimoMensaje: undefined, actualizado } as unknown as Prisma.InputJsonValue,
        },
        include: includeDetalle,
      });
      return {
        invoice,
        afipResponse: {
          cae: result.cae,
          caeFchVto: result.caeVencimiento,
          resultado: RESULTADO.APROBADA,
          observaciones: result.observaciones,
          eventos: result.eventos,
          qrUrl: qrUrl ?? undefined,
        },
      };
    }

    if (desenlace.tipo === 'rechazada') {
      // Después de recuperar y reenviar, ARCA lo rechazó: con certeza no se emitió.
      // Se borra para liberar el número (cbteTipo, puntoVenta, cbteNro).
      await prisma.invoice.delete({ where: { id } });
      throw new AppError(
        422,
        `ARCA rechazó el comprobante al reenviarlo: no se emitió y se eliminó el registro pendiente. ${desenlace.motivo}`,
        true,
        desenlace.observaciones,
        desenlace.observaciones,
      );
    }

    const conflicto = desenlace.tipo === 'conflicto';
    const invoice = await prisma.invoice.update({
      where: { id },
      data: {
        resultado: conflicto ? RESULTADO.CONFLICTO : RESULTADO.PENDIENTE,
        emision: {
          ...emision,
          estado: conflicto ? 'conflicto' : 'incierto',
          ultimoMensaje: desenlace.motivo,
          ...(conflicto && { encontrado: desenlace.encontrado }),
          actualizado,
        } as unknown as Prisma.InputJsonValue,
      },
      include: includeDetalle,
    });
    return {
      invoice,
      afipResponse: {
        resultado: invoice.resultado,
        pendiente: !conflicto,
        conflicto,
        mensaje: conflicto
          ? `${desenlace.motivo}. Requiere revisión manual.`
          : 'ARCA no confirmó el resultado. La factura quedó pendiente: reintentá la recuperación.',
        intento: emision.intento,
      },
    };
  }

  async createInvoice(data: CreateInvoiceInput) {
    const processedItems = processItemsForDB(data.items);
    const items: LineItem[] = processedItems.map((item) => ({ neto: item.subtotal, iva: item.ivaId }));

    // Default: Productos (1), igual que la UI. Las fechas de servicio solo se envían con concepto 2 o 3.
    const concepto = data.concepto ?? Concepto.PRODUCTOS;
    const servicio = esServicio(concepto);
    const condicionIva = await this.condicionIvaReceptor(data.docTipo, data.condicionIva, data.clientId);
    const today = formatDate(arca.wsaa.now());

    const opts: FacturarOpts = {
      ptoVta: data.puntoVenta,
      cbteTipo: data.cbteTipo,
      items,
      concepto,
      docTipo: data.docTipo,
      docNro: Number(data.docNro),
      ...(condicionIva !== undefined && { condicionIva }),
      ...(servicio && {
        servicio: {
          desde: data.fchServDesde || today,
          hasta: data.fchServHasta || today,
          vtoPago: data.fchVtoPago || today,
        },
      }),
    };

    return this.emitir({
      operacion: 'facturar',
      cbteTipo: data.cbteTipo,
      opts,
      optsArmado: opts,
      processedItems,
      meta: {
        docTipo: data.docTipo,
        docNro: data.docNro,
        concepto,
        clientId: data.clientId ?? null,
        observations: data.observations,
        servicio,
      },
    });
  }

  async createNotaCredito(data: CreateNotaCreditoInput) {
    return this.createNotaAsociada('notaCredito', data);
  }

  async createNotaDebito(data: CreateNotaDebitoInput) {
    return this.createNotaAsociada('notaDebito', data);
  }

  private async createNotaAsociada(operacion: 'notaCredito' | 'notaDebito', data: CreateNotaCreditoInput) {
    const esNC = operacion === 'notaCredito';
    const originalInvoice = await prisma.invoice.findUnique({
      where: { id: data.originalInvoiceId },
      include: { items: true, client: true },
    });

    if (!originalInvoice) {
      throw new AppError(404, `No existe la factura original #${data.originalInvoiceId}`);
    }

    if (!originalInvoice.cae || originalInvoice.resultado !== RESULTADO.APROBADA) {
      throw new AppError(
        400,
        `La factura original no está autorizada (sin CAE): no se puede emitir una nota de ${esNC ? 'crédito' : 'débito'}`,
      );
    }

    const cbteTipo = (esNC ? NOTA_CREDITO_MAP : NOTA_DEBITO_MAP)[originalInvoice.cbteTipo];
    if (cbteTipo === undefined) {
      throw new AppError(400, `No se puede emitir una nota de ${esNC ? 'crédito' : 'débito'} para el tipo ${originalInvoice.cbteTipo}`);
    }

    const processedItems = processItemsForDB(data.items);
    const items: LineItem[] = processedItems.map((item) => ({ neto: item.subtotal, iva: item.ivaId }));

    const concepto = data.concepto ?? originalInvoice.concepto;
    const servicio = esServicio(concepto);
    const today = formatDate(arca.wsaa.now());
    const emisionOriginal = originalInvoice.emision as unknown as EmisionGuardada | null;
    const condicionIva = await this.condicionIvaReceptor(
      originalInvoice.docTipo,
      data.condicionIva ?? originalInvoice.client?.ivaCondition ?? (emisionOriginal?.opts as FacturarOpts | undefined)?.condicionIva,
    );

    const comprobanteOriginal: ComprobanteRef = {
      tipo: originalInvoice.cbteTipo,
      ptoVta: originalInvoice.puntoVenta,
      nro: originalInvoice.cbteNro,
      fecha: originalInvoice.cbteFch,
    };

    const comun = {
      ptoVta: data.puntoVenta,
      items,
      concepto,
      docTipo: originalInvoice.docTipo,
      docNro: Number(originalInvoice.docNro),
      ...(condicionIva !== undefined && { condicionIva }),
      ...(servicio && {
        servicio: {
          desde: data.fchServDesde || today,
          hasta: data.fchServHasta || today,
          vtoPago: data.fchVtoPago || today,
        },
      }),
    };

    return this.emitir({
      operacion,
      cbteTipo,
      opts: { ...comun, comprobanteOriginal } as NotaCreditoOpts,
      // Lo mismo que hacen notaCredito/notaDebito del SDK: tipo inferido y el original como asociado.
      optsArmado: { ...comun, cbteTipo, cbtesAsoc: [comprobanteOriginal] },
      processedItems,
      meta: {
        docTipo: originalInvoice.docTipo,
        docNro: originalInvoice.docNro,
        concepto,
        clientId: originalInvoice.clientId,
        observations: data.observations,
        servicio,
      },
    });
  }

  /**
   * Condición de IVA del receptor (RG 5616, validación 10246). ARCA la exige
   * siempre, también con docTipo 99. En la API simplificada de
   * arca-facturacion 6.1 (`facturar`/`notaCredito`/`notaDebito`):
   * - docTipo distinto de 99: obligatoria (el SDK no la infiere: un CUIT puede
   *   ser RI, monotributista o exento). Si no viene, se toma la del cliente; si
   *   falta, el SDK lanza ArcaValidationError (400).
   * - docTipo 99 (consumidor final sin identificar): si no viene, el SDK envía
   *   CONSUMIDOR_FINAL (5). Por eso acá queda undefined.
   * (Solo la API raw, que no se usa acá, exige `condicionIvaReceptorId` explícito con 99.)
   */
  private async condicionIvaReceptor(docTipo: number, condicionIva?: number, clientId?: number) {
    if (condicionIva !== undefined) return condicionIva;
    if (docTipo === DocTipo.CONSUMIDOR_FINAL) return undefined;
    if (clientId) {
      const client = await prisma.client.findUnique({ where: { id: clientId }, select: { ivaCondition: true } });
      return client?.ivaCondition ?? undefined;
    }
    return undefined;
  }

  /**
   * Reintenta la recuperación de una factura pendiente (resultado incierto o
   * envío interrumpido) o en conflicto. Ver `resolverIncierto`.
   */
  async recuperarFactura(id: number) {
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: includeDetalle });
    if (!invoice) {
      throw new AppError(404, `No existe la factura #${id}`);
    }
    if (invoice.resultado === RESULTADO.APROBADA) {
      return { invoice, afipResponse: { resultado: RESULTADO.APROBADA, cae: invoice.cae, mensaje: 'La factura ya está aprobada.' } };
    }
    if (invoice.resultado !== RESULTADO.PENDIENTE && invoice.resultado !== RESULTADO.CONFLICTO) {
      throw new AppError(409, 'La factura no está pendiente de recuperación');
    }
    const emision = invoice.emision as unknown as EmisionGuardada | null;
    if (!emision?.intento || !emision.opts || !emision.operacion) {
      throw new AppError(409, 'La factura no tiene los datos de emisión necesarios para recuperarla');
    }

    return conLock(`${invoice.puntoVenta}-${invoice.cbteTipo}`, async () => {
      const { desenlace, reenviado } = await resolverIncierto(emision);
      const envios = (emision.envios ?? 1) + (reenviado ? 1 : 0);
      return this.aplicarDesenlace(id, { ...emision, envios }, desenlace);
    });
  }

  async getInvoices(filters: InvoiceFilters) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.InvoiceWhereInput = {};

    if (filters.cbteTipo) {
      where.cbteTipo = filters.cbteTipo;
    }

    if (filters.clientId) {
      where.clientId = filters.clientId;
    }

    if (filters.resultado) {
      where.resultado = filters.resultado;
    }

    if (filters.from || filters.to) {
      where.cbteFch = {};
      if (filters.from) {
        where.cbteFch.gte = filters.from;
      }
      if (filters.to) {
        where.cbteFch.lte = filters.to;
      }
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          client: {
            select: { id: true, name: true, docNumber: true },
          },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ]);

    return {
      data: invoices,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getInvoiceById(id: number) {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        client: true,
      },
    });

    if (!invoice) {
      throw new AppError(404, `No existe la factura #${id}`);
    }

    return invoice;
  }

  /**
   * Estadísticas del dashboard. Cuentan solo comprobantes autorizados (no los
   * pendientes ni en conflicto). Los montos son netos de notas de crédito: una
   * NC (cualquier tipo de NOTA_CREDITO_MAP) resta su total. Las cantidades separan facturas, notas de
   * crédito y notas de débito (`totalCount` sigue siendo el total de comprobantes).
   * "Mes" = mes calendario de Argentina según la fecha del comprobante (`cbteFch`).
   */
  async getInvoiceStats(hoy: Date = new Date()) {
    const aprobadas: Prisma.InvoiceWhereInput = { resultado: RESULTADO.APROBADA };
    const mes = formatDate(hoy).slice(0, 6); // YYYYMM (fecha calendario de Argentina)
    const delMes: Prisma.InvoiceWhereInput = {
      ...aprobadas,
      cbteFch: { gte: `${mes}01`, lte: `${mes}31` },
    };
    const [totalsByType, monthlyByType, pendingCount] = await Promise.all([
      prisma.invoice.groupBy({
        by: ['cbteTipo'],
        where: aprobadas,
        _count: { id: true },
        _sum: { impTotal: true },
      }),
      prisma.invoice.groupBy({
        by: ['cbteTipo'],
        where: delMes,
        _count: { id: true },
        _sum: { impTotal: true },
      }),
      prisma.invoice.count({ where: { resultado: { in: [RESULTADO.PENDIENTE, RESULTADO.CONFLICTO] } } }),
    ]);

    const CBTE_TIPO_NAMES: Record<number, string> = {
      1: 'Factura A',
      2: 'Nota de Débito A',
      3: 'Nota de Crédito A',
      6: 'Factura B',
      7: 'Nota de Débito B',
      8: 'Nota de Crédito B',
      11: 'Factura C',
      12: 'Nota de Débito C',
      13: 'Nota de Crédito C',
    };

    type Grupo = { cbteTipo: number; _count: { id: number }; _sum: { impTotal: unknown } };
    /** Cantidades por clase de comprobante: facturas, notas de crédito y notas de débito. */
    const cantidades = (grupos: Grupo[]) => {
      const c = { facturas: 0, notasCredito: 0, notasDebito: 0 };
      for (const g of grupos) {
        if (TIPOS_NOTA_CREDITO.has(g.cbteTipo)) c.notasCredito += g._count.id;
        else if (TIPOS_NOTA_DEBITO.has(g.cbteTipo)) c.notasDebito += g._count.id;
        else c.facturas += g._count.id;
      }
      return c;
    };
    const totales = cantidades(totalsByType as Grupo[]);
    const delMesCant = cantidades(monthlyByType as Grupo[]);

    /** Suma de importes con las notas de crédito en negativo. */
    const montoNeto = (grupos: Grupo[]) =>
      roundTwo(
        grupos.reduce((acc, g) => {
          const total = Number(g._sum.impTotal ?? 0);
          return acc + (TIPOS_NOTA_CREDITO.has(g.cbteTipo) ? -total : total);
        }, 0),
      );

    return {
      /** Todos los comprobantes autorizados (facturas + NC + ND). */
      totalCount: totales.facturas + totales.notasCredito + totales.notasDebito,
      /** Solo facturas (sin notas de crédito ni de débito). */
      invoiceCount: totales.facturas,
      creditNoteCount: totales.notasCredito,
      debitNoteCount: totales.notasDebito,
      pendingCount,
      /** Facturas + ND − NC. */
      totalAmount: montoNeto(totalsByType as Grupo[]),
      /** Facturas del mes (sin NC/ND). */
      monthlyInvoices: delMesCant.facturas,
      monthlyCreditNotes: delMesCant.notasCredito,
      monthlyDebitNotes: delMesCant.notasDebito,
      /** Facturas + ND − NC del mes. */
      monthlyAmount: montoNeto(monthlyByType as Grupo[]),
      byType: totalsByType.map((t) => ({
        cbteTipo: t.cbteTipo,
        name: CBTE_TIPO_NAMES[t.cbteTipo] || `Tipo ${t.cbteTipo}`,
        count: t._count.id,
        total: t._sum.impTotal || 0,
      })),
    };
  }
}

export const invoiceService = new InvoiceService();
