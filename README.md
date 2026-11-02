# ARCA Server

Sistema de facturación electrónica integrado con AFIP/ARCA (Argentina). Backend + Frontend full-stack para emitir facturas, notas de crédito/débito, consultar comprobantes, y gestionar certificados digitales — todo contra los web services oficiales de AFIP.

## Stack

- **Backend:** Node.js 22+, Express 5.2, TypeScript 6, Prisma 7 (driver adapter), PostgreSQL, Zod 4
- **Frontend:** React 19.2, Vite 8, Tailwind CSS 4 (@tailwindcss/vite), React Hook Form 7
- **Facturación:** [@ramiidv/arca-facturacion](https://www.npmjs.com/package/@ramiidv/arca-facturacion) ^6.1 — WSFEv1, WSFEX, CAEA, QR, resultado incierto (`recuperarComprobante`). API en camelCase
- **Padrón:** [@ramiidv/arca-padron](https://www.npmjs.com/package/@ramiidv/arca-padron) ^0.7 — A4, A10, A13, A100, constancia, `condicionIvaDesdePadron`
- **Constatación:** [@ramiidv/arca-cdc](https://www.npmjs.com/package/@ramiidv/arca-cdc) ^0.6 — WSCDC (camelCase)
- **FECRED:** [@ramiidv/arca-fecred](https://www.npmjs.com/package/@ramiidv/arca-fecred) ^0.6 — Factura de Crédito Electrónica MiPyME
- **MTXCA:** [@ramiidv/arca-mtxca](https://www.npmjs.com/package/@ramiidv/arca-mtxca) ^0.6 — Facturación con detalle de artículos
- **SIRE:** [@ramiidv/arca-sire](https://www.npmjs.com/package/@ramiidv/arca-sire) ^0.5 — Certificados de retención de IVA (C2005)
- **Agro:** [@ramiidv/arca-agro](https://www.npmjs.com/package/@ramiidv/arca-agro) ^0.6 — WSCPE y WSLPG (WSCTG fue derogado)
- **Empleados:** [@ramiidv/arca-empleados](https://www.npmjs.com/package/@ramiidv/arca-empleados) ^0.5 — Ingreso masivo de relaciones laborales (TXT de ancho fijo, 130 posiciones)
- **Common:** [@ramiidv/arca-common](https://www.npmjs.com/package/@ramiidv/arca-common) ^0.7 — WSAA (un `WsaaClient` compartido por todos los SDKs), `FileTicketStorage`, SOAP con fallback TLS legacy, validadores
- **Certificados:** [arca-cert](https://www.npmjs.com/package/arca-cert) — Generación automática de certificados AFIP
- **Infra:** Docker Compose, Nginx

## Features

### Facturación

- Factura A, B, C con validación por tipo (A requiere receptor con CUIT, `docTipo` 80; C no discrimina IVA)
- Notas de crédito y débito asociadas a facturas existentes
- Cálculo automático de IVA y totales (via SDK); el número se reserva como último autorizado + 1 y las emisiones se serializan por punto de venta y tipo
- Condición de IVA del receptor (RG 5616) obligatoria si está identificado: se toma del body o del cliente
  (con `docTipo` 99 el SDK envía Consumidor Final, 5)
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
- Un solo `WsaaClient` (`createWsaaClient` de arca-common) compartido por los 7 SDKs: mismos tickets, reloj y esperas de login
- Tickets de Acceso de WSAA persistidos en disco (`FileTicketStorage`): un reinicio no deja al server sin acceso (`ArcaTicketVigenteError`)
- Tras un error permanente de WSAA (certificado vencido o no confiable, `coe.notAuthorized`...) el servicio queda
  bloqueado hasta corregir la causa y llamar a `POST /api/afip/wsaa-reset` (botón "Reintentar autenticación" en
  Configuración) o generar/renovar el certificado
- Los SDKs se crean al primer uso: el server arranca sin certificado (para poder generarlo desde la UI) y las
  rutas de ARCA responden 503 con un mensaje claro hasta instalarlo
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
   - **Rechazada** (`ArcaWSFEError`, `ArcaAuthError` por WSFE 600/601 o `aprobada: false`) → no se emitió:
     se borra el registro y se informa el error (422/503/400).
   - **Incierta** (`ArcaResultadoIncierto`, o 10016 por número según `requiereRecuperacion`) → se espera
     `AFIP_RECOVERY_DELAY_MS` y se llama a `recuperarComprobante(intento)`:
     - `autorizado` → aprobada con el CAE recuperado.
     - `no_emitido` → se reenvía **una vez** con las mismas opciones (mismo número y fecha). Es seguro
       según el README: si el intento original llegara a autorizarse, ARCA rechaza el duplicado (10016).
       Si ARCA rechaza el reenvío (`ArcaWSFEError` salvo 6xx), con certeza no se emitió: se borra el
       registro (libera el número) y responde 422. Si el reenvío falla sin evaluar el comprobante
       (`ArcaAuthError`, incluido el 600/601 que desde arca-facturacion 6.1 llega así, el 602, red), sigue `"P"`.
     - `conflicto` → `resultado = "C"` (el número existe con otros datos): revisión manual. Lo encontrado se
       guarda en `emision.encontrado` en camelCase (`cbteFch`, `impTotal`, `docTipo`, `docNro`, `codAutorizacion`).
     - Sin certeza (no se pudo consultar ni reenviar) → sigue `"P"`; se reintenta con
       `POST /api/invoices/:id/recuperar` (también si el proceso se cayó durante el envío).

Migración: `20261101120000_add_invoice_emision` agrega `Invoice.emision` (JSONB) y un índice por `resultado`.

### Errores de ARCA

| Error del SDK | HTTP | Cuerpo |
| ------------- | ---- | ------ |
| `ArcaValidationError` | 400 | `field`, `details` (no se envió nada a ARCA) |
| `ArcaResultadoIncierto` / `ArcaResultadoInciertoExpo` | 502 | `uncertain: true`, `recuperacion` (intento / Id) |
| `ArcaConflictoExpo` | 409 | `details: { id, enviado, respuesta }`: el `Id` de WSFEX ya lo usaba otra solicitud; el comprobante no se autorizó |
| `ArcaTicketVigenteError` | 503 | `service` |
| `ArcaAuthError` | 503 | `retryable`, `faultCode`, `blocked` (WSAA bloqueó el servicio tras un error permanente: corregir y `POST /api/afip/wsaa-reset`). Incluye WSFE 600/601 (`faultCode: "600"`) |
| `ArcaPadronServiceError` | 404 (`inexistente`, también "No existe persona" de la constancia), 422 (`inactiva`), 400 (`id_invalido`), 502 (`no_autorizado`) | `reason`, `errors` |
| `ArcaAgroServiceError` con `uncertain` | 502 | `uncertain: true`, `errors`: hubo errores pero también resultado (CTG/COE): consultar antes de reintentar |
| `ArcaWSFEError` (incluido 602) y otros `ArcaServiceError` | 422 | `errors` |
| `ArcaSoapError` | 502 (504 si fue timeout sin respuesta) | `soapFault`, `uncertain`, `upstreamStatus` (no se exponen `responseBody` ni `faultDetail`) |
| `ArcaResponseError` (incluye `ArcaAgroResponseError`) | 502 | `uncertain`: ARCA respondió con una forma inesperada |

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
| GET | `/api/afip/status` | Estado de WSFEv1 y WSFEX: `{ wsfe, wsfex }`, cada uno `{ ok: true, status: { appserver, dbserver, authserver } }` o `{ ok: false, error, status? }` (`ok` es false si algún servidor no está en OK) |
| POST | `/api/afip/wsaa-reset` | Vuelve a habilitar el login en WSAA tras corregir un error permanente (`resetLoginCooldown`) |
| GET | `/api/afip/contribuyente/:cuit` | Consulta padrón A4 (incluye `metadata`) + `condicionIvaSugerida` |
| GET | `/api/afip/comprobante` | Consultar comprobante (query: puntoVenta, cbteTipo, cbteNro). `resultGet` del SDK en camelCase (`cbteFch`, `impTotal`, `codAutorizacion`...) con `iva`, `tributos`, `cbtesAsoc`, `opcionales`, `observaciones` y `events` siempre como arrays |
| GET | `/api/afip/cotizacion` | Cotización (query: monedaId, fecha opcional). Devuelve `{ monId, monCotiz, fchCotiz }` |
| GET | `/api/afip/puntos-venta` | Puntos de venta habilitados: `[{ nro, emisionTipo?, bloqueado?, fchBaja? }]` |
| GET | `/api/afip/last-voucher` | Último comprobante (query: puntoVenta, cbteTipo): `{ cbteNro, ptoVta, cbteTipo }` |
| GET | `/api/afip/invoice-types` | Tipos de comprobante. Las tablas de parámetros devuelven `[{ id, desc, fchDesde?, fchHasta? }]` (condiciones de IVA: `{ id, desc, cmpClase? }`) |
| GET | `/api/afip/doc-types` | Tipos de documento |
| GET | `/api/afip/iva-types` | Alícuotas IVA |
| GET | `/api/afip/iva-conditions` | Condiciones frente al IVA |
| GET | `/api/afip/concept-types` | Tipos de concepto |
| GET | `/api/afip/currency-types` | Monedas |
| GET | `/api/afip/tributo-types` | Tipos de tributo |
| GET | `/api/afip/optional-types` | Datos opcionales |
| GET | `/api/afip/contribuyente-basic/:cuit` | Consulta padrón A10 (básico) |
| GET | `/api/afip/padron-status` | Estado por servicio (a5, a4, a10, a13, a100): `{ ok, status }` o `{ ok: false, error, status? }` |
| POST | `/api/afip/constatar` | Constatar comprobante via WSCDC. Body camelCase (`ConstatarInput` de arca-cdc): `cbteModo` (CAE/CAI/CAEA), `cuitEmisor`, `ptoVta`, `cbteTipo`, `cbteNro`, `cbteFch`, `impTotal`, `codAutorizacion`, `docTipoReceptor?`, `docNroReceptor?`, `opcionales?`. Devuelve `{ resultado, fchProceso, cmpResp?, observaciones, events }` |
| GET | `/api/afip/cdc-status` | Estado servicio WSCDC (`{ appserver, dbserver, authserver }`) |
| GET | `/api/afip/cdc-tipos-cbte` | Tipos de comprobante WSCDC (`[{ id, desc }]`) |
| GET | `/api/afip/fecred-status` | Estado WSFECRED |
| GET | `/api/afip/fecred-obligado/:cuit` | ¿Obligado a recibir FCE? (query `fechaEmision`, default hoy en Argentina) |
| POST | `/api/afip/fecred-ctas-ctes` | Cuentas corrientes FCE (`{ rol, cuitContraparte?, fecha? }`). Respuesta paginada `{ ctasCtes, nroPagina, hayMas }` |
| POST | `/api/afip/fecred-aceptar` | Aceptar FCE (`{ idCtaCte, saldoAceptado, codMoneda, cotizacionMonedaUlt, ... }`) |
| POST | `/api/afip/fecred-rechazar` | Rechazar FCE (`{ idCtaCte, motivos: [{ codMotivo, descMotivo, justificacion }] }`) |
| GET | `/api/afip/mtxca-status` | Estado WSMTXCA |
| POST | `/api/afip/mtxca-autorizar` | Autorizar con detalle de artículos (`ComprobanteType` del XSD; `condicionIVAReceptor` obligatoria). Resultado `R` → 422; aprobado incluye `urlQR` |
| GET | `/api/afip/mtxca-ultimo-comprobante` | Último comprobante MTXCA: `{ cbteNro, ptoVta, cbteTipo }` |
| GET | `/api/afip/sire-status` | Estado SIRE (incluye `headerInfo`: ambiente, fecha, versiones) |
| POST | `/api/afip/sire-emitir` | Emitir certificado de retención (`emitirCertificado`). Alias: `/api/afip/sire-retencion` |
| POST | `/api/afip/sire-anular` | Anular certificado (`{ numeroCertificado, motivoAnulacion, codigoTrazabilidad? }`) |
| GET | `/api/afip/agro-status` | Estado de WSCPE y WSLPG: `{ cpe, lpg }` con `{ ok, status }` o `{ ok: false, error, status? }` |
| POST | `/api/afip/agro-cpe-autorizar` | Autorizar Carta de Porte automotor (request según el XSD de WSCPE). El error 550 (PDF) vuelve en `advertencias` |
| POST | `/api/afip/agro-lpg-autorizar` | Autorizar liquidación de granos (`{ liquidacion, deducciones?, retenciones?, percepciones? }`). El error 1021 (PDF) vuelve en `advertencias` |
| POST | `/api/afip/empleados-generar` | Archivo de relaciones laborales (`{ registros: [{ tipo: alta\|baja\|modificacion\|novedad, data }], strict?, fechaReferencia? }`). `fechaInicio` obligatoria en todos los movimientos; propiedades desconocidas → 400. Con `?formato=txt` descarga el TXT (ISO-8859-1) |

**Cambio de contrato (arca-facturacion 6.1 / arca-common 0.7):** las respuestas de `/api/afip/*` usan los nombres
camelCase de los SDKs. Cambiaron `/status` (antes `{ AppServer, DbServer, AuthServer }`), `/comprobante`,
`/cotizacion`, `/puntos-venta`, las tablas de parámetros, `/cdc-tipos-cbte`, `/last-voucher`,
`/mtxca-ultimo-comprobante` (antes `{ CbteNro }`) y el body/respuesta de `/constatar` (un body PascalCase responde 400).
Las integraciones por API key que leían los nombres viejos tienen que actualizarse.

**Eliminados** (no existen en ARCA): `POST /api/afip/agro-ctg-solicitar` (WSCTG derogado, el CTG viene en la
respuesta de WSCPE), `POST /api/afip/sire-consultar`, `GET /api/afip/sire-regimenes` y
`DELETE /api/afip/sire-anular/:nro` (ahora `POST /api/afip/sire-anular`).

### AFIP — Certificados

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| POST | `/api/afip/generate-cert` | Generar certificado AFIP (timeout: 2min) |
| POST | `/api/afip/renew-cert` | Renovar certificado (alias nuevo) |
| GET | `/api/afip/cert-info` | Expiración del cert actual (días restantes) |
| POST | `/api/afip/test-cert` | Verificar el cert contra WSAA (`environment`: `production` o `testing`); el ticket queda en el storage de los SDKs |

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
| `/configuracion` | Configuración | Generar/renovar cert, verificar cert, estado de WSFEv1/WSFEX, reintentar autenticación WSAA, info sistema |
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

- `tests/arca-sdk.test.ts`: API de los SDKs (formatDate de common, QR, calcularTotales, armarComprobante y las
  validaciones de 6.1, requiereRecuperacion, errores, validación de CUIT/certificado, `wsaa` compartido, archivo
  de empleados) e integración con homologación (`describe.skipIf`: requiere `ARCA_INTEGRATION=1`, `AFIP_CUIT` y
  `backend/certs/cert.crt` + `key.key`).
- `tests/afip-routes.e2e.test.ts`: rutas `/api/afip` con los SDKs reales y ARCA simulado (`mockFetchWith` de
  `@ramiidv/arca-common/testing`): WSAA compartido, shapes camelCase, 600 → 503, bloqueo de WSAA y `/wsaa-reset`.
- `tests/arca-service.test.ts`: el server arranca sin certificados (SDKs lazy, 503 al usarlos).
- `tests/errorHandler.test.ts`: mapeo de cada error de los SDKs a HTTP.
- `tests/invoice.service.test.ts`: flujo incierto → recuperar con el SDK y Prisma mockeados.
- `tests/afip-empleados.route.test.ts`: `/empleados-generar` con `?formato=txt`, `fechaInicio` y `fechaReferencia`.

## Licencia

MIT
