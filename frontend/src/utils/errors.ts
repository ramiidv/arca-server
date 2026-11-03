/** Error u observación de ARCA (`ArcaWSFEError.errors`, observaciones de un rechazo). */
interface MensajeArca {
  code?: number | string;
  msg?: string;
}

/** Detalle de validación de un 400: issue de Zod (`path`, `message`) o de ArcaValidationError (`field`, `message`). */
interface IssueZod {
  path?: (string | number)[];
  message?: string;
}

/** `"10015: msg; 10016: msg"` (sin repetir lo que el mensaje principal ya incluye). */
function mensajesArca(errores: unknown, yaIncluido: string): string {
  if (!Array.isArray(errores)) return '';
  return (errores as MensajeArca[])
    .filter((e) => e && (e.code !== undefined || e.msg))
    .map((e) => (e.code !== undefined ? `${e.code}: ${e.msg ?? ''}` : String(e.msg)))
    .filter((m) => !yaIncluido.includes(m))
    .join('; ');
}

/** `"items.0.quantity: msg; docNro: msg"` (sin repetir lo que el mensaje principal ya incluye). */
function mensajesZod(details: unknown, yaIncluido: string): string {
  if (!Array.isArray(details)) return '';
  return (details as IssueZod[])
    .filter((d) => d && typeof d.message === 'string')
    .map((d) => (d.path && d.path.length > 0 ? `${d.path.join('.')}: ${d.message}` : String(d.message)))
    .filter((m) => !yaIncluido.includes(m))
    .join('; ');
}

/**
 * Extrae el mensaje de error más útil de un error de axios/API.
 * Prioriza el mensaje del backend (err.response.data.error) sobre
 * el mensaje genérico de axios (err.message), y le agrega:
 * - los códigos y mensajes de ARCA (`errors[]`: "10015: msg"),
 * - los detalles de validación (`details[].message` de Zod),
 * - el soapFault si lo hay.
 * Si ARCA pudo haber procesado la operación (`uncertain`), lo advierte para
 * que no se reintente a ciegas.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as {
    code?: string;
    response?: {
      data?: {
        error?: string;
        code?: string;
        details?: unknown;
        /** Errores u observaciones de ARCA: `[{ code, msg }]` */
        errors?: unknown;
        soapFault?: { faultcode?: string; faultstring?: string };
        /** La operación pudo haberse procesado en ARCA: consultar antes de reintentar */
        uncertain?: boolean;
        /** ArcaAuthError: el servicio quedó bloqueado tras un error permanente de WSAA */
        blocked?: boolean;
        faultCode?: string;
      };
    };
  };

  const data = axiosErr?.response?.data;

  if (!data?.error) {
    if (axiosErr?.code === 'ECONNABORTED') {
      return `${fallback}: el servidor tardó demasiado en responder. Si era una emisión, revisá el listado antes de reintentar.`;
    }
    return fallback;
  }

  let msg = data.error;

  const arca = mensajesArca(data.errors, msg);
  if (arca) msg += ` (${arca})`;

  const zod = mensajesZod(data.details, msg);
  if (zod) msg += ` (${zod})`;

  if (data.soapFault?.faultstring) {
    msg += ` (${data.soapFault.faultcode}: ${data.soapFault.faultstring})`;
  } else if (data.code === 'ARCA_AUTH_ERROR' && data.faultCode) {
    msg += ` (${data.faultCode})`;
  }

  if (data.uncertain && !/reintent/i.test(msg)) {
    msg += ' Puede que ARCA la haya procesado: verificá antes de reintentar.';
  }

  return msg;
}
