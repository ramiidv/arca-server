import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  ArcaFacturacion,
  IVA_RATES,
  IvaTipo,
  CbteTipo,
  Concepto,
  DocTipo,
  Moneda,
  CondicionIva,
  NOTA_CREDITO_MAP,
  NOTA_DEBITO_MAP,
  ArcaError,
  ArcaAuthError,
  ArcaTicketVigenteError,
  ArcaServiceError,
  ArcaValidationError,
  ArcaWSFEError,
  ArcaSoapError,
  ArcaResultadoIncierto,
  ArcaConflictoExpo,
  ArcaResponseError,
  WSFE_ERRORES_AUTH,
  FileTicketStorage,
  armarComprobante,
  calcularTotales,
  generarUrlQR,
  urlQRDesdeFactura,
  requiereRecuperacion,
} from '@ramiidv/arca-facturacion';
import type { FacturaResult } from '@ramiidv/arca-facturacion';
import { formatDate, createWsaaClient } from '@ramiidv/arca-common';
import { testCert } from '@ramiidv/arca-common/testing';
import { ArcaPadron, ArcaPadronServiceError } from '@ramiidv/arca-padron';
import { ArcaCdc } from '@ramiidv/arca-cdc';
import { ArcaEmpleados } from '@ramiidv/arca-empleados';

// CUIT de ejemplo con dígito verificador válido (los SDKs lo validan).
const CUIT = 20123456786;

/** Decodifica el JSON del parámetro `p` de una URL de QR. */
function payloadQR(url: string): Record<string, unknown> {
  const p = new URL(url).searchParams.get('p')!;
  return JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
}

// ============================================================
// Tests unitarios (sin certificados ni conexión a ARCA)
// ============================================================

describe('arca-facturacion: constantes y enums', () => {
  it('IVA_RATES mapea todos los IvaTipo a porcentajes correctos', () => {
    expect(IVA_RATES[IvaTipo.IVA_0]).toBe(0);
    expect(IVA_RATES[IvaTipo.IVA_2_5]).toBe(2.5);
    expect(IVA_RATES[IvaTipo.IVA_5]).toBe(5);
    expect(IVA_RATES[IvaTipo.IVA_10_5]).toBe(10.5);
    expect(IVA_RATES[IvaTipo.IVA_21]).toBe(21);
    expect(IVA_RATES[IvaTipo.IVA_27]).toBe(27);
  });

  it('CbteTipo tiene los tipos principales', () => {
    expect(CbteTipo.FACTURA_A).toBe(1);
    expect(CbteTipo.FACTURA_B).toBe(6);
    expect(CbteTipo.FACTURA_C).toBe(11);
    expect(CbteTipo.NOTA_CREDITO_A).toBe(3);
    expect(CbteTipo.NOTA_DEBITO_B).toBe(7);
    expect(CbteTipo.FACTURA_E).toBe(19);
  });

  it('Concepto tiene los 3 valores', () => {
    expect(Concepto.PRODUCTOS).toBe(1);
    expect(Concepto.SERVICIOS).toBe(2);
    expect(Concepto.PRODUCTOS_Y_SERVICIOS).toBe(3);
  });

  it('DocTipo tiene los tipos comunes', () => {
    expect(DocTipo.CUIT).toBe(80);
    expect(DocTipo.DNI).toBe(96);
    expect(DocTipo.CONSUMIDOR_FINAL).toBe(99);
  });

  it('Moneda tiene PES para pesos', () => {
    expect(Moneda.PESOS).toBe('PES');
    expect(Moneda.DOLARES).toBe('DOL');
  });

  it('Moneda: 029 es guaraní y 031 peso boliviano (corregido en 6.1)', () => {
    expect(Moneda.GUARANIES).toBe('029');
    expect(Moneda.BOLIVIANOS).toBe('031');
  });

  it('NOTA_CREDITO_MAP mapea facturas a sus NC correspondientes', () => {
    expect(NOTA_CREDITO_MAP[CbteTipo.FACTURA_A]).toBe(CbteTipo.NOTA_CREDITO_A);
    expect(NOTA_CREDITO_MAP[CbteTipo.FACTURA_B]).toBe(CbteTipo.NOTA_CREDITO_B);
    expect(NOTA_CREDITO_MAP[CbteTipo.FACTURA_C]).toBe(CbteTipo.NOTA_CREDITO_C);
  });

  it('CondicionIva tiene las condiciones principales', () => {
    expect(CondicionIva.RESPONSABLE_INSCRIPTO).toBe(1);
    expect(CondicionIva.EXENTO).toBe(4);
    expect(CondicionIva.CONSUMIDOR_FINAL).toBe(5);
    expect(CondicionIva.MONOTRIBUTISTA).toBe(6);
    expect(CondicionIva.CLIENTE_EXTERIOR).toBe(9);
    expect(CondicionIva.MONOTRIBUTO_SOCIAL).toBe(13);
  });

  it('NOTA_DEBITO_MAP mapea facturas a sus ND correspondientes', () => {
    expect(NOTA_DEBITO_MAP[CbteTipo.FACTURA_A]).toBe(CbteTipo.NOTA_DEBITO_A);
    expect(NOTA_DEBITO_MAP[CbteTipo.FACTURA_B]).toBe(CbteTipo.NOTA_DEBITO_B);
    expect(NOTA_DEBITO_MAP[CbteTipo.FACTURA_C]).toBe(CbteTipo.NOTA_DEBITO_C);
  });
});

