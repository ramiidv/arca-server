import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { createCertificate, renewCertificate, getCertExpiry } from 'arca-cert';
import {
  arca,
  padron,
  cdc,
  fecred,
  mtxca,
  sire,
  agro,
  reloadArca,
  probarCertificado,
  resetWsaaCooldown,
  ambienteArca,
  nombreAmbiente,
} from '../services/arca.service';
import type { AmbienteArca } from '../services/arca.service';
import { ArcaEmpleados } from '@ramiidv/arca-empleados';
import { condicionIvaDesdePadron } from '@ramiidv/arca-padron';
import type { RegistroRelacionLaboral } from '@ramiidv/arca-empleados';
import { formatDate } from '@ramiidv/arca-common';
import type { ServiceStatus } from '@ramiidv/arca-common';
import { config } from '../config';
import { adminMiddleware } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// CUIT de 11 dígitos, con o sin guiones (el SDK además valida el dígito verificador).
const CUIT_RE = /^\d{2}-?\d{8}-?\d$/;
// Fecha YYYYMMDD o YYYY-MM-DD (el SDK valida que exista).
const FECHA_RE = /^(\d{8}|\d{4}-\d{2}-\d{2})$/;

/** Valida el parámetro :cuit. Si es inválido responde 400 y devuelve null. */
function cuitParam(req: Request, res: Response): string | null {
  const cuit = req.params.cuit as string;
  if (!cuit || !CUIT_RE.test(cuit)) {
    res.status(400).json({ success: false, error: 'La CUIT tiene que tener 11 dígitos' });
    return null;
  }
  return cuit;
}

/** El body tiene que ser un objeto JSON (su contenido lo valida el SDK con ArcaValidationError). */
function bodyObjeto(req: Request, res: Response): Record<string, unknown> | null {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ success: false, error: 'El body tiene que ser un objeto JSON' });
    return null;
  }
  return req.body as Record<string, unknown>;
}

/**
 * `ServiceStatus` de arca-common serializable (un Error se pierde en JSON):
 * `{ ok: true, status }` o `{ ok: false, error, status? }`. Desde arca-common
 * 0.7, `ok` es false también si el servicio respondió con algún servidor que
 * no está en OK (entonces viene `status` con lo informado).
 */
function estadoServicio(s: ServiceStatus) {
  return s.ok
    ? { ok: true as const, status: s.status }
    : { ok: false as const, error: s.error.message, ...(s.status && { status: s.status }) };
}

/** Aplica `estadoServicio` a cada servicio de un `status()` de varios servicios. */
function estadosServicios<K extends string>(status: Record<K, ServiceStatus>) {
  return Object.fromEntries(
    Object.entries<ServiceStatus>(status).map(([servicio, s]) => [servicio, estadoServicio(s)]),
  ) as Record<K, ReturnType<typeof estadoServicio>>;
}

// GET /status - WSFEv1 y WSFEX health check (FEDummy/FEXDummy, sin autenticación):
// { wsfe, wsfex }, cada uno { ok, status: { appserver, dbserver, authserver } } o { ok: false, error, status? }
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: estadosServicios(await arca.status()) });
  } catch (error) {
    next(error);
  }
});

// POST /wsaa-reset - Vuelve a habilitar el login en WSAA después de corregir un error
// permanente (certificado vencido o no confiable, servicio no autorizado...). Con arca-common
// 0.7 el WsaaClient compartido no pide más tickets para ese servicio hasta esto.
router.post('/wsaa-reset', (_req: Request, res: Response) => {
  const reiniciado = resetWsaaCooldown();
  res.json({
    success: true,
    data: {
      reset: reiniciado,
      message: reiniciado
        ? 'Autenticación con WSAA habilitada: el próximo pedido vuelve a solicitar el ticket.'
        : 'Los servicios de ARCA todavía no se inicializaron: no había nada que reiniciar.',
    },
  });
});

// GET /invoice-types - Available invoice types
router.get('/invoice-types', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await arca.getTiposComprobante();
    res.json({ success: true, data: types });
  } catch (error) {
    next(error);
  }
});

// GET /doc-types - Document types
router.get('/doc-types', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await arca.getTiposDocumento();
    res.json({ success: true, data: types });
  } catch (error) {
    next(error);
  }
});

