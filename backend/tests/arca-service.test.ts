import { describe, it, expect, vi } from 'vitest';

// Sin certificados: el server tiene que arrancar igual (para poder generarlos
// desde /api/afip/generate-cert). Los SDKs se crean recién al primer uso.
vi.mock('../src/config', () => ({
  config: {
    afip: {
      cuit: '20123456786',
      certPath: '/no/existe/cert.crt',
      keyPath: '/no/existe/key.key',
      production: false,
      ticketsDir: '/no/existe/tickets',
    },
  },
}));

describe('arca.service sin certificados', () => {
  it('importar el módulo no crea los SDKs ni lee los certificados', async () => {
    await expect(import('../src/services/arca.service')).resolves.toBeDefined();
  });

  it('el primer uso responde 503 con un mensaje claro (AppError), y wsaa-reset no falla', async () => {
    const { arca, resetWsaaCooldown } = await import('../src/services/arca.service');
    const { AppError } = await import('../src/middleware/errorHandler');

    let error: unknown;
    try {
      void arca.ultimoComprobante;
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(503);
    expect((error as Error).message).toMatch(/certificado/);
    expect(resetWsaaCooldown()).toBe(false);
  });
});
