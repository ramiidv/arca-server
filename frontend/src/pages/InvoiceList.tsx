import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FunnelIcon,
  PlusCircleIcon,
  ArrowDownTrayIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { getInvoices } from '../api/client';
import type { Invoice } from '../types';
import { CBTE_TIPOS } from '../types';
import {
  formatCurrency,
  formatDate,
  formatCbteTipo,
  formatFullInvoiceNumber,
} from '../utils/formatters';
import InvoiceStatusBadge from '../components/InvoiceStatusBadge';
import RecuperarFacturaButton from '../components/RecuperarFacturaButton';

export default function InvoiceList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);

  const page = Number(searchParams.get('page')) || 1;
  const [filterTipo, setFilterTipo] = useState<string>('');
  const [filterDesde, setFilterDesde] = useState('');
  const [filterHasta, setFilterHasta] = useState('');
  const [filterResultado, setFilterResultado] = useState(searchParams.get('resultado') ?? '');
  // Se incrementa para recargar la lista después de una recuperación
  const [recarga, setRecarga] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    async function loadInvoices() {
      try {
        setLoading(true);
        const params: Record<string, unknown> = { page, limit: 20 };
        if (filterTipo) params.cbteTipo = Number(filterTipo);
        if (filterDesde) params.desde = filterDesde.replace(/-/g, '');
        if (filterHasta) params.hasta = filterHasta.replace(/-/g, '');
        if (filterResultado) params.resultado = filterResultado;

        const data = await getInvoices(params as Parameters<typeof getInvoices>[0]);
        setInvoices(data.invoices || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 0);
      } catch {
        setInvoices([]);
      } finally {
        setLoading(false);
      }
    }
    loadInvoices();
  }, [page, filterTipo, filterDesde, filterHasta, filterResultado, recarga]);

  const pendientes = invoices.filter((inv) => inv.resultado === 'P' || inv.resultado === 'C').length;

  const goToPage = (p: number) => {
    setSearchParams({ page: String(p) });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">{total} facturas encontradas</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="btn-secondary text-xs"
          >
            <FunnelIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Filtros</span>
          </button>
          <button disabled className="btn-secondary text-xs opacity-50 hidden sm:inline-flex" title="Proximamente">
            <ArrowDownTrayIcon className="h-4 w-4" />
            Exportar
          </button>
          <Link to="/facturas/nueva" className="btn-primary text-xs">
            <PlusCircleIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Nueva Factura</span>
            <span className="sm:hidden">Nueva</span>
          </Link>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="card">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <label className="label">Estado</label>
              <select
                value={filterResultado}
                onChange={(e) => {
                  setFilterResultado(e.target.value);
                  setSearchParams({ page: '1' });
                }}
                className="select"
              >
                <option value="">Todos</option>
                <option value="A">Aprobadas</option>
                <option value="P">Pendientes (resultado incierto)</option>
                <option value="C">En conflicto</option>
              </select>
            </div>
            <div>
              <label className="label">Tipo</label>
              <select
                value={filterTipo}
                onChange={(e) => {
                  setFilterTipo(e.target.value);
                  setSearchParams({ page: '1' });
                }}
                className="select"
              >
                <option value="">Todos</option>
                {Object.entries(CBTE_TIPOS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Desde</label>
              <input
                type="date"
                value={filterDesde}
                onChange={(e) => {
                  setFilterDesde(e.target.value);
                  setSearchParams({ page: '1' });
                }}
                className="input"
              />
            </div>
            <div>
              <label className="label">Hasta</label>
              <input
                type="date"
                value={filterHasta}
                onChange={(e) => {
                  setFilterHasta(e.target.value);
                  setSearchParams({ page: '1' });
                }}
                className="input"
              />
            </div>
          </div>
          <button
            onClick={() => {
              setFilterTipo('');
              setFilterDesde('');
              setFilterHasta('');
              setFilterResultado('');
              setSearchParams({ page: '1' });
            }}
            className="mt-3 text-xs text-indigo-600 hover:underline"
          >
            Limpiar filtros
          </button>
        </div>
      )}

      {/* Facturas con resultado incierto */}
      {pendientes > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Hay {pendientes} {pendientes === 1 ? 'factura' : 'facturas'} sin resultado confirmado por ARCA en esta página.
          No las vuelvas a emitir: usá <strong>Recuperar</strong> para consultar si quedaron autorizadas.
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="empty-state">
            <DocumentTextIcon className="h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-500">No se encontraron facturas</p>
            <Link to="/facturas/nueva" className="btn-primary mt-4 text-xs">
              Crear primera factura
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="table-header px-6 py-3">Tipo</th>
                  <th className="table-header px-6 py-3">Numero</th>
                  <th className="table-header px-6 py-3">Fecha</th>
                  <th className="table-header px-6 py-3">Cliente</th>
                  <th className="table-header px-6 py-3">Total</th>
                  <th className="table-header px-6 py-3">CAE</th>
                  <th className="table-header px-6 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="cursor-pointer transition-colors hover:bg-gray-50"
                    onClick={() => window.location.href = `/facturas/${inv.id}`}
                  >
                    <td className="table-cell">
                      <Link
                        to={`/facturas/${inv.id}`}
                        className="text-indigo-600 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {formatCbteTipo(inv.cbteTipo)}
                      </Link>
                    </td>
                    <td className="table-cell font-mono text-xs">
                      {formatFullInvoiceNumber(inv.puntoVenta, inv.cbteNro)}
                    </td>
                    <td className="table-cell">{formatDate(inv.cbteFch)}</td>
                    <td className="table-cell">
                      {inv.client?.name || inv.docNro || '-'}
                    </td>
                    <td className="table-cell font-semibold">
                      {formatCurrency(inv.impTotal)}
                    </td>
                    <td className="table-cell font-mono text-xs">
                      {inv.cae || '-'}
                    </td>
                    <td className="table-cell">
                      <div className="flex flex-wrap items-center gap-2">
                        <InvoiceStatusBadge resultado={inv.resultado} />
                        {(inv.resultado === 'P' || inv.resultado === 'C') && (
                          <RecuperarFacturaButton
                            invoiceId={inv.id}
                            compact
                            onResultado={() => setRecarga((n) => n + 1)}
                            onEliminada={() => setRecarga((n) => n + 1)}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <p className="text-xs text-gray-500">
            Página {page} de {totalPages}
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="btn-secondary text-xs"
            >
              Ant.
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, totalPages - 4));
              const p = start + i;
              if (p > totalPages) return null;
              return (
                <button
                  key={p}
                  onClick={() => goToPage(p)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    p === page
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="btn-secondary text-xs"
            >
              Sig.
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
