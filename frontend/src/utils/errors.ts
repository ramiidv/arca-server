/**
 * Extrae el mensaje de error más útil de un error de axios/API.
 * Prioriza el mensaje del backend (err.response.data.error) sobre
 * el mensaje genérico de axios (err.message).
 * Si hay soapFault, lo incluye para debugging. Si ARCA pudo haber procesado
 * la operación (`uncertain`), lo advierte para que no se reintente a ciegas.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as {
    response?: {
      data?: {
        error?: string;
        code?: string;
        details?: unknown;
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

  if (!data?.error) return fallback;

  let msg = data.error;

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
