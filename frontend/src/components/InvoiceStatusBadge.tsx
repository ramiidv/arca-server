interface InvoiceStatusBadgeProps {
  resultado?: string | null;
}

export default function InvoiceStatusBadge({ resultado }: InvoiceStatusBadgeProps) {
  if (resultado === 'A') {
    return <span className="badge-green">Aprobada</span>;
  }

  if (resultado === 'R') {
    return <span className="badge-red">Rechazada</span>;
  }

  if (resultado === 'C') {
    return (
      <span className="badge-red" title="El número existe en ARCA con otros datos: requiere revisión manual">
        Conflicto
      </span>
    );
  }

  if (resultado === 'P') {
    return (
      <span className="badge-yellow" title="ARCA no confirmó el resultado: reintentá la recuperación">
        Pendiente (incierta)
      </span>
    );
  }

  return <span className="badge-yellow">Pendiente</span>;
}
