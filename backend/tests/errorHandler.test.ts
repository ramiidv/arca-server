import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';

// El errorHandler solo usa las clases de error: se mockean los SDKs que no
// hacen falta para no cargar nada que pueda tocar la red.
vi.mock('arca-cert', () => {
  class ArcaCertError extends Error {
    code: string;
    soapFault?: { faultcode: string; faultstring: string };
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    ArcaCertError,
    parseSoapFault: (msg: string) =>
      msg.includes('<faultstring>')
        ? { message: 'fault', soapFault: { faultcode: 'soap:Server', faultstring: msg.replace(/.*<faultstring>(.*)<\/faultstring>.*/, '$1') } }
        : null,
  };
});

import {
  ArcaError,
  ArcaAuthError,
  ArcaTicketVigenteError,
  ArcaSoapError,
  ArcaServiceError,
  ArcaValidationError,
  ArcaWSFEError,
  ArcaResultadoIncierto,
  ArcaResultadoInciertoExpo,
} from '@ramiidv/arca-facturacion';
import { ArcaPadronServiceError, ArcaPadronError } from '@ramiidv/arca-padron';
import { ArcaAgroServiceError, ArcaAgroResponseError } from '@ramiidv/arca-agro';
import { ArcaSerializationError } from '@ramiidv/arca-empleados';
import { errorHandler, AppError } from '../src/middleware/errorHandler';

function run(err: Error) {
  let status = 0;
  let body: any;
  const res = {
    status(code: number) { status = code; return this; },
    json(b: unknown) { body = b; return this; },
  } as unknown as Response;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  errorHandler(err, {} as Request, res, () => {});
  return { status, body };
}

const intento = { ptoVta: 1, cbteTipo: 6, cbteNro: 42, importeTotal: 121, docTipo: 99, docNro: 0, fecha: '20261101' };

