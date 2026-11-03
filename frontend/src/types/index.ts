export interface Client {
  id: number;
  name: string;
  docType: number;
  docNumber: string;
  ivaCondition: number;
  address?: string;
  email?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
  _count?: { invoices: number };
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  ivaId: number;
  ivaRate?: number;
  subtotal?: number;
  ivaAmount?: number;
}

export interface Invoice {
  id: number;
  cbteTipo: number;
  puntoVenta: number;
  cbteNro: number;
  cbteDesde: number;
  cbteHasta: number;
  cbteFch: string;
  concepto: number;
  docTipo: number;
  docNro: string;
  impTotal: number;
  impTotConc: number;
  impNeto: number;
  impOpEx: number;
  impIVA: number;
  impTrib: number;
  cae?: string;
  caeFchVto?: string;
  resultado?: string;
  fchServDesde?: string;
  fchServHasta?: string;
  fchVtoPago?: string;
  clientId?: number;
  client?: Client;
  items: InvoiceItem[];
  qrUrl?: string;
  observations?: string;
  /** Datos de la emisión en ARCA (para recuperar un resultado incierto) */
  emision?: EmisionGuardada | null;
  createdAt: string;
}

/** Valores de `Invoice.resultado` */
export const RESULTADO = {
  APROBADA: 'A',
  /** Resultado incierto: hay que recuperarla en ARCA */
  PENDIENTE: 'P',
  /** El número existe en ARCA con otros datos: revisión manual */
  CONFLICTO: 'C',
} as const;

/** Intento de emisión: alcanza para consultar en ARCA si el comprobante se autorizó */
export interface IntentoComprobante {
  ptoVta: number;
  cbteTipo: number;
  cbteNro: number;
  importeTotal: number;
  docTipo: number;
  docNro: number;
  fecha: string;
}

export interface EmisionGuardada {
  operacion: 'facturar' | 'notaCredito' | 'notaDebito';
  intento: IntentoComprobante;
  estado: 'enviando' | 'incierto' | 'conflicto' | 'autorizado';
  envios: number;
  ultimoMensaje?: string;
  encontrado?: Record<string, unknown>;
  actualizado: string;
}

export interface MensajeArca {
  code: number;
  msg: string;
}

/** Respuesta de emitir / recuperar una factura */
export interface EmisionResult {
  invoice: Invoice;
  afipResponse: {
    resultado?: string | null;
    cae?: string | null;
    caeFchVto?: string;
    qrUrl?: string;
    observaciones?: MensajeArca[];
    eventos?: MensajeArca[];
    /** true si el resultado sigue incierto: se puede reintentar la recuperación */
    pendiente?: boolean;
    /** true si el número existe en ARCA con otros datos */
    conflicto?: boolean;
    mensaje?: string;
    intento?: IntentoComprobante;
  };
}

export interface InvoiceStats {
  /** Solo facturas (sin notas de crédito ni de débito) */
  totalInvoices: number;
  creditNotes: number;
  debitNotes: number;
  /** Facturas + ND − NC */
  totalAmount: number;
  /** Facturas pendientes de recuperación o en conflicto */
  pendingInvoices: number;
  /** Facturas del mes (sin NC/ND) */
  monthlyInvoices: number;
  monthlyCreditNotes: number;
  monthlyDebitNotes: number;
  /** Facturas + ND − NC del mes */
  monthlyAmount: number;
  byType: { cbteTipo: number; count: number; total: number }[];
}

// ARCA — los campos siguen los nombres camelCase de los SDKs @ramiidv/arca-* (facturacion 6, cdc 0.6...)

/** Ítem de las tablas de parámetros de WSFEv1 (`getTipos*`, `getMonedas`, `getCondicionesIva`) */
export interface ParamAfip {
  /** Numérico en casi todas las tablas; string en monedas (`PES`, `DOL`, `060`) */
  id: number | string;
  desc: string;
  fchDesde?: string;
  fchHasta?: string;
  /** Solo en condiciones de IVA: clases de comprobante para las que vale (ej: "A/M/C") */
  cmpClase?: string;
}