// GET /iva-types - IVA aliquot types
router.get('/iva-types', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await arca.getTiposIva();
    res.json({ success: true, data: types });
  } catch (error) {
    next(error);
  }
});

// GET /concept-types - Concept types
router.get('/concept-types', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await arca.getTiposConcepto();
    res.json({ success: true, data: types });
  } catch (error) {
    next(error);
  }
});

// GET /optional-types - Optional types
router.get('/optional-types', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await arca.getTiposOpcional();
    res.json({ success: true, data: types });
  } catch (error) {
    next(error);
  }
});

// GET /currency-types - Currency types
router.get('/currency-types', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await arca.getMonedas();
    res.json({ success: true, data: types });
  } catch (error) {
    next(error);
  }
});

// GET /puntos-venta - Available sales points: [{ nro, emisionTipo?, bloqueado?, fchBaja? }]
router.get('/puntos-venta', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const puntosVenta = await arca.getPuntosVenta();
    res.json({ success: true, data: puntosVenta });
  } catch (error) {
    next(error);
  }
});

// GET /contribuyente/:cuit - Taxpayer info from padrón A4 (full)
router.get('/contribuyente/:cuit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cuit = cuitParam(req, res);
    if (!cuit) return;

    // CUIT inexistente o inactiva: ArcaPadronServiceError (404 / 422 en errorHandler)
    const persona = await padron.getPersona(cuit);
    // Condición de IVA inferida de los impuestos (null + motivo si no se puede determinar):
    // sirve para completar condicionIva al facturar (RG 5616). El motivo advierte si ARCA
    // informó un errorConstancia (ej: CUIT limitada) aunque la condición se haya determinado.
    // La persona incluye `metadata` ({ fechaHora, servidor }) de la respuesta de ARCA.
    const condicionIva = condicionIvaDesdePadron(persona);
    res.json({ success: true, data: { ...persona, condicionIvaSugerida: condicionIva } });
  } catch (error) {
    next(error);
  }
});

// GET /contribuyente-basic/:cuit - Taxpayer basic info from padrón A10
router.get('/contribuyente-basic/:cuit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cuit = cuitParam(req, res);
    if (!cuit) return;

    const persona = await padron.getPersonaBasic(cuit);
    res.json({ success: true, data: persona });
  } catch (error) {
    next(error);
  }
});

// GET /padron-status - Padrón services health check (un resultado por servicio: a5, a4, a10, a13, a100)
router.get('/padron-status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: estadosServicios(await padron.status()) });
  } catch (error) {
    next(error);
  }
});

// POST /constatar - Verify a comprobante via WSCDC
// Body = ConstatarInput de arca-cdc (camelCase): cbteModo (CAE|CAI|CAEA), cuitEmisor, ptoVta,
// cbteTipo, cbteNro, cbteFch, impTotal, codAutorizacion, docTipoReceptor?, docNroReceptor?,
// opcionales?: [{ id, valor }]. Lo valida el SDK (ArcaValidationError → 400).
// Devuelve { resultado, fchProceso, cmpResp?, observaciones, eventos }. Resultado "R" es un rechazo
// funcional (200 con observaciones; cmpResp puede faltar); los Errors de ARCA llegan como
// ArcaServiceError (422) y una respuesta con forma inesperada como ArcaResponseError (502).
router.post('/constatar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = bodyObjeto(req, res);
    if (!body) return;
    const result = await cdc.constatar(body as unknown as Parameters<typeof cdc.constatar>[0]);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// GET /cdc-status - WSCDC health check: { appserver, dbserver, authserver } (lanza si no responde)
router.get('/cdc-status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await cdc.status();
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
});

// GET /cdc-tipos-cbte - WSCDC voucher types
router.get('/cdc-tipos-cbte', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tipos = await cdc.getTiposCbte();
    res.json({ success: true, data: tipos });
  } catch (error) {
    next(error);
  }
});