describe('arca-common: formatDate() (reemplaza a Arca.formatDate, quitado en facturacion 6)', () => {
  it('formatea Date a YYYYMMDD con la fecha calendario de Argentina', () => {
    expect(formatDate(new Date('2026-06-15T12:00:00-03:00'))).toBe('20260615');
    // 01:00 UTC del 1/1 es todavía 31/12 en Argentina
    expect(formatDate(new Date('2026-01-01T01:00:00Z'))).toBe('20251231');
  });

  it('acepta YYYYMMDD y YYYY-MM-DD literal', () => {
    expect(formatDate('20260315')).toBe('20260315');
    expect(formatDate('2026-03-15')).toBe('20260315');
  });

  it('es estricto: fechas inexistentes u otros formatos lanzan ArcaValidationError', () => {
    expect(() => formatDate('20261399')).toThrow(ArcaValidationError);
    expect(() => formatDate('20230230')).toThrow(ArcaValidationError);
    expect(() => formatDate('2026-03-15T10:00:00Z')).toThrow(ArcaValidationError);
  });

  it('ArcaFacturacion ya no expone formatDate/calcularTotales estáticos', () => {
    expect((ArcaFacturacion as unknown as Record<string, unknown>).formatDate).toBeUndefined();
    expect((ArcaFacturacion as unknown as Record<string, unknown>).calcularTotales).toBeUndefined();
  });
});