/** Punto de venta (`getPuntosVenta`) */
export interface PuntoVenta {
  nro: number;
  emisionTipo?: string;
  /** "S" o "N" */
  bloqueado?: string;
  fchBaja?: string;
}

/** `getCotizacion` */
export interface Cotizacion {
  monId: string;
  monCotiz: number;
  /** YYYYMMDD */
  fchCotiz: string;
}

/** Último comprobante autorizado (`/afip/last-voucher`) */
export interface UltimoComprobante {
  cbteNro: number;
  ptoVta: number;
  cbteTipo: number;
}

/** `consultarComprobante` (`FECompConsultarResult.resultGet`) con las listas siempre presentes */
export interface ComprobanteAfip {
  concepto: number;
  docTipo: number;
  docNro: number;
  cbteDesde: number;
  cbteHasta: number;
  cbteFch?: string;
  impTotal: number;
  impTotConc: number;
  impNeto: number;
  impOpEx: number;
  impTrib: number;
  impIva: number;
  fchServDesde?: string;
  fchServHasta?: string;
  fchVtoPago?: string;
  monId?: string;
  monCotiz?: number;
  resultado?: 'A' | 'R';
  codAutorizacion?: string;
  /** "CAE" o "CAEA" */
  emisionTipo?: string;
  fchVto?: string;
  fchProceso?: string;
  ptoVta: number;
  cbteTipo: number;
  condicionIvaReceptorId?: number;
  canMisMonExt?: string;
  iva: { id: number; baseImp: number; importe: number }[];
  tributos: { id: number; desc?: string; baseImp: number; alic: number; importe: number }[];
  cbtesAsoc: { tipo: number; ptoVta: number; nro: number; cuit?: string | number; cbteFch?: string }[];
  opcionales: { id: string; valor: string }[];
  observaciones: MensajeArca[];
  /** `Events` de ARCA */
  events: MensajeArca[];
}

export type CbteModo = 'CAE' | 'CAI' | 'CAEA';

/** Input de `constatar` (WSCDC, arca-cdc) */
export interface ConstatarInput {
  cbteModo: CbteModo;
  cuitEmisor: string;
  ptoVta: number;
  cbteTipo: number;
  cbteNro: number;
  /** YYYYMMDD o YYYY-MM-DD */
  cbteFch: string;
  impTotal: number;
  codAutorizacion: string;
  docTipoReceptor?: number;
  docNroReceptor?: string;
  opcionales?: { id: string; valor: string }[];
}

export interface ConstatarResult {
  resultado: 'A' | 'R';
  /** YYYYMMDDHHMMSS */
  fchProceso: string;
  /** Datos del comprobante constatado (puede faltar en un rechazo) */
  cmpResp?: Record<string, unknown>;
  observaciones: MensajeArca[];
  /** `Events` de ARCA */
  eventos: MensajeArca[];
}

/** Persona del padrón A4 (campos usados por la UI) */
export interface PersonaPadron {
  idPersona: string;
  /** FISICA o JURIDICA (el SDK devuelve tal cual otros valores) */
  tipoPersona: string;
  estadoClave?: string;
  nombre?: string;
  apellido?: string;
  razonSocial?: string;
  domicilio?: {
    direccion?: string;
    localidad?: string;
    codPostal?: string;
    descripcionProvincia?: string;
    tipoDomicilio?: string;
  }[];
  impuesto?: { idImpuesto: number; descripcionImpuesto?: string; estado?: string }[];
  /** Fecha/hora y servidor de la respuesta de ARCA */
  metadata?: { fechaHora?: string; servidor?: string };
  /** Condición de IVA inferida por el backend (null + motivo si no se puede determinar) */
  condicionIvaSugerida?: { condicionIva: number | null; motivo: string };
}

/** `dummy` de un servicio (nombres de arca-common: appserver/dbserver/authserver) */
export interface ServerStatus {
  appserver: string;
  dbserver: string;
  authserver: string;
  [otro: string]: unknown;
}

/**
 * Health check por servicio (`ServiceStatus` de arca-common): `ok` es true solo si
 * todos los servidores están en OK. Con `ok: false`, `status` viene si el servicio
 * respondió con algún servidor caído.
 */
