import { useState, useEffect } from 'react';
import { MagnifyingGlassIcon, DocumentTextIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { consultarComprobante, constatarComprobante, getPuntosVenta } from '../api/client';
import { getApiErrorMessage } from '../utils/errors';
import {
  CBTE_TIPOS,
  DOC_TIPOS,
  type CbteModo,
  type ComprobanteAfip,
  type ConstatarInput,
  type ConstatarResult,
  type PuntoVenta,
} from '../types';
import { formatCurrency, formatDate, inputDateToYYYYMMDD } from '../utils/formatters';

export default function ConsultaComprobante() {
  const [puntosVenta, setPuntosVenta] = useState<PuntoVenta[]>([]);
  const [puntoVenta, setPuntoVenta] = useState(1);
  const [cbteTipo, setCbteTipo] = useState(11);
  const [cbteNro, setCbteNro] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComprobanteAfip | null>(null);

  useEffect(() => {
    getPuntosVenta()
      .then((data) => {
        const activos = (Array.isArray(data) ? data : [])// bloqueado puede faltar (opcional en el SDK): solo se descartan los bloqueados
        .filter((p) => p.bloqueado !== 'S');
        setPuntosVenta(activos);
        if (activos.length > 0) setPuntoVenta(activos[0].nro);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, 'Error al cargar los puntos de venta de ARCA'), { duration: 8000 }));
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const nro = parseInt(cbteNro, 10);
    if (isNaN(nro) || nro <= 0) {
      toast.error('Ingresá un número de comprobante válido');
      return;
    }

    try {
      setLoading(true);
      setResult(null);
      const data = await consultarComprobante(puntoVenta, cbteTipo, nro);
      setResult(data);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'No se encontró el comprobante en ARCA'), { duration: 8000 });
    } finally {
      setLoading(false);
    }
  };

  const r = result;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Search form */}
      <div className="card">
        <h3 className="mb-4 text-base font-semibold text-gray-900">
          Consultar Comprobante en ARCA
        </h3>
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Punto de Venta</label>
              {puntosVenta.length > 0 ? (
                <select
                  value={puntoVenta}
                  onChange={(e) => setPuntoVenta(Number(e.target.value))}
                  className="select"
                >
                  {puntosVenta.map((pv) => (
                    <option key={pv.nro} value={pv.nro}>
                      {String(pv.nro).padStart(5, '0')}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  value={puntoVenta}
                  onChange={(e) => setPuntoVenta(Number(e.target.value))}
                  className="input"
                  min={1}
                />
              )}
            </div>
            <div>
              <label className="label">Tipo de Comprobante</label>
              <select
                value={cbteTipo}
                onChange={(e) => setCbteTipo(Number(e.target.value))}
                className="select"
              >
                {Object.entries(CBTE_TIPOS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Número</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={cbteNro}
                  onChange={(e) => setCbteNro(e.target.value)}
                  className="input flex-1"
                  placeholder="1"
                  min={1}
                />
                <button type="submit" disabled={loading} className="btn-primary flex-shrink-0">
                  {loading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <MagnifyingGlassIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* Result */}
      {r && (
        <div className="card space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50">
              <DocumentTextIcon className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {CBTE_TIPOS[Number(r.cbteTipo)] || `Tipo ${r.cbteTipo}`}
              </p>
              <p className="font-mono text-xs text-gray-500">
                {String(r.ptoVta).padStart(5, '0')}-{String(r.cbteDesde).padStart(8, '0')}
              </p>
            </div>
            <div className="ml-auto">
              {r.resultado === 'A' ? (
                <span className="badge-green">Aprobado</span>
              ) : r.resultado === 'R' ? (
                <span className="badge-red">Rechazado</span>
              ) : (
                <span className="badge-yellow">Sin resultado</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-gray-500">Fecha</p>
              <p className="text-sm font-medium">{formatDate(r.cbteFch ?? '')}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Doc. Receptor</p>
              <p className="text-sm font-medium">{r.docTipo === 99 ? 'Cons. Final' : `Tipo ${r.docTipo}: ${r.docNro}`}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Concepto</p>
              <p className="text-sm font-medium">
                {r.concepto === 1 ? 'Productos' : r.concepto === 2 ? 'Servicios' : 'Prod. y Serv.'}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-gray-100 p-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Neto Gravado</span>
                <span className="font-medium">{formatCurrency(Number(r.impNeto))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">IVA</span>
                <span className="font-medium">{formatCurrency(Number(r.impIva))}</span>
              </div>
              {Number(r.impTotConc) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">No Gravado</span>
                  <span className="font-medium">{formatCurrency(Number(r.impTotConc))}</span>
                </div>
              )}
              {Number(r.impOpEx) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Exento</span>
                  <span className="font-medium">{formatCurrency(Number(r.impOpEx))}</span>
                </div>
              )}
              {Number(r.impTrib) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Tributos</span>
                  <span className="font-medium">{formatCurrency(Number(r.impTrib))}</span>
                </div>
              )}
              <div className="border-t border-gray-200 pt-2">
                <div className="flex justify-between">
                  <span className="font-bold text-gray-900">Total</span>
                  <span className="font-bold text-indigo-600">{formatCurrency(Number(r.impTotal))}</span>
                </div>
              </div>
            </div>
          </div>

          {r.codAutorizacion && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-emerald-600">{r.emisionTipo === 'CAEA' ? 'CAEA' : 'CAE'}</p>
                  <p className="font-mono text-sm font-bold text-emerald-900">{r.codAutorizacion}</p>
                </div>
                <div>
                  <p className="text-xs text-emerald-600">Vencimiento</p>
                  <p className="text-sm font-semibold text-emerald-900">{formatDate(r.fchVto ?? '')}</p>
                </div>
              </div>
            </div>
          )}

          {(r.fchServDesde || r.fchServHasta) && (
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500">Servicio Desde</p>
                <p className="font-medium">{formatDate(r.fchServDesde ?? '')}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Servicio Hasta</p>
                <p className="font-medium">{formatDate(r.fchServHasta ?? '')}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Vto. Pago</p>
                <p className="font-medium">{formatDate(r.fchVtoPago ?? '')}</p>
              </div>
            </div>
          )}

          {r.observaciones.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
              <p className="mb-1 text-xs font-semibold text-amber-700">Observaciones de ARCA</p>
              <ul className="space-y-0.5 text-sm text-amber-900">
                {r.observaciones.map((o, i) => (
                  <li key={i}>[{o.code}] {o.msg}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500">Moneda</p>
              <p className="font-medium">{r.monId ?? '-'} (ctz: {r.monCotiz ?? '-'})</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Procesado</p>
              <p className="font-medium">{formatDate((r.fchProceso ?? '').slice(0, 8))}</p>
            </div>
          </div>
        </div>
      )}

      <ConstatarForm desde={r} />
    </div>
  );
}

/** YYYYMMDD → YYYY-MM-DD (para un input type="date"). */
function toInputDate(fecha: string): string {
  return /^\d{8}$/.test(fecha) ? `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}` : fecha;
}

interface ConstatarFormState {
  cbteModo: CbteModo;
  cuitEmisor: string;
  ptoVta: string;
  cbteTipo: string;
  cbteNro: string;
  cbteFch: string;
  impTotal: string;
  codAutorizacion: string;
  docTipoReceptor: string;
  docNroReceptor: string;
}

const CONSTATAR_VACIO: ConstatarFormState = {
  cbteModo: 'CAE',
  cuitEmisor: '',
  ptoVta: '',
  cbteTipo: '11',
  cbteNro: '',
  cbteFch: '',
  impTotal: '',
  codAutorizacion: '',
  docTipoReceptor: '',
  docNroReceptor: '',
};

/**
 * Constatación de comprobantes (WSCDC): verifica que un comprobante propio o
 * de terceros haya sido autorizado por ARCA. Exige la modalidad de
 * autorización (CAE, CAI o CAEA) y el CUIT del emisor.
 */
function ConstatarForm({ desde }: { desde: ComprobanteAfip | null }) {
  const [form, setForm] = useState<ConstatarFormState>(CONSTATAR_VACIO);
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<ConstatarResult | null>(null);

  const set = (campo: keyof ConstatarFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [campo]: e.target.value }));

  const usarConsultado = () => {
    if (!desde) return;
    setForm((f) => ({
      ...f,
      cbteModo: desde.emisionTipo === 'CAEA' ? 'CAEA' : 'CAE',
      ptoVta: String(desde.ptoVta),
      cbteTipo: String(desde.cbteTipo),
      cbteNro: String(desde.cbteDesde),
      cbteFch: toInputDate(desde.cbteFch ?? ''),
      impTotal: String(desde.impTotal),
      codAutorizacion: desde.codAutorizacion ?? '',
      docTipoReceptor: desde.docTipo === 99 ? '' : String(desde.docTipo),
      docNroReceptor: desde.docTipo === 99 ? '' : String(desde.docNro),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{2}-?\d{8}-?\d$/.test(form.cuitEmisor)) {
      toast.error('Ingresá el CUIT del emisor (11 dígitos)');
      return;
    }
    if (!/^\d{14}$/.test(form.codAutorizacion)) {
      toast.error('El código de autorización tiene 14 dígitos');
      return;
    }
    if ((form.docTipoReceptor === '') !== (form.docNroReceptor === '')) {
      toast.error('El tipo y el número de documento del receptor se informan juntos');
      return;
    }

    const input: ConstatarInput = {
      cbteModo: form.cbteModo,
      cuitEmisor: form.cuitEmisor,
      ptoVta: Number(form.ptoVta),
      cbteTipo: Number(form.cbteTipo),
      cbteNro: Number(form.cbteNro),
      cbteFch: inputDateToYYYYMMDD(form.cbteFch),
      impTotal: Number(form.impTotal),
      codAutorizacion: form.codAutorizacion,
      ...(form.docTipoReceptor !== '' && {
        docTipoReceptor: Number(form.docTipoReceptor),
        docNroReceptor: form.docNroReceptor,
      }),
    };

    try {
      setLoading(true);
      setResultado(null);
      setResultado(await constatarComprobante(input));
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'No se pudo constatar el comprobante'), { duration: 8000 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">Constatar Comprobante (WSCDC)</h3>
        {desde && (
          <button type="button" onClick={usarConsultado} className="btn-secondary text-xs">
            Usar datos del comprobante consultado
          </button>
        )}
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Modalidad</label>
            <select value={form.cbteModo} onChange={set('cbteModo')} className="select">
              <option value="CAE">CAE</option>
              <option value="CAEA">CAEA</option>
              <option value="CAI">CAI</option>
            </select>
          </div>
          <div>
            <label className="label">CUIT del Emisor <span className="text-red-500">*</span></label>
            <input value={form.cuitEmisor} onChange={set('cuitEmisor')} className="input" placeholder="20123456786" required />
          </div>
          <div>
            <label className="label">Código de Autorización</label>
            <input value={form.codAutorizacion} onChange={set('codAutorizacion')} className="input font-mono" placeholder="14 dígitos" required />
          </div>
          <div>
            <label className="label">Tipo de Comprobante</label>
            <select value={form.cbteTipo} onChange={set('cbteTipo')} className="select">
              {Object.entries(CBTE_TIPOS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Punto de Venta</label>
            <input type="number" min={1} value={form.ptoVta} onChange={set('ptoVta')} className="input" required />
          </div>
          <div>
            <label className="label">Número</label>
            <input type="number" min={1} value={form.cbteNro} onChange={set('cbteNro')} className="input" required />
          </div>
          <div>
            <label className="label">Fecha</label>
            <input type="date" value={form.cbteFch} onChange={set('cbteFch')} className="input" required />
          </div>
          <div>
            <label className="label">Importe Total</label>
            <input type="number" min={0} step="0.01" value={form.impTotal} onChange={set('impTotal')} className="input" required />
          </div>
          <div>
            <label className="label">Doc. Receptor (opcional)</label>
            <div className="flex gap-2">
              <select value={form.docTipoReceptor} onChange={set('docTipoReceptor')} className="select w-28">
                <option value="">-</option>
                {Object.entries(DOC_TIPOS).filter(([v]) => v !== '99').map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input value={form.docNroReceptor} onChange={set('docNroReceptor')} className="input flex-1" placeholder="Número" />
            </div>
          </div>
        </div>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <ShieldCheckIcon className="h-4 w-4" />
          )}
          Constatar
        </button>
      </form>

      {resultado && (
        <div className={`rounded-lg border p-4 ${resultado.resultado === 'A' ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'}`}>
          <div className="flex items-center justify-between">
            {resultado.resultado === 'A' ? (
              <span className="badge-green">Comprobante autorizado por ARCA</span>
            ) : (
              <span className="badge-red">Rechazado</span>
            )}
            <span className="text-xs text-gray-500">Procesado: {resultado.fchProceso}</span>
          </div>
          {resultado.observaciones.length > 0 && (
            <ul className="mt-3 space-y-0.5 text-sm text-gray-700">
              {resultado.observaciones.map((o, i) => (
                <li key={i}>[{o.code}] {o.msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