describe('arca-facturacion: QR (generarUrlQR / urlQRDesdeFactura)', () => {
  const base = {
    fecha: '20261030',
    cuit: CUIT,
    ptoVta: 1,
    tipoCmp: CbteTipo.FACTURA_B,
    nroCmp: 150,
    importe: 121,
    moneda: 'PES',
    ctz: 1,
    codAut: '73429843294823',
  };

  it('usa la URL de la especificación vigente y la fecha como YYYY-MM-DD', () => {
    const url = generarUrlQR(base);
    expect(url.startsWith('https://www.arca.gob.ar/fe/qr/?p=')).toBe(true);
    const p = payloadQR(url);
    expect(p.fecha).toBe('2026-10-30');
    expect(p.codAut).toBe(73429843294823);
    expect(p.tipoCodAut).toBe('E');
    // tipoDocRec/nroDocRec son "de corresponder": si no vienen, no se incluyen
    expect(p).not.toHaveProperty('tipoDocRec');
  });

  it('ArcaFacturacion.generateQRUrl acepta baseUrl', () => {
    const url = ArcaFacturacion.generateQRUrl(base, { baseUrl: 'https://www.afip.gob.ar/fe/qr/' });
    expect(url.startsWith('https://www.afip.gob.ar/fe/qr/?p=')).toBe(true);
  });

  it('valida CUIT y CAE', () => {
    expect(() => generarUrlQR({ ...base, cuit: 20123456789 })).toThrow(ArcaValidationError);
    expect(() => generarUrlQR({ ...base, codAut: '123' })).toThrow(ArcaValidationError);
  });

  it('urlQRDesdeFactura arma el QR desde un FacturaResult', () => {
    const factura = {
      aprobada: true,
      cae: '73429843294823',
      caeVencimiento: '20261110',
      cbteNro: 150,
      ptoVta: 1,
      cbteTipo: CbteTipo.FACTURA_B,
      importes: { total: 121, neto: 100, iva: 21, exento: 0, noGravado: 0, tributos: 0 },
      observaciones: [],
      eventos: [],
      fecha: '20261030',
      docTipo: DocTipo.CONSUMIDOR_FINAL,
      docNro: 0,
      moneda: 'PES',
      cotizacion: 1,
      tipoCodAut: 'E',
      raw: {} as FacturaResult['raw'],
    } satisfies FacturaResult;
    const p = payloadQR(urlQRDesdeFactura(factura, { cuit: CUIT }));
    expect(p).toMatchObject({ cuit: CUIT, nroCmp: 150, importe: 121, tipoDocRec: 99, nroDocRec: 0 });
  });

  it('no arma QR de un comprobante no aprobado', () => {
    const factura = { aprobada: false, cbteNro: 1, ptoVta: 1, cbteTipo: 6 } as unknown as FacturaResult;
    expect(() => urlQRDesdeFactura(factura, { cuit: CUIT })).toThrow(ArcaValidationError);
  });
});

describe('arca-facturacion: calcularTotales()', () => {
  it('calcula totales para items con IVA 21%', () => {
    const { importes, iva } = calcularTotales([{ neto: 1000, iva: IvaTipo.IVA_21 }]);

    expect(importes).toMatchObject({ neto: 1000, iva: 210, total: 1210, exento: 0, noGravado: 0, tributos: 0 });
    expect(iva).toEqual([{ id: IvaTipo.IVA_21, baseImp: 1000, importe: 210 }]);
  });

  it('calcula totales con múltiples alícuotas', () => {
    const { importes, iva } = calcularTotales([
      { neto: 1000, iva: IvaTipo.IVA_21 },
      { neto: 500, iva: IvaTipo.IVA_10_5 },
    ]);

    expect(importes.neto).toBe(1500);
    expect(importes.iva).toBe(262.5);
    expect(importes.total).toBe(1762.5);
    expect(iva).toHaveLength(2);
  });

  it('agrupa items con la misma alícuota', () => {
    const { importes, iva } = calcularTotales([
      { neto: 300, iva: IvaTipo.IVA_21 },
      { neto: 700, iva: IvaTipo.IVA_21 },
    ]);

    expect(importes.neto).toBe(1000);
    expect(importes.iva).toBe(210);
    expect(iva).toEqual([{ id: IvaTipo.IVA_21, baseImp: 1000, importe: 210 }]);
  });

  it('mezcla gravados, exentos y no gravados', () => {
    const { importes } = calcularTotales([
      { neto: 1000, iva: IvaTipo.IVA_21 },
      { neto: 500, exento: true },
      { neto: 200 },
    ]);

    expect(importes).toMatchObject({ neto: 1000, iva: 210, exento: 500, noGravado: 200, total: 1910 });
  });

  it('items con precio final (IVA incluido)', () => {
    const { importes } = calcularTotales([{ total: 1210, iva: IvaTipo.IVA_21 }]);
    expect(importes).toMatchObject({ neto: 1000, iva: 210, total: 1210 });
  });

  it('tipo C no discrimina IVA', () => {
    const { importes, iva } = calcularTotales([{ neto: 1000, iva: IvaTipo.IVA_21 }], { tipoC: true });

    expect(importes.iva).toBe(0);
    expect(importes.total).toBe(1000);
    expect(iva).toHaveLength(0);
  });

  it('un item con iva y exento a la vez es inválido', () => {
    expect(() => calcularTotales([{ neto: 500, iva: IvaTipo.IVA_21, exento: true }])).toThrow(ArcaValidationError);
  });

  it('lanza ArcaValidationError para IvaTipo desconocido', () => {
    expect(() => calcularTotales([{ neto: 100, iva: 999 }])).toThrow(ArcaValidationError);
  });

  it('incluye tributos en el total', () => {
    const { importes } = calcularTotales([{ neto: 1000, iva: IvaTipo.IVA_21 }], {
      tributos: [{ importe: 50 }, { importe: 30 }],
    });

    expect(importes.tributos).toBe(80);
    expect(importes.total).toBe(1290);
  });
});