export type ServicioStatus =
  | { ok: true; status: ServerStatus }
  | { ok: false; error: string; status?: ServerStatus };

export type AmbienteArca = 'production' | 'testing';

/** `/afip/config`: configuración de ARCA activa del server */
export interface ArcaConfig {
  /** AFIP_PRODUCTION del server */
  environment: AmbienteArca;
  cuit: string | null;
  puntoVenta: number;
}

/** `/afip/status`: WSFEv1 y WSFEX por separado */
export interface ArcaStatus {
  wsfe: ServicioStatus;
  wsfex: ServicioStatus;
}

export interface RegistroEmpleado {
  tipo: 'alta' | 'baja' | 'modificacion' | 'novedad';
  data: Record<string, unknown>;
}

export interface ArchivoEmpleados {
  contenido: string;
  lineas: string[];
  encoding: string;
  resumen: { totalRegistros: number; altas: number; bajas: number; modificaciones: number; na: number; nb: number };
}

// Constants

/** Largo mínimo de la contraseña (registerSchema del backend, routes/auth.ts). */
export const LARGO_MINIMO_PASSWORD = 8;
export const CBTE_TIPOS: Record<number, string> = {
  1: 'Factura A',
  2: 'Nota de Débito A',
  3: 'Nota de Crédito A',
  6: 'Factura B',
  7: 'Nota de Débito B',
  8: 'Nota de Crédito B',
  11: 'Factura C',
  12: 'Nota de Débito C',
  13: 'Nota de Crédito C',
};

export const DOC_TIPOS: Record<number, string> = {
  80: 'CUIT',
  86: 'CUIL',
  96: 'DNI',
  99: 'Sin identificar / Consumidor Final',
};

export const IVA_ALICUOTAS: Record<number, { name: string; rate: number }> = {
  3: { name: '0%', rate: 0 },
  4: { name: '10,5%', rate: 10.5 },
  5: { name: '21%', rate: 21 },
  6: { name: '27%', rate: 27 },
  8: { name: '5%', rate: 5 },
  9: { name: '2,5%', rate: 2.5 },
};

export const IVA_CONDITIONS: Record<number, string> = {
  1: 'Responsable Inscripto',
  4: 'Exento',
  5: 'Consumidor Final',
  6: 'Monotributista',
  7: 'No Categorizado',
  8: 'Proveedor del Exterior',
  9: 'Cliente del Exterior',
  10: 'IVA Liberado',
  13: 'Monotributo Social',
  15: 'IVA No Alcanzado',
  16: 'Monotributo Independiente Promovido',
};

/** Facturas A, B y C (`CbteTipo.FACTURA_A/B/C`): las que se emiten en Nueva Factura y admiten NC/ND. */
export const TIPOS_FACTURA = [1, 6, 11];

/**
 * Clase de cada tipo de CBTE_TIPOS. Números de `CbteTipo` de
 * @ramiidv/arca-facturacion (el frontend no depende de los SDKs).
 */
export const CLASE_CBTE: Record<number, 'A' | 'B' | 'C'> = {
  1: 'A',
  2: 'A',
  3: 'A',
  6: 'B',
  7: 'B',
  8: 'B',
  11: 'C',
  12: 'C',
  13: 'C',
};

/**
 * Condiciones de IVA del receptor por clase de comprobante, igual que
 * `resolverCbteTipo` de @ramiidv/arca-facturacion (manual WSFEv1, RG 5616):
 * - A: 1, 6, 13, 16 (`RECEPTORES_CLASE_A`, validación 10243).
 * - B: 4, 5, 7, 8, 9, 10, 15.
 * - C: todas las de IVA_CONDITIONS.
 */
export const CONDICIONES_IVA_POR_CLASE: Record<'A' | 'B' | 'C', number[]> = {
  A: [1, 6, 13, 16],
  B: [4, 5, 7, 8, 9, 10, 15],
  C: Object.keys(IVA_CONDITIONS).map(Number),
};

/** Nombre de cada ambiente de ARCA (`ArcaConfig.environment`). */
export const NOMBRE_AMBIENTE: Record<AmbienteArca, string> = {
  production: 'Producción',
  testing: 'Homologación',
};
