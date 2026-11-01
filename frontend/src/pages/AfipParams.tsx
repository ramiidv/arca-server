import { useState, useEffect } from 'react';
import {
  getAfipInvoiceTypes,
  getAfipDocTypes,
  getAfipIvaTypes,
  getAfipIvaConditions,
  getAfipConceptTypes,
  getAfipCurrencyTypes,
  getAfipTributoTypes,
  getCotizacion,
} from '../api/client';
import toast from 'react-hot-toast';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { getApiErrorMessage } from '../utils/errors';
import { formatDate } from '../utils/formatters';
import type { Cotizacion } from '../types';

interface ParamItem {
  Id: number | string;
  Desc: string;
  FchDesde?: string;
  FchHasta?: string;
}

const TABS = [
  { key: 'comprobantes', label: 'Comprobantes' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'iva', label: 'IVA' },
  { key: 'condiciones', label: 'Cond. IVA' },
  { key: 'conceptos', label: 'Conceptos' },
  { key: 'monedas', label: 'Monedas' },
  { key: 'tributos', label: 'Tributos' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function AfipParams() {
  const [activeTab, setActiveTab] = useState<TabKey>('comprobantes');
  const [data, setData] = useState<Record<TabKey, ParamItem[]>>({
    comprobantes: [],
    documentos: [],
    iva: [],
    condiciones: [],
    conceptos: [],
    monedas: [],
    tributos: [],
  });
  const [loading, setLoading] = useState<Record<TabKey, boolean>>({
    comprobantes: false,
    documentos: false,
    iva: false,
    condiciones: false,
    conceptos: false,
    monedas: false,
    tributos: false,
  });
  // ResultGet de FEParamGetCotizacion: { MonId, MonCotiz, FchCotiz }
  const [cotizacion, setCotizacion] = useState<Cotizacion | null>(null);
  const [cotizLoading, setCotizLoading] = useState(false);

  const fetchTab = async (tab: TabKey) => {
    if (data[tab].length > 0) return; // Already loaded

    setLoading((prev) => ({ ...prev, [tab]: true }));
    try {
      let result: ParamItem[];
      switch (tab) {
        case 'comprobantes':
          result = await getAfipInvoiceTypes();
          break;
        case 'documentos':
          result = await getAfipDocTypes();
          break;
        case 'iva':
          result = await getAfipIvaTypes();
          break;
        case 'condiciones':
          result = await getAfipIvaConditions();
          break;
        case 'conceptos':
          result = await getAfipConceptTypes();
          break;
        case 'monedas':
          result = await getAfipCurrencyTypes();
          break;
        case 'tributos':
          result = await getAfipTributoTypes();
          break;
      }
      setData((prev) => ({ ...prev, [tab]: Array.isArray(result) ? result : [] }));
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Error cargando datos de AFIP'), { duration: 8000 });
    } finally {
      setLoading((prev) => ({ ...prev, [tab]: false }));
    }
  };

  useEffect(() => {
    fetchTab(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleCotizacion = async (monedaId: string) => {
    try {
      setCotizLoading(true);
      const result = await getCotizacion(monedaId);
      setCotizacion(result);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Error obteniendo cotización'), { duration: 8000 });
    } finally {
      setCotizLoading(false);
    }
  };

  const items = data[activeTab];
  const isLoading = loading[activeTab];

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="card p-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="card">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">Sin datos. Conectá los certificados AFIP para cargar.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">ID</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Descripción</th>
                  {items[0]?.FchDesde !== undefined && (
                    <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Vigencia</th>
                  )}
                  {activeTab === 'monedas' && (
                    <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-400">Cotización</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item, i) => (
                  <tr key={i} className="transition-colors hover:bg-gray-50/50">
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{item.Id}</td>
                    <td className="px-4 py-2 text-sm text-gray-700">{item.Desc}</td>
                    {item.FchDesde !== undefined && (
                      <td className="px-4 py-2 text-xs text-gray-400">
                        {item.FchDesde || '-'} — {item.FchHasta || 'vigente'}
                      </td>
                    )}
                    {activeTab === 'monedas' && (
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleCotizacion(String(item.Id))}
                          disabled={cotizLoading}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                        >
                          <MagnifyingGlassIcon className="h-3 w-3" />
                          Ver
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cotización result */}
      {cotizacion && activeTab === 'monedas' && (
        <div className="card border-indigo-200 bg-indigo-50/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-indigo-600">Cotización Oficial AFIP ({cotizacion.MonId})</p>
              <p className="mt-0.5 text-2xl font-bold text-indigo-900">
                ${cotizacion.MonCotiz}
              </p>
            </div>
            <p className="text-xs text-indigo-400">
              Fecha: {formatDate(cotizacion.FchCotiz)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