describe('arca-facturacion: armarComprobante() y resultado incierto', () => {
  it('arma el comprobante sin red y devuelve el intento para recuperarlo', () => {
    const { request, importes, intento } = armarComprobante({
      ptoVta: 1,
      cbteTipo: CbteTipo.FACTURA_B,
      cbteNro: 151,
      fecha: '20261101',
      items: [{ total: 1210, iva: IvaTipo.IVA_21 }],
    });

    expect(intento).toEqual({
      ptoVta: 1,
      cbteTipo: CbteTipo.FACTURA_B,
      cbteNro: 151,
      importeTotal: 1210,
      docTipo: DocTipo.CONSUMIDOR_FINAL,
      docNro: 0,
      fecha: '20261101',
    });
    expect(importes.total).toBe(1210);
    expect(request.cbteDesde).toBe(151);
    // Consumidor final sin identificar: el SDK completa condicionIvaReceptorId = 5
    expect(request.condicionIvaReceptorId).toBe(CondicionIva.CONSUMIDOR_FINAL);
  });

  it('clase A exige receptor con CUIT (docTipo 80, validación 10013)', () => {
    expect(() =>
      armarComprobante({
        ptoVta: 1,
        cbteTipo: CbteTipo.FACTURA_A,
        cbteNro: 1,
        docTipo: DocTipo.DNI,
        docNro: 12345678,
        condicionIva: CondicionIva.RESPONSABLE_INSCRIPTO,
        items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
      }),
    ).toThrow(ArcaValidationError);
  });

  it('NC/ND sin comprobantes ni período asociado es inválida (validación 10197)', () => {
    expect(() =>
      armarComprobante({
        ptoVta: 1,
        cbteTipo: CbteTipo.NOTA_CREDITO_B,
        cbteNro: 1,
        items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
      }),
    ).toThrow(ArcaValidationError);
  });

  it('servicios: vtoPago se puede indicar fuera de servicio (6.1)', () => {
    const { request } = armarComprobante({
      ptoVta: 1,
      cbteTipo: CbteTipo.FACTURA_B,
      cbteNro: 1,
      fecha: '20261101',
      concepto: Concepto.SERVICIOS,
      servicio: { desde: '20261001', hasta: '20261031' },
      vtoPago: '20261110',
      items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
    });
    expect(request.fchVtoPago).toBe('20261110');
  });

  it('exige condicionIva si el receptor está identificado (RG 5616)', () => {
    expect(() =>
      armarComprobante({
        ptoVta: 1,
        cbteTipo: CbteTipo.FACTURA_A,
        cbteNro: 1,
        docTipo: DocTipo.CUIT,
        docNro: 30712345671,
        items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
      }),
    ).toThrow(/condicionIva/);
  });

  it('servicios (concepto 2) exigen servicio', () => {
    expect(() =>
      armarComprobante({
        ptoVta: 1,
        cbteTipo: CbteTipo.FACTURA_B,
        cbteNro: 1,
        concepto: Concepto.SERVICIOS,
        items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
      }),
    ).toThrow(ArcaValidationError);
  });

  it('requiereRecuperacion distingue el 10016 por número del 10016 por fecha', () => {
    const rechazo = (msg: string) =>
      ({ aprobada: false, observaciones: [{ code: 10016, msg }] }) as unknown as FacturaResult;
    expect(requiereRecuperacion(rechazo('El numero o fecha del comprobante no se corresponde con el proximo a autorizar'))).toBe(true);
    expect(requiereRecuperacion(rechazo('La fecha del comprobante (CbteFch) no se encuentra en el rango permitido'))).toBe(false);
  });

  it('ArcaResultadoIncierto lleva el intento y la operación', () => {
    const intento = { ptoVta: 1, cbteTipo: 6, cbteNro: 10, importeTotal: 121, docTipo: 99, docNro: 0, fecha: '20261101' };
    const err = new ArcaResultadoIncierto('FECAESolicitar', [intento]);
    expect(err).toBeInstanceOf(ArcaError);
    expect(err.code).toBe('ARCA_RESULTADO_INCIERTO');
    expect(err.intento).toEqual(intento);
    expect(err.operacion).toBe('FECAESolicitar');
  });
});

