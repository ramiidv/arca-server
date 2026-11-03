import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DocumentTextIcon,
  CurrencyDollarIcon,
  CalendarDaysIcon,
  PlusCircleIcon,
  UserPlusIcon,
  XCircleIcon,
  ArrowTrendingUpIcon,
} from '@heroicons/react/24/outline';
import { getInvoiceStats, getInvoices, getAfipStatus } from '../api/client';
import type { ArcaStatus, Invoice, InvoiceStats } from '../types';
import { formatCurrency, formatDate, formatCbteTipo, formatFullInvoiceNumber } from '../utils/formatters';
import InvoiceStatusBadge from '../components/InvoiceStatusBadge';
import { useAuth } from '../context/AuthContext';
import { getApiErrorMessage } from '../utils/errors';

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<InvoiceStats | null>(null);
  const [recentInvoices, setRecentInvoices] = useState<Invoice[]>([]);
  const [afipStatus, setAfipStatus] = useState<ArcaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [statsData, invoicesData] = await Promise.all([
          getInvoiceStats(),
          getInvoices({ page: 1, limit: 10 }),
        ]);

        setStats(statsData);
        setRecentInvoices(invoicesData.invoices || []);

        try {
          const status = await getAfipStatus();
          setAfipStatus(status);
        } catch {
          // El estado de ARCA es solo un indicador (sin certificado instalado siempre falla):
          // se oculta. El detalle del error se ve en Configuración → Estado de ARCA.
          setAfipStatus(null);
        }
      } catch (err) {
        setError(getApiErrorMessage(err, 'Error al cargar los datos del dashboard'));
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="rounded-full bg-red-50 p-4">
          <XCircleIcon className="h-8 w-8 text-red-400" />
        </div>
        <p className="mt-4 text-sm font-medium text-gray-900">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary mt-4">
          Reintentar
        </button>
      </div>
    );
  }

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Buenos días';
    if (hour < 19) return 'Buenas tardes';
    return 'Buenas noches';
  };

  return (
    <div className="space-y-6">
      {/* Welcome + ARCA Status */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {greeting()}, {user?.name?.split(' ')[0]}
          </h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Resumen de tu actividad de facturación
          </p>
        </div>

        {afipStatus && (
          <div
            className="hidden sm:flex items-center gap-3 rounded-lg border border-gray-200/80 bg-white px-4 py-2 shadow-sm"
            title={afipStatus.wsfe.ok ? 'WSFEv1 operativo' : afipStatus.wsfe.error}
          >
            <span className="text-xs font-medium text-gray-500">ARCA</span>
            {(['appserver', 'dbserver', 'authserver'] as const).map((server) => (
              <span key={server} className="inline-flex items-center gap-1 text-[11px] text-gray-600">
                {afipStatus.wsfe.status?.[server] === 'OK' ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                )}
                {{ appserver: 'App', dbserver: 'Db', authserver: 'Auth' }[server]}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Facturas con resultado incierto o en conflicto */}
      {(stats?.pendingInvoices ?? 0) > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>
            {stats!.pendingInvoices === 1
              ? 'Hay 1 factura sin resultado confirmado por ARCA.'
              : `Hay ${stats!.pendingInvoices} facturas sin resultado confirmado por ARCA.`}{' '}
            No las vuelvas a emitir: recuperalas.
          </span>
          <Link to="/facturas?resultado=P" className="font-medium text-amber-900 underline">
            Ver pendientes
          </Link>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="stat-card">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50">
            <DocumentTextIcon className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500">Total Facturas</p>
            <p className="mt-0.5 text-2xl font-bold tracking-tight text-gray-900">
              {stats?.totalInvoices ?? 0}
            </p>
            <p className="text-[11px] text-gray-400">
              + {stats?.creditNotes ?? 0} NC · {stats?.debitNotes ?? 0} ND
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50">
            <CurrencyDollarIcon className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500" title="Comprobantes autorizados; las notas de crédito restan">
              Monto Total <span className="text-gray-400">(neto de NC)</span>
            </p>
            <p className="mt-0.5 text-2xl font-bold tracking-tight text-gray-900">
              {formatCurrency(stats?.totalAmount ?? 0)}
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50">
            <CalendarDaysIcon className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500">Este Mes</p>
            <p className="mt-0.5 text-2xl font-bold tracking-tight text-gray-900">
              {stats?.monthlyInvoices ?? 0}
            </p>
            <p className="text-[11px] text-gray-400">
              facturas · + {stats?.monthlyCreditNotes ?? 0} NC · {stats?.monthlyDebitNotes ?? 0} ND
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50">
            <ArrowTrendingUpIcon className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500" title="Comprobantes autorizados del mes; las notas de crédito restan">
              Monto del Mes <span className="text-gray-400">(neto de NC)</span>
            </p>
            <p className="mt-0.5 text-2xl font-bold tracking-tight text-gray-900">
              {formatCurrency(stats?.monthlyAmount ?? 0)}
            </p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Link to="/facturas/nueva" className="btn-primary">
          <PlusCircleIcon className="h-4 w-4" />
          Nueva Factura
        </Link>
        <Link to="/clientes/nuevo" className="btn-secondary">
          <UserPlusIcon className="h-4 w-4" />
          Nuevo Cliente
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Invoices */}
        <div className="card lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Facturas Recientes</h3>
            <Link to="/facturas" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
              Ver todas
            </Link>
          </div>

          {recentInvoices.length === 0 ? (
            <div className="empty-state py-10">
              <DocumentTextIcon className="h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm text-gray-500">
                No hay facturas registradas
              </p>
              <Link to="/facturas/nueva" className="btn-primary mt-4 text-xs">
                Crear primera factura
              </Link>
            </div>
          ) : (
            <div className="-mx-6 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-4 sm:px-6 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Tipo</th>
                    <th className="hidden sm:table-cell px-6 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Número</th>
                    <th className="hidden sm:table-cell px-6 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Fecha</th>
                    <th className="hidden md:table-cell px-6 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Cliente</th>
                    <th className="px-4 sm:px-6 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-400">Total</th>
                    <th className="px-4 sm:px-6 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-400">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recentInvoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="cursor-pointer transition-colors hover:bg-gray-50/50"
                    >
                      <td className="px-4 sm:px-6 py-2.5 text-sm">
                        <Link to={`/facturas/${inv.id}`} className="font-medium text-indigo-600 hover:text-indigo-700">
                          {formatCbteTipo(inv.cbteTipo)}
                        </Link>
                      </td>
                      <td className="hidden sm:table-cell px-6 py-2.5 font-mono text-xs text-gray-500">
                        {formatFullInvoiceNumber(inv.puntoVenta, inv.cbteNro)}
                      </td>
                      <td className="hidden sm:table-cell px-6 py-2.5 text-sm text-gray-500">{formatDate(inv.cbteFch)}</td>
                      <td className="hidden md:table-cell px-6 py-2.5 text-sm text-gray-600">{inv.client?.name || inv.docNro}</td>
                      <td className="px-4 sm:px-6 py-2.5 text-right text-sm font-semibold text-gray-900">
                        {formatCurrency(inv.impTotal)}
                      </td>
                      <td className="px-4 sm:px-6 py-2.5 text-right">
                        <InvoiceStatusBadge resultado={inv.resultado} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Stats by type */}
        <div className="card">
          <h3 className="mb-4 text-sm font-semibold text-gray-900">Por Tipo</h3>
          {stats?.byType && stats.byType.length > 0 ? (
            <div className="space-y-3">
              {stats.byType.map((item) => (
                <div
                  key={item.cbteTipo}
                  className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5 transition-colors hover:bg-gray-50"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {formatCbteTipo(item.cbteTipo)}
                    </p>
                    <p className="text-[11px] text-gray-400">{item.count} comprobantes</p>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatCurrency(item.total)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state py-8">
              <p className="text-xs text-gray-400">Sin datos aún</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
