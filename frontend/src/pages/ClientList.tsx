import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  MagnifyingGlassIcon,
  PlusCircleIcon,
  PencilSquareIcon,
  TrashIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { getClients, deleteClient } from '../api/client';
import { getApiErrorMessage } from '../utils/errors';
import type { Client } from '../types';
import { DOC_TIPOS, IVA_CONDITIONS } from '../types';

export default function ClientList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const page = Number(searchParams.get('page')) || 1;

  const loadClients = async () => {
    try {
      setLoading(true);
      const params: { page: number; limit: number; search?: string } = {
        page,
        limit: 20,
      };
      if (search) params.search = search;
      const data = await getClients(params);
      setClients(data.clients || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 0);
    } catch (err) {
      setClients([]);
      toast.error(getApiErrorMessage(err, 'Error al cargar los clientes'), { duration: 8000 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`¿Eliminar el cliente "${name}"?`)) return;
    try {
      await deleteClient(id);
      toast.success('Cliente eliminado');
      loadClients();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Error al eliminar el cliente'), { duration: 8000 });
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams({ page: '1' });
  };

  const goToPage = (p: number) => {
    setSearchParams({ page: String(p) });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o documento..."
              className="input pl-9 w-full sm:w-72"
            />
          </div>
        </form>
        <Link to="/clientes/nuevo" className="btn-primary text-xs">
          <PlusCircleIcon className="mr-1 h-4 w-4" />
          Nuevo Cliente
        </Link>
      </div>

      <p className="text-sm text-gray-500">{total} clientes encontrados</p>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        ) : clients.length === 0 ? (
          <div className="empty-state">
            <UsersIcon className="h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-500">No se encontraron clientes</p>
            <Link to="/clientes/nuevo" className="btn-primary mt-4 text-xs">
              Crear primer cliente
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="table-header px-6 py-3">Nombre</th>
                  <th className="table-header px-6 py-3">Tipo Doc.</th>
                  <th className="table-header px-6 py-3">Número Doc.</th>
                  <th className="table-header px-6 py-3">Cond. IVA</th>
                  <th className="table-header px-6 py-3">Facturas</th>
                  <th className="table-header px-6 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clients.map((client) => (
                  <tr key={client.id} className="transition-colors hover:bg-gray-50">
                    <td className="table-cell font-medium">{client.name}</td>
                    <td className="table-cell">
                      {DOC_TIPOS[client.docType] || client.docType}
                    </td>
                    <td className="table-cell font-mono text-xs">
                      {client.docNumber}
                    </td>
                    <td className="table-cell">
                      {IVA_CONDITIONS[client.ivaCondition] || client.ivaCondition}
                    </td>
                    <td className="table-cell text-center">
                      {client._count?.invoices ?? 0}
                    </td>
                    <td className="table-cell">
                      <div className="flex gap-2">
                        <Link
                          to={`/clientes/${client.id}/editar`}
                          className="rounded-lg p-1.5 text-indigo-600 hover:bg-indigo-50"
                          title="Editar"
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                        </Link>
                        <button
                          onClick={() => handleDelete(client.id, client.name)}
                          className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                          title="Eliminar"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
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
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Página {page} de {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="btn-secondary text-xs"
            >
              Anterior
            </button>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="btn-secondary text-xs"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