describe('arca-facturacion: clases de error', () => {
  it('ArcaAuthError extiende ArcaError y ArcaTicketVigenteError extiende ArcaAuthError', () => {
    const err = new ArcaTicketVigenteError('wsfe');
    expect(err).toBeInstanceOf(ArcaAuthError);
    expect(err).toBeInstanceOf(ArcaError);
    expect(err.service).toBe('wsfe');
    expect(new ArcaAuthError('x').name).toBe('ArcaAuthError');
  });

  it('ArcaWSFEError extiende ArcaServiceError, con errors y tieneCodigo', () => {
    const err = new ArcaWSFEError([
      { code: 10016, msg: 'DocNro invalido' },
      { code: 10017, msg: 'Fecha invalida' },
    ]);
    expect(err).toBeInstanceOf(ArcaServiceError);
    expect(err).toBeInstanceOf(ArcaError);
    expect(err.errors).toHaveLength(2);
    expect(err.tieneCodigo(10017)).toBe(true);
    expect(err.message).toContain('[10016]');
    expect(err.code).toBe('ARCA_WSFE_ERROR');
  });

  it('ArcaSoapError acepta opciones (statusCode, faultString, uncertain)', () => {
    const err = new ArcaSoapError('SOAP Fault: x', { statusCode: 500, faultCode: 'soap:Server', faultString: 'x', uncertain: true });
    expect(err.statusCode).toBe(500);
    expect(err.faultString).toBe('x');
    expect(err.uncertain).toBe(true);
    expect(new ArcaSoapError('timeout', 408).statusCode).toBe(408);
    expect(new ArcaSoapError('network error').uncertain).toBe(false);
  });

  it('WSFE_ERRORES_AUTH: 600/601 llegan como ArcaAuthError (6.1)', () => {
    expect([...WSFE_ERRORES_AUTH]).toEqual([600, 601]);
  });

  it('ArcaResponseError (de arca-common) se reexporta y no es ArcaSoapError', () => {
    const err = new ArcaResponseError('falta Resultado', true);
    expect(err).toBeInstanceOf(ArcaError);
    expect(err).not.toBeInstanceOf(ArcaSoapError);
    expect(err.uncertain).toBe(true);
  });

  it('ArcaConflictoExpo extiende ArcaError (no es incierto)', () => {
    expect(ArcaConflictoExpo.code).toBe('ARCA_CONFLICTO_EXPO');
  });

  it('ArcaAuthError tiene faultCode y retryable (default false)', () => {
    const err = new ArcaAuthError('x', { faultCode: 'ns1:cms.cert.expired' });
    expect(err.faultCode).toBe('ns1:cms.cert.expired');
    expect(err.retryable).toBe(false);
    expect(new ArcaAuthError('y', { retryable: true }).retryable).toBe(true);
  });

  it('ArcaPadronServiceError extiende ArcaServiceError con reason', () => {
    const err = new ArcaPadronServiceError('x', [{ code: 0, msg: 'No existe persona con ese Id' }], { reason: 'inexistente' });
    expect(err).toBeInstanceOf(ArcaServiceError);
    expect(err.reason).toBe('inexistente');
  });
});