// GET /last-voucher - Last authorized voucher
router.get('/last-voucher', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const puntoVenta = parseInt(req.query.puntoVenta as string, 10);
    const cbteTipo = parseInt(req.query.cbteTipo as string, 10);

    if (isNaN(puntoVenta) || isNaN(cbteTipo)) {
      res.status(400).json({
        success: false,
        error: 'Los parámetros puntoVenta y cbteTipo son obligatorios y tienen que ser números',
      });
      return;
    }

    const cbteNro = await arca.ultimoComprobante(puntoVenta, cbteTipo);
    // Mismos nombres que FECompUltimoAutorizadoResult del SDK
    res.json({
      success: true,
      data: { cbteNro, ptoVta: puntoVenta, cbteTipo },
    });
  } catch (error) {
    next(error);
  }
});

// GET /comprobante - Query invoice from AFIP
router.get('/comprobante', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const puntoVenta = parseInt(req.query.puntoVenta as string, 10);
    const cbteTipo = parseInt(req.query.cbteTipo as string, 10);
    const cbteNro = parseInt(req.query.cbteNro as string, 10);

    if (isNaN(puntoVenta) || isNaN(cbteTipo) || isNaN(cbteNro)) {
      res.status(400).json({
        success: false,
        error: 'Los parámetros puntoVenta, cbteTipo y cbteNro son obligatorios y tienen que ser números',
      });
      return;
    }

    // FECompConsultarResult: resultGet en camelCase con las listas ya
    // como arrays; si ARCA las omite quedan undefined, acá se devuelven siempre como arrays.
    // Un comprobante inexistente es ArcaWSFEError 602 (422). Muchos campos son opcionales
    // (cbteFch, resultado, codAutorizacion, monId...): ARCA puede omitirlos.
    const { resultGet: r, events } = await arca.consultarComprobante(cbteTipo, puntoVenta, cbteNro);
    res.json({
      success: true,
      data: {
        ...r,
        iva: r.iva ?? [],
        tributos: r.tributos ?? [],
        cbtesAsoc: r.cbtesAsoc ?? [],
        opcionales: r.opcionales ?? [],
        observaciones: r.observaciones ?? [],
        events: events ?? [],
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /cotizacion - Currency exchange rate
router.get('/cotizacion', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const monedaId = req.query.monedaId as string;
    const fecha = req.query.fecha as string | undefined;

    if (!monedaId || !/^[A-Za-z0-9]{3}$/.test(monedaId)) {
      res.status(400).json({
        success: false,
        error: 'El parámetro monedaId es obligatorio (3 caracteres, por ejemplo DOL)',
      });
      return;
    }
    if (fecha !== undefined && !FECHA_RE.test(fecha)) {
      res.status(400).json({ success: false, error: 'fecha tiene que tener formato YYYYMMDD o YYYY-MM-DD' });
      return;
    }

    // { monId, monCotiz: number, fchCotiz: YYYYMMDD }
    const cotizacion = await arca.getCotizacion(monedaId, fecha ? { fecha } : undefined);
    res.json({ success: true, data: cotizacion });
  } catch (error) {
    next(error);
  }
});

// GET /iva-conditions - IVA conditions (Responsable Inscripto, Monotributista, etc.)
router.get('/iva-conditions', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await arca.getCondicionesIva();
    res.json({ success: true, data: types });
  } catch (error) {
    next(error);
  }
});

