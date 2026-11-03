import { z } from 'zod';

/** Máximo de `limit` en los listados (la UI pide como mucho 100 clientes para los selectores). */
const LIMIT_MAXIMO = 100;

/**
 * `page` y `limit` de los listados (query string). Valores no numéricos o fuera
 * de rango → ZodError (400 en el errorHandler), en vez de un `skip` negativo o
 * un listado sin tope.
 */
export const paginacionSchema = z.object({
  page: z.coerce.number().int().min(1, 'page tiene que ser un entero mayor o igual a 1').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit tiene que ser un entero mayor o igual a 1')
    .max(LIMIT_MAXIMO, `limit no puede ser mayor a ${LIMIT_MAXIMO}`)
    .default(20),
});
