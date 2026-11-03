import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { MagnifyingGlassIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { createClient, getClient, updateClient, consultarCuit } from '../api/client';
import { IVA_CONDITIONS } from '../types';
import { getApiErrorMessage } from '../utils/errors';

interface ClientFormData {
  name: string;
  docType: number;
  docNumber: string;
  ivaCondition: number;
  address: string;
  email: string;
  phone: string;
}

export default function NewClient() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(!!id);
  const [lookingUp, setLookingUp] = useState(false);
  const [cuitFound, setCuitFound] = useState(false);
  const isEditing = !!id;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ClientFormData>({
    defaultValues: {
      name: '',
      docType: 80,
      docNumber: '',
      ivaCondition: 1,
      address: '',
      email: '',
      phone: '',
    },
  });

  const watchDocType = Number(watch('docType'));
  const watchDocNumber = watch('docNumber');

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        setFetching(true);
        const client = await getClient(Number(id));
        reset({
          name: client.name,
          docType: client.docType,
          docNumber: client.docNumber,
          ivaCondition: client.ivaCondition,
          address: client.address || '',
          email: client.email || '',
          phone: client.phone || '',
        });
      } catch (err) {
        toast.error(getApiErrorMessage(err, 'Error al cargar el cliente'));
        navigate('/clientes');
      } finally {
        setFetching(false);
      }
    }
    load();
  }, [id, reset, navigate]);

  const lookupCuit = async () => {
    const cuit = watchDocNumber?.replace(/\D/g, '');
    if (!cuit || cuit.length < 11) {
      toast.error('Ingresá un CUIT válido (11 dígitos)');
      return;
    }

    try {
      setLookingUp(true);
      setCuitFound(false);
      const persona = await consultarCuit(cuit);

      // Padrón A4 (arca-padron): nombre/apellido o razón social
      const nombre = persona.razonSocial ||
        [persona.apellido, persona.nombre].filter(Boolean).join(' ') || '';
      if (nombre) setValue('name', nombre);

      // Domicilio: el fiscal si está, si no el primero
      const domicilio = persona.domicilio?.find((d) => d.tipoDomicilio === 'FISCAL') ?? persona.domicilio?.[0];
      if (domicilio) {
        const parts = [
          domicilio.direccion,
          domicilio.localidad,
          domicilio.codPostal,
          domicilio.descripcionProvincia,
        ].filter(Boolean);
        if (parts.length > 0) setValue('address', parts.join(', '));
      }

      // Condición de IVA inferida por el backend (condicionIvaDesdePadron)
      const sugerida = persona.condicionIvaSugerida;
      if (sugerida?.condicionIva) {
        setValue('ivaCondition', sugerida.condicionIva);
      } else if (sugerida?.motivo) {
        toast(`No se pudo determinar la condición de IVA: ${sugerida.motivo}`, { duration: 8000 });
      }

      setCuitFound(true);
      toast.success(`Datos cargados: ${nombre}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'No se encontró el CUIT en el padrón de ARCA'), { duration: 8000 });
    } finally {
      setLookingUp(false);
    }
  };

  const onSubmit = async (data: ClientFormData) => {
    try {
      setLoading(true);
      const payload = {
        ...data,
        docType: Number(data.docType),
        ivaCondition: Number(data.ivaCondition),
      };

      if (isEditing) {
        await updateClient(Number(id), payload);
        toast.success('Cliente actualizado');
      } else {
        await createClient(payload);
        toast.success('Cliente creado');
      }
      navigate('/clientes');
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Error al guardar el cliente'));
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="card">
          <h3 className="mb-4 text-base font-semibold text-gray-900">
            {isEditing ? 'Editar Cliente' : 'Nuevo Cliente'}
          </h3>

          <div className="space-y-4">
            {/* Document */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Tipo de Documento *</label>
                <select
                  {...register('docType', { valueAsNumber: true })}
                  className="select"
                >
                  <option value={80}>CUIT</option>
                  <option value={86}>CUIL</option>
                  <option value={96}>DNI</option>
                  <option value={99}>Sin identificar / Consumidor Final</option>
                </select>
              </div>
              <div>
                <label className="label">Número de Documento *</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    {...register('docNumber', {
                      required: 'El documento es requerido',
                    })}
                    className="input flex-1"
                    placeholder="20123456789"
                  />
                  {watchDocType === 80 && (
                    <button
                      type="button"
                      onClick={lookupCuit}
                      disabled={lookingUp}
                      className="btn-secondary flex-shrink-0"
                      title="Buscar en padrón ARCA"
                    >
                      {lookingUp ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                      ) : cuitFound ? (
                        <CheckCircleIcon className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <MagnifyingGlassIcon className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
                {errors.docNumber && (
                  <p className="mt-1 text-xs text-red-600">{errors.docNumber.message}</p>
                )}
                {watchDocType === 80 && !isEditing && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    Ingresá el CUIT y hacé click en la lupa para completar los datos desde ARCA
                  </p>
                )}
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="label">Nombre / Razón Social *</label>
              <input
                type="text"
                {...register('name', { required: 'El nombre es requerido' })}
                className="input"
                placeholder="Juan Pérez S.A."
              />
              {errors.name && (
                <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
              )}
            </div>

            {/* IVA Condition */}
            <div>
              <label className="label">Condición frente al IVA *</label>
              <select
                {...register('ivaCondition', { valueAsNumber: true })}
                className="select"
              >
                {Object.entries(IVA_CONDITIONS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {/* Address */}
            <div>
              <label className="label">Domicilio</label>
              <input
                type="text"
                {...register('address')}
                className="input"
                placeholder="Av. Corrientes 1234, CABA"
              />
            </div>

            {/* Contact */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  {...register('email')}
                  className="input"
                  placeholder="cliente@email.com"
                />
              </div>
              <div>
                <label className="label">Teléfono</label>
                <input
                  type="text"
                  {...register('phone')}
                  className="input"
                  placeholder="+54 11 1234-5678"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/clientes')}
            className="btn-secondary"
          >
            Cancelar
          </button>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Guardando...
              </>
            ) : isEditing ? (
              'Actualizar Cliente'
            ) : (
              'Crear Cliente'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
