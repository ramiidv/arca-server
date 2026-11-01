# ARCA Server

Sistema de facturación electrónica integrado con AFIP/ARCA (Argentina). Backend + Frontend full-stack para emitir facturas, notas de crédito/débito, consultar comprobantes, y gestionar certificados digitales — todo contra los web services oficiales de AFIP.

## Stack

- **Backend:** Node.js 22+, Express 5.2, TypeScript 6, Prisma 7 (driver adapter), PostgreSQL, Zod 4
- **Frontend:** React 19.2, Vite 8, Tailwind CSS 4 (@tailwindcss/vite), React Hook Form 7
- **Facturación:** [@ramiidv/arca-facturacion](https://www.npmjs.com/package/@ramiidv/arca-facturacion) ^4.0 — WSFEv1, WSFEX, CAEA, QR, resultado incierto (`recuperarComprobante`)
- **Padrón:** [@ramiidv/arca-padron](https://www.npmjs.com/package/@ramiidv/arca-padron) ^0.4 — A4, A10, A13, A100, constancia, `condicionIvaDesdePadron`
- **Constatación:** [@ramiidv/arca-cdc](https://www.npmjs.com/package/@ramiidv/arca-cdc) ^0.3 — WSCDC
- **FECRED:** [@ramiidv/arca-fecred](https://www.npmjs.com/package/@ramiidv/arca-fecred) ^0.3 — Factura de Crédito Electrónica MiPyME
- **MTXCA:** [@ramiidv/arca-mtxca](https://www.npmjs.com/package/@ramiidv/arca-mtxca) ^0.3 — Facturación con detalle de artículos
- **SIRE:** [@ramiidv/arca-sire](https://www.npmjs.com/package/@ramiidv/arca-sire) ^0.3 — Certificados de retención de IVA (C2005)
- **Agro:** [@ramiidv/arca-agro](https://www.npmjs.com/package/@ramiidv/arca-agro) ^0.3 — WSCPE y WSLPG (WSCTG fue derogado)
- **Empleados:** [@ramiidv/arca-empleados](https://www.npmjs.com/package/@ramiidv/arca-empleados) ^0.3 — Ingreso masivo de relaciones laborales (TXT de ancho fijo, 130 posiciones)
- **Common:** [@ramiidv/arca-common](https://www.npmjs.com/package/@ramiidv/arca-common) ^0.4 — WSAA, `FileTicketStorage`, SOAP con fallback TLS legacy, validadores
- **Certificados:** [arca-cert](https://www.npmjs.com/package/arca-cert) — Generación automática de certificados AFIP
- **Infra:** Docker Compose, Nginx

## Features

### Facturación

- Factura A, B, C con validación por tipo (A requiere CUIT, C no discrimina IVA)
- Notas de crédito y débito asociadas a facturas existentes
- Cálculo automático de IVA y totales (via SDK); el número se reserva como último autorizado + 1 y las emisiones se serializan por punto de venta y tipo
- Condición de IVA del receptor (RG 5616) obligatoria si está identificado: se toma del body o del cliente
- **Emisión segura:** la factura se guarda como pendiente con el intento *antes* de enviarla; un resultado incierto nunca se da por rechazado (ver [Resultado incierto](#resultado-incierto))
- QR oficial de ARCA (`arca.urlQR`) generado y persistido por factura
- Fechas de servicio condicionales según concepto (solo para Servicios y Productos y Servicios)
- Puntos de venta dinámicos cargados desde AFIP
- Resultado de comprobante: Aprobada (A) / Pendiente de recuperación (P) / Conflicto (C)
- Filtros por tipo de comprobante, cliente, estado y rango de fechas
- Paginación con 20 registros por página

### Certificados

- Generación automática de certificados AFIP desde la UI (via arca-cert)
- Renovación de certificados con alias temporal
- Verificación de certificado contra WSAA
- Visualización de expiración y días restantes (alerta si quedan menos de 30 días)
- Hot-reload del SDK al generar/renovar (sin reiniciar server)
- Producción como entorno default para generación de certificados

### Clientes

- CRUD de clientes con búsqueda (por nombre o número de documento)
- Auto-completar datos desde CUIT via padrón AFIP (A4): nombre, domicilio y condición IVA sugerida (`condicionIvaDesdePadron`)
- Protección contra eliminación: no se puede borrar un cliente que tiene facturas asociadas

### AFIP

- Consulta de comprobantes en AFIP por punto de venta, tipo y número
- Constatación de comprobantes propios o de terceros (WSCDC) con modalidad CAE/CAI/CAEA y CUIT del emisor
- Parámetros de referencia con tabs (comprobantes, IVA, documentos, monedas, tributos, conceptos)
- Cotización oficial de monedas
- Estado de servidores AFIP en dashboard y en configuración

### Observabilidad

- Logging de eventos de todos los SDKs (`onEvent`): auth login/cache-hit/clock-skew/storage-error, request end/retry/error
- Tickets de Acceso de WSAA persistidos en disco (`FileTicketStorage`, compartido por todos los SDKs): un reinicio no deja al server sin acceso (`ArcaTicketVigenteError`)
- Tiempos de respuesta de cada request a AFIP
- Retries automáticos con backoff exponencial

### Seguridad

- Helmet con CSP, HSTS (1 año), referrer-policy, frame-ancestors: none
- API keys hasheadas con SHA-256 (solo se muestran una vez al crearlas, máximo 5 por usuario)
- JWT con secreto obligatorio (sin defaults inseguros)
- DATABASE_URL obligatorio (sin defaults inseguros)
- Rate limiting: 200 req/15min global, 20 req/15min para endpoints de auth
- CORS restrictivo (default: `http://localhost:5173`)
- Body limit 1MB
- Manejo de errores del SDK con SOAP fault parsing y hints contextuales
- Errores de AFIP parseados con mensajes legibles (ej: "Estás usando el ambiente correcto?")

### Accesibilidad

- Skip-to-content link
- Focus visible global con outline indigo
- Respeto de prefers-reduced-motion
- ARIA labels y roles semánticos
- Touch targets de 44px en mobile (pointer: coarse)
- Touch manipulation (sin 300ms delay)

### Mobile

- UI responsive con Tailwind breakpoints
- Tablas con columnas ocultas en pantallas chicas (Número, Fecha, Cliente)
- Botones compactos (icono solo en mobile, texto en desktop)
- Stat cards en 2 columnas en mobile
- Pagination compacta y centrada
- Toasts dismissibles con botón de cerrar

## Setup

### Requisitos

- Node.js 22+
- PostgreSQL 17+
- Certificado AFIP (se puede generar desde la UI con clave fiscal)

### Variables de entorno

Crear `backend/.env`:

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/arca_facturacion

JWT_SECRET=tu-secreto-seguro-aqui
JWT_EXPIRES_IN=7d

AFIP_CUIT=20XXXXXXXXX
AFIP_CERT_PATH=./certs/cert.crt
AFIP_KEY_PATH=./certs/key.key
AFIP_PUNTO_VENTA=1
AFIP_PRODUCTION=false
AFIP_TICKETS_DIR=./certs/tickets     # opcional: Tickets de Acceso de WSAA (default backend/certs/tickets)
AFIP_RECOVERY_DELAY_MS=3000          # opcional: espera antes de consultar una factura con resultado incierto

PORT=3001
CORS_ORIGIN=http://localhost:5173
```

> `JWT_SECRET` y `DATABASE_URL` son obligatorios. El server no arranca sin ellos.
>
> `AFIP_TICKETS_DIR` guarda los Tickets de Acceso (token/sign de WSAA): tratalo como un secreto
> (el directorio se crea con permisos 0700). En Docker se usa el volumen `arca-tickets` (`/app/tickets`),
> porque `certs/` se monta como solo lectura. Producción de WSFEv1 en Node >= 17 funciona gracias al
> fallback TLS legacy de arca-common (`legacyTls: "auto"`, default).

### Instalación

```bash
# Backend
cd backend
npm install
npx prisma migrate dev
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

### Generar certificado AFIP

Desde la UI: **Configuración** > **Generar Certificado** (necesitás CUIT + clave fiscal nivel 3+).

Via API:

```bash
curl -X POST http://localhost:3001/api/afip/generate-cert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"cuit":"20XXXXXXXXX","password":"clave-fiscal","alias":"mi-sistema","environment":"production"}'
```

El certificado se guarda en `backend/certs/` y el SDK se recarga automáticamente.

### Docker

```bash
docker compose up -d
```

## API Endpoints

### Health

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/api/health` | Health check (público, sin auth) |

### Autenticación

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| POST | `/api/auth/register` | Registro (primer usuario = admin) |
| POST | `/api/auth/login` | Login, retorna JWT |
| GET | `/api/auth/me` | Usuario autenticado |
| GET | `/api/auth/api-keys` | Listar API keys (máscara, no el key real) |
| POST | `/api/auth/api-keys` | Crear API key (se muestra una sola vez) |
| DELETE | `/api/auth/api-keys/:id` | Eliminar API key |

### Facturas

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| POST | `/api/invoices` | Crear factura (A/B/C). 201 aprobada, 202 pendiente/conflicto. `condicionIva` opcional (si no, la del cliente) |
| POST | `/api/invoices/nota-credito` | Crear nota de crédito (ídem) |
| POST | `/api/invoices/nota-debito` | Crear nota de débito (ídem) |
| POST | `/api/invoices/:id/recuperar` | **Nuevo.** Reintentar la recuperación de una factura pendiente (P) o en conflicto (C) |
| GET | `/api/invoices` | Listar (filtros: cbteTipo, clientId, resultado, from, to) |
| GET | `/api/invoices/stats` | Estadísticas del dashboard (solo aprobadas + `pendingCount`) |
| GET | `/api/invoices/:id` | Detalle de factura con items, QR y datos de emisión |

### Resultado incierto

Sigue el flujo "Emisión segura" del README de arca-facturacion:

1. Se reserva el número (`ultimoComprobante + 1`), se fija la fecha con el reloj de ARCA y se arma el
   comprobante sin red (`armarComprobante`, que valida igual que `facturar` y devuelve el `intento`).
2. La factura se guarda con `resultado = "P"` y `emision` (JSON: operación, opciones con `cbteNro` y
   fecha fijos, intento, estado) **antes** de enviarla. Mientras haya una pendiente del mismo tipo y
   punto de venta no se emite otra (409).
3. Se envía:
   - **Aprobada** → `resultado = "A"`, CAE y QR.
   - **Rechazada** (`ArcaWSFEError` o `aprobada: false`) → no se emitió: se borra el registro y se
     informa el error (422/400).
   - **Incierta** (`ArcaResultadoIncierto`, o 10016 por número según `requiereRecuperacion`) → se espera
     `AFIP_RECOVERY_DELAY_MS` y se llama a `recuperarComprobante(intento)`:
     - `autorizado` → aprobada con el CAE recuperado.
     - `no_emitido` → se reenvía **una vez** con las mismas opciones (mismo número y fecha). Es seguro
       según el README: si el intento original llegara a autorizarse, ARCA rechaza el duplicado (10016).
       Si ARCA rechaza el reenvío, con certeza no se emitió: se borra el registro (libera el número) y
       responde 422.
     - `conflicto` → `resultado = "C"` (el número existe con otros datos): revisión manual.
     - Sin certeza (no se pudo consultar ni reenviar) → sigue `"P"`; se reintenta con
       `POST /api/invoices/:id/recuperar` (también si el proceso se cayó durante el envío).

Migración: `20261101120000_add_invoice_emision` agrega `Invoice.emision` (JSONB) y un índice por `resultado`.

### Errores de ARCA

| Error del SDK | HTTP | Cuerpo |
| ------------- | ---- | ------ |
| `ArcaValidationError` | 400 | `field`, `details` (no se envió nada a ARCA) |
| `ArcaResultadoIncierto` / `ArcaResultadoInciertoExpo` | 502 | `uncertain: true`, `recuperacion` (intento / Id) |
| `ArcaTicketVigenteError` | 503 | `service` |
| `ArcaAuthError` | 503 | |
| `ArcaPadronServiceError` | 404 (`inexistente`), 422 (`inactiva`), 400 (`id_invalido`), 502 (`no_autorizado`) | `reason`, `errors` |
| `ArcaWSFEError` y otros `ArcaServiceError` | 422 | `errors` |
| `ArcaSoapError` | 502 (504 si fue timeout sin respuesta) | `soapFault`, `uncertain`, `upstreamStatus` |

### Clientes

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/api/clients` | Listar (filtro: search por nombre o documento) |
| POST | `/api/clients` | Crear cliente |
| GET | `/api/clients/:id` | Detalle con cantidad de facturas |
| PUT | `/api/clients/:id` | Actualizar cliente |
| DELETE | `/api/clients/:id` | Eliminar (falla si tiene facturas) |

### AFIP — Parámetros, Padrón y Constatación

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/api/afip/status` | Estado servidores WSFE |
| GET | `/api/afip/contribuyente/:cuit` | Consulta padrón A4 + `condicionIvaSugerida` |
| GET | `/api/afip/comprobante` | Consultar comprobante (query: puntoVenta, cbteTipo, cbteNro). `ResultGet` con listas como arrays |
| GET | `/api/afip/cotizacion` | Cotización (query: monedaId, fecha opcional). Devuelve `{ MonId, MonCotiz, FchCotiz }` |
| GET | `/api/afip/puntos-venta` | Puntos de venta habilitados |
| GET | `/api/afip/last-voucher` | Último comprobante (query: puntoVenta, cbteTipo) |
| GET | `/api/afip/invoice-types` | Tipos de comprobante |
| GET | `/api/afip/doc-types` | Tipos de documento |
| GET | `/api/afip/iva-types` | Alícuotas IVA |
| GET | `/api/afip/iva-conditions` | Condiciones frente al IVA |
| GET | `/api/afip/concept-types` | Tipos de concepto |
| GET | `/api/afip/currency-types` | Monedas |
| GET | `/api/afip/tributo-types` | Tipos de tributo |
| GET | `/api/afip/optional-types` | Datos opcionales |
| GET | `/api/afip/contribuyente-basic/:cuit` | Consulta padrón A10 (básico) |
| GET | `/api/afip/padron-status` | Estado por servicio (a5, a4, a10, a13, a100): `{ ok, status \| error }` |
| POST | `/api/afip/constatar` | Constatar comprobante via WSCDC. Body `CmpReq`: `CbteModo` (CAE/CAI/CAEA) y `CuitEmisor` obligatorios |
| GET | `/api/afip/cdc-status` | Estado servicio WSCDC |
| GET | `/api/afip/cdc-tipos-cbte` | Tipos de comprobante WSCDC |
| GET | `/api/afip/fecred-status` | Estado WSFECRED |
| GET | `/api/afip/fecred-obligado/:cuit` | ¿Obligado a recibir FCE? (query `fechaEmision`, default hoy en Argentina) |
| POST | `/api/afip/fecred-ctas-ctes` | Cuentas corrientes FCE (`{ rol, cuitContraparte?, fecha? }`). Respuesta paginada `{ ctasCtes, nroPagina, hayMas }` |
| POST | `/api/afip/fecred-aceptar` | Aceptar FCE (`{ idCtaCte, saldoAceptado, codMoneda, cotizacionMonedaUlt, ... }`) |
| POST | `/api/afip/fecred-rechazar` | Rechazar FCE (`{ idCtaCte, motivos: [{ codMotivo, descMotivo, justificacion }] }`) |
| GET | `/api/afip/mtxca-status` | Estado WSMTXCA |
| POST | `/api/afip/mtxca-autorizar` | Autorizar con detalle de artículos (`ComprobanteType` del XSD). Resultado `R` → 422 |
| GET | `/api/afip/mtxca-ultimo-comprobante` | Último comprobante MTXCA |
| GET | `/api/afip/sire-status` | Estado SIRE |
| POST | `/api/afip/sire-emitir` | Emitir certificado de retención (`emitirCertificado`). Alias: `/api/afip/sire-retencion` |
| POST | `/api/afip/sire-anular` | Anular certificado (`{ numeroCertificado, motivoAnulacion, codigoTrazabilidad? }`) |
| GET | `/api/afip/agro-status` | Estado de WSCPE y WSLPG: `{ cpe, lpg }` con `{ ok, status \| error }` |
| POST | `/api/afip/agro-cpe-autorizar` | Autorizar Carta de Porte automotor (request según el XSD de WSCPE) |
| POST | `/api/afip/agro-lpg-autorizar` | Autorizar liquidación de granos (`{ liquidacion, deducciones?, retenciones?, percepciones? }`) |
| POST | `/api/afip/empleados-generar` | Archivo de relaciones laborales (`{ registros: [{ tipo: alta\|baja\|modificacion\|novedad, data }], strict? }`). Con `?formato=txt` descarga el TXT (ISO-8859-1) |

**Eliminados** (no existen en ARCA): `POST /api/afip/agro-ctg-solicitar` (WSCTG derogado, el CTG viene en la
respuesta de WSCPE), `POST /api/afip/sire-consultar`, `GET /api/afip/sire-regimenes` y
`DELETE /api/afip/sire-anular/:nro` (ahora `POST /api/afip/sire-anular`).

### AFIP — Certificados

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| POST | `/api/afip/generate-cert` | Generar certificado AFIP (timeout: 2min) |
| POST | `/api/afip/renew-cert` | Renovar certificado (alias nuevo) |
| GET | `/api/afip/cert-info` | Expiración del cert actual (días restantes) |
| POST | `/api/afip/test-cert` | Verificar cert contra WSAA |

## Frontend

### Páginas

| Ruta | Página | Descripción |
| ---- | ------ | ----------- |
| `/` | Dashboard | Stats, facturas recientes, estado AFIP |
| `/facturas` | Facturas | Lista con filtros por tipo, estado y fecha, paginación, botón Recuperar en pendientes |
| `/facturas/nueva` | Nueva Factura | Formulario tipo-aware (A/B/C) con cálculo en vivo |
| `/facturas/nota` | NC / ND | Crear nota de crédito o débito desde factura existente |
| `/facturas/:id` | Detalle | Factura completa con items, totales, CAE, QR, botón NC/ND; aviso y reintento de recuperación si quedó pendiente |
| `/clientes` | Clientes | Lista con búsqueda y paginación |
| `/clientes/nuevo` | Nuevo Cliente | Formulario con lookup CUIT desde padrón AFIP |
| `/clientes/:id/editar` | Editar Cliente | Mismo formulario en modo edición |
| `/consulta` | Consultar Cbte. | Buscar comprobante en AFIP por PV + tipo + número y constatarlo (WSCDC) |
| `/parametros` | Parámetros AFIP | Tabs: comprobantes, documentos, IVA, conceptos, monedas, tributos + cotización |
| `/configuracion` | Configuración | Generar/renovar cert, verificar cert, estado AFIP, info sistema |
| `/api-keys` | API Keys | Crear, listar y eliminar API keys |
| `/login` | Login | Email + contraseña |
| `/register` | Registro | Nombre, email, contraseña |

### Navegación (Sidebar)

- **General:** Dashboard
- **Facturación:** Facturas, Nueva Factura, NC / ND
- **Gestión:** Clientes, Nuevo Cliente
- **AFIP:** Consultar Cbte., Parámetros
- **Sistema:** API Keys, Configuración

## Base de datos

### Modelos (Prisma)

- **User** — email, password (bcrypt 12 rounds), name, role (admin/user)
- **ApiKey** — key (SHA-256 hash), keyHint (máscara visible), userId, lastUsed (máx 5 por usuario)
- **Client** — name, docType, docNumber, ivaCondition, address, email, phone
- **Invoice** — cbteTipo, puntoVenta, cbteNro, importes (Decimal 15,2), cae, caeFchVto, resultado (A/P/C), qrUrl, monId, monCotiz, observations, emision (JSON con el intento para recuperar)
- **InvoiceItem** — description, quantity, unitPrice, ivaId, ivaRate, subtotal, ivaAmount

## Tests

```bash
cd backend
npm test                                          # tests unitarios (sin red ni certificado)
ARCA_INTEGRATION=1 AFIP_CUIT=20XXXXX npm test     # + integración con ARCA homologación (emite comprobantes)
```

- `tests/arca-sdk.test.ts`: API de los SDKs (formatDate de common, QR, calcularTotales, armarComprobante,
  requiereRecuperacion, errores, validación de CUIT, archivo de empleados) e integración con homologación
  (`describe.skipIf`: requiere `ARCA_INTEGRATION=1`, `AFIP_CUIT` y `backend/certs/cert.crt` + `key.key`).
- `tests/errorHandler.test.ts`: mapeo de cada error de los SDKs a HTTP.
- `tests/invoice.service.test.ts`: flujo incierto → recuperar con el SDK y Prisma mockeados.
- `tests/afip-empleados.route.test.ts`: `/empleados-generar` con `?formato=txt`.

## Licencia

MIT
