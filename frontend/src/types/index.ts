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
  totalInvoices: number;
  totalAmount: number;
  /** Facturas pendientes de recuperación o en conflicto */
  pendingInvoices?: number;
  monthlyInvoices?: number;
  monthlyAmount?: number;
  byType: { cbteTipo: number; count: number; total: number }[];
}

// ARCA

/** Ítem de las tablas de parámetros de WSFEv1 (`FEParamGet*`) */
export interface ParamAfip {
  Id: number | string;
  Desc: string;
  FchDesde?: string;
  FchHasta?: string;
  Cmp_Clase?: string;
}

export interface PuntoVenta {
  Nro: number;
  EmisionTipo: string;
  Bloqueado: string;
  FchBaja: string;
}

/** `FEParamGetCotizacion` (ResultGet) */
export interface Cotizacion {
  MonId: string;
  MonCotiz: number;
  /** YYYYMMDD */
  FchCotiz: string;
}

/** `FECompConsultar` (ResultGet) con las listas como arrays */
export interface ComprobanteAfip {
  Concepto: number;
  DocTipo: number;
  DocNro: number;
  CbteDesde: number;
  CbteHasta: number;
  CbteFch: string;
  ImpTotal: number;
  ImpTotConc: number;
  ImpNeto: number;
  ImpOpEx: number;
  ImpTrib: number;
  ImpIVA: number;
  FchServDesde?: string;
  FchServHasta?: string;
  FchVtoPago?: string;
  MonId: string;
  MonCotiz: number;
  Resultado: 'A' | 'R';
  CodAutorizacion: string;
  EmisionTipo: string;
  FchVto: string;
  FchProceso: string;
  PtoVta: number;
  CbteTipo: number;
  CondicionIVAReceptorId?: number;
  Iva: { Id: number; BaseImp: number; Importe: number }[];
  Tributos: { Id: number; Desc?: string; BaseImp: number; Alic?: number; Importe: number }[];
  CbtesAsoc: { Tipo: number; PtoVta: number; Nro: number }[];
  Opcionales: { Id: string; Valor: string }[];
  Observaciones: { Code: number; Msg: string }[];
  Events: { Code: number; Msg: string }[];
}

export type CbteModo = 'CAE' | 'CAI' | 'CAEA';

/** Bloque `CmpReq` de WSCDC */
export interface ConstatarInput {
  CbteModo: CbteModo;
  CuitEmisor: string;
  PtoVta: number;
  CbteTipo: number;
  CbteNro: number;
  CbteFch: string;
  ImpTotal: number;
  CodAutorizacion: string;
  DocTipoReceptor?: number;
  DocNroReceptor?: string;
}

export interface ConstatarResult {
  Resultado: 'A' | 'R';
  FchProceso: string;
  CmpResp?: Record<string, unknown>;
  Observaciones: { Code: number; Msg: string }[];
  Events: { Code: number; Msg: string }[];
}

/** Persona del padrón A4 (campos usados por la UI) */
export interface PersonaPadron {
  idPersona: string;
  tipoPersona: 'FISICA' | 'JURIDICA';
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
  /** Condición de IVA inferida por el backend (null + motivo si no se puede determinar) */
  condicionIvaSugerida?: { condicionIva: number | null; motivo: string };
}

/** Health check por servicio */
export type ServicioStatus =
  | { ok: true; status: Record<string, string> }
  | { ok: false; error: string };

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
export const CBTE_TIPOS: Record<number, string> = {
  1: 'Factura A',
  2: 'Nota de Debito A',
  3: 'Nota de Credito A',
  6: 'Factura B',
  7: 'Nota de Debito B',
  8: 'Nota de Credito B',
  11: 'Factura C',
  12: 'Nota de Debito C',
  13: 'Nota de Credito C',
};

export const DOC_TIPOS: Record<number, string> = {
  80: 'CUIT',
  86: 'CUIL',
  96: 'DNI',
  99: 'Consumidor Final',
};

export const IVA_ALICUOTAS: Record<number, { name: string; rate: number }> = {
  3: { name: '0%', rate: 0 },
  4: { name: '10.5%', rate: 10.5 },
  5: { name: '21%', rate: 21 },
  6: { name: '27%', rate: 27 },
  8: { name: '5%', rate: 5 },
  9: { name: '2.5%', rate: 2.5 },
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
