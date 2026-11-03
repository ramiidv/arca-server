import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, useFieldArray } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  PlusIcon,
  TrashIcon,
  CheckCircleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { createInvoice, getClients, getPuntosVenta } from '../api/client';
import {
  CBTE_TIPOS,
  CLASE_CBTE,
  CONDICIONES_IVA_POR_CLASE,
  DOC_TIPOS,
  IVA_ALICUOTAS,
  IVA_CONDITIONS,
  TIPOS_FACTURA,
  type Client,
  type PuntoVenta,
} from '../types';
import { formatCurrency, todayAsInputDate, inputDateToYYYYMMDD } from '../utils/formatters';
import { getApiErrorMessage } from '../utils/errors';

interface FormItem {
  description: string;
  quantity: number;
  unitPrice: number;
  ivaId: number;
}

interface InvoiceFormData {
  cbteTipo: number;
  puntoVenta: number;
  concepto: number;
  docTipo: number;
  docNro: string;
  /** Condición de IVA del receptor (RG 5616): obligatoria si docTipo != 99 */
  condicionIva?: number | '';
  clientId?: number;
  items: FormItem[];
  fchServDesde: string;
  fchServHasta: string;
  fchVtoPago: string;
  observations: string;
}

// Solo facturas en NewInvoice — NC/ND se crean desde otro flujo
const FACTURA_TIPOS: Record<number, string> = Object.fromEntries(TIPOS_FACTURA.map((t) => [t, CBTE_TIPOS[t]]));

function needsServiceDates(concepto: number) { return concepto === 2 || concepto === 3; }

/**
 * Ayuda de cada tipo: las condiciones de IVA del receptor que acepta el SDK
 * para la clase (CONDICIONES_IVA_POR_CLASE), no una regla normativa completa.
 */
const AYUDA_TIPO: Record<number, string> = {
  1: 'Receptor RI o monotributista, con CUIT',
  6: 'Receptor consumidor final, exento, no alcanzado o del exterior; no discrimina IVA',
  11: 'Cualquier condición de IVA del receptor; no discrimina IVA',
};

