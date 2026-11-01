import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, useFieldArray } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  PlusIcon,
  TrashIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { createNotaCredito, createNotaDebito, getInvoice, getInvoices } from '../api/client';
import { CBTE_TIPOS, IVA_ALICUOTAS, IVA_CONDITIONS, type Invoice } from '../types';
import {
  formatCurrency,
  formatCbteTipo,
  formatFullInvoiceNumber,
  formatDate,
} from '../utils/formatters';
import { getApiErrorMessage } from '../utils/errors';

// Mapeo de factura -> NC
const NC_MAP: Record<number, number> = { 1: 3, 6: 8, 11: 13 };
// Mapeo de factura -> ND
const ND_MAP: Record<number, number> = { 1: 2, 6: 7, 11: 12 };
// Solo facturas (no NC/ND) pueden tener NC/ND asociadas
const FACTURAS_VALIDAS = new Set([1, 6, 11]);

interface FormItem {
  description: string;
  quantity: number;
  unitPrice: number;
  ivaId: number;
}

interface NotaFormData {
  items: FormItem[];
  observations: string;
  /** Condición de IVA del receptor (RG 5616), si la factura original no tiene cliente */
  condicionIva: number | '';
}

export default function NewNotaCredDeb() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedId = searchParams.get('facturaId');

  const [tipo, setTipo] = useState<'nc' | 'nd'>('nc');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{
    cae: string;
    cbteNro: number;
    cbteTipo: number;
    puntoVenta: number;
  } | null>(null);

  // Invoice search
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);

  const { register, control, watch, handleSubmit } = useForm<NotaFormData>({
    defaultValues: {
      items: [{ description: '', quantity: 1, unitPrice: 0, ivaId: 5 }],
      observations: '',
      condicionIva: '',
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const watchItems = watch('items');

  const isTipoC = selectedInvoice ? [11, 12, 13].includes(selectedInvoice.cbteTipo) : false;
  // Receptor identificado sin cliente: el backend no puede tomar la condición de IVA del cliente
  // (si la factura original se emitió con esta versión, la toma de sus datos de emisión).
  const pideCondicionIva = !!selectedInvoice && selectedInvoice.docTipo !== 99 && !selectedInvoice.client;

  // Load preselected invoice
  useEffect(() => {
    if (preselectedId) {
      setLoadingInvoice(true);
      getInvoice(Number(preselectedId))
        .then((inv) => {
          if (FACTURAS_VALIDAS.has(inv.cbteTipo)) {
            setSelectedInvoice(inv);
          } else {
            toast.error('Solo se pueden crear NC/ND sobre facturas');
          }
        })
        .catch(() => toast.error('No se pudo cargar la factura'))
        .finally(() => setLoadingInvoice(false));
    }
  }, [preselectedId]);

  // Search invoices
  const searchInvoices = async () => {
    if (!invoiceSearch.trim()) return;
    try {
      setLoadingInvoice(true);
      const data = await getInvoices({ limit: 20 });
      // Filter only valid facturas (not NC/ND)
      const valid = (data.invoices || []).filter(
        (inv) => FACTURAS_VALIDAS.has(inv.cbteTipo) && inv.cae && inv.resultado === 'A'
      );
      setInvoices(valid);
    } catch {
      toast.error('Error buscando facturas');
    } finally {
      setLoadingInvoice(false);
    }
  };

  const calculateTotals = () => {
    let impNeto = 0;
    let impIVA = 0;

    (watchItems || []).forEach((item) => {
      const subtotal = (item.quantity || 0) * (item.unitPrice || 0);
      if (isTipoC) {
        impNeto += subtotal;
      } else {
        const rate = IVA_ALICUOTAS[item.ivaId]?.rate ?? 21;
        impNeto += subtotal;
        impIVA += subtotal * rate / 100;
      }
    });

    return { impNeto, impIVA, impTotal: impNeto + impIVA };
  };

  const totals = calculateTotals();

  const onSubmit = async (data: NotaFormData) => {
    if (!selectedInvoice) {
      toast.error('Seleccioná una factura original');
      return;
    }

    try {
      setSubmitting(true);

      const items = data.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        ivaId: Number(item.ivaId),
      }));

      const payload = {
        originalInvoiceId: selectedInvoice.id,
        puntoVenta: selectedInvoice.puntoVenta,
        items,
        observations: data.observations || undefined,
        condicionIva: pideCondicionIva && data.condicionIva ? Number(data.condicionIva) : undefined,
      };

      const createFn = tipo === 'nc' ? createNotaCredito : createNotaDebito;
      const result = await createFn(payload);
      const inv = result.invoice;

      if (result.afipResponse.resultado !== 'A') {
        // Resultado incierto o conflicto: quedó guardada, no se debe reemitir.
        toast(result.afipResponse.mensaje || 'ARCA no confirmó el resultado. El comprobante quedó pendiente.', {
          icon: '⚠️',
          duration: 10000,
        });
        navigate(`/facturas/${inv.id}`);
        return;
      }

      toast.success(`${tipo === 'nc' ? 'Nota de Crédito' : 'Nota de Débito'} emitida`);
      setSuccess({
        cae: inv.cae || '',
        cbteNro: inv.cbteNro,
        cbteTipo: inv.cbteTipo,
        puntoVenta: inv.puntoVenta,
      });
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Error al emitir el comprobante'), { duration: 8000 });
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="mx-auto max-w-md">
        <div className="card text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircleIcon className="h-10 w-10 text-emerald-500" />
          </div>
          <h2 className="mt-5 text-xl font-bold text-gray-900">Comprobante Emitido</h2>
          <p className="mt-1 text-sm text-gray-500">
            {CBTE_TIPOS[success.cbteTipo]}
          </p>
          <p className="mt-1 font-mono text-lg font-bold text-indigo-600">
            {String(success.puntoVenta).padStart(5, '0')}-
            {String(success.cbteNro).padStart(8, '0')}
          </p>
          {success.cae && (
            <div className="mt-5 rounded-xl bg-emerald-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">CAE</p>
              <p className="mt-1 font-mono text-lg font-bold tracking-wide text-emerald-900">
                {success.cae}
              </p>
            </div>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => navigate('/facturas')}
              className="btn-primary text-sm"
            >
              Ver Facturas
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Tipo: NC o ND */}
      <div className="card">
        <h3 className="mb-4 text-base font-semibold text-gray-900">Tipo de Comprobante</h3>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setTipo('nc')}
            className={`rounded-xl border-2 p-4 text-left transition-all ${
              tipo === 'nc'
                ? 'border-indigo-600 bg-indigo-50 shadow-sm'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <p className={`text-sm font-semibold ${tipo === 'nc' ? 'text-indigo-700' : 'text-gray-700'}`}>
              Nota de Crédito
            </p>
            <p className={`mt-0.5 text-xs ${tipo === 'nc' ? 'text-indigo-500' : 'text-gray-400'}`}>
              Anula total o parcialmente una factura
            </p>
          </button>
          <button
            type="button"
            onClick={() => setTipo('nd')}
            className={`rounded-xl border-2 p-4 text-left transition-all ${
              tipo === 'nd'
                ? 'border-indigo-600 bg-indigo-50 shadow-sm'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <p className={`text-sm font-semibold ${tipo === 'nd' ? 'text-indigo-700' : 'text-gray-700'}`}>
              Nota de Débito
            </p>
            <p className={`mt-0.5 text-xs ${tipo === 'nd' ? 'text-indigo-500' : 'text-gray-400'}`}>
              Agrega cargos a una factura existente
            </p>
          </button>
        </div>

        {selectedInvoice && (
          <p className="mt-3 text-xs text-gray-500">
            Se emitirá:{' '}
            <span className="font-semibold text-gray-700">
              {CBTE_TIPOS[tipo === 'nc'
                ? NC_MAP[selectedInvoice.cbteTipo]
                : ND_MAP[selectedInvoice.cbteTipo]] || 'N/A'}
            </span>
          </p>
        )}
      </div>

      {/* Seleccionar factura original */}
      <div className="card">
        <h3 className="mb-4 text-base font-semibold text-gray-900">Factura Original</h3>

        {selectedInvoice ? (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {formatCbteTipo(selectedInvoice.cbteTipo)}{' '}
                  <span className="font-mono">
                    {formatFullInvoiceNumber(selectedInvoice.puntoVenta, selectedInvoice.cbteNro)}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {formatDate(selectedInvoice.cbteFch)} — {selectedInvoice.client?.name || selectedInvoice.docNro} — {formatCurrency(Number(selectedInvoice.impTotal))}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-gray-400">CAE: {selectedInvoice.cae}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedInvoice(null);
                  setInvoices([]);
                  setInvoiceSearch('');
                }}
                className="btn-secondary text-xs"
              >
                Cambiar
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchInvoices()}
                placeholder="Buscar facturas..."
                className="input flex-1"
              />
              <button
                type="button"
                onClick={searchInvoices}
                className="btn-secondary"
                disabled={loadingInvoice}
              >
                <MagnifyingGlassIcon className="h-4 w-4" />
              </button>
            </div>

            {loadingInvoice && (
              <div className="flex justify-center py-4">
                <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
              </div>
            )}

            {invoices.length > 0 && (
              <div className="max-h-60 overflow-auto rounded-lg border border-gray-200">
                {invoices.map((inv) => (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => {
                      setSelectedInvoice(inv);
                      setInvoices([]);
                    }}
                    className="flex w-full items-center justify-between border-b border-gray-100 px-4 py-3 text-left text-sm transition-colors last:border-0 hover:bg-indigo-50"
                  >
                    <div>
                      <span className="font-medium text-indigo-600">
                        {formatCbteTipo(inv.cbteTipo)}
                      </span>
                      <span className="ml-2 font-mono text-xs text-gray-500">
                        {formatFullInvoiceNumber(inv.puntoVenta, inv.cbteNro)}
                      </span>
                      <span className="ml-2 text-xs text-gray-400">
                        {formatDate(inv.cbteFch)}
                      </span>
                    </div>
                    <span className="font-semibold text-gray-900">
                      {formatCurrency(Number(inv.impTotal))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Items — solo si hay factura seleccionada */}
      {selectedInvoice && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="card">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Items</h3>
              <button
                type="button"
                onClick={() => append({ description: '', quantity: 1, unitPrice: 0, ivaId: 5 })}
                className="btn-secondary text-xs"
              >
                <PlusIcon className="h-4 w-4" />
                Agregar Item
              </button>
            </div>

            <div className="space-y-4">
              {fields.map((field, index) => {
                const item = watchItems?.[index];
                const subtotal = (item?.quantity || 0) * (item?.unitPrice || 0);

                return (
                  <div key={field.id} className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                      <div className={isTipoC ? 'sm:col-span-6' : 'sm:col-span-4'}>
                        <label className="label">Descripción</label>
                        <input
                          type="text"
                          {...register(`items.${index}.description`, { required: true })}
                          className="input"
                          placeholder="Descripción"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="label">Cantidad</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          {...register(`items.${index}.quantity`, { valueAsNumber: true, required: true, min: 0.01 })}
                          className="input"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="label">Precio Unit.</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          {...register(`items.${index}.unitPrice`, { valueAsNumber: true, required: true, min: 0 })}
                          className="input"
                        />
                      </div>
                      {!isTipoC && (
                        <div className="sm:col-span-2">
                          <label className="label">IVA</label>
                          <select
                            {...register(`items.${index}.ivaId`, { valueAsNumber: true })}
                            className="select"
                          >
                            {Object.entries(IVA_ALICUOTAS).map(([id, info]) => (
                              <option key={id} value={id}>{info.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="flex items-end sm:col-span-2">
                        <div className="flex-1">
                          <label className="label">Subtotal</label>
                          <p className="rounded-lg bg-white px-3 py-2 text-sm font-semibold">
                            {formatCurrency(subtotal)}
                          </p>
                        </div>
                        {fields.length > 1 && (
                          <button
                            type="button"
                            onClick={() => remove(index)}
                            className="mb-0.5 ml-2 rounded-lg p-2 text-red-500 hover:bg-red-50"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Condición de IVA del receptor */}
          {pideCondicionIva && (
            <div className="card">
              <label className="label">Condición frente al IVA del receptor</label>
              <select {...register('condicionIva')} className="select">
                <option value="">La de la factura original</option>
                {Object.entries(IVA_CONDITIONS)
                  .filter(([value]) => value !== '5')
                  .map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
              </select>
              <p className="mt-1 text-[11px] text-gray-400">
                Obligatoria para receptores identificados (RG 5616). Completala si la factura original es anterior a la migración.
              </p>
            </div>
          )}

          {/* Observations */}
          <div className="card">
            <label className="label">Observaciones</label>
            <textarea
              {...register('observations')}
              className="input"
              rows={3}
              placeholder="Observaciones opcionales..."
            />
          </div>

          {/* Totals */}
          <div className="card">
            <h3 className="mb-4 text-base font-semibold text-gray-900">Resumen</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{isTipoC ? 'Importe Neto' : 'Neto Gravado'}</span>
                <span className="font-medium">{formatCurrency(totals.impNeto)}</span>
              </div>
              {!isTipoC && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">IVA</span>
                  <span className="font-medium">{formatCurrency(totals.impIVA)}</span>
                </div>
              )}
              <div className="border-t border-gray-200 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-gray-900">TOTAL</span>
                  <span className="text-lg font-bold text-indigo-600">
                    {formatCurrency(totals.impTotal)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => navigate('/facturas')} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Emitiendo...
                </>
              ) : (
                `Emitir ${tipo === 'nc' ? 'Nota de Crédito' : 'Nota de Débito'}`
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
