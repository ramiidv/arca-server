import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  HomeIcon,
  DocumentTextIcon,
  PlusCircleIcon,
  UsersIcon,
  CogIcon,
  KeyIcon,
  XMarkIcon,
  UserPlusIcon,
  DocumentDuplicateIcon,
  ReceiptRefundIcon,
  MagnifyingGlassCircleIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline';
import { getArcaConfig } from '../api/client';
import { getApiErrorMessage } from '../utils/errors';
import { NOMBRE_AMBIENTE } from '../types';
import type { ArcaConfig } from '../types';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const navSections = [
  {
    label: 'General',
    items: [
      { name: 'Dashboard', href: '/', icon: HomeIcon },
    ],
  },
  {
    label: 'Facturación',
    items: [
      { name: 'Facturas', href: '/facturas', icon: DocumentTextIcon },
      { name: 'Nueva Factura', href: '/facturas/nueva', icon: PlusCircleIcon },
      { name: 'NC / ND', href: '/facturas/nota', icon: ReceiptRefundIcon },
    ],
  },
  {
    label: 'Gestión',
    items: [
      { name: 'Clientes', href: '/clientes', icon: UsersIcon },
      { name: 'Nuevo Cliente', href: '/clientes/nuevo', icon: UserPlusIcon },
    ],
  },
  {
    label: 'ARCA',
    items: [
      { name: 'Consultar Cbte.', href: '/consulta', icon: MagnifyingGlassCircleIcon },
      { name: 'Parámetros', href: '/parametros', icon: TableCellsIcon },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { name: 'API Keys', href: '/api-keys', icon: KeyIcon },
      { name: 'Configuración', href: '/configuracion', icon: CogIcon },
    ],
  },
];

export default function Sidebar({ open, onClose }: SidebarProps) {
  // Ambiente activo del server (AFIP_PRODUCTION), no un valor fijo.
  const [arcaConfig, setArcaConfig] = useState<ArcaConfig | null>(null);
  const [errorConfig, setErrorConfig] = useState<string | null>(null);
  useEffect(() => {
    let vigente = true;
    getArcaConfig()
      .then((cfg) => vigente && setArcaConfig(cfg))
      .catch((err) => vigente && setErrorConfig(getApiErrorMessage(err, 'No se pudo obtener el ambiente de ARCA')));
    return () => {
      vigente = false;
    };
  }, []);

  const ambiente = arcaConfig
    ? {
        texto: `ARCA ${NOMBRE_AMBIENTE[arcaConfig.environment]}`,
        punto: arcaConfig.environment === 'production' ? 'bg-emerald-400 shadow-emerald-400/50' : 'bg-amber-400 shadow-amber-400/50',
      }
    : { texto: errorConfig ? 'Ambiente desconocido' : 'Cargando ambiente...', punto: 'bg-gray-500 shadow-gray-500/50' };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-gradient-to-b from-indigo-950 via-indigo-950 to-slate-950 transition-transform duration-300 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Navegación principal"
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-lg shadow-indigo-500/25">
              <DocumentDuplicateIcon className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white">ARCA</h1>
              <p className="text-[10px] font-medium text-indigo-400">Facturación Electrónica</p>
            </div>
          </div>
          <button
            className="rounded-lg p-1.5 text-indigo-400 transition-colors hover:bg-indigo-900 hover:text-white lg:hidden"
            onClick={onClose}
            aria-label="Cerrar menú"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="mt-4 flex-1 space-y-6 overflow-y-auto px-3 pb-4" aria-label="Menú principal">
          {navSections.map((section) => (
            <div key={section.label}>
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-indigo-500">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.name}
                    to={item.href}
                    end={item.href === '/'}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all ${
                        isActive
                          ? 'bg-indigo-600/20 text-white shadow-sm'
                          : 'text-indigo-300 hover:bg-white/5 hover:text-white'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon
                          className={`h-[18px] w-[18px] flex-shrink-0 transition-colors ${
                            isActive ? 'text-indigo-400' : 'text-indigo-500 group-hover:text-indigo-400'
                          }`}
                          aria-hidden="true"
                        />
                        {item.name}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/5 px-5 py-4">
          <div className="flex items-center gap-2" title={errorConfig ?? 'Ambiente de ARCA configurado en el server (AFIP_PRODUCTION)'}>
            <div className={`h-1.5 w-1.5 rounded-full shadow-sm ${ambiente.punto}`} aria-hidden="true" />
            <p className="text-[11px] font-medium text-indigo-400">{ambiente.texto}</p>
          </div>
          {arcaConfig?.cuit && (
            <p className="mt-1 font-mono text-[10px] text-indigo-600">CUIT {arcaConfig.cuit}</p>
          )}
        </div>
      </aside>
    </>
  );
}