describe('arca-padron / arca-facturacion: config', () => {
  const certs = testCert();

  it('los constructores validan el CUIT (dígito verificador)', () => {
    expect(() => new ArcaFacturacion({ cuit: 20123456789, ...certs })).toThrow(ArcaValidationError);
    expect(() => new ArcaPadron({ cuit: '20-12345678-9', ...certs })).toThrow(ArcaValidationError);
  });

  it('aceptan el CUIT como número o string', () => {
    expect(() => new ArcaFacturacion({ cuit: '20-12345678-6', ...certs })).not.toThrow();
    expect(() => new ArcaPadron({ cuit: CUIT, ...certs })).not.toThrow();
  });

  it('el certificado y la clave se validan al construir (arca-common 0.7)', () => {
    expect(() => new ArcaFacturacion({ cuit: CUIT, cert: 'x', key: 'y' })).toThrow(ArcaValidationError);
  });

  it('un WsaaClient compartido sirve a todos los SDKs del mismo entorno', () => {
    const wsaa = createWsaaClient({ cuit: CUIT, ...certs, production: false });
    const arca = new ArcaFacturacion({ cuit: CUIT, ...certs, wsaa });
    const cdc = new ArcaCdc({ cuit: CUIT, ...certs, wsaa });
    expect(arca.wsaa).toBe(wsaa);
    expect(cdc.wsaa).toBe(wsaa);
  });

  it('rechaza un wsaa compartido de otro entorno', () => {
    const wsaa = createWsaaClient({ cuit: CUIT, ...certs, production: true });
    expect(() => new ArcaPadron({ cuit: CUIT, ...certs, production: false, wsaa })).toThrow(ArcaValidationError);
  });
});

describe('arca-empleados: archivo de ancho fijo', () => {
  it('genera registros de 130 posiciones con resumen y buffer latin1', () => {
    const sr = new ArcaEmpleados();
    sr.alta({ cuil: '20-12345678-6', fechaInicio: '2026-11-02', modalidadContrato: 8, obraSocial: '126205', sucursal: 1 })
      // fechaInicio (inicio del vínculo) es obligatoria en todos los movimientos desde 0.5
      .baja({ cuil: '20123456786', fechaInicio: '2020-03-01', fechaFin: '2026-10-31' });
    const { contenido, lineas, encoding, buffer, resumen } = sr.generar();

    expect(lineas).toHaveLength(2);
    expect(lineas.every((l) => l.length === 130)).toBe(true);
    expect(lineas[0].slice(0, 4)).toBe('01AT');
    expect(lineas[1].slice(0, 4)).toBe('01BT');
    expect(encoding).toBe('latin1');
    expect(buffer.toString('latin1')).toBe(contenido);
    expect(resumen).toMatchObject({ totalRegistros: 2, altas: 1, bajas: 1 });
  });

  it('rechaza propiedades que no son del diseño de registro (0.5)', () => {
    const sr = new ArcaEmpleados();
    expect(() =>
      sr.alta({ cuil: '20123456786', fechaInicio: '2026-11-02', modalidadContrato: 8, obraSocal: '126205' } as never),
    ).toThrow(ArcaValidationError);
  });
});

// ============================================================
// Tests de integración (requieren certificado y conexión a ARCA homologación)
// Se ejecutan solo con ARCA_INTEGRATION=1, AFIP_CUIT y backend/certs/cert.crt + key.key.
// ============================================================

const certPath = path.resolve(__dirname, '../certs/cert.crt');
const keyPath = path.resolve(__dirname, '../certs/key.key');
const integrationCuit = process.env.AFIP_CUIT;
const canRunIntegration =
  process.env.ARCA_INTEGRATION === '1' &&
  !!integrationCuit &&
  fs.existsSync(certPath) && fs.statSync(certPath).size > 0 &&
  fs.existsSync(keyPath) && fs.statSync(keyPath).size > 0;

