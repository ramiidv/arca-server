import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { invoiceService, RESULTADO } from '../services/invoice.service';

const router = Router();

const VALID_CBTE_TIPOS = [1, 2, 3, 6, 7, 8, 11, 12, 13] as const;
const VALID_IVA_IDS = [3, 4, 5, 6, 8, 9] as const;

const createInvoiceSchema = z.object({
  cbteTipo: z.number().refine((v) => (VALID_CBTE_TIPOS as readonly number[]).includes(v), {
    message: `cbteTipo must be one of: ${VALID_CBTE_TIPOS.join(', ')}`,
  }),
  clientId: z.number().int().positive().optional(),
  docTipo: z.number().int().min(0),
  docNro: z.string().min(1, 'docNro is required'),
  // Condición de IVA del receptor (RG 5616). Obligatoria si docTipo != 99; si no viene se toma la del cliente.
  // Con docTipo 99 (consumidor final sin identificar) el SDK envía 5 (Consumidor Final) si no se indica.
  condicionIva: z.number().int().positive().optional(),
  concepto: z.number().int().min(1).max(3).default(2),
  puntoVenta: z.number().int().positive(),
  items: z
    .array(
      z.object({
        description: z.string().min(1, 'Item description is required'),
        quantity: z.number().positive('Quantity must be positive'),
        unitPrice: z.number().min(0, 'Unit price must be non-negative'),
        ivaId: z.number().refine((v) => (VALID_IVA_IDS as readonly number[]).includes(v), {
          message: `ivaId must be one of: ${VALID_IVA_IDS.join(', ')}`,
        }),
      })
    )
    .min(1, 'At least one item is required'),
  fchServDesde: z.string().regex(/^\d{8}$/, 'Date must be YYYYMMDD format').optional(),
  fchServHasta: z.string().regex(/^\d{8}$/, 'Date must be YYYYMMDD format').optional(),
  fchVtoPago: z.string().regex(/^\d{8}$/, 'Date must be YYYYMMDD format').optional(),
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
  concepto: z.number().int().min(1).max(3).optional(),
  items: z
    .array(
      z.object({
        description: z.string().min(1, 'Item description is required'),
        quantity: z.number().positive('Quantity must be positive'),
        unitPrice: z.number().min(0, 'Unit price must be non-negative'),
        ivaId: z.number().refine((v) => (VALID_IVA_IDS as readonly number[]).includes(v), {
          message: `ivaId must be one of: ${VALID_IVA_IDS.join(', ')}`,
        }),
      })
    )
    .min(1, 'At least one item is required'),
  fchServDesde: z.string().regex(/^\d{8}$/, 'Date must be YYYYMMDD format').optional(),
  fchServHasta: z.string().regex(/^\d{8}$/, 'Date must be YYYYMMDD format').optional(),
  fchVtoPago: z.string().regex(/^\d{8}$/, 'Date must be YYYYMMDD format').optional(),
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
    const filters = {
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      cbteTipo: req.query.cbteTipo ? parseInt(req.query.cbteTipo as string, 10) : undefined,
      clientId: req.query.clientId ? parseInt(req.query.clientId as string, 10) : undefined,
      resultado: typeof req.query.resultado === 'string' && /^[A-Z]$/.test(req.query.resultado)
        ? req.query.resultado
        : undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    };

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
      res.status(400).json({ success: false, error: 'Invalid invoice ID' });
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
      res.status(400).json({ success: false, error: 'Invalid invoice ID' });
      return;
    }

    const result = await invoiceService.recuperarFactura(id);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
