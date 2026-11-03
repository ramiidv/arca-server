import { useState, useRef, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import {
  Bars3Icon,
  ArrowRightOnRectangleIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import Sidebar from './Sidebar';
import { useAuth } from '../context/AuthContext';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/facturas': 'Facturas',
  '/facturas/nueva': 'Nueva Factura',
  '/facturas/nota': 'Nota de Crédito / Débito',
  '/clientes': 'Clientes',
  '/clientes/nuevo': 'Nuevo Cliente',
  '/consulta': 'Consultar Comprobante',
  '/parametros': 'Parámetros ARCA',
  '/configuracion': 'Configuración',
  '/api-keys': 'API Keys',
};

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();
  const menuRef = useRef<HTMLDivElement>(null);

  const getPageTitle = () => {
    if (pageTitles[location.pathname]) {
      return pageTitles[location.pathname];
    }
    if (location.pathname.startsWith('/facturas/')) return 'Detalle de Factura';
    if (location.pathname.includes('/editar')) return 'Editar Cliente';
    return 'ARCA';
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50/80">
      <a href="#main-content" className="skip-link">
        Saltar al contenido
      </a>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-200/80 bg-white/80 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir menú de navegación"
            >
              <Bars3Icon className="h-5 w-5" aria-hidden="true" />
            </button>
            <h1 className="text-sm font-semibold text-gray-800">
              {getPageTitle()}
            </h1>
          </div>

          {/* User menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-gray-100"
              aria-expanded={userMenuOpen}
              aria-haspopup="true"
              aria-label="Menú de usuario"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">
                {user?.name?.charAt(0).toUpperCase()}
              </div>
              <span className="hidden text-sm font-medium text-gray-700 sm:block">{user?.name}</span>
              <ChevronDownIcon className="hidden h-3.5 w-3.5 text-gray-400 sm:block" />
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-56 origin-top-right rounded-xl border border-gray-200 bg-white py-1 shadow-lg shadow-gray-200/50 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="border-b border-gray-100 px-4 py-3">
                  <p className="text-sm font-semibold text-gray-900">{user?.name}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{user?.email}</p>
                  <span className="mt-1.5 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">
                    {user?.role === 'admin' ? 'Administrador' : 'Usuario'}
                  </span>
                </div>
                <div className="p-1">
                  <button
                    onClick={logout}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                    role="menuitem"
                  >
                    <ArrowRightOnRectangleIcon className="h-4 w-4" aria-hidden="true" />
                    Cerrar sesión
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main id="main-content" className="p-4 sm:p-6 lg:p-8" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
