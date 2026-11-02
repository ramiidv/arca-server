import fs from 'fs';
import { ArcaFacturacion, FileTicketStorage } from '@ramiidv/arca-facturacion';
import { createWsaaClient } from '@ramiidv/arca-common';
import type { ArcaEvent, ArcaSdkConfig } from '@ramiidv/arca-common';
import { ArcaPadron } from '@ramiidv/arca-padron';
import { ArcaCdc } from '@ramiidv/arca-cdc';
import { ArcaFecred } from '@ramiidv/arca-fecred';
import { ArcaMtxca } from '@ramiidv/arca-mtxca';
import { ArcaSire } from '@ramiidv/arca-sire';
import { ArcaAgro } from '@ramiidv/arca-agro';
import { config } from '../config';
import { AppError } from '../middleware/errorHandler';

function errorText(error: Error | string): string {
  return error instanceof Error ? error.message : error;
}

function onEvent(event: ArcaEvent) {
  switch (event.type) {
    case 'auth:login':
      console.log(`[ARCA] Login WSAA para ${event.service} (${event.durationMs ?? '?'}ms)`);
      break;
    case 'auth:cache-hit':
      console.log(`[ARCA] Ticket reutilizado para ${event.service} (${event.source ?? 'memory'})`);
      break;
    case 'auth:clock-skew':
      console.warn(`[ARCA] Desfase de reloj ajustado para ${event.service}: ${event.offsetMs}ms`);
      break;
    case 'auth:storage-error':
      console.error(`[ARCA] Error del ticketStorage (${event.operation}) para ${event.service}: ${errorText(event.error)}`);
      break;
    case 'request:end':
      console.log(`[ARCA] ${event.method} completado (${event.durationMs}ms)`);
      break;
    case 'request:retry':
      console.warn(`[ARCA] Reintento #${event.attempt} de ${event.method}: ${errorText(event.error)}`);
      break;
    case 'request:error':
      console.error(`[ARCA] Error en ${event.method}: ${errorText(event.error)}`);
      break;
  }
}

function readCerts() {
  if (!fs.existsSync(config.afip.certPath) || !fs.existsSync(config.afip.keyPath)) {
    throw new AppError(503, 'No hay certificado de ARCA instalado: generalo desde Configuración (POST /api/afip/generate-cert).');
  }
  return {
    cert: fs.readFileSync(config.afip.certPath, 'utf8'),
    key: fs.readFileSync(config.afip.keyPath, 'utf8'),
  };
}

/**
 * Storage de Tickets de Acceso compartido por todos los SDKs. WSAA rechaza un
 * login nuevo mientras exista un TA vigente para el mismo certificado y
 * servicio: sin persistirlo, cada reinicio del server terminaría en
 * `ArcaTicketVigenteError` hasta que venza el ticket anterior (hasta 12 h).
 * Las keys incluyen entorno + certificado + servicio, así que un mismo
 * directorio sirve para todos los servicios y para homologación/producción.
 */
const ticketStorage = new FileTicketStorage(config.afip.ticketsDir);

function credencialesDe(production?: boolean) {
  const { cert, key } = readCerts();
  return {
    cuit: config.afip.cuit,
    cert,
    key,
    production: production ?? config.afip.production,
    ticketStorage,
    onEvent,
  };
}

function createAll(production?: boolean) {
  const credenciales = credencialesDe(production);
  // Un solo WsaaClient para los 7 SDKs (mismo certificado): comparte los
  // tickets en memoria, el reloj de ARCA y las esperas tras un login fallido.
  // Valida el certificado y la clave al construirse (ArcaValidationError).
  const wsaa = createWsaaClient(credenciales, onEvent);

  // Config común: todas las configs de los SDKs extienden ArcaSdkConfig de
  // arca-common (cuit number|string validado con dígito verificador,
  // ticketStorage, onEvent, `wsaa` compartido del mismo entorno y legacyTls
  // "auto" por defecto para la producción de WSFEv1/WSCDC). Con `wsaa`, los
  // SDKs ignoran cert/key/ticketStorage: se pasan igual porque son obligatorios.
  const base: ArcaSdkConfig = { ...credenciales, wsaa };

  return {
    wsaa,
    arca: new ArcaFacturacion(base),
    padron: new ArcaPadron(base),
    cdc: new ArcaCdc(base),
    fecred: new ArcaFecred(base),
    mtxca: new ArcaMtxca(base),
    sire: new ArcaSire(base),
    agro: new ArcaAgro(base),
  };
}

type Instances = ReturnType<typeof createAll>;
type Sdk = Exclude<keyof Instances, 'wsaa'>;

// Las instancias se crean al primer uso: los constructores validan el CUIT, el
// certificado y la clave, y el server tiene que poder arrancar sin ellos (por
// ejemplo, para generar el certificado desde /api/afip/generate-cert).
let _instances: Instances | null = null;
let _production: boolean | undefined;

function instances(): Instances {
  if (!_instances) _instances = createAll(_production);
  return _instances;
}

/**
 * Limpia las esperas de WSAA tras un login fallido (todas las de los servicios).
 * Tras un error permanente (certificado vencido, `coe.notAuthorized`...) el
 * WsaaClient no vuelve a pedir tickets hasta esto, `clearTicket` o un
 * certificado nuevo (`reloadArca`). Devuelve false si todavía no se creó.
 */
export function resetWsaaCooldown(): boolean {
  if (!_instances) return false;
  _instances.wsaa.resetLoginCooldown();
  return true;
}

/**
 * Prueba el certificado instalado pidiendo un Ticket de Acceso de `wsfe` a WSAA
 * con el WsaaClient del SDK, así el ticket queda en el mismo `ticketStorage`
 * que usan los SDKs (un ticket obtenido por fuera haría que el próximo login
 * del SDK falle con `ArcaTicketVigenteError` hasta que venza). Si el entorno
 * pedido es el de los SDKs se usa su WsaaClient; si no, uno temporal.
 */
export async function probarCertificado(production: boolean) {
  const actual = instances();
  const wsaa = actual.wsaa.production === production ? actual.wsaa : createWsaaClient(credencialesDe(production), onEvent);
  return wsaa.getAccessTicket('wsfe');
}

export function reloadArca(production?: boolean) {
  _instances = createAll(production);
  _production = production;
  const env = (production ?? config.afip.production) ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN';
  console.log(`[ARCA] Servicios recargados con los certificados nuevos (${env})`);
}

function proxy<K extends Sdk>(name: K): Instances[K] {
  return new Proxy({} as Instances[K], {
    get(_target, prop) {
      const target = instances()[name] as any;
      const value = target[prop];
      // Los SDKs usan campos privados (#): los métodos se invocan sobre la instancia real.
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export const arca = proxy('arca');
export const padron = proxy('padron');
export const cdc = proxy('cdc');
export const fecred = proxy('fecred');
export const mtxca = proxy('mtxca');
export const sire = proxy('sire');
export const agro = proxy('agro');