describe.skipIf(!canRunIntegration)('arca-facturacion: integración con ARCA homologación', () => {
  const crear = () =>
    new ArcaFacturacion({
      cuit: integrationCuit!,
      cert: fs.readFileSync(certPath, 'utf8'),
      key: fs.readFileSync(keyPath, 'utf8'),
      production: false,
      // Persistir el TA: sin esto, correr los tests dos veces seguidas da ArcaTicketVigenteError
      ticketStorage: new FileTicketStorage(path.resolve(__dirname, '../certs/tickets')),
    });
  const arca = canRunIntegration ? crear() : (undefined as unknown as ArcaFacturacion);

  it('status() responde con wsfe y wsfex', async () => {
    const { wsfe, wsfex } = await arca.status();
    expect(wsfe.status?.appserver).toBeDefined();
    expect(wsfe.status?.dbserver).toBeDefined();
    expect(wsfe.status?.authserver).toBeDefined();
    expect(wsfex).toHaveProperty('ok');
  });

  it('getTiposDocumento incluye CUIT', async () => {
    const tipos = await arca.getTiposDocumento();
    expect(tipos.find((t) => t.id === DocTipo.CUIT)).toBeDefined();
  });

  it('getMonedas devuelve lista con PES', async () => {
    const monedas = await arca.getMonedas();
    expect(monedas.find((m) => m.id === Moneda.PESOS)).toBeDefined();
  });

  it('getCotizacion devuelve { monId, monCotiz, fchCotiz }', async () => {
    const cotiz = await arca.getCotizacion(Moneda.DOLARES);
    expect(cotiz.monId).toBe(Moneda.DOLARES);
    expect(typeof cotiz.monCotiz).toBe('number');
    expect(cotiz.fchCotiz).toMatch(/^\d{8}$/);
  });

  it('getPuntosVenta devuelve lista', async () => {
    expect(Array.isArray(await arca.getPuntosVenta())).toBe(true);
  });

  it('facturar crea una Factura B con CAE y QR', async () => {
    const cbteNro = (await arca.ultimoComprobante(1, CbteTipo.FACTURA_B)) + 1;
    const opts = {
      ptoVta: 1,
      cbteTipo: CbteTipo.FACTURA_B,
      cbteNro,
      fecha: formatDate(arca.wsaa.now()),
      concepto: Concepto.PRODUCTOS,
      items: [{ neto: 1000, iva: IvaTipo.IVA_21 }],
    };
    const { intento } = arca.armarComprobante(opts);
    const result = await arca.facturar(opts);

    expect(result.aprobada).toBe(true);
    expect(result.cae).toHaveLength(14);
    expect(result.cbteNro).toBe(cbteNro);
    expect(result.importes.total).toBe(1210);
    expect(arca.urlQR(result)).toContain('https://www.arca.gob.ar/fe/qr/');

    // recuperarComprobante con el intento lo encuentra autorizado
    const r = await arca.recuperarComprobante(intento);
    expect(r.estado).toBe('autorizado');
  });

  it('consultarComprobante recupera la última factura', async () => {
    const ultimo = await arca.ultimoComprobante(1, CbteTipo.FACTURA_B);
    const consulta = await arca.consultarComprobante(CbteTipo.FACTURA_B, 1, ultimo);
    expect(consulta.resultGet.resultado).toBe('A');
  });

  it('notaCredito asociada a un comprobante', async () => {
    const factura = await arca.facturar({
      ptoVta: 1,
      cbteTipo: CbteTipo.FACTURA_B,
      concepto: Concepto.PRODUCTOS,
      items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
    });
    expect(factura.aprobada).toBe(true);

    const nc = await arca.notaCredito({
      ptoVta: 1,
      comprobanteOriginal: { tipo: CbteTipo.FACTURA_B, ptoVta: 1, nro: factura.cbteNro },
      items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
    });
    expect(nc.aprobada).toBe(true);
    expect(nc.cbteTipo).toBe(CbteTipo.NOTA_CREDITO_B);
  });

  it('status().wsfex responde', async () => {
    const { wsfex } = await arca.status();
    expect(wsfex.ok || wsfex.error).toBeTruthy();
  });
});