// GET /tributo-types - Tributo types
router.get('/tributo-types', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await arca.getTiposTributo();
    res.json({ success: true, data: types });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// Certificados (arca-cert)
// ============================================================

const soloDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** `environment` del body: `'production'`, `'testing'` o ausente (el ambiente activo). `null` si es inválido. */
function ambientePedido(environment: unknown): AmbienteArca | null {
  if (environment === undefined) return ambienteArca();
  return environment === 'production' || environment === 'testing' ? environment : null;
}

const ERROR_AMBIENTE = "environment tiene que ser 'production' o 'testing'";

/**
 * Valida el pedido de generar/renovar un certificado. El certificado se instala
 * en AFIP_CERT_PATH/AFIP_KEY_PATH y los SDKs lo usan con AFIP_CUIT y
 * AFIP_PRODUCTION, así que se rechaza (400) un certificado de otra CUIT o de
 * otro ambiente: instalado no funcionaría (WSAA rechaza el login o ARCA el
 * ticket) y reemplazaría al que sí funciona. Para cambiar de CUIT o ambiente
 * hay que cambiar esas variables y reiniciar el server.
 */
function pedidoCertificado(req: Request, res: Response) {
  const { cuit, password, alias, environment } = req.body ?? {};
  if (!cuit || !password || !alias) {
    res.status(400).json({ success: false, error: 'cuit, password y alias son obligatorios' });
    return null;
  }
  const ambiente = ambientePedido(environment);
  if (!ambiente) {
    res.status(400).json({ success: false, error: ERROR_AMBIENTE });
    return null;
  }
  const activo = ambienteArca();
  if (ambiente !== activo) {
    res.status(400).json({
      success: false,
      error:
        `El server está en ${nombreAmbiente(activo)} (AFIP_PRODUCTION=${config.afip.production}): ` +
        `un certificado de ${nombreAmbiente(ambiente)} no serviría. Generalo en ${nombreAmbiente(activo)}, ` +
        `o cambiá AFIP_PRODUCTION y reiniciá el server antes de generarlo.`,
    });
    return null;
  }
  if (!config.afip.cuit) {
    // Falta configuración del server, no es un error del pedido.
    res.status(503).json({
      success: false,
      error: 'AFIP_CUIT no está configurada: definila con la CUIT del certificado y reiniciá el server antes de generarlo.',
    });
    return null;
  }
  if (soloDigitos(cuit) !== soloDigitos(config.afip.cuit)) {
    res.status(400).json({
      success: false,
      error:
        `La CUIT ${soloDigitos(cuit)} no coincide con AFIP_CUIT (${soloDigitos(config.afip.cuit)}), que es con la que ` +
        'factura el server. Usá esa CUIT, o cambiá AFIP_CUIT y reiniciá el server antes de generar el certificado.',
    });
    return null;
  }
  return { cuit: soloDigitos(cuit), password: String(password), alias: String(alias), environment: ambiente };
}

/** Causa legible de un error de E/S al guardar el certificado (sin rutas: van solo al log). */
const CAUSA_ERROR_ESCRITURA: Record<string, string> = {
  EACCES: 'el server no tiene permiso de escritura en el directorio del certificado',
  EPERM: 'el server no tiene permiso de escritura en el directorio del certificado',
  EROFS: 'el directorio del certificado está en un sistema de archivos de solo lectura (¿volumen montado con :ro?)',
  ENOSPC: 'no hay espacio en disco',
  ENOENT: 'el directorio del certificado no existe y no se pudo crear',
  ENOTDIR: 'la ruta del certificado (AFIP_CERT_PATH/AFIP_KEY_PATH) pasa por un archivo que no es un directorio',
  // mkdir del directorio del certificado cuando ya existe un archivo con ese nombre
  EEXIST: 'la ruta del certificado (AFIP_CERT_PATH/AFIP_KEY_PATH) pasa por un archivo que no es un directorio',
};

/**
 * Guarda el certificado y la clave en AFIP_CERT_PATH y AFIP_KEY_PATH (los
 * mismos archivos que leen los SDKs). Escribe primero archivos temporales y
 * recién con los dos escritos los renombra: un error de escritura no toca el
 * par instalado. Si algo falla se borran los temporales.
 */
function guardarCertificado(cert: string, key: string) {
  const { certPath, keyPath } = config.afip;
  const sufijo = `.${process.pid}.${Date.now()}.tmp`;
  const certTmp = `${certPath}${sufijo}`;
  const keyTmp = `${keyPath}${sufijo}`;
  try {
    fs.mkdirSync(path.dirname(certPath), { recursive: true });
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(certTmp, cert);
    fs.writeFileSync(keyTmp, key, { mode: 0o600 });
    fs.renameSync(keyTmp, keyPath);
    fs.renameSync(certTmp, certPath);
  } catch (e) {
    for (const tmp of [certTmp, keyTmp]) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // No se pudo crear o ya no existe: no hay temporal que borrar.
      }
    }
    const code = (e as NodeJS.ErrnoException).code ?? '';
    console.error(`[ARCA] No se pudo guardar el certificado en ${certPath} / ${keyPath}:`, (e as Error).message);
    throw new AppError(
      500,
      `No se pudo guardar el certificado: ${CAUSA_ERROR_ESCRITURA[code] ?? 'error de escritura en disco'}. ` +
        'En Docker el certificado va en el volumen arca-certs (/app/certs). ' +
        'ARCA ya emitió el certificado: corregí el problema y volvé a intentarlo con otro alias.',
    );
  }
}

