import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import {
  loginResponse,
  mockFetchWith,
  soapEnvelope,
  soapFaultResponse,
  testCert,
} from '@ramiidv/arca-common/testing';
import type { RecordedRequest } from '@ramiidv/arca-common/testing';

// ------------------------------------------------------------
// End to end de las rutas /api/afip con los SDKs reales (arca.service real:
// un WsaaClient compartido, FileTicketStorage), con ARCA simulado vía fetch.
// ------------------------------------------------------------

// vi.hoisted corre antes de los imports: se usa require para crear el directorio temporal.
const dir = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arca-e2e-'));
});

vi.mock('../src/config', () => ({
  config: {
    afip: {
      cuit: '20123456786',
      certPath: `${dir}/cert.crt`,
      keyPath: `${dir}/key.key`,
      production: false,
      puntoVenta: 1,
      recoveryDelayMs: 0,
      ticketsDir: `${dir}/tickets`,
    },
  },
}));

const WSFE_NS = 'http://ar.gov.afip.dif.FEV1/';
const WSFEX_NS = 'http://ar.gov.afip.dif.fexv1/';
const WSCDC_NS = 'http://servicios1.afip.gob.ar/wscdc/';

function asmx(ns: string, method: string, inner: string): string {
  return soapEnvelope(`<${method}Response xmlns="${ns}"><${method}Result>${inner}</${method}Result></${method}Response>`);
}

/** Respuestas por método SOAP; `login` decide la respuesta de WSAA por servicio. */
let handlers: Record<string, (req: RecordedRequest) => Response | string>;
let login: (service: string) => Response | string;

/** Servicio pedido en un loginCms (el TRA va firmado en base64; el XML del TRA queda legible adentro). */
function serviceDe(req: RecordedRequest): string | undefined {
  const cms = /<(?:\w+:)?in0>([^<]+)</.exec(req.body)?.[1] ?? '';
  return /<service>([^<]+)<\/service>/.exec(Buffer.from(cms, 'base64').toString('latin1'))?.[1];
}

const fetchMock = mockFetchWith((req) => {
  if (req.method === 'loginCms') return login(serviceDe(req) ?? '?');
  const h = req.method && handlers[req.method];
  if (!h) throw new Error(`Método sin respuesta en el test: ${req.method}`);
  return h(req);
});

const loginsDe = (service: string) => fetchMock.calls.filter((c) => c.method === 'loginCms' && serviceDe(c) === service).length;
const logins = () => fetchMock.calls.filter((c) => c.method === 'loginCms').length;

let server: Server;
let baseUrl: string;
let arcaService: typeof import('../src/services/arca.service');

