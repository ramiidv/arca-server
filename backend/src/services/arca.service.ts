import fs from 'fs';
import { Arca, FileTicketStorage } from '@ramiidv/arca-facturacion';
import type { ArcaEvent, ArcaBaseConfig } from '@ramiidv/arca-common';
import { ArcaPadron } from '@ramiidv/arca-padron';
import { ArcaCdc } from '@ramiidv/arca-cdc';
import { ArcaFecred } from '@ramiidv/arca-fecred';
import { ArcaMtxca } from '@ramiidv/arca-mtxca';
import { ArcaSire } from '@ramiidv/arca-sire';
import { ArcaAgro } from '@ramiidv/arca-agro';
import { config } from '../config';

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

function createAll(production?: boolean) {
  const { cert, key } = readCerts();
  // Config común: todos los SDKs extienden ArcaBaseConfig de arca-common
  // (cuit number|string validado con dígito verificador, ticketStorage,
  // onEvent y legacyTls "auto" por defecto para la producción de WSFEv1/WSCDC).
  const base: ArcaBaseConfig = {
    cuit: config.afip.cuit,
    cert,
    key,
    production: production ?? config.afip.production,
    ticketStorage,
    onEvent,
  };

  return {
    arca: new Arca(base),
    padron: new ArcaPadron(base),
    cdc: new ArcaCdc(base),
    fecred: new ArcaFecred(base),
    mtxca: new ArcaMtxca(base),
    sire: new ArcaSire(base),
    agro: new ArcaAgro(base),
  };
}

type Instances = ReturnType<typeof createAll>;

// Las instancias se crean al primer uso: los constructores validan el CUIT y
// leen los certificados, y el server tiene que poder arrancar sin ellos (por
// ejemplo, para generar el certificado desde /api/afip/generate-cert).
let _instances: Instances | null = null;
let _production: boolean | undefined;

function instances(): Instances {
  if (!_instances) _instances = createAll(_production);
  return _instances;
}

export function reloadArca(production?: boolean) {
  _instances = createAll(production);
  _production = production;
  const env = (production ?? config.afip.production) ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN';
  console.log(`[ARCA] Servicios recargados con los certificados nuevos (${env})`);
}

function proxy<K extends keyof Instances>(name: K): Instances[K] {
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
