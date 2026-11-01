import { useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { recuperarFactura } from '../api/client';
import { getApiErrorMessage } from '../utils/errors';
import type { EmisionResult } from '../types';

interface RecuperarFacturaButtonProps {
  invoiceId: number;
  /** Se llama con el resultado de la recuperación (aprobada, sigue pendiente o en conflicto). */
  onResultado?: (result: EmisionResult) => void;
  /** ARCA rechazó el reenvío: el comprobante no se emitió y el backend borró el registro pendiente. */
  onEliminada?: () => void;
  className?: string;
  compact?: boolean;
}

/**
 * Reintenta la recuperación en ARCA de una factura con resultado incierto
 * (POST /invoices/:id/recuperar). El backend consulta el comprobante y, si no
 * se emitió, lo reenvía con el mismo número.
 */
export default function RecuperarFacturaButton({
  invoiceId,
  onResultado,
  onEliminada,
  className = '',
  compact = false,
}: RecuperarFacturaButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      setLoading(true);
      const result = await recuperarFactura(invoiceId);
      const { afipResponse } = result;
      if (afipResponse.resultado === 'A') {
        toast.success(`Factura recuperada${result.invoice.cae ? `: CAE ${result.invoice.cae}` : ''}`);
      } else if (afipResponse.conflicto) {
        toast.error(afipResponse.mensaje || 'El número existe en ARCA con otros datos: requiere revisión manual', { duration: 10000 });
      } else {
        toast(afipResponse.mensaje || 'ARCA todavía no confirmó el resultado. Reintentá en unos minutos.', { duration: 8000 });
      }
      onResultado?.(result);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast.error(getApiErrorMessage(err, 'No se pudo recuperar la factura'), { duration: 10000 });
      if (status === 422) onEliminada?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`btn-secondary ${compact ? 'px-2 py-1 text-[11px]' : 'text-xs sm:text-sm'} ${className}`}
      title="Consultar en ARCA si el comprobante quedó autorizado"
    >
      <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      {compact ? 'Recuperar' : 'Reintentar recuperación'}
    </button>
  );
}