beforeAll(async () => {
  const { cert, key } = testCert();
  fs.writeFileSync(path.join(dir, 'cert.crt'), cert);
  fs.writeFileSync(path.join(dir, 'key.key'), key);
  vi.stubGlobal('fetch', fetchMock);

  arcaService = await import('../src/services/arca.service');
  const { default: afipRoutes } = await import('../src/routes/afip');
  const { errorHandler } = await import('../src/middleware/errorHandler');

  const app = express();
  app.use(express.json());
  app.use('/api/afip', afipRoutes);
  app.use(errorHandler);
  // Solo lo usa el test para hablar con el server: no pasa por el fetch simulado.
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/afip`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  login = (service) => loginResponse(`token-${service}`, new Date(Date.now() + 12 * 3600_000));
  handlers = {};
});

// El fetch global está simulado (es el de ARCA): al server del test se le habla con http.
async function api(pathname: string, init?: { method?: string; body?: unknown }) {
  const { request } = await import('http');
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const url = new URL(`${baseUrl}${pathname}`);
    const data = init?.body === undefined ? undefined : JSON.stringify(init.body);
    const req = request(
      url,
      { method: init?.method ?? 'GET', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : undefined }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('arca.service: instancias', () => {
  it('los 7 SDKs comparten un solo WsaaClient', () => {
    const { arca, padron, cdc, fecred, mtxca, sire, agro } = arcaService;
    const wsaa = arca.wsaa;
    expect(wsaa).toBeDefined();
    for (const sdk of [padron, cdc, fecred, mtxca, sire, agro]) expect(sdk.wsaa).toBe(wsaa);
  });
});

describe('GET /api/afip/status (WSFEv1 + WSFEX, sin WSAA)', () => {
  it('devuelve { wsfe, wsfex } con ServiceStatus; un servidor caído da ok: false con status', async () => {
    handlers.FEDummy = () =>
      asmx(WSFE_NS, 'FEDummy', '<AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>');
    handlers.FEXDummy = () =>
      asmx(WSFEX_NS, 'FEXDummy', '<AppServer>OK</AppServer><DbServer>NO</DbServer><AuthServer>OK</AuthServer>');

    const { status, body } = await api('/status');

    expect(status).toBe(200);
    expect(body.data.wsfe).toEqual({ ok: true, status: { appserver: 'OK', dbserver: 'OK', authserver: 'OK' } });
    expect(body.data.wsfex.ok).toBe(false);
    expect(body.data.wsfex.status).toEqual({ appserver: 'OK', dbserver: 'NO', authserver: 'OK' });
    expect(typeof body.data.wsfex.error).toBe('string');
  });
});

describe('WSFEv1 con login WSAA (camelCase de arca-facturacion 6)', () => {
  it('GET /comprobante devuelve resultGet en camelCase con listas como arrays y events', async () => {
    handlers.FECompConsultar = () =>
      asmx(
        WSFE_NS,
        'FECompConsultar',
        '<ResultGet>' +
          '<Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro>' +
          '<CbteDesde>42</CbteDesde><CbteHasta>42</CbteHasta><CbteFch>20261030</CbteFch>' +
          '<ImpTotal>1210</ImpTotal><ImpTotConc>0</ImpTotConc><ImpNeto>1000</ImpNeto><ImpOpEx>0</ImpOpEx>' +
          '<ImpTrib>0</ImpTrib><ImpIVA>210</ImpIVA><FchServDesde/><FchServHasta/><FchVtoPago/>' +
          '<MonId>PES</MonId><MonCotiz>1</MonCotiz>' +
          '<Iva><AlicIva><Id>5</Id><BaseImp>1000</BaseImp><Importe>210</Importe></AlicIva></Iva>' +
          '<Resultado>A</Resultado><CodAutorizacion>76123456789012</CodAutorizacion>' +
          '<EmisionTipo>CAE</EmisionTipo><FchVto>20261109</FchVto><FchProceso>20261030120000</FchProceso>' +
          '<PtoVta>1</PtoVta><CbteTipo>6</CbteTipo>' +
          '</ResultGet>' +
          '<Events><Evt><Code>1</Code><Msg>aviso</Msg></Evt></Events>',
      );

    const { status, body } = await api('/comprobante?puntoVenta=1&cbteTipo=6&cbteNro=42');

    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      cbteDesde: 42,
      cbteFch: '20261030',
      impTotal: 1210,
      impIva: 210,
      monId: 'PES',
      resultado: 'A',
      codAutorizacion: '76123456789012',
      emisionTipo: 'CAE',
      ptoVta: 1,
      cbteTipo: 6,
      iva: [{ id: 5, baseImp: 1000, importe: 210 }],
      tributos: [],
      cbtesAsoc: [],
      opcionales: [],
      observaciones: [],
      events: [{ code: 1, msg: 'aviso' }],
    });
    expect(body.data).not.toHaveProperty('ResultGet');
    expect(body.data).not.toHaveProperty('ImpTotal');
  });

  it('el ticket de wsfe se pide una sola vez y se persiste (FileTicketStorage)', async () => {
    handlers.FECompUltimoAutorizado = () =>
      asmx(WSFE_NS, 'FECompUltimoAutorizado', '<PtoVta>1</PtoVta><CbteTipo>6</CbteTipo><CbteNro>41</CbteNro>');
    await api('/last-voucher?puntoVenta=1&cbteTipo=6');
    await api('/last-voucher?puntoVenta=1&cbteTipo=6');
    expect(loginsDe('wsfe')).toBe(1);
    expect(fs.readdirSync(path.join(dir, 'tickets')).length).toBeGreaterThan(0);
  });

  it('GET /last-voucher → { cbteNro, ptoVta, cbteTipo }', async () => {
    handlers.FECompUltimoAutorizado = () =>
      asmx(WSFE_NS, 'FECompUltimoAutorizado', '<PtoVta>1</PtoVta><CbteTipo>6</CbteTipo><CbteNro>41</CbteNro>');
    const { body } = await api('/last-voucher?puntoVenta=1&cbteTipo=6');
    expect(body.data).toEqual({ cbteNro: 41, ptoVta: 1, cbteTipo: 6 });
  });

  it('GET /cotizacion → { monId, monCotiz, fchCotiz }', async () => {
    handlers.FEParamGetCotizacion = () =>
      asmx(
        WSFE_NS,
        'FEParamGetCotizacion',
        '<ResultGet><MonId>DOL</MonId><MonCotiz>1045.5</MonCotiz><FchCotiz>20261030</FchCotiz></ResultGet>',
      );
    const { body } = await api('/cotizacion?monedaId=DOL');
    expect(body.data).toEqual({ monId: 'DOL', monCotiz: 1045.5, fchCotiz: '20261030' });
  });

  it('GET /puntos-venta → [{ nro, emisionTipo, bloqueado, fchBaja }]', async () => {
    handlers.FEParamGetPtosVenta = () =>
      asmx(
        WSFE_NS,
        'FEParamGetPtosVenta',
        '<ResultGet><PtoVenta><Nro>3</Nro><EmisionTipo>CAE - Ws</EmisionTipo><Bloqueado>N</Bloqueado><FchBaja>NULL</FchBaja></PtoVenta></ResultGet>',
      );
    const { body } = await api('/puntos-venta');
    expect(body.data).toEqual([{ nro: 3, emisionTipo: 'CAE - Ws', bloqueado: 'N', fchBaja: 'NULL' }]);
  });

  it('WSFE 600 → ArcaAuthError → 503 con faultCode 600, no reintentable y sin bloqueo de WSAA', async () => {
    handlers.FECompUltimoAutorizado = () =>
      asmx(
        WSFE_NS,
        'FECompUltimoAutorizado',
        '<Errors><Err><Code>600</Code><Msg>ValidacionDeToken: No aparecio CUIT en lista de relaciones</Msg></Err></Errors>',
      );
    const { status, body } = await api('/last-voucher?puntoVenta=1&cbteTipo=6');
    expect(status).toBe(503);
    expect(body).toMatchObject({ code: 'ARCA_AUTH_ERROR', faultCode: '600', retryable: false, blocked: false });
  });

  it('WSFE 602 sigue siendo ArcaWSFEError → 422', async () => {
    handlers.FECompConsultar = () =>
      asmx(WSFE_NS, 'FECompConsultar', '<Errors><Err><Code>602</Code><Msg>Sin Resultados</Msg></Err></Errors>');
    const { status, body } = await api('/comprobante?puntoVenta=1&cbteTipo=6&cbteNro=999');
    expect(status).toBe(422);
    expect(body.errors).toEqual([{ code: 602, msg: 'Sin Resultados' }]);
  });
});

describe('POST /api/afip/constatar (arca-cdc 0.6, camelCase)', () => {
  const input = {
    cbteModo: 'CAE',
    cuitEmisor: '30712345671',
    ptoVta: 1,
    cbteTipo: 1,
    cbteNro: 150,
    cbteFch: '20260315',
    impTotal: 12100.46,
    codAutorizacion: '73429843294823',
    docTipoReceptor: 80,
    docNroReceptor: '20123456786',
  };

  it('envía el CmpReq y devuelve { resultado, fchProceso, cmpResp, observaciones, events }', async () => {
    let enviado = '';
    handlers.ComprobanteConstatar = (req) => {
      enviado = req.body;
      return asmx(
        WSCDC_NS,
        'ComprobanteConstatar',
        '<CmpResp><CbteModo>CAE</CbteModo><CuitEmisor>30712345671</CuitEmisor><PtoVta>1</PtoVta>' +
          '<CbteTipo>1</CbteTipo><CbteNro>150</CbteNro><CbteFch>20260315</CbteFch><ImpTotal>12100.46</ImpTotal>' +
          '<CodAutorizacion>73429843294823</CodAutorizacion><DocTipoReceptor>80</DocTipoReceptor>' +
          '<DocNroReceptor>20123456786</DocNroReceptor></CmpResp>' +
          '<Resultado>A</Resultado><FchProceso>20261101120000</FchProceso>',
      );
    };

    const { status, body } = await api('/constatar', { method: 'POST', body: input });

    expect(status).toBe(200);
    expect(enviado).toContain('<CbteModo>CAE</CbteModo>');
    expect(enviado).toContain('<CodAutorizacion>73429843294823</CodAutorizacion>');
    expect(body.data).toMatchObject({
      resultado: 'A',
      fchProceso: '20261101120000',
      observaciones: [],
      events: [],
      cmpResp: { cbteNro: 150, codAutorizacion: '73429843294823' },
    });
  });

  it('el body PascalCase viejo se rechaza con 400 (ArcaValidationError)', async () => {
    const { status, body } = await api('/constatar', {
      method: 'POST',
      body: { CbteModo: 'CAE', CuitEmisor: '30712345671', PtoVta: 1, CbteTipo: 1, CbteNro: 150 },
    });
    expect(status).toBe(400);
    expect(body.code).toBe('ARCA_VALIDATION_ERROR');
  });

  it('respuesta sin Resultado → ArcaResponseError → 502', async () => {
    handlers.ComprobanteConstatar = () => asmx(WSCDC_NS, 'ComprobanteConstatar', '<FchProceso>20261101120000</FchProceso>');
    const { status, body } = await api('/constatar', { method: 'POST', body: input });
    expect(status).toBe(502);
    expect(body.code).toBe('ARCA_RESPONSE_ERROR');
  });
});

describe('WSAA: error permanente → servicio bloqueado hasta POST /wsaa-reset', () => {
  it('cms.cert.expired bloquea el servicio; /wsaa-reset vuelve a habilitar el login', async () => {
    login = () => soapFaultResponse('ns1:cms.cert.expired', 'Certificado expirado');

    // padron (servicio ws_sr_padron_a4) no tiene ticket todavía: el login falla y queda bloqueado
    const primero = await api('/contribuyente/20123456786');
    expect(primero.status).toBe(503);
    expect(primero.body).toMatchObject({ code: 'ARCA_AUTH_ERROR', retryable: false, blocked: true });

    const antes = logins();
    const segundo = await api('/contribuyente/20123456786');
    expect(segundo.status).toBe(503);
    expect(segundo.body.blocked).toBe(true);
    // No se volvió a llamar a WSAA
    expect(logins()).toBe(antes);

    const reset = await api('/wsaa-reset', { method: 'POST' });
    expect(reset.body.data.reset).toBe(true);

    login = (service) => loginResponse(`token-${service}`, new Date(Date.now() + 12 * 3600_000));
    handlers.getPersona = () =>
      soapEnvelope(
        '<ns2:getPersonaResponse xmlns:ns2="http://a4.soap.ws.server.puc.sr/"><personaReturn>' +
          '<metadata><fechaHora>2026-11-01T12:00:00</fechaHora><servidor>srv</servidor></metadata>' +
          '<persona><idPersona>20123456786</idPersona><tipoPersona>FISICA</tipoPersona><estadoClave>ACTIVO</estadoClave>' +
          '<nombre>JUAN</nombre><apellido>PEREZ</apellido>' +
          '<impuesto><idImpuesto>30</idImpuesto><estado>ACTIVO</estado><periodo>201001</periodo></impuesto>' +
          '</persona></personaReturn></ns2:getPersonaResponse>',
      );
    const tercero = await api('/contribuyente/20123456786');
    expect(logins()).toBe(antes + 1);
    expect(tercero.status).toBe(200);
    expect(tercero.body.data).toMatchObject({
      idPersona: '20123456786',
      apellido: 'PEREZ',
      metadata: { fechaHora: '2026-11-01T12:00:00', servidor: 'srv' },
    });
    expect(tercero.body.data.condicionIvaSugerida).toHaveProperty('condicionIva');
  });
});


describe('POST /api/afip/test-cert (WsaaClient del SDK)', () => {
  it('el ticket queda en el ticketStorage de los SDKs: el SDK no vuelve a loguearse', async () => {
    const r = await api('/test-cert', { method: 'POST', body: { environment: 'testing' } });
    expect(r.status).toBe(200);
    expect(r.body.data.valid).toBe(true);
    const despues = loginsDe('wsfe');
    expect(despues).toBeGreaterThanOrEqual(1);

    handlers.FECompUltimoAutorizado = () =>
      asmx(WSFE_NS, 'FECompUltimoAutorizado', '<PtoVta>1</PtoVta><CbteTipo>6</CbteTipo><CbteNro>41</CbteNro>');
    expect((await api('/last-voucher?puntoVenta=1&cbteTipo=6')).status).toBe(200);
    expect(loginsDe('wsfe')).toBe(despues);
  });

  it('otro entorno usa un WsaaClient temporal con el mismo storage', async () => {
    const antes = loginsDe('wsfe');
    expect((await api('/test-cert', { method: 'POST', body: { environment: 'production' } })).status).toBe(200);
    expect(loginsDe('wsfe')).toBe(antes + 1);
    // El ticket de producción quedó guardado: una segunda prueba no pide otro.
    expect((await api('/test-cert', { method: 'POST', body: { environment: 'production' } })).status).toBe(200);
    expect(loginsDe('wsfe')).toBe(antes + 1);
  });

  it('environment inválido → 400', async () => {
    expect((await api('/test-cert', { method: 'POST', body: { environment: 'prod' } })).status).toBe(400);
  });
});
