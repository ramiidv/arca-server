import { Request, Response, NextFunction } from 'express';
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
  ArcaConflictoExpo,
  ArcaResponseError,
  WSFE_ERRORES_AUTH,
  WSFEX_ERRORES_AUTH,
} from '@ramiidv/arca-facturacion';
import { ArcaPadronServiceError, ArcaPadronError } from '@ramiidv/arca-padron';
import { ArcaAgroServiceError } from '@ramiidv/arca-agro';
import { ArcaSerializationError } from '@ramiidv/arca-empleados';
import { ArcaCertError, parseSoapFault } from 'arca-cert';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, isOperational = true, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/** Código HTTP para un error de negocio de Padrón según su `reason`. */
const PADRON_REASON_STATUS: Record<string, number> = {
  inexistente: 404,
  inactiva: 422,
  id_invalido: 400,
  // El certificado no está autorizado para el servicio: problema de configuración del server.
  no_autorizado: 502,
  otro: 422,
};

/** `faultCode` sin el prefijo de namespace (`ns1:cms.cert.expired` → `cms.cert.expired`). */
function faultLocal(faultCode: string | undefined): string {
  return (faultCode ?? '').replace(/^.*:/, '').trim();
}

/** Códigos de WSFEv1/WSFEX con los que ARCA rechaza el ticket (600/601, 1000/1001). */
const ERRORES_TICKET = new Set([...WSFE_ERRORES_AUTH, ...WSFEX_ERRORES_AUTH].map(String));

/**
 * `true` si WSAA rechazó el login con un error que no se resuelve reintentando
 * (`cms.*`, `coe.*`, `xml.*`, `wsn.*` salvo `wsn.unavailable`): desde
 * arca-common 0.7 el `WsaaClient` deja de pedir tickets para ese servicio
 * hasta `resetLoginCooldown` (POST /api/afip/wsaa-reset) o un certificado nuevo.
 */
function wsaaBloqueado(err: ArcaAuthError): boolean {
  const code = faultLocal(err.faultCode);
  return !err.retryable && /^(xml|cms|coe|wsn)\./i.test(code) && !/^wsn\.unavailable$/i.test(code);
}

/** Mensaje para el usuario según el tipo de error de autenticación. */
function mensajeAuth(err: ArcaAuthError): string {
  if (ERRORES_TICKET.has(faultLocal(err.faultCode))) {
    return 'ARCA rechazó el ticket de acceso: la CUIT no está relacionada con el certificado o el servicio no está autorizado. Corregí la relación en ARCA.';
  }
  if (wsaaBloqueado(err)) {
    return 'WSAA rechazó la autenticación con un error que no se resuelve reintentando (certificado vencido o no confiable, ' +
      'servicio no autorizado para el certificado, etc.). El servicio quedó bloqueado: corregí la causa y reintentá la ' +
      'autenticación desde Configuración (POST /api/afip/wsaa-reset) o generá un certificado nuevo.';
  }
  if (err.retryable) {
    return 'No se pudo autenticar con WSAA (servicio no disponible o error transitorio). Reintentá en unos minutos.';
  }
  return 'ARCA rechazó las credenciales de acceso (token, firma o CUIT representada).';
}