describe('errorHandler: errores de los SDKs de ARCA', () => {
  it('ArcaValidationError → 400 con field y details', () => {
    const { status, body } = run(
      new ArcaValidationError('Validación: condicionIva es requerido', [{ field: 'condicionIva', message: 'requerido' }], 'condicionIva'),
    );
    expect(status).toBe(400);
    expect(body).toMatchObject({ success: false, code: 'ARCA_VALIDATION_ERROR', field: 'condicionIva' });
    expect(body.details).toEqual([{ field: 'condicionIva', message: 'requerido' }]);
  });

  it('ArcaResultadoIncierto → 502 con uncertain y el intento para recuperar', () => {
    const { status, body } = run(new ArcaResultadoIncierto('FECAESolicitar', [intento]));
    expect(status).toBe(502);
    expect(body.uncertain).toBe(true);
    expect(body.code).toBe('ARCA_RESULTADO_INCIERTO');
    expect(body.recuperacion).toMatchObject({ operacion: 'FECAESolicitar', intento });
  });

  it('ArcaResultadoInciertoExpo → 502 con el Id para reenviar (sin el request completo)', () => {
    const request = { Id: 77, Cbte_Tipo: 19, Punto_vta: 2, Cbte_nro: 5, Fecha_cbte: '20261101' } as any;
    const { status, body } = run(new ArcaResultadoInciertoExpo(request));
    expect(status).toBe(502);
    expect(body.uncertain).toBe(true);
    expect(body.recuperacion).toMatchObject({ id: 77, cbteTipo: 19, ptoVta: 2, cbteNro: 5 });
    expect(body.recuperacion).not.toHaveProperty('request');
  });

  it('ArcaTicketVigenteError → 503 (aunque es subclase de ArcaAuthError)', () => {
    const { status, body } = run(new ArcaTicketVigenteError('wsfe'));
    expect(status).toBe(503);
    expect(body.code).toBe('ARCA_TICKET_VIGENTE');
    expect(body.service).toBe('wsfe');
  });

  it('ArcaAuthError → 503', () => {
    const { status, body } = run(new ArcaAuthError('certificado vencido'));
    expect(status).toBe(503);
    expect(body.code).toBe('ARCA_AUTH_ERROR');
  });

  it('ArcaPadronServiceError: inexistente → 404, inactiva → 422 (antes que ArcaServiceError)', () => {
    const inexistente = run(
      new ArcaPadronServiceError('getPersona: x', [{ code: 0, msg: 'No existe persona con ese Id' }], { reason: 'inexistente' }),
    );
    expect(inexistente.status).toBe(404);
    expect(inexistente.body).toMatchObject({ reason: 'inexistente', error: 'No existe persona con ese Id' });

    const inactiva = run(
      new ArcaPadronServiceError('getPersona: x', [{ code: 0, msg: 'La clave se encuentra INACTIVA' }], { reason: 'inactiva' }),
    );
    expect(inactiva.status).toBe(422);
    expect(inactiva.body.reason).toBe('inactiva');
  });

  it('ArcaWSFEError → 422 con errors (antes que ArcaServiceError)', () => {
    const { status, body } = run(new ArcaWSFEError([{ code: 10015, msg: 'DocNro invalido' }]));
    expect(status).toBe(422);
    expect(body.code).toBe('ARCA_WSFE_ERROR');
    expect(body.errors).toEqual([{ code: 10015, msg: 'DocNro invalido' }]);
  });

  it('ArcaServiceError y subclases de otros SDKs → 422 con errors', () => {
    const agro = run(new ArcaAgroServiceError('WSCPE x', [{ code: 1, msg: 'CTG inválido' }], 'WSCPE', 'autorizarCPEAutomotor', {}));
    expect(agro.status).toBe(422);
    expect(agro.body.code).toBe('ARCA_AGRO_SERVICE_ERROR');
    expect(agro.body.errors).toEqual([{ code: 1, msg: 'CTG inválido' }]);

    const generico = run(new ArcaServiceError('rechazo', [{ code: 5, msg: 'x' }]));
    expect(generico.status).toBe(422);
  });

  it('ArcaSoapError con Fault → 502 con faultCode/faultString y upstreamStatus', () => {
    const { status, body } = run(
      new ArcaSoapError('SOAP Fault: Servicio no disponible', {
        statusCode: 500,
        faultCode: 'soap:Server',
        faultString: 'Servicio no disponible',
        uncertain: false,
      }),
    );
    expect(status).toBe(502);
    expect(body.soapFault).toEqual({ faultcode: 'soap:Server', faultstring: 'Servicio no disponible' });
    expect(body.upstreamStatus).toBe(500);
    expect(body.uncertain).toBe(false);
  });

  it('ArcaSoapError incierto sin respuesta (timeout) → 504', () => {
    const { status, body } = run(new ArcaSoapError('Timeout después de 30000ms', { uncertain: true }));
    expect(status).toBe(504);
    expect(body.uncertain).toBe(true);
    expect(body).not.toHaveProperty('upstreamStatus');
  });

  it('ArcaSoapError sin faultString usa parseSoapFault de arca-cert como fallback', () => {
    const { body } = run(new ArcaSoapError('HTTP 500: <faultstring>Token expirado</faultstring>', 500));
    expect(body.soapFault).toEqual({ faultcode: 'soap:Server', faultstring: 'Token expirado' });
  });

  it('ArcaAgroResponseError, ArcaPadronError y ArcaSerializationError', () => {
    expect(run(new ArcaAgroResponseError('sin COE', true)).body).toMatchObject({ uncertain: true });
    expect(run(new ArcaAgroResponseError('sin COE', true)).status).toBe(502);
    expect(run(new ArcaPadronError('sin persona')).status).toBe(502);
    const ser = run(new ArcaSerializationError('no entra', { field: 'puesto', desde: 85, hasta: 88, indice: 0 }));
    expect(ser.status).toBe(400);
    expect(ser.body).toMatchObject({ field: 'puesto', desde: 85, hasta: 88, indice: 0 });
  });

  it('ArcaError genérico → 400', () => {
    expect(run(new ArcaError('otro')).status).toBe(400);
  });

  it('no filtra cause ni datos internos', () => {
    const cause = new Error('-----BEGIN PRIVATE KEY----- secreto');
    const { body } = run(new ArcaAuthError('falló el login', { cause }));
    expect(JSON.stringify(body)).not.toContain('PRIVATE KEY');
  });
});

describe('errorHandler: errores de la app', () => {
  it('AppError usa su status y details', () => {
    const { status, body } = run(new AppError(409, 'pendiente', true, { id: 1 }));
    expect(status).toBe(409);
    expect(body).toEqual({ success: false, error: 'pendiente', details: { id: 1 } });
  });

  it('error desconocido → 500 sin detalles', () => {
    const { status, body } = run(new Error('boom'));
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Internal server error' });
  });
});
