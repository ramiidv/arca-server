import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { paginacionSchema } from '../lib/paginacion';

const router = Router();

const createClientSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(200),
  docType: z.number().int().min(0),
  docNumber: z.string().min(1, 'El número de documento es obligatorio').max(20),
  ivaCondition: z.number().int().min(1),
  address: z.string().max(500).optional(),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
});

const updateClientSchema = createClientSchema.partial();

// POST / - Create client
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createClientSchema.parse(req.body);

    const client = await prisma.client.create({ data });

    res.status(201).json({ success: true, data: client });
  } catch (error) {
    next(error);
  }
});

// GET / - List clients
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const search = typeof req.query.search === 'string' && req.query.search.trim() ? req.query.search.trim() : undefined;
    const { page, limit } = paginacionSchema.parse(req.query);
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { docNumber: { contains: search } },
          ],
        }
      : {};

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        include: {
          _count: { select: { invoices: true } },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      prisma.client.count({ where }),
    ]);

    res.json({
      success: true,
      data: clients,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /:id - Get client with invoice count
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'ID de cliente inválido' });
      return;
    }

    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        _count: { select: { invoices: true } },
      },
    });

    if (!client) {
      throw new AppError(404, `No existe el cliente #${id}`);
    }

    res.json({ success: true, data: client });
  } catch (error) {
    next(error);
  }
});

// PUT /:id - Update client
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'ID de cliente inválido' });
      return;
    }

    const data = updateClientSchema.parse(req.body);

    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, `No existe el cliente #${id}`);
    }

    const client = await prisma.client.update({
      where: { id },
      data,
    });

    res.json({ success: true, data: client });
  } catch (error) {
    next(error);
  }
});

// DELETE /:id - Delete client (only if no invoices)
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'ID de cliente inválido' });
      return;
    }

    const client = await prisma.client.findUnique({
      where: { id },
      include: { _count: { select: { invoices: true } } },
    });

    if (!client) {
      throw new AppError(404, `No existe el cliente #${id}`);
    }

    if (client._count.invoices > 0) {
      throw new AppError(
        409,
        `No se puede eliminar el cliente "${client.name}": tiene ${client._count.invoices} comprobante(s) asociado(s).`
      );
    }

    await prisma.client.delete({ where: { id } });

    res.json({ success: true, message: `Cliente "${client.name}" eliminado` });
  } catch (error) {
    next(error);
  }
});

export default router;
