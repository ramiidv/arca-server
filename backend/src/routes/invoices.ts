import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CbteTipo, IVA_RATES } from '@ramiidv/arca-facturacion';
import { invoiceService, RESULTADO } from '../services/invoice.service';
import { paginacionSchema } from '../lib/paginacion';

const router = Router();

/** Comprobantes A, B y C de WSFEv1 que emite este server (facturas, NC y ND). */
const VALID_CBTE_TIPOS: readonly number[] = [
  CbteTipo.FACTURA_A,
  CbteTipo.NOTA_DEBITO_A,
  CbteTipo.NOTA_CREDITO_A,
  CbteTipo.FACTURA_B,
  CbteTipo.NOTA_DEBITO_B,
  CbteTipo.NOTA_CREDITO_B,
  CbteTipo.FACTURA_C,
  CbteTipo.NOTA_DEBITO_C,
  CbteTipo.NOTA_CREDITO_C,
];
/** Alícuotas de IVA (IvaTipo) que conoce el SDK. */
const VALID_IVA_IDS: readonly number[] = Object.keys(IVA_RATES).map(Number);

const fechaYYYYMMDD = z.string().regex(/^\d{8}$/, 'La fecha tiene que tener formato YYYYMMDD');

const itemSchema = z.object({
  description: z.string().min(1, 'La descripción del ítem es obligatoria'),
  quantity: z.number().positive('La cantidad tiene que ser mayor a 0'),
  unitPrice: z.number().min(0, 'El precio unitario no puede ser negativo'),
  ivaId: z.number().refine((v) => VALID_IVA_IDS.includes(v), {
    message: `ivaId tiene que ser uno de: ${VALID_IVA_IDS.join(', ')}`,
  }),
});

const createInvoiceSchema = z.object({
  cbteTipo: z.number().refine((v) => VALID_CBTE_TIPOS.includes(v), {
    message: `cbteTipo tiene que ser uno de: ${VALID_CBTE_TIPOS.join(', ')}`,
  }),
  clientId: z.number().int().positive().optional(),
  docTipo: z.number().int().min(0),
  docNro: z.string().min(1, 'docNro es obligatorio'),
  // Condición de IVA del receptor (RG 5616). Obligatoria si docTipo != 99; si no viene se toma la del cliente.
  // Con docTipo 99 (consumidor final sin identificar) el SDK envía 5 (Consumidor Final) si no se indica.
  condicionIva: z.number().int().positive().optional(),
  // 1 Productos (default, igual que la UI), 2 Servicios, 3 Productos y Servicios.
  // Las fechas de servicio (fchServDesde/Hasta, fchVtoPago) solo se usan con 2 o 3 (default: hoy).
  concepto: z.number().int().min(1).max(3).default(1),
  puntoVenta: z.number().int().positive(),
  items: z.array(itemSchema).min(1, 'Tiene que haber al menos un ítem'),
  fchServDesde: fechaYYYYMMDD.optional(),
  fchServHasta: fechaYYYYMMDD.optional(),
  fchVtoPago: fechaYYYYMMDD.optional(),
  // Solo se guarda en la base local: no se envía a ARCA.
  observations: z.string().optional(),
});

/**
 * 201 si ARCA autorizó el comprobante; 202 si quedó pendiente (resultado
 * incierto) o en conflicto: se guardó y se puede reintentar la recuperación
 * con POST /:id/recuperar.
 */
function statusEmision(resultado: string | null | undefined): number {
  return resultado === RESULTADO.APROBADA ? 201 : 202;
}

// POST / - Create invoice
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createInvoiceSchema.parse(req.body);
    const result = await invoiceService.createInvoice(data);

    res.status(statusEmision(result.afipResponse.resultado)).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

const createNotaCreditoSchema = z.object({
  originalInvoiceId: z.number().int().positive(),
  puntoVenta: z.number().int().positive(),
  condicionIva: z.number().int().positive().optional(),
  // Default: el concepto de la factura original.
  concepto: z.number().int().min(1).max(3).optional(),
  items: z.array(itemSchema).min(1, 'Tiene que haber al menos un ítem'),
  fchServDesde: fechaYYYYMMDD.optional(),
  fchServHasta: fechaYYYYMMDD.optional(),
  fchVtoPago: fechaYYYYMMDD.optional(),
  observations: z.string().optional(),
});

// POST /nota-credito - Create credit note
router.post('/nota-credito', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createNotaCreditoSchema.parse(req.body);
    const result = await invoiceService.createNotaCredito(data);
    res.status(statusEmision(result.afipResponse.resultado)).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// POST /nota-debito - Create debit note
router.post('/nota-debito', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createNotaCreditoSchema.parse(req.body);
    const result = await invoiceService.createNotaDebito(data);
    res.status(statusEmision(result.afipResponse.resultado)).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/** Query de GET /: paginación y filtros. Un filtro inválido es un 400, no se ignora. */
const listadoSchema = paginacionSchema.extend({
  cbteTipo: z.coerce.number().int().positive('cbteTipo tiene que ser un entero positivo').optional(),
  clientId: z.coerce.number().int().positive('clientId tiene que ser un entero positivo').optional(),
  resultado: z.enum(Object.values(RESULTADO), { message: `resultado tiene que ser uno de: ${Object.values(RESULTADO).join(', ')}` }).optional(),
  from: fechaYYYYMMDD.optional(),
  to: fechaYYYYMMDD.optional(),
});

// GET /stats - Dashboard stats (must be before /:id)
router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await invoiceService.getInvoiceStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

// GET / - List invoices
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = listadoSchema.parse(req.query);

    const result = await invoiceService.getInvoices(filters);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// GET /:id - Get invoice detail
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'ID de factura inválido' });
      return;
    }

    const invoice = await invoiceService.getInvoiceById(id);
    res.json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
});

// POST /:id/recuperar - Retry recovery of a pending (uncertain) or conflicting invoice
router.post('/:id/recuperar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'ID de factura inválido' });
      return;
    }

    const result = await invoiceService.recuperarFactura(id);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