/**
 * Mapea los errores de los SDKs de ARCA a respuestas HTTP.
 *
 * El orden de los `instanceof` importa: varias clases heredan unas de otras
 * (`ArcaTicketVigenteError` → `ArcaAuthError`, `ArcaPadronServiceError` y
 * `ArcaWSFEError` → `ArcaServiceError`, y todas → `ArcaError`), así que
 * siempre se chequea primero la clase más específica. `ArcaResponseError`
 * (y su subclase `ArcaAgroResponseError`), `ArcaConflictoExpo` y los
 * `ArcaResultadoIncierto*` heredan directo de `ArcaError`.
 *
 * Nunca se devuelven el certificado, la clave ni el token/sign: los mensajes
 * de los SDKs no los incluyen y no se serializan `cause`, el request, ni
 * `responseBody`/`faultDetail` de `ArcaSoapError`.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('[Error]', err.message);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err.details !== undefined && { details: err.details }),
    });
    return;
  }

  // Prisma known errors
  if (err.constructor?.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as any;
    if (prismaErr.code === 'P2002') {
      res.status(409).json({
        success: false,
        error: 'A record with the same unique fields already exists',
      });
      return;
    }
    if (prismaErr.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: 'Record not found',
      });
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Errores de los SDKs de ARCA (de la clase más específica a la más general)
  // ---------------------------------------------------------------------------

  // Datos inválidos: el SDK no llegó a enviar nada a ARCA.
  if (err instanceof ArcaValidationError) {
    res.status(400).json({
      success: false,
      error: err.message,
      code: err.code,
      field: err.field,
      details: err.details,
    });
    return;
  }

  // Emisión de exportación sin resultado seguro: reenviar con el mismo Id.
  if (err instanceof ArcaResultadoInciertoExpo) {
    res.status(502).json({
      success: false,
      uncertain: true,
      code: err.code,
      error: 'No se sabe si ARCA autorizó el comprobante de exportación. Reenviá la misma solicitud con el mismo Id.',
      details: err.message,
      recuperacion: {
        operacion: err.operacion,
        id: err.id,
        cbteTipo: err.cbteTipo,
        ptoVta: err.ptoVta,
        cbteNro: err.cbteNro,
        intento: err.intento,
      },
    });
    return;
  }

  // Emisión WSFEv1 sin resultado seguro: hay que recuperar el comprobante.
  if (err instanceof ArcaResultadoIncierto) {
    res.status(502).json({
      success: false,
      uncertain: true,
      code: err.code,
      error: 'No se sabe si ARCA autorizó el comprobante. No lo reenvíes sin recuperarlo primero.',
      details: err.message,
      recuperacion: {
        operacion: err.operacion,
        intento: err.intento,
        intentos: err.intentos,
      },
    });
    return;
  }

  // El Id de WSFEX ya lo usaba otra solicitud: el comprobante del request NO se autorizó.
  if (err instanceof ArcaConflictoExpo) {
    const r = err.respuesta.fexResultAuth;
    res.status(409).json({
      success: false,
      code: err.code,
      error: 'El Id de WSFEX ya lo usaba otra solicitud: el comprobante no se autorizó. Volvé a emitirlo con otro Id.',
      details: {
        id: err.id,
        enviado: { cbteTipo: err.request.cbteTipo, ptoVta: err.request.puntoVta, cbteNro: err.request.cbteNro },
        respuesta: r && {
          cbteTipo: r.cbteTipo,
          ptoVta: r.puntoVta,
          cbteNro: r.cbteNro,
          resultado: r.resultado,
          reproceso: r.reproceso,
        },
      },
    });
    return;
  }

  // Antes que ArcaAuthError (es una subclase).
  if (err instanceof ArcaTicketVigenteError) {
    res.status(503).json({
      success: false,
      code: err.code,
      error: `WSAA ya emitió un Ticket de Acceso vigente para "${err.service}" que no está guardado. Hay que esperar a que venza (hasta 12 horas).`,
      service: err.service,
    });
    return;
  }

  // Login WSAA fallido, o ARCA rechazó el ticket (WSFEv1 600/601, WSFEX 1000/1001,
  // FECRED wscommon_*, SIRE token). `retryable: false` = hay que corregir algo antes.
  if (err instanceof ArcaAuthError) {
    res.status(503).json({
      success: false,
      code: err.code,
      error: mensajeAuth(err),
      details: err.message,
      retryable: err.retryable,
      blocked: wsaaBloqueado(err),
      ...(err.faultCode && { faultCode: err.faultCode }),
    });
    return;
  }

  // Antes que ArcaServiceError (es una subclase).
  if (err instanceof ArcaPadronServiceError) {
    res.status(PADRON_REASON_STATUS[err.reason] ?? 422).json({
      success: false,
      code: err.code,
      reason: err.reason,
      error: err.errors[0]?.msg ?? err.message,
      errors: err.errors,
    });
    return;
  }

  // Antes que ArcaServiceError (es una subclase).
  if (err instanceof ArcaWSFEError) {
    res.status(422).json({
      success: false,
      code: err.code,
      error: 'AFIP rejected the request',
      details: err.errors,
      errors: err.errors,
    });
    return;
  }

  // Emisión de WSCPE/WSLPG con errores Y con el resultado (ej: nroCTG o COE):
  // puede haberse procesado, hay que consultar antes de reintentar.
  if (err instanceof ArcaAgroServiceError && err.uncertain) {
    res.status(502).json({
      success: false,
      code: err.code,
      uncertain: true,
      error: `ARCA informó errores pero la operación puede haberse procesado: consultala antes de reintentar. ${err.message}`,
      errors: err.errors,
    });
    return;
  }

  // Rechazos de negocio del resto de los servicios (SIRE, agro, FECRED, CDC, MTXCA).
  if (err instanceof ArcaServiceError) {
    res.status(422).json({
      success: false,
      code: err.code,
      error: err.message,
      errors: err.errors,
    });
    return;
  }

  if (err instanceof ArcaSoapError) {
    // Un 4xx/5xx de ARCA es un problema del upstream: se informa como 502
    // (504 si no hubo respuesta y el resultado es incierto, ej: timeout).
    // El código original va en upstreamStatus.
    const status = err.statusCode === undefined && err.uncertain ? 504 : 502;
    let fault: { faultcode?: string; faultstring?: string } | undefined;
    if (err.faultString) {
      fault = { faultcode: err.faultCode, faultstring: err.faultString };
    } else {
      // Fallback: algunos mensajes traen el Fault en el texto.
      const parsed = parseSoapFault(err.message);
      if (parsed?.soapFault) {
        fault = { faultcode: parsed.soapFault.faultcode, faultstring: parsed.soapFault.faultstring };
      }
    }
    res.status(status).json({
      success: false,
      code: err.code,
      error: fault ? `ARCA respondió con un error SOAP: ${fault.faultstring}` : 'AFIP service unavailable',
      details: err.message,
      uncertain: err.uncertain,
      ...(err.statusCode !== undefined && { upstreamStatus: err.statusCode }),
      ...(fault && { soapFault: fault }),
    });
    return;
  }

  // Respuesta de ARCA con forma inesperada (falta un campo obligatorio, valor
  // inválido). Incluye ArcaAgroResponseError (ej: CPE sin nroCTG). Con
  // `uncertain`, la operación pudo haberse procesado: consultar antes de reintentar.
  if (err instanceof ArcaResponseError) {
    res.status(502).json({
      success: false,
      code: err.code,
      error: err.uncertain
        ? 'ARCA respondió con datos incompletos: no se sabe si la operación se procesó. Consultala antes de reintentar.'
        : 'ARCA respondió con una forma inesperada',
      details: err.message,
      uncertain: err.uncertain,
    });
    return;
  }

  // Respuesta de Padrón sin un dato obligatorio.
  if (err instanceof ArcaPadronError) {
    res.status(502).json({ success: false, code: err.code, error: err.message });
    return;
  }

  // Un valor no entra en el archivo de ancho fijo de empleados.
  if (err instanceof ArcaSerializationError) {
    res.status(400).json({
      success: false,
      code: err.code,
      error: err.message,
      field: err.field,
      indice: err.indice,
      desde: err.desde,
      hasta: err.hasta,
    });
    return;
  }

  if (err instanceof ArcaError) {
    res.status(400).json({
      success: false,
      code: err.code,
      error: err.message,
    });
    return;
  }

  // arca-cert errors
  if (err instanceof ArcaCertError) {
    const statusMap: Record<string, number> = {
      INVALID_CUIT: 400,
      INVALID_ALIAS: 400,
      INVALID_SERVICE: 400,
      LOGIN_FAILED: 401,
      SESSION_EXPIRED: 401,
      PORTAL_ERROR: 502,
      WSAA_ERROR: 502,
      WSASS_ERROR: 502,
      CERTIFICATE_ERROR: 422,
      CRYPTO_ERROR: 500,
      NETWORK_ERROR: 502,
      UNSAFE_URL: 400,
    };
    const status = statusMap[err.code] || 400;

    const response: Record<string, unknown> = {
      success: false,
      error: err.message,
      code: err.code,
    };

    if (err.soapFault) {
      response.soapFault = {
        faultcode: err.soapFault.faultcode,
        faultstring: err.soapFault.faultstring,
      };
    }

    res.status(status).json(response);
    return;
  }

  // Zod validation errors (zod 4: `issues`)
  if (err.constructor?.name === 'ZodError') {
    const zodErr = err as any;
    res.status(400).json({
      success: false,
      error: 'Validation error',
      details: zodErr.issues ?? zodErr.errors,
    });
    return;
  }

  // Default server error
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
}