export default function NewInvoice() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ cae: string; cbteNro: number; cbteTipo: number; puntoVenta: number } | null>(null);
  const [puntosVenta, setPuntosVenta] = useState<PuntoVenta[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const today = todayAsInputDate();

  const { register, control, watch, setValue, handleSubmit, formState: { errors } } = useForm<InvoiceFormData>({
    defaultValues: {
      cbteTipo: 11,
      puntoVenta: 1,
      concepto: 1,
      docTipo: 99,
      docNro: '0',
      condicionIva: '',
      items: [{ description: '', quantity: 1, unitPrice: 0, ivaId: 5 }],
      fchServDesde: today,
      fchServHasta: today,
      fchVtoPago: today,
      observations: '',
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const watchItems = watch('items');
  const watchCbteTipo = Number(watch('cbteTipo'));
  const watchConcepto = Number(watch('concepto'));
  const watchDocTipo = Number(watch('docTipo'));
  // Receptor identificado sin cliente cargado: hay que indicar la condición de IVA
  const pideCondicionIva = watchDocTipo !== 99 && !selectedClient;
  // Condiciones que acepta la clase del comprobante (mismas reglas que arca-facturacion)
  const clase = CLASE_CBTE[watchCbteTipo];
  const condicionesValidas = CONDICIONES_IVA_POR_CLASE[clase];

  // Tipo A requiere CUIT del receptor; tipo C no discrimina IVA
  const esA = clase === 'A';
  const esC = clase === 'C';
  const esServicio = needsServiceDates(watchConcepto);

  // Cuando cambia el tipo, ajustar defaults
  useEffect(() => {
    if (esA) {
      // Tipo A requiere CUIT
      setValue('docTipo', 80);
      if (watch('docNro') === '0') setValue('docNro', '');
    } else if (esC) {
      // Tipo C: consumidor final por defecto
      if (!selectedClient) {
        setValue('docTipo', 99);
        setValue('docNro', '0');
      }
    }
  }, [watchCbteTipo, esA, esC, setValue, selectedClient, watch]);

  // Si cambia el tipo y la condición elegida no vale para la nueva clase, se limpia
  const condicionElegida = watch('condicionIva');
  useEffect(() => {
    if (condicionElegida && !condicionesValidas.includes(Number(condicionElegida))) {
      setValue('condicionIva', '');
    }
  }, [condicionElegida, condicionesValidas, setValue]);

  // Load clients and puntos de venta
  useEffect(() => {
    getClients({ limit: 100 })
      .then((data) => setClients(data.clients || []))
      .catch((err) => toast.error(getApiErrorMessage(err, 'Error al cargar los clientes'), { duration: 8000 }));
    getPuntosVenta()
      .then((data) => {
        const activos = (Array.isArray(data) ? data : []).filter((p) => p.bloqueado !== 'S'); // bloqueado es opcional en el SDK
        setPuntosVenta(activos);
        if (activos.length > 0) setValue('puntoVenta', activos[0].nro);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, 'Error al cargar los puntos de venta de ARCA'), { duration: 8000 }));
  }, [setValue]);

  const filteredClients = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
      c.docNumber.includes(clientSearch)
  );

  const selectClient = useCallback(
    (client: Client) => {
      setSelectedClient(client);
      setValue('docTipo', client.docType);
      setValue('docNro', client.docNumber);
      setValue('clientId', client.id);
      setClientSearch(client.name);
      setShowClientDropdown(false);
    },
    [setValue]
  );

  const clearClient = () => {
    setSelectedClient(null);
    setValue('docTipo', esA ? 80 : 99);
    setValue('docNro', esA ? '' : '0');
    setValue('clientId', undefined);
    setClientSearch('');
  };

  // Calculate totals — tipo C no discrimina IVA
  const calculateTotals = () => {
    let impNeto = 0;
    let impIVA = 0;

    (watchItems || []).forEach((item) => {
      const subtotal = (item.quantity || 0) * (item.unitPrice || 0);

      if (esC) {
        // Tipo C: todo va a neto, sin IVA
        impNeto += subtotal;
      } else {
        // Todas las alícuotas del selector son gravadas, incluida 0% (id 3): suman a
        // Neto Gravado, como en el SDK y en el detalle de la factura.
        const ivaInfo = IVA_ALICUOTAS[item.ivaId];
        const rate = ivaInfo?.rate ?? 21;
        impNeto += subtotal;
        impIVA += subtotal * rate / 100;
      }
    });

    const impTotal = impNeto + impIVA;
    return { impNeto, impIVA, impTotal };
  };

  const totals = calculateTotals();

  const onSubmit = async (data: InvoiceFormData) => {
    // Validación extra: Tipo A requiere receptor con CUIT (docTipo 80, validación 10013 de ARCA)
    if (esA && (!data.docNro || data.docNro === '0' || (selectedClient && selectedClient.docType !== 80))) {
      toast.error('Factura A requiere CUIT del receptor');
      return;
    }
    if (pideCondicionIva && !data.condicionIva) {
      toast.error('Indicá la condición de IVA del receptor');
      return;
    }
    if (pideCondicionIva && !condicionesValidas.includes(Number(data.condicionIva))) {
      toast.error(`La condición de IVA elegida no es válida para ${FACTURA_TIPOS[watchCbteTipo] ?? 'este comprobante'}`);
      return;
    }

    try {
      setSubmitting(true);

      const items = data.items.map((item) => {
        const ivaInfo = IVA_ALICUOTAS[item.ivaId];
        const subtotal = item.quantity * item.unitPrice;
        const ivaAmount = esC ? 0 : subtotal * (ivaInfo?.rate ?? 21) / 100;
        return {
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          ivaId: Number(item.ivaId),
          ivaRate: ivaInfo?.rate ?? 21,
          subtotal,
          ivaAmount,
        };
      });

      const payload: Record<string, unknown> = {
        cbteTipo: Number(data.cbteTipo),
        puntoVenta: Number(data.puntoVenta),
        concepto: Number(data.concepto),
        // El select queda deshabilitado en tipo A: el valor es siempre CUIT (80)
        docTipo: esA ? 80 : Number(data.docTipo),
        docNro: data.docNro,
        clientId: data.clientId || undefined,
        // Con cliente, el backend usa su condición de IVA
        condicionIva: pideCondicionIva && data.condicionIva ? Number(data.condicionIva) : undefined,
        items,
        observations: data.observations || undefined,
      };

      // Solo incluir fechas de servicio si el concepto lo requiere
      if (esServicio) {
        payload.fchServDesde = inputDateToYYYYMMDD(data.fchServDesde);
        payload.fchServHasta = inputDateToYYYYMMDD(data.fchServHasta);
        payload.fchVtoPago = inputDateToYYYYMMDD(data.fchVtoPago);
      }

      const result = await createInvoice(payload);
      const inv = result.invoice;

      if (result.afipResponse.resultado !== 'A') {
        // Resultado incierto o conflicto: la factura quedó guardada, no se debe reemitir.
        toast(result.afipResponse.mensaje || 'ARCA no confirmó el resultado. La factura quedó pendiente.', {
          icon: '⚠️',
          duration: 10000,
        });
        navigate(`/facturas/${inv.id}`);
        return;
      }

      toast.success('Factura emitida exitosamente');
      setSuccess({
        cae: inv.cae || '',
        cbteNro: inv.cbteNro,
        cbteTipo: inv.cbteTipo,
        puntoVenta: inv.puntoVenta,
      });
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Error al emitir la factura'), { duration: 8000 });
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
          <h2 className="mt-5 text-xl font-bold text-gray-900">Factura Emitida</h2>
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
              onClick={() => {
                setSuccess(null);
                navigate('/facturas/nueva');
                window.location.reload();
              }}
              className="btn-primary text-sm"
            >
              <PlusIcon className="h-4 w-4" />
              Nueva Factura
            </button>
            <button onClick={() => navigate('/facturas')} className="btn-secondary text-sm">
              Ver Facturas
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mx-auto max-w-4xl space-y-6">
      {/* Invoice Type Selection */}
      <div className="card">
        <h3 className="mb-4 text-base font-semibold text-gray-900">
          Tipo de Comprobante
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Object.entries(FACTURA_TIPOS).map(([value, label]) => {
            const selected = watchCbteTipo === Number(value);
            const hint = AYUDA_TIPO[Number(value)];
            return (
              <label
                key={value}
                className={`cursor-pointer rounded-xl border-2 p-4 transition-all ${
                  selected
                    ? 'border-indigo-600 bg-indigo-50 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  value={value}
                  {...register('cbteTipo', { valueAsNumber: true })}
                  className="sr-only"
                />
                <p className={`text-sm font-semibold ${selected ? 'text-indigo-700' : 'text-gray-700'}`}>
                  {label}
                </p>
                <p className={`mt-0.5 text-xs ${selected ? 'text-indigo-500' : 'text-gray-400'}`}>
                  {hint}
                </p>
              </label>
            );
          })}
        </div>

        {/* Tipo A info */}
        {esA && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <InformationCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            Factura A requiere receptor con CUIT y condición de IVA Responsable Inscripto o Monotributo
            (incluye Monotributo Social y Trabajador Independiente Promovido)
          </div>
        )}

        {/* Tipo C info */}
        {esC && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
            <InformationCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            Factura C no discrimina IVA. Los importes se envían como neto sin desglose.
          </div>
        )}
      </div>

      {/* Punto de Venta + Concepto */}
      <div className="card">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Punto de Venta</label>
            {puntosVenta.length > 0 ? (
              <select
                {...register('puntoVenta', { valueAsNumber: true, required: true })}
                className="select"
              >
                {puntosVenta.map((pv) => (
                  <option key={pv.nro} value={pv.nro}>
                    {String(pv.nro).padStart(5, '0')}{pv.emisionTipo ? ` — ${pv.emisionTipo}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                {...register('puntoVenta', { valueAsNumber: true, required: true, min: 1 })}
                className="input"
                min={1}
              />
            )}
            {errors.puntoVenta && (
              <p className="mt-1 text-xs text-red-600">Punto de venta requerido</p>
            )}
          </div>
          <div>
            <label className="label">Concepto</label>
            <select {...register('concepto', { valueAsNumber: true })} className="select">
              <option value={1}>Productos</option>
              <option value={2}>Servicios</option>
              <option value={3}>Productos y Servicios</option>
            </select>
          </div>
        </div>
      </div>

      {/* Client / Document */}
      <div className="card">
        <h3 className="mb-4 text-base font-semibold text-gray-900">
          {esA ? 'Receptor (obligatorio)' : 'Cliente'}
        </h3>
        <div className="space-y-4">
          <div className="relative">
            <label className="label">Buscar Cliente</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setShowClientDropdown(true);
                  if (!e.target.value) clearClient();
                }}
                onFocus={() => setShowClientDropdown(true)}
                placeholder="Buscar por nombre o documento..."
                className="input flex-1"
              />
              {selectedClient && (
                <button type="button" onClick={clearClient} className="btn-secondary text-xs">
                  Limpiar
                </button>
              )}
            </div>
            {showClientDropdown && clientSearch && filteredClients.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                {filteredClients.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => selectClient(client)}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-indigo-50"
                  >
                    <span className="font-medium">{client.name}</span>
                    <span className="text-xs text-gray-500">{client.docNumber}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Tipo de Documento</label>
              <select
                {...register('docTipo', { valueAsNumber: true })}
                className="select"
                disabled={esA && !selectedClient}
              >
                {esA ? (
                  <option value={80}>{DOC_TIPOS[80]}</option>
                ) : (
                  <>
                    {Object.entries(DOC_TIPOS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </>
                )}
              </select>
              {esA && (
                <p className="mt-1 text-[11px] text-gray-400">Factura A solo acepta CUIT</p>
              )}
            </div>
            <div>
              <label className="label">
                Número de Documento
                {esA && <span className="text-red-500"> *</span>}
              </label>
              <input
                type="text"
                {...register('docNro', { required: true })}
                className="input"
                placeholder={esA ? 'Ej: 20123456789' : '20123456789'}
              />
              {errors.docNro && (
                <p className="mt-1 text-xs text-red-600">Documento requerido</p>
              )}
            </div>
            {pideCondicionIva && (
              <div>
                <label className="label">
                  Condición frente al IVA <span className="text-red-500">*</span>
                </label>
                <select {...register('condicionIva')} className="select">
                  <option value="">Seleccioná...</option>
                  {condicionesValidas.map((value) => (
                    <option key={value} value={value}>{IVA_CONDITIONS[value]}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-gray-400">
                  Obligatoria para receptores identificados (RG 5616). Se muestran las que acepta{' '}
                  {FACTURA_TIPOS[watchCbteTipo] ?? 'el comprobante'}.
                </p>
              </div>
            )}
            {selectedClient && watchDocTipo !== 99 && (
              <div>
                <p className="label">Condición frente al IVA</p>
                <p className="text-sm text-gray-700">
                  {IVA_CONDITIONS[selectedClient.ivaCondition] || `Código ${selectedClient.ivaCondition}`} (del cliente)
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Items</h3>
          <button
            type="button"
            onClick={() =>
              append({ description: '', quantity: 1, unitPrice: 0, ivaId: 5 })
            }
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
            const ivaInfo = IVA_ALICUOTAS[item?.ivaId ?? 5];
            const ivaAmount = esC ? 0 : subtotal * (ivaInfo?.rate ?? 21) / 100;

            return (
              <div
                key={field.id}
                className="rounded-lg border border-gray-200 bg-gray-50/50 p-4"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <div className={esC ? 'sm:col-span-6' : 'sm:col-span-4'}>
                    <label className="label">Descripción</label>
                    <input
                      type="text"
                      {...register(`items.${index}.description`, { required: true })}
                      className="input"
                      placeholder="Descripción del producto o servicio"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Cantidad</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      {...register(`items.${index}.quantity`, {
                        valueAsNumber: true,
                        required: true,
                        min: 0.01,
                      })}
                      className="input"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Precio Unit.</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      {...register(`items.${index}.unitPrice`, {
                        valueAsNumber: true,
                        required: true,
                        min: 0,
                      })}
                      className="input"
                    />
                  </div>
                  {/* IVA selector: hidden for tipo C */}
                  {!esC && (
                    <div className="sm:col-span-2">
                      <label className="label">IVA</label>
                      <select
                        {...register(`items.${index}.ivaId`, { valueAsNumber: true })}
                        className="select"
                      >
                        {Object.entries(IVA_ALICUOTAS).map(([id, info]) => (
                          <option key={id} value={id}>
                            {info.name}
                          </option>
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
                {!esC && (
                  <p className="mt-2 text-right text-xs text-gray-400">
                    IVA: {formatCurrency(ivaAmount)} | Total: {formatCurrency(subtotal + ivaAmount)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Service Dates — only for Servicios / Productos y Servicios */}
      {esServicio && (
        <div className="card">
          <h3 className="mb-4 text-base font-semibold text-gray-900">
            Período de Servicio
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Fecha Desde</label>
              <input
                type="date"
                {...register('fchServDesde', { required: esServicio })}
                className="input"
              />
            </div>
            <div>
              <label className="label">Fecha Hasta</label>
              <input
                type="date"
                {...register('fchServHasta', { required: esServicio })}
                className="input"
              />
            </div>
            <div>
              <label className="label">Vencimiento de Pago</label>
              <input
                type="date"
                {...register('fchVtoPago', { required: esServicio })}
                className="input"
              />
            </div>
          </div>
        </div>
      )}

      {/* Observations */}
      <div className="card">
        <label className="label" htmlFor="observations">Observaciones</label>
        <textarea
          id="observations"
          {...register('observations')}
          className="input"
          rows={3}
          placeholder="Observaciones opcionales..."
          aria-describedby="observations-ayuda"
        />
        <p id="observations-ayuda" className="mt-1 text-[11px] text-gray-400">
          Notas internas: se guardan solo en este sistema y no se envían a ARCA ni aparecen en el comprobante autorizado.
        </p>
      </div>

      {/* Totals Summary */}
      <div className="card">
        <h3 className="mb-4 text-base font-semibold text-gray-900">Resumen</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">{esC ? 'Importe Neto' : 'Neto Gravado'}</span>
            <span className="font-medium">{formatCurrency(totals.impNeto)}</span>
          </div>
          {!esC && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">IVA</span>
                <span className="font-medium">{formatCurrency(totals.impIVA)}</span>
              </div>
            </>
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
        <button
          type="button"
          onClick={() => navigate('/facturas')}
          className="btn-secondary"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary"
        >
          {submitting ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Emitiendo...
            </>
          ) : (
            'Emitir Factura'
          )}
        </button>
      </div>
    </form>
  );
}
