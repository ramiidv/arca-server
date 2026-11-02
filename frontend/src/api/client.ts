import axios from 'axios';
import type {
  Invoice,
  Client,
  InvoiceStats,
  EmisionResult,
  PuntoVenta,
  Cotizacion,
  ComprobanteAfip,
  ConstatarInput,
  ConstatarResult,
  PersonaPadron,
  ServicioStatus,
  ArchivoEmpleados,
  RegistroEmpleado,
  ParamAfip,
  ArcaStatus,
  ServerStatus,
  UltimoComprobante,
} from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach token from localStorage on every request
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token && cfg.headers) {
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

// Auto-logout on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

/** El backend responde `{ success, data }`: devuelve `data`. */
function unwrap<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

interface Paginado<T> {
  data: T[];
  pagination?: { page: number; limit: number; total: number; totalPages: number };
}

// La emisión puede tardar más que una consulta: si el resultado es incierto, el
// backend espera y consulta a ARCA (recuperarComprobante) antes de responder.
const TIMEOUT_EMISION = 120000;

// Invoices
export async function getInvoices(params?: {
  page?: number;
  limit?: number;
  cbteTipo?: number;
  desde?: string;
  hasta?: string;
  clientId?: number;
  /** "A" aprobada, "P" pendiente de recuperación, "C" conflicto */
  resultado?: string;
}) {
  const { desde, hasta, ...rest } = params ?? {};
  const { data } = await api.get<Paginado<Invoice>>('/invoices', {
    params: { ...rest, from: desde, to: hasta },
  });
  return {
    invoices: data.data ?? [],
    total: data.pagination?.total ?? 0,
    page: data.pagination?.page ?? 1,
    totalPages: data.pagination?.totalPages ?? 0,
  };
}

/**
 * Emite una factura. Status 201 si ARCA la autorizó; 202 si quedó pendiente
 * (resultado incierto) o en conflicto: ver `afipResponse.pendiente` / `conflicto`.
 */
export async function createInvoice(invoiceData: Record<string, unknown>) {
  const { data } = await api.post('/invoices', invoiceData, { timeout: TIMEOUT_EMISION });
  return unwrap<EmisionResult>(data);
}

export async function createNotaCredito(payload: Record<string, unknown>) {
  const { data } = await api.post('/invoices/nota-credito', payload, { timeout: TIMEOUT_EMISION });
  return unwrap<EmisionResult>(data);
}

export async function createNotaDebito(payload: Record<string, unknown>) {
  const { data } = await api.post('/invoices/nota-debito', payload, { timeout: TIMEOUT_EMISION });
  return unwrap<EmisionResult>(data);
}

/** Reintenta la recuperación en ARCA de una factura pendiente (resultado incierto) o en conflicto. */
export async function recuperarFactura(id: number) {
  const { data } = await api.post(`/invoices/${id}/recuperar`, undefined, { timeout: TIMEOUT_EMISION });
  return unwrap<EmisionResult>(data);
}

export async function getInvoice(id: number) {
  const { data } = await api.get(`/invoices/${id}`);
  return unwrap<Invoice>(data);
}

export async function getInvoiceStats() {
  const { data } = await api.get('/invoices/stats');
  const s = unwrap<{
    totalCount: number;
    pendingCount?: number;
    totalAmount: number | string;
    byType: { cbteTipo: number; name?: string; count: number; total: number | string }[];
  }>(data);
  const stats: InvoiceStats = {
    totalInvoices: s.totalCount,
    totalAmount: Number(s.totalAmount),
    pendingInvoices: s.pendingCount ?? 0,
    byType: s.byType.map((t) => ({ cbteTipo: t.cbteTipo, count: t.count, total: Number(t.total) })),
  };
  return stats;
}

// Clients
export async function getClients(params?: {
  page?: number;
  limit?: number;
  search?: string;
}) {
  const { data } = await api.get<Paginado<Client>>('/clients', { params });
  return {
    clients: data.data ?? [],
    total: data.pagination?.total ?? 0,
    page: data.pagination?.page ?? 1,
    totalPages: data.pagination?.totalPages ?? 0,
  };
}

export async function createClient(clientData: Partial<Client>) {
  const { data } = await api.post('/clients', clientData);
  return unwrap<Client>(data);
}

export async function getClient(id: number) {
  const { data } = await api.get(`/clients/${id}`);
  return unwrap<Client>(data);
}

export async function updateClient(id: number, clientData: Partial<Client>) {
  const { data } = await api.put(`/clients/${id}`, clientData);
  return unwrap<Client>(data);
}

export async function deleteClient(id: number) {
  const { data } = await api.delete(`/clients/${id}`);
  return data;
}

// AFIP — las respuestas usan los nombres camelCase de los SDKs @ramiidv/arca-*

/** Estado de WSFEv1 y WSFEX: `{ wsfe, wsfex }`, cada uno `{ ok, status }` o `{ ok: false, error, status? }`. */
export async function getAfipStatus() {
  const { data } = await api.get('/afip/status');
  return unwrap<ArcaStatus>(data);
}

/**
 * Limpia la espera de WSAA tras un login rechazado por un error permanente
 * (certificado vencido, servicio no autorizado...). Usar después de corregir la causa.
 */
export async function resetWsaa() {
  const { data } = await api.post('/afip/wsaa-reset');
  return unwrap<{ message: string }>(data);
}

export async function getLastVoucher(puntoVenta: number, cbteTipo: number) {
  const { data } = await api.get('/afip/last-voucher', {
    params: { puntoVenta, cbteTipo },
  });
  return unwrap<UltimoComprobante>(data);
}

export async function getPuntosVenta() {
  const { data } = await api.get('/afip/puntos-venta');
  return unwrap<PuntoVenta[]>(data);
}

/** Padrón A4. Incluye `condicionIvaSugerida` (condicionIvaDesdePadron). 404 si el CUIT no existe. */
export async function consultarCuit(cuit: number | string) {
  const { data } = await api.get(`/afip/contribuyente/${cuit}`);
  return unwrap<PersonaPadron>(data);
}

export async function consultarComprobante(puntoVenta: number, cbteTipo: number, cbteNro: number) {
  const { data } = await api.get('/afip/comprobante', {
    params: { puntoVenta, cbteTipo, cbteNro },
  });
  return unwrap<ComprobanteAfip>(data);
}

/** Cotización oficial: `{ monId, monCotiz, fchCotiz }`. `fecha` opcional (YYYYMMDD). */
export async function getCotizacion(monedaId: string, fecha?: string) {
  const { data } = await api.get('/afip/cotizacion', { params: { monedaId, fecha } });
  return unwrap<Cotizacion>(data);
}

export async function getAfipInvoiceTypes() {
  const { data } = await api.get('/afip/invoice-types');
  return unwrap<ParamAfip[]>(data);
}

export async function getAfipDocTypes() {
  const { data } = await api.get('/afip/doc-types');
  return unwrap<ParamAfip[]>(data);
}

export async function getAfipIvaTypes() {
  const { data } = await api.get('/afip/iva-types');
  return unwrap<ParamAfip[]>(data);
}

export async function getAfipConceptTypes() {
  const { data } = await api.get('/afip/concept-types');
  return unwrap<ParamAfip[]>(data);
}

export async function getAfipCurrencyTypes() {
  const { data } = await api.get('/afip/currency-types');
  return unwrap<ParamAfip[]>(data);
}

export async function getAfipTributoTypes() {
  const { data } = await api.get('/afip/tributo-types');
  return unwrap<ParamAfip[]>(data);
}

export async function getAfipIvaConditions() {
  const { data } = await api.get('/afip/iva-conditions');
  return unwrap<ParamAfip[]>(data);
}

export async function consultarCuitBasic(cuit: number | string) {
  const { data } = await api.get(`/afip/contribuyente-basic/${cuit}`);
  return unwrap<PersonaPadron>(data);
}

/** Un resultado por servicio (a5, a4, a10, a13, a100): `{ ok, status | error }`. */
export async function getPadronStatus() {
  const { data } = await api.get('/afip/padron-status');
  return unwrap<Record<string, ServicioStatus>>(data);
}

/** Constatación (WSCDC). `cbteModo` y `cuitEmisor` son obligatorios. */
export async function constatarComprobante(input: ConstatarInput) {
  const { data } = await api.post('/afip/constatar', input, { timeout: 60000 });
  return unwrap<ConstatarResult>(data);
}

export async function getCdcStatus() {
  const { data } = await api.get('/afip/cdc-status');
  return unwrap<ServerStatus>(data);
}

export async function getCdcTiposCbte() {
  const { data } = await api.get('/afip/cdc-tipos-cbte');
  return unwrap<{ id: number; desc: string }[]>(data);
}

export async function getAfipOptionalTypes() {
  const { data } = await api.get('/afip/optional-types');
  return unwrap<ParamAfip[]>(data);
}

interface CertResult {
  alias: string;
  cuit: string;
  environment: string;
  message: string;
}

export async function generateCert(payload: { cuit: string; password: string; alias: string; environment?: string }) {
  const { data } = await api.post('/afip/generate-cert', payload, { timeout: 120000 });
  return unwrap<CertResult>(data);
}

export async function renewCert(payload: { cuit: string; password: string; alias: string; environment?: string }) {
  const { data } = await api.post('/afip/renew-cert', payload, { timeout: 120000 });
  return unwrap<CertResult>(data);
}

export async function getCertInfo() {
  const { data } = await api.get('/afip/cert-info');
  return unwrap<{ notBefore: string; notAfter: string; daysLeft: number; expired: boolean } | null>(data);
}

export async function testCert(environment?: string) {
  const { data } = await api.post('/afip/test-cert', { environment }, { timeout: 60000 });
  return unwrap<{ valid: boolean; expirationTime: string; message: string }>(data);
}

// FECRED

/** Identificación de la cuenta corriente: por código o por la factura. */
export type IdCtaCte =
  | { codCtaCte: number | string }
  | { idFactura: { cuitEmisor: number | string; codTipoCmp: number; ptoVta: number; nroCmp: number } };

export async function getFecredStatus() {
  const { data } = await api.get('/afip/fecred-status');
  return unwrap<ServerStatus>(data);
}

/**
 * `fechaEmision` (YYYYMMDD o YYYY-MM-DD) es opcional: el backend usa hoy (Argentina).
 * `obligado` puede faltar si ARCA solo devolvió observaciones.
 */
export async function consultarFecredObligado(cuit: string, fechaEmision?: string) {
  const { data } = await api.get(`/afip/fecred-obligado/${cuit}`, { params: { fechaEmision } });
  return unwrap<{ obligado?: boolean; montoDesde?: number; observaciones: unknown[] }>(data);
}

/** Respuesta paginada: `{ ctasCtes, nroPagina?, hayMas?, evento?, observaciones }`. */
export async function consultarFecredCtasCtes(params: {
  rol: 'Emisor' | 'Receptor';
  cuitContraparte?: string;
  fecha?: { tipo: string; desde: string; hasta: string };
  estadoCtaCte?: string;
  nroPagina?: number;
}) {
  const { data } = await api.post('/afip/fecred-ctas-ctes', params);
  return unwrap<{ ctasCtes: Record<string, unknown>[]; nroPagina?: number; hayMas?: boolean; observaciones: unknown[] }>(data);
}

export async function aceptarFecred(params: {
  idCtaCte: IdCtaCte;
  saldoAceptado: number;
  codMoneda: string;
  cotizacionMonedaUlt: number;
  [opcional: string]: unknown;
}) {
  const { data } = await api.post('/afip/fecred-aceptar', params);
  return unwrap<{ resultado: string; idCtaCte: unknown; observaciones: unknown[] }>(data);
}

export async function rechazarFecred(params: {
  idCtaCte: IdCtaCte;
  motivos: { codMotivo: number; descMotivo: string; justificacion: string }[];
}) {
  const { data } = await api.post('/afip/fecred-rechazar', params);
  return unwrap<{ resultado: string; idCtaCte: unknown; observaciones: unknown[] }>(data);
}

// MTXCA
export async function getMtxcaStatus() {
  const { data } = await api.get('/afip/mtxca-status');
  return unwrap<ServerStatus>(data);
}

/**
 * ComprobanteType con los nombres del XSD (condicionIVAReceptor obligatoria). Un rechazo
 * (resultado "R") responde 422. Con resultado A/O incluye `urlQR`.
 */
export async function autorizarMtxca(comprobante: Record<string, unknown>) {
  const { data } = await api.post('/afip/mtxca-autorizar', comprobante);
  return unwrap<{ resultado: 'A' | 'O' | 'R'; comprobante?: Record<string, unknown>; errores?: unknown[]; urlQR?: string }>(data);
}

// SIRE (solo existen emitir, anular y status)
export async function getSireStatus() {
  const { data } = await api.get('/afip/sire-status');
  // headerInfo: ambiente, fecha y versiones del header SOAP de SIRE
  return unwrap<ServerStatus & { headerInfo?: Record<string, string> }>(data);
}

export async function emitirCertificadoSire(params: Record<string, unknown>) {
  const { data } = await api.post('/afip/sire-emitir', params);
  return unwrap<{ certificadoNro: string; codigoSeguridad: string }>(data);
}

export async function anularCertificadoSire(params: {
  numeroCertificado: string;
  motivoAnulacion: number;
  codigoTrazabilidad?: string;
}) {
  const { data } = await api.post('/afip/sire-anular', params);
  return unwrap<{ certificadoNro: string; codigoSeguridad: string }>(data);
}

// AGRO (WSCPE y WSLPG; WSCTG fue derogado)
export async function getAgroStatus() {
  const { data } = await api.get('/afip/agro-status');
  return unwrap<{ cpe: ServicioStatus; lpg: ServicioStatus }>(data);
}

export async function autorizarCPE(cpe: Record<string, unknown>) {
  const { data } = await api.post('/afip/agro-cpe-autorizar', cpe);
  return unwrap<Record<string, unknown>>(data);
}

export async function autorizarLiquidacion(liquidacion: Record<string, unknown>) {
  const { data } = await api.post('/afip/agro-lpg-autorizar', liquidacion);
  return unwrap<Record<string, unknown>>(data);
}

// EMPLEADOS (ingreso masivo de relaciones laborales, ancho fijo de 130 posiciones)
export async function generarArchivoEmpleados(params: { registros: RegistroEmpleado[]; strict?: boolean }) {
  const { data } = await api.post('/afip/empleados-generar', params);
  return unwrap<ArchivoEmpleados>(data);
}

/** Descarga el TXT (ISO-8859-1) listo para subir a Simplificación Registral. */
export async function descargarArchivoEmpleados(params: { registros: RegistroEmpleado[]; strict?: boolean }) {
  const res = await api.post('/afip/empleados-generar', params, {
    params: { formato: 'txt' },
    responseType: 'blob',
  });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const nombre = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'relaciones-laborales.txt';
  return { blob: res.data as Blob, nombre };
}

export default api;