// GET /config - Configuración de ARCA activa del server (ambiente, CUIT, punto de venta)
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      environment: ambienteArca(),
      cuit: config.afip.cuit || null,
      puntoVenta: config.afip.puntoVenta,
    },
  });
});

/** Hay una generación/renovación en curso: dos a la vez se pisarían el par cert/clave instalado. */
let certificadoEnCurso = false;

/**
 * POST /generate-cert y /renew-cert (solo admin): piden el certificado a ARCA
 * con arca-cert, lo instalan y recrean los SDKs. La CUIT y el ambiente tienen
 * que ser los del server (AFIP_CUIT, AFIP_PRODUCTION).
 */
function rutaCertificado(emitir: typeof createCertificate | typeof renewCertificate, mensaje: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pedido = pedidoCertificado(req, res);
      if (!pedido) return;
      if (certificadoEnCurso) {
        res.status(409).json({ success: false, error: 'Ya se está generando un certificado. Esperá a que termine.' });
        return;
      }
      certificadoEnCurso = true;
      try {
        const result = await emitir(pedido);
        guardarCertificado(result.cert, result.key);
        reloadArca();
        res.json({
          success: true,
          data: { alias: result.alias, cuit: result.cuit, environment: result.environment, message: mensaje },
        });
      } finally {
        certificadoEnCurso = false;
      }
    } catch (error) {
      next(error);
    }
  };
}

router.post('/generate-cert', adminMiddleware, rutaCertificado(createCertificate, 'Certificado generado y activado.'));
// Renovar = certificado nuevo con otro alias; el anterior sigue válido hasta vencer.
router.post('/renew-cert', adminMiddleware, rutaCertificado(renewCertificate, 'Certificado renovado y activado.'));

