import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/errors';
import {
  KeyIcon,
  PlusIcon,
  TrashIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

interface ApiKeyItem {
  id: number;
  name: string;
  key: string;
  lastUsed: string | null;
  createdAt: string;
}

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/api-keys');
      setKeys(data.apiKeys);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Error al cargar las API keys'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const { data } = await api.post('/auth/api-keys', { name: newKeyName.trim() });
      setNewlyCreatedKey(data.apiKey.key);
      setNewKeyName('');
      loadKeys();
      toast.success('API key creada');
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Error al crear la API key'));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`¿Eliminar la API key "${name}"?`)) return;
    try {
      await api.delete(`/auth/api-keys/${id}`);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      toast.success('API key eliminada');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Error al eliminar la API key'));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copiado al portapapeles');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">API Keys</h2>
        <p className="mt-1 text-sm text-gray-500">
          Usá API keys para autenticar requests programáticos a la API de ARCA Server. La key actúa con los permisos de tu usuario.
        </p>
      </div>

      {/* Usage example */}
      <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
        <h3 className="text-sm font-medium text-indigo-900">Uso</h3>
        <p className="mt-1 text-xs text-indigo-700">
          Incluí el header <code className="rounded bg-indigo-100 px-1 py-0.5">X-API-Key: tu_api_key</code> en
          cada request. Ejemplo:
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-indigo-900 p-3 text-xs text-indigo-100">
{`curl -H "X-API-Key: arca_xxxx..." \\
     https://tu-dominio.com/api/invoices`}
        </pre>
      </div>

      {/* Newly created key warning */}
      {newlyCreatedKey && (
        <div
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
          role="alert"
        >
          <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0 text-amber-500" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">
              Guardá esta key: no se va a mostrar de nuevo
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">
                {newlyCreatedKey}
              </code>
              <button
                onClick={() => copyToClipboard(newlyCreatedKey)}
                className="rounded-md p-1.5 text-amber-600 hover:bg-amber-100"
                aria-label="Copiar API key"
              >
                <ClipboardDocumentIcon className="h-5 w-5" />
              </button>
            </div>
            <button
              onClick={() => setNewlyCreatedKey(null)}
              className="mt-2 text-xs text-amber-600 hover:text-amber-800"
            >
              Ya la guardé, cerrar
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      <form onSubmit={handleCreate} className="flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="key-name" className="block text-sm font-medium text-gray-700">
            Nombre de la key
          </label>
          <input
            id="key-name"
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="ej: Mi App, Integración ERP"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            maxLength={100}
          />
        </div>
        <button
          type="submit"
          disabled={creating || !newKeyName.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          Crear
        </button>
      </form>

      {/* Keys list */}
      {loading ? (
        <div className="flex justify-center py-8" role="status">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
          <span className="sr-only">Cargando...</span>
        </div>
      ) : keys.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border-2 border-dashed border-gray-200 py-12">
          <KeyIcon className="h-10 w-10 text-gray-300" aria-hidden="true" />
          <p className="mt-2 text-sm text-gray-500">No hay API keys creadas</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Nombre
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Key
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Último uso
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Creada
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                    {k.name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                    {k.key}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {k.lastUsed ? new Date(k.lastUsed).toLocaleDateString('es-AR') : 'Nunca'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {new Date(k.createdAt).toLocaleDateString('es-AR')}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(k.id, k.name)}
                      className="rounded-md p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Eliminar API key ${k.name}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