// GET /cert-info - Vencimiento del certificado instalado (AFIP_CERT_PATH)
router.get('/cert-info', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const certPath = config.afip.certPath;
    if (!fs.existsSync(certPath)) {
      res.json({ success: true, data: null });
      return;
    }

    const certPem = fs.readFileSync(certPath, 'utf8');
    if (!certPem.includes('BEGIN CERTIFICATE')) {
      res.json({ success: true, data: null });
      return;
    }

    const expiry = getCertExpiry(certPem);
    const now = new Date();
    const daysLeft = Math.floor((expiry.notAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    res.json({
      success: true,
      data: {
        notBefore: expiry.notBefore.toISOString(),
        notAfter: expiry.notAfter.toISOString(),
        daysLeft,
        expired: daysLeft < 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /test-cert - Prueba el certificado instalado contra WSAA. `environment`
// opcional: default el ambiente activo del server (el que usan los SDKs).
router.post('/test-cert', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ambiente = ambientePedido(req.body?.environment);
    if (!ambiente) {
      res.status(400).json({ success: false, error: ERROR_AMBIENTE });
      return;
    }
    // Sin certificado instalado, probarCertificado responde 503 (AppError).
    const ticket = await probarCertificado(ambiente === 'production');

    res.json({
      success: true,
      data: {
        valid: true,
        environment: ambiente,
        expirationTime: ticket.expirationTime,
        message: `Certificado válido. Autenticación con WSAA (${nombreAmbiente(ambiente)}) exitosa.`,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// FECRED — Factura de Crédito Electrónica MiPyME
// ============================================================

// GET /fecred-status - WSFECRED health check
router.get('/fecred-status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await fecred.status();
    res.json({ success: true, data: status });
  } catch (error) { next(error); }
});

// GET /fecred-obligado/:cuit?fechaEmision=YYYYMMDD - Check if CUIT is obligated to receive FCE
// fechaEmision es obligatoria en el XSD: default hoy (fecha calendario de Argentina).
router.get('/fecred-obligado/:cuit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cuit = cuitParam(req, res);
    if (!cuit) return;
    const fechaEmision = (req.query.fechaEmision as string | undefined) ?? formatDate(new Date());
    if (!FECHA_RE.test(fechaEmision)) {
      res.status(400).json({ success: false, error: 'fechaEmision tiene que tener formato YYYYMMDD o YYYY-MM-DD' });
      return;
    }
    // { obligado?: boolean, montoDesde?, observaciones }: obligado falta si ARCA solo devolvió observaciones
    const result = await fecred.consultarMontoObligadoRecepcion({ cuitConsultada: cuit, fechaEmision });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

// POST /fecred-ctas-ctes - Query FCE current accounts
// Body: { rol: 'Emisor' | 'Receptor', cuitContraparte?, fecha?: { tipo, desde, hasta }, estadoCtaCte?, nroPagina?, opcionTransferencia? }
// Devuelve { ctasCtes, nroPagina?, hayMas?, evento?, observaciones } (paginado). Los estados
// (estadoCtaCte.estado, etc.) son abiertos: un valor nuevo de ARCA se devuelve tal cual.
router.post('/fecred-ctas-ctes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = bodyObjeto(req, res);
    if (!body) return;
    const result = await fecred.consultarCtasCtes(body as unknown as Parameters<typeof fecred.consultarCtasCtes>[0]);
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

// POST /fecred-aceptar - Accept an FCE
// Body: { idCtaCte: { codCtaCte } | { idFactura }, saldoAceptado, codMoneda, cotizacionMonedaUlt, ...opcionales del XSD }
// Un rechazo de ARCA (resultado "R") lanza ArcaRechazoError → 422 con errors y observaciones.
router.post('/fecred-aceptar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = bodyObjeto(req, res);
    if (!body) return;
    const result = await fecred.aceptarFECred(body as unknown as Parameters<typeof fecred.aceptarFECred>[0]);
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

// POST /fecred-rechazar - Reject an FCE
// Body: { idCtaCte, motivos: [{ codMotivo, descMotivo, justificacion }] }
// Un rechazo de ARCA (resultado "R") lanza ArcaRechazoError → 422 con errors y observaciones.
router.post('/fecred-rechazar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = bodyObjeto(req, res);
    if (!body) return;
    const result = await fecred.rechazarFECred(body as unknown as Parameters<typeof fecred.rechazarFECred>[0]);
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

// ============================================================
// MTXCA — Facturación con detalle de artículos
// ============================================================

// GET /mtxca-status - WSMTXCA health check
router.get('/mtxca-status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await mtxca.status();
    res.json({ success: true, data: status });
  } catch (error) { next(error); }
});

// POST /mtxca-autorizar - Authorize invoice with item detail
// Body = ComprobanteType con los nombres del XSD (codigoTipoComprobante, numeroPuntoVenta,
// importeSubtotal, codigoMoneda, condicionIVAReceptor (obligatoria),
// items[], subtotalesIVA[], ...). El SDK redondea mitad al par (manual WSMTXCA) y valida las
// reglas de FCE (fechaVencimientoPago en 201/206). Un rechazo (resultado "R") lanza
// ArcaRechazoError → 422 con errors y observaciones. Si se autorizó, se agrega `urlQR` (RG 4892).
router.post('/mtxca-autorizar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = bodyObjeto(req, res);
    if (!body) return;
    const comprobante = body as unknown as Parameters<typeof mtxca.autorizar>[0];
    const result = await mtxca.autorizar(comprobante);
    res.json({ success: true, data: { ...result, urlQR: qrMtxca(comprobante, result) } });
  } catch (error) { next(error); }
});

/** URL del QR de un comprobante MTXCA autorizado. Un QR que no se puede armar no invalida la autorización. */
function qrMtxca(
  comprobante: Parameters<typeof mtxca.urlQR>[0],
  resultado: Parameters<typeof mtxca.urlQR>[1],
): string | undefined {
  try {
    return mtxca.urlQR(comprobante, resultado);
  } catch (e) {
    console.error('[MTXCA] No se pudo generar el QR:', (e as Error).message);
    return undefined;
  }
}

// GET /mtxca-ultimo-comprobante - Last authorized voucher (MTXCA)
router.get('/mtxca-ultimo-comprobante', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ptoVta = parseInt(req.query.puntoVenta as string, 10);
    const cbteTipo = parseInt(req.query.cbteTipo as string, 10);
    if (isNaN(ptoVta) || isNaN(cbteTipo) || ptoVta < 1 || cbteTipo < 1) {
      res.status(400).json({ success: false, error: 'puntoVenta y cbteTipo son obligatorios' });
      return;
    }
    const cbteNro = await mtxca.ultimoComprobante(ptoVta, cbteTipo);
    res.json({ success: true, data: { cbteNro, ptoVta, cbteTipo } });
  } catch (error) { next(error); }
});

// ============================================================
// SIRE — Retenciones Electrónicas
// ============================================================

// GET /sire-status - SIRE health check: { appserver, dbserver, authserver, headerInfo? }
// (headerInfo: ambiente, fecha, vCore, v2005 del header SOAP: sirve para detectar un entorno equivocado)
router.get('/sire-status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await sire.status();
    res.json({ success: true, data: status });
  } catch (error) { next(error); }
});

// POST /sire-emitir (alias: /sire-retencion) - Emit a retention certificate (operación `emitir`)
// Body = EmitirCertificadoParams: regimen, fechaRetencion, imposibilidadRetencion, importeRetencion,
// importeBaseCalculo, regimenExclusion, tipoComprobante, fechaComprobante, numeroComprobante,
// importeComprobante, cuitRetenido, ... Lo valida el SDK, incluidas las reglas de fechas del manual
// (fechaRetencion >= 2019-12-01, fechaComprobante <= fechaRetencion; iguales en los tipos 3, 19 y 20).
// Devuelve { certificadoNro, codigoSeguridad }. Un Fault de token/sign es ArcaAuthError (503); un
// Fault Client, ArcaSireServiceError (un ArcaRechazoError: 422 con `operacion`). Ante un ArcaSoapError
// incierto no se reenvía: SIRE no tiene consulta (verificar en el micrositio).
const emitirCertificado = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = bodyObjeto(req, res);
    if (!body) return;
    const result = await sire.emitirCertificado(body as unknown as Parameters<typeof sire.emitirCertificado>[0]);
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
};
router.post('/sire-emitir', emitirCertificado);
router.post('/sire-retencion', emitirCertificado);

// POST /sire-anular - Cancel a retention certificate (operación `anular`)
// Body = AnularCertificadoParams: { numeroCertificado, motivoAnulacion, codigoTrazabilidad? }
router.post('/sire-anular', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = bodyObjeto(req, res);
    if (!body) return;
    const result = await sire.anularCertificado(body as unknown as Parameters<typeof sire.anularCertificado>[0]);
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

// ============================================================
// AGRO — Servicios Agropecuarios
// ============================================================

// GET /agro-status - WSCPE y WSLPG health check: { cpe, lpg } con { ok, status } o { ok: false, error, status? }
router.get('/agro-status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: estadosServicios(await agro.status()) });
  } catch (error) { next(error); }
});

// POST /agro-cpe-autorizar - Authorize Carta de Porte automotor (WSCPE)
// Body = AutorizarCPEAutomotorParams según el XSD: { cabecera, origen, correspondeRetiroProductor,
// esSolicitanteCampo, datosCarga, destino, destinatario, transporte, ... }. WSCTG ya no existe:
// el número de CTG viene en cabecera.nroCTG de la respuesta. Si ARCA no pudo generar el PDF
// (error 550) la CPE igual queda autorizada: la respuesta trae `advertencias` y no trae `pdf`.
// Errores junto con el resultado → ArcaAgroServiceError con uncertain (502: consultar antes de reintentar).
router.post('/agro-cpe-autorizar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = bodyObjeto(req, res);
    if (!body) return;
    const result = await agro.cpe.autorizarCPEAutomotor(body as unknown as Parameters<typeof agro.cpe.autorizarCPEAutomotor>[0]);
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

// POST /agro-lpg-autorizar - Authorize grain settlement (WSLPG)
// Body: { liquidacion, deducciones?, retenciones?, percepciones? } según LpgLiquidacionBaseType.
// El error 1021 (PDF) no cancela la liquidación: vuelve en `advertencias`.
router.post('/agro-lpg-autorizar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = bodyObjeto(req, res);
    if (!body) return;
    const result = await agro.lpg.liquidacionAutorizar(body as unknown as Parameters<typeof agro.lpg.liquidacionAutorizar>[0]);
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

// ============================================================
// EMPLEADOS — Ingreso masivo de relaciones laborales (Simplificación Registral)
// ============================================================

const TIPOS_REGISTRO = ['alta', 'baja', 'modificacion', 'novedad'] as const;
type TipoRegistro = (typeof TIPOS_REGISTRO)[number];

// POST /empleados-generar[?formato=txt] - Generate the fixed-width (130 positions) TXT file
// Body: { registros: [{ tipo: 'alta' | 'baja' | 'modificacion' | 'novedad', data }], strict?, fechaReferencia? }
// - alta (AT), baja (BT, fecha en fechaFin), modificacion (MR); novedad recibe { movimiento, cuil, ... }.
// - fechaInicio (inicio del vínculo) es obligatoria en todos los movimientos (arca-empleados 0.5),
//   y las propiedades que no son del diseño de registro se rechazan (ArcaValidationError → 400).
// - fechaReferencia (YYYY-MM-DD, opcional): fecha de la novedad para validar que un alta no tenga
//   fechaInicio más de 90 días posterior (default: hoy en Argentina).
// - Por defecto responde JSON con { contenido, lineas, encoding, resumen }.
// - Con ?formato=txt devuelve el archivo para descargar (ISO-8859-1, CRLF).
router.post('/empleados-generar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const formato = req.query.formato as string | undefined;
    if (formato !== undefined && formato !== 'txt' && formato !== 'json') {
      res.status(400).json({ success: false, error: "formato tiene que ser 'txt' o 'json'" });
      return;
    }

    const { registros, strict, fechaReferencia } = req.body ?? {};
    if (!Array.isArray(registros) || registros.length === 0) {
      res.status(400).json({ success: false, error: 'registros tiene que ser un array no vacío' });
      return;
    }
    if (strict !== undefined && typeof strict !== 'boolean') {
      res.status(400).json({ success: false, error: 'strict tiene que ser un booleano' });
      return;
    }
    if (fechaReferencia !== undefined && (typeof fechaReferencia !== 'string' || !FECHA_RE.test(fechaReferencia))) {
      res.status(400).json({ success: false, error: 'fechaReferencia tiene que tener formato YYYYMMDD o YYYY-MM-DD' });
      return;
    }
    const invalido = registros.findIndex(
      (r: unknown) =>
        !r || typeof r !== 'object' ||
        !TIPOS_REGISTRO.includes((r as { tipo?: TipoRegistro }).tipo as TipoRegistro) ||
        !(r as { data?: unknown }).data || typeof (r as { data?: unknown }).data !== 'object',
    );
    if (invalido !== -1) {
      res.status(400).json({
        success: false,
        error: `registros[${invalido}] tiene que ser { tipo: ${TIPOS_REGISTRO.join(' | ')}, data: objeto }`,
      });
      return;
    }

    const builder = new ArcaEmpleados({
      ...(strict !== undefined && { strict }),
      ...(fechaReferencia !== undefined && { fechaReferencia }),
    });
    for (const reg of registros as { tipo: TipoRegistro; data: any }[]) {
      switch (reg.tipo) {
        case 'alta': builder.alta(reg.data); break;
        case 'baja': builder.baja(reg.data); break;
        case 'modificacion': builder.modificacion(reg.data); break;
        case 'novedad': builder.novedad(reg.data as RegistroRelacionLaboral); break;
      }
    }

    const archivo = builder.generar();

    if (formato === 'txt') {
      const nombre = `relaciones-laborales-${formatDate(new Date())}.txt`;
      res.setHeader('Content-Type', 'text/plain; charset=ISO-8859-1');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
      res.send(archivo.buffer);
      return;
    }

    res.json({
      success: true,
      data: {
        contenido: archivo.contenido,
        lineas: archivo.lineas,
        encoding: archivo.encoding,
        resumen: archivo.resumen,
      },
    });
  } catch (error) { next(error); }
});

export default router;
