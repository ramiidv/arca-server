# ARCA Server

Sistema de facturación electrónica integrado con ARCA (ex AFIP, Argentina). Backend + Frontend full-stack para emitir facturas, notas de crédito/débito, consultar comprobantes y gestionar certificados digitales, todo contra los web services oficiales de ARCA.

## Stack

- **Backend:** Node.js 20.19+ o 22.12+ (las imágenes Docker usan Node 22), Express 5.2, TypeScript 6, Prisma 7 (driver adapter), PostgreSQL, Zod 4
- **Frontend:** React 19.2, Vite 8, Tailwind CSS 4 (@tailwindcss/vite), React Hook Form 7
- **Facturación:** [@ramiidv/arca-facturacion](https://www.npmjs.com/package/@ramiidv/arca-facturacion) ^6.1 — WSFEv1, QR y resultado incierto (`recuperarComprobante`). API en camelCase.
  El SDK también soporta CAEA y exportación (WSFEX), pero el server no los expone: emite por WSFEv1 con CAE
  (Facturas, NC y ND A/B/C) y de WSFEX solo consulta el estado (`GET /api/afip/status`)
- **Padrón:** [@ramiidv/arca-padron](https://www.npmjs.com/package/@ramiidv/arca-padron) ^0.7 — A4, A10, A13, A100, constancia, `condicionIvaDesdePadron`
- **Constatación:** [@ramiidv/arca-cdc](https://www.npmjs.com/package/@ramiidv/arca-cdc) ^0.6 — WSCDC (camelCase)
- **FECRED:** [@ramiidv/arca-fecred](https://www.npmjs.com/package/@ramiidv/arca-fecred) ^0.6 — Factura de Crédito Electrónica MiPyME
- **MTXCA:** [@ramiidv/arca-mtxca](https://www.npmjs.com/package/@ramiidv/arca-mtxca) ^0.6 — Facturación con detalle de artículos
- **SIRE:** [@ramiidv/arca-sire](https://www.npmjs.com/package/@ramiidv/arca-sire) ^0.5 — Certificados de retención de IVA (C2005)
- **Agro:** [@ramiidv/arca-agro](https://www.npmjs.com/package/@ramiidv/arca-agro) ^0.6 — WSCPE y WSLPG (WSCTG fue derogado)
- **Empleados:** [@ramiidv/arca-empleados](https://www.npmjs.com/package/@ramiidv/arca-empleados) ^0.5 — Ingreso masivo de relaciones laborales (TXT de ancho fijo, 130 posiciones)
- **Common:** [@ramiidv/arca-common](https://www.npmjs.com/package/@ramiidv/arca-common) ^0.7 — WSAA (un `WsaaClient` compartido por todos los SDKs), `FileTicketStorage`, SOAP con fallback TLS legacy, validadores
- **Certificados:** [arca-cert](https://www.npmjs.com/package/arca-cert) — Generación automática de certificados de ARCA
- **Infra:** Docker Compose, Nginx

## Features

### Facturación

- Factura A, B, C con validación por tipo (A requiere receptor con CUIT, `docTipo` 80; C no discrimina IVA)
- Notas de crédito y débito asociadas a facturas existentes
- Cálculo automático de IVA y totales (via SDK); el número se reserva como último autorizado + 1 y las emisiones se serializan por punto de venta y tipo.
  La serialización es en memoria, dentro de un proceso: no cubre varias instancias del backend contra la misma base
  (corré una sola réplica, o agregá un lock compartido, por ejemplo un advisory lock de Postgres)
- Condición de IVA del receptor (RG 5616) obligatoria si está identificado: se toma del body o del cliente
  (con `docTipo` 99 el SDK envía Consumidor Final, 5)
- **Emisión segura:** la factura se guarda como pendiente con el intento *antes* de enviarla; un resultado incierto nunca se da por rechazado (ver [Resultado incierto](#resultado-incierto))
- QR oficial de ARCA (`arca.urlQR`) generado y persistido por factura
- Concepto: 1 Productos (default en la API y en la UI), 2 Servicios, 3 Productos y Servicios. Las fechas de servicio
  (`fchServDesde`, `fchServHasta`, `fchVtoPago`) solo se envían con concepto 2 o 3 (default: hoy)
- Puntos de venta dinámicos cargados desde ARCA
- Resultado de comprobante: Aprobada (A) / Pendiente de recuperación (P) / Conflicto (C)
- Filtros por tipo de comprobante, estado, cliente (`clientId`, con búsqueda por nombre o documento en la UI) y rango de fechas
- Paginación con 20 registros por página (`page` y `limit` en la API)
- Observaciones: notas internas que se guardan solo en la base local; no se envían a ARCA

### Certificados

- Generación automática de certificados de ARCA desde la UI (via arca-cert), solo para administradores
- Renovación de certificados con alias temporal
- Verificación del certificado contra WSAA en el ambiente activo del server
- Visualización de expiración y días restantes (alerta si quedan menos de 30 días)
- Hot-reload del SDK al generar/renovar (sin reiniciar server)
- **El certificado se genera para la CUIT y el ambiente del server** (`AFIP_CUIT` y `AFIP_PRODUCTION`): se rechaza
  (400) generar o renovar uno de otra CUIT o de otro ambiente, porque instalado no funcionaría y reemplazaría al
  que sí funciona. Para cambiar de CUIT o de ambiente, cambiá esas variables, reiniciá el server y generá el
  certificado de nuevo. Un certificado de homologación no sirve en producción ni al revés

### Clientes

- CRUD de clientes con búsqueda (por nombre o número de documento)
- Auto-completar datos desde CUIT via padrón de ARCA (A4): nombre, domicilio y condición IVA sugerida (`condicionIvaDesdePadron`)
- Protección contra eliminación: no se puede borrar un cliente que tiene facturas asociadas

### ARCA

- Consulta de comprobantes en ARCA por punto de venta, tipo y número
- Constatación de comprobantes propios o de terceros (WSCDC) con modalidad CAE/CAI/CAEA y CUIT del emisor
- Parámetros de referencia con tabs (comprobantes, documentos, IVA, Cond. IVA, conceptos, monedas, tributos)
- Cotización oficial de monedas
- Estado de los servidores de ARCA en el dashboard y en Configuración
- Ambiente activo (homologación/producción) y CUIT del server en el sidebar (`GET /api/afip/config`)

### Observabilidad

- Logging de eventos de todos los SDKs (`onEvent`): auth login/cache-hit/clock-skew/storage-error, request end/retry/error
- Un solo `WsaaClient` (`createWsaaClient` de arca-common) compartido por los 7 SDKs: mismos tickets, reloj y esperas de login
- Tickets de Acceso de WSAA persistidos en disco (`FileTicketStorage`): un reinicio no deja al server sin acceso (`ArcaTicketVigenteError`)
- Tras un error permanente de WSAA (certificado vencido o no confiable, `coe.notAuthorized`...) el servicio queda
  bloqueado hasta corregir la causa y llamar a `POST /api/afip/wsaa-reset` (botón "Reintentar autenticación" en
  Configuración) o generar/renovar el certificado
- Los SDKs se crean al primer uso: el server arranca sin certificado (para poder generarlo desde la UI) y las
  rutas de ARCA responden 503 con un mensaje claro hasta instalarlo
- Tiempos de respuesta de cada request a ARCA
- Retries automáticos con backoff exponencial

### Seguridad

- Helmet con CSP, HSTS (1 año), referrer-policy, frame-ancestors: none
- API keys hasheadas con SHA-256 (solo se muestran una vez al crearlas, máximo 5 por usuario)
- JWT con secreto obligatorio (sin defaults inseguros; Docker Compose no arranca sin `JWT_SECRET`)
- DATABASE_URL obligatorio (sin defaults inseguros)
- **Registro cerrado:** `POST /api/auth/register` es público solo mientras no hay usuarios (el primero queda como
  admin). Después, solo un admin puede crear usuarios (desde Configuración > Crear Usuario, o la misma ruta con su
  token o API key)
- **Rol admin:** generar y renovar el certificado (`/api/afip/generate-cert`, `/api/afip/renew-cert`) y crear
  usuarios requieren rol admin (403 si no). Las API keys son siempre del usuario que las crea y actúan con su rol
- Rate limiting: 200 req/15min global, 20 req/15min para endpoints de auth (más los límites de nginx en Docker).
  Detrás de un proxy, `TRUST_PROXY` hace que el límite cuente por IP real del cliente
- CORS restrictivo (`CORS_ORIGIN`, lista separada por comas; default: `http://localhost:5173` en dev,
  `http://localhost` en Docker Compose, donde la UI y la API comparten origen)
- Body limit 1MB
- Manejo de errores del SDK con SOAP fault parsing y hints contextuales
- Errores de ARCA con sus códigos y mensajes (`10015: ...`) y errores de validación con el campo, en español

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

- Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` (`engines` de los `package.json`; lo exigen Prisma 7, Vite 8 y los
  SDKs, que se cargan con `require(esm)`). Las imágenes Docker usan Node 22
- PostgreSQL 17+ (o Docker para levantar el del `docker-compose.yml`)
- Certificado de ARCA (se puede generar desde la UI con clave fiscal)

### Archivos `.env`

| Archivo | Lo usa | Para qué |
| ------- | ------ | -------- |
| `.env` (raíz, desde `.env.example`) | Docker Compose | Variables del stack completo en contenedores: `DB_*`, `JWT_SECRET`, `AFIP_CUIT`, `AFIP_PRODUCTION`, `CORS_ORIGIN`, `TRUST_PROXY`, `APP_PORT`. Compose arma `DATABASE_URL` y fija las rutas del certificado y los tickets |
| `backend/.env` (desde `backend/.env.example`) | El backend en desarrollo local (`npm run dev`) | Todas las variables del backend, incluido `DATABASE_URL` |

Variables del backend:

| Variable | Obligatoria | Default | Descripción |
| -------- | ----------- | ------- | ----------- |
| `DATABASE_URL` | Sí | — | Conexión a PostgreSQL |
| `JWT_SECRET` | Sí | — | Secreto para firmar los JWT (`openssl rand -hex 32`) |
| `JWT_EXPIRES_IN` | No | `7d` | Duración del token |
| `PORT` | No | `3001` | Puerto del backend |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Orígenes permitidos, separados por coma (`*` permite cualquiera; no recomendado) |
| `TRUST_PROXY` | No | `false` | `trust proxy` de Express. Detrás de nginx: `1` (cantidad de proxies). Acepta `true`, un número o IPs/subredes. Sin proxy dejalo sin definir: si no, un cliente podría falsear `X-Forwarded-For` y saltear el rate limit |
| `AFIP_CUIT` | Para operar con ARCA | — | CUIT que factura (se valida el dígito verificador). El certificado tiene que ser de esta CUIT |
| `AFIP_PRODUCTION` | No | `false` | `false` = homologación, `true` = producción. El certificado tiene que ser de este ambiente |
| `AFIP_CERT_PATH` / `AFIP_KEY_PATH` | No | `backend/certs/cert.crt` / `backend/certs/key.key` | Certificado y clave: los leen los SDKs y los escribe "Generar certificado". Rutas relativas al directorio desde el que corre el server |
| `AFIP_PUNTO_VENTA` | No | `1` | Punto de venta por defecto |
| `AFIP_TICKETS_DIR` | No | `backend/certs/tickets` | Tickets de Acceso de WSAA (token/sign: tratalo como un secreto; el directorio se crea con permisos 0700) |
| `AFIP_RECOVERY_DELAY_MS` | No | `3000` | Espera antes de consultar una factura con resultado incierto |

> Producción de WSFEv1 en Node >= 17 funciona gracias al fallback TLS legacy de arca-common (`legacyTls: "auto"`, default).

### Primer arranque (desarrollo local)

```bash
# 1. Dependencias de la raíz, backend y frontend + cliente de Prisma
npm run setup

# 2. PostgreSQL del docker-compose.yml (queda en localhost:5433, solo accesible desde la máquina host)
npm run db:up                  # = docker compose up -d postgres

# 3. Variables del backend
cp backend/.env.example backend/.env
#    Completá JWT_SECRET (openssl rand -hex 32) y AFIP_CUIT. El DATABASE_URL del ejemplo
#    (postgresql://arca:arca_dev_2024@localhost:5433/arca_facturacion) coincide con los valores
#    por defecto del compose; si definiste DB_USER/DB_PASSWORD/DB_NAME en el .env de la raíz, usá esos.

# 4. Migraciones
npm run db:migrate             # = cd backend && npx prisma migrate dev

# 5. Backend (http://localhost:3001) y frontend (http://localhost:5173) juntos
npm run dev
```

Abrí http://localhost:5173: como todavía no hay usuarios, el login ofrece crear la cuenta de administrador. Después
el registro se cierra y los demás usuarios los crea un admin desde **Configuración**.

Otros scripts de la raíz: `dev:backend`, `dev:frontend`, `db:generate` (cliente de Prisma) y `db:studio`. No hay
seed: los datos se cargan desde la UI o la API.

### Generar certificado de ARCA

Desde la UI (como admin): **Configuración** > **Generar Certificado** (necesitás clave fiscal nivel 3+). La CUIT y el
ambiente son los del server (`AFIP_CUIT`, `AFIP_PRODUCTION`); un pedido con otra CUIT u otro ambiente se rechaza con
400. **Antes de generar un certificado de producción**, poné `AFIP_PRODUCTION=true` y reiniciá el server: si no,
el server está en homologación y rechaza el pedido.

Via API (token o API key de un admin):

```bash
curl -X POST http://localhost:3001/api/afip/generate-cert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"cuit":"20123456786","password":"clave-fiscal","alias":"mi-sistema"}'
```

`environment` (`testing` o `production`) es opcional: default el ambiente activo; otro valor responde 400. El
certificado y la clave se guardan en `AFIP_CERT_PATH` y `AFIP_KEY_PATH` (en dev, `backend/certs/`) y los SDKs se
recargan automáticamente con la CUIT y el ambiente del server.

### Docker

```bash
cp .env.example .env     # completá JWT_SECRET (obligatorio) y AFIP_CUIT (obligatorio)
docker compose up -d --build
```

La app queda en http://localhost (`APP_PORT`): nginx sirve el frontend y hace de proxy de `/api`. El backend
también se publica en `127.0.0.1:3001` (solo desde la máquina host). Compose no arranca sin `JWT_SECRET` ni
`AFIP_CUIT`.

- **Certificados:** el backend usa el volumen con nombre `arca-certs`, montado con escritura en `/app/certs`
  (`AFIP_CERT_PATH=/app/certs/cert.crt`, `AFIP_KEY_PATH=/app/certs/key.key`), así que "Generar certificado" desde
  la UI funciona y el certificado persiste entre reinicios. Para instalar uno que ya tenés:

  ```bash
  docker compose cp backend/certs/cert.crt backend:/app/certs/cert.crt
  docker compose cp backend/certs/key.key backend:/app/certs/key.key
  docker compose exec -u root backend chown appuser:appgroup /app/certs/cert.crt /app/certs/key.key
  docker compose restart backend
  ```

  Si preferís un bind mount (`./backend/certs:/app/certs`), el directorio del host tiene que poder escribirlo el
  usuario `appuser` del contenedor; si no, generar el certificado falla con `EACCES`.
- **Tickets de WSAA:** volumen `arca-tickets` en `/app/tickets`.
- **Proxy:** `TRUST_PROXY=1` (default del compose) para que el rate limit vea la IP real. nginx espera hasta 130 s
  en `/api/invoices` y `/api/afip/*` (emisiones, recuperación, generar certificado: el frontend espera hasta
  120 s) y 30 s en el resto de `/api`.

## API Endpoints

### Autenticación y formato de respuesta

**Rutas públicas** (sin credenciales): `GET /api/health`, `POST /api/auth/login`,
`GET /api/auth/registration-status` y `POST /api/auth/register` mientras no haya usuarios. Todo lo demás
(`/api/invoices`, `/api/clients`, `/api/afip`, `/api/auth/me`, `/api/auth/api-keys`) requiere uno de:

- `Authorization: Bearer <jwt>`: el token que devuelven login o el primer registro (vence según `JWT_EXPIRES_IN`).
- `X-API-Key: arca_...`: una API key creada en `/api/auth/api-keys` (actúa con el usuario y el rol de su dueño).

**Sobres de respuesta:**

| Caso | Forma |
| ---- | ----- |
| Éxito con datos | `{ "success": true, "data": ... }` |
| Login y primer registro | `{ "success": true, "token": "<jwt>", "user": { id, email, name, role } }` |
| Alta de usuario por un admin, `GET /api/auth/me` | `{ "success": true, "user": { ... } }` |
| API keys | `{ "success": true, "apiKeys": [...] }` (listado), `{ "success": true, "apiKey": { id, name, key, createdAt } }` (alta) |
| Listados paginados (`GET /api/invoices`, `GET /api/clients`) | `{ "success": true, "data": [...], "pagination": { page, limit, total, totalPages } }`. Query `page` (entero ≥ 1, default 1) y `limit` (1 a 100, default 20); fuera de rango, 400 |
| Error | `{ "success": false, "error": "<mensaje en español>", ... }` más, según el caso, `code`, `errors` (errores u observaciones de ARCA: `[{ code, msg }]`), `details` (por ejemplo, los issues de validación `[{ path, message }]`), `field`, `uncertain`, `soapFault` |

**Códigos de error:**

| HTTP | Cuándo |
| ---- | ------ |
| 400 | Datos inválidos (validación de la API o `ArcaValidationError` del SDK: no se envió nada a ARCA) |
| 401 | Falta el token o la API key, o son inválidos/vencidos |
| 403 | La operación requiere rol admin, o el registro está cerrado |
| 404 | No existe el recurso (factura, cliente, CUIT en el padrón) |
| 409 | Conflicto: email ya registrado, cliente con facturas, comprobante pendiente de recuperación del mismo tipo y punto de venta, generación de certificado en curso, dos registros simultáneos (reintentar) |
| 413 | Body de más de 1 MB |
| 422 | ARCA rechazó la operación (por ejemplo, `ArcaWSFEError` o factura con `aprobada: false`): ver `errors` |
| 429 | Rate limit |
| 502 / 504 | ARCA no respondió bien o no respondió (puede venir `uncertain: true`: consultar antes de reintentar) |
| 503 | Sin certificado instalado, o WSAA rechazó la autenticación (`ArcaAuthError`, `ArcaTicketVigenteError`) |

Ver también [Errores de ARCA](#errores-de-arca).

### Health

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/api/health` | Health check (público, sin auth) |

### Autenticación

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/api/auth/registration-status` | Público: `{ open }`, true solo si todavía no hay usuarios |
| POST | `/api/auth/register` | Sin usuarios: público, crea el primer usuario como admin y devuelve token. Con usuarios: solo admin (`{ email, password, name, role? }` con `role` `user` o `admin`), no devuelve token; sin credenciales responde 403 |
| POST | `/api/auth/login` | Login, retorna JWT |
| GET | `/api/auth/me` | Usuario autenticado |
| GET | `/api/auth/api-keys` | Listar API keys (máscara, no el key real) |
| POST | `/api/auth/api-keys` | Crear API key (se muestra una sola vez) |
| DELETE | `/api/auth/api-keys/:id` | Eliminar API key |

### Facturas

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| POST | `/api/invoices` | Crear factura (A/B/C). 201 aprobada, 202 pendiente/conflicto, 422 rechazada por ARCA. `concepto` opcional (default 1, Productos; las fechas de servicio solo se usan con 2 o 3). `condicionIva` opcional (si no, la del cliente). `observations` se guarda solo localmente |
| POST | `/api/invoices/nota-credito` | Crear nota de crédito (ídem) |
| POST | `/api/invoices/nota-debito` | Crear nota de débito (ídem) |
| POST | `/api/invoices/:id/recuperar` | Reintentar la recuperación de una factura pendiente (P) o en conflicto (C) |
| GET | `/api/invoices` | Listar paginado (`page`, `limit`; filtros: `cbteTipo`, `clientId`, `resultado` (`A`, `P` o `C`), `from`, `to` con fechas YYYYMMDD). Un filtro inválido responde 400 |
| GET | `/api/invoices/stats` | Estadísticas del dashboard (solo aprobadas): `totalCount` (todos los comprobantes), `invoiceCount`, `creditNoteCount`, `debitNoteCount`, `totalAmount`, `monthlyInvoices` (solo facturas), `monthlyCreditNotes`, `monthlyDebitNotes`, `monthlyAmount` (mes calendario de Argentina según la fecha del comprobante), `byType`, `pendingCount`. Los montos son facturas + ND − NC |
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
   - **Rechazada** → no se emitió: se borra el registro y se informa el error. `ArcaWSFEError` y `aprobada: false`
     responden 422 con los códigos de ARCA en `errors` (`[{ code, msg }]`) y en el mensaje
     (`ARCA rechazó el comprobante: 10048: ...`); `ArcaAuthError` (WSFE 600/601) responde 503.
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
| `ArcaWSFEError` (incluido 602) y otros `ArcaServiceError` | 422 | `errors` (`[{ code, msg }]`); el mensaje incluye los códigos (`ARCA rechazó la solicitud: 10015: ...`) |
| Factura con `aprobada: false` (rechazo con observaciones) | 422 | `errors` y `details` con las observaciones de ARCA |
| `ArcaSoapError` | 502 (504 si fue timeout sin respuesta) | `soapFault`, `uncertain`, `upstreamStatus` (no se exponen `responseBody` ni `faultDetail`) |
| `ArcaResponseError` (incluye `ArcaAgroResponseError`) | 502 | `uncertain`: ARCA respondió con una forma inesperada |

### Clientes

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/api/clients` | Listar paginado (`page`, `limit`; filtro `search` por nombre o documento) |
| POST | `/api/clients` | Crear cliente |
| GET | `/api/clients/:id` | Detalle con cantidad de facturas |
| PUT | `/api/clients/:id` | Actualizar cliente |
| DELETE | `/api/clients/:id` | Eliminar (falla si tiene facturas) |

### ARCA — Parámetros, Padrón y Constatación

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/api/afip/config` | Configuración activa del server: `{ environment, cuit, puntoVenta }` (`environment`: `testing` o `production`, según `AFIP_PRODUCTION`; no consulta a ARCA) |
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

**Cambios de contrato (correcciones de la auditoría):** `POST /api/invoices` usa `concepto` 1 (Productos) por
defecto (antes 2); un rechazo con `aprobada: false` responde 422 (antes 400) con `errors`; los mensajes de error
están en español e incluyen los códigos de ARCA; `POST /api/auth/register` se cierra después del primer usuario;
generar/renovar certificado requiere admin y rechaza otra CUIT u otro ambiente; `POST /api/afip/test-cert` usa el
ambiente activo por defecto (antes producción); `/api/invoices/stats` agrega cantidades por clase
(`invoiceCount`, `creditNoteCount`, `debitNoteCount`) y del mes (`monthlyInvoices`, `monthlyCreditNotes`,
`monthlyDebitNotes`, `monthlyAmount`), y sus montos restan las notas de crédito, y ya no devuelve `recentInvoices`
(el dashboard usa `GET /api/invoices`); `generate-cert` ya no devuelve `certPath`/`keyPath`; `GET /api/invoices` y
`GET /api/clients` responden 400 con `page`/`limit` o filtros inválidos (antes se ignoraban o daban 500).

**Eliminados** (no existen en ARCA): `POST /api/afip/agro-ctg-solicitar` (WSCTG derogado, el CTG viene en la
respuesta de WSCPE), `POST /api/afip/sire-consultar`, `GET /api/afip/sire-regimenes` y
`DELETE /api/afip/sire-anular/:nro` (ahora `POST /api/afip/sire-anular`).

### ARCA — Certificados

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| POST | `/api/afip/generate-cert` | **Admin.** Generar certificado (`{ cuit, password, alias, environment? }`). La CUIT tiene que ser `AFIP_CUIT` y el ambiente el activo (`AFIP_PRODUCTION`); si no, 400 (503 si `AFIP_CUIT` no está configurada). Se guarda en `AFIP_CERT_PATH`/`AFIP_KEY_PATH`; si no se puede escribir, 500 con la causa (permisos, solo lectura, sin espacio). Una segunda generación mientras hay otra en curso responde 409. Responde `{ alias, cuit, environment, message }`. El frontend espera hasta 120 s |
| POST | `/api/afip/renew-cert` | **Admin.** Renovar certificado (alias nuevo). Mismas reglas |
| GET | `/api/afip/cert-info` | Expiración del certificado de `AFIP_CERT_PATH` (`notBefore`, `notAfter`, `daysLeft`, `expired`); `null` si no hay certificado |
| POST | `/api/afip/test-cert` | Verificar el certificado contra WSAA. `environment` (`production` o `testing`) opcional: default el ambiente activo. El ticket queda en el storage de los SDKs |

## Frontend

### Páginas

| Ruta | Página | Descripción |
| ---- | ------ | ----------- |
| `/` | Dashboard | Stats: cantidad de facturas (con NC y ND aparte), monto total (facturas + ND − NC), facturas y monto del mes; facturas recientes, estado de ARCA |
| `/facturas` | Facturas | Lista con filtros por tipo, estado, cliente y fecha (`?clientId=` abre la lista filtrada), paginación, botón Recuperar en pendientes |
| `/facturas/nueva` | Nueva Factura | Formulario tipo-aware (A/B/C) con cálculo en vivo |
| `/facturas/nota` | NC / ND | Crear nota de crédito o débito desde factura existente |
| `/facturas/:id` | Detalle | Factura completa con items, totales, CAE, QR, botón NC/ND; aviso y reintento de recuperación si quedó pendiente |
| `/clientes` | Clientes | Lista con búsqueda y paginación |
| `/clientes/nuevo` | Nuevo Cliente | Formulario con lookup CUIT desde el padrón de ARCA |
| `/clientes/:id/editar` | Editar Cliente | Mismo formulario en modo edición |
| `/consulta` | Consultar Cbte. | Buscar comprobante en ARCA por PV + tipo + número y constatarlo (WSCDC) |
| `/parametros` | Parámetros ARCA | Tabs: comprobantes, documentos, IVA, Cond. IVA, conceptos, monedas, tributos + cotización |
| `/configuracion` | Configuración | Generar/renovar cert (admin, CUIT y ambiente del server), verificar cert en el ambiente activo, estado de WSFEv1/WSFEX, reintentar autenticación WSAA, crear usuarios (admin), info sistema |
| `/api-keys` | API Keys | Crear, listar y eliminar API keys |
| `/login` | Login | Email + contraseña |
| `/register` | Registro | Solo para crear el primer usuario (admin); después muestra que el registro está cerrado |

### Navegación (Sidebar)

- **General:** Dashboard
- **Facturación:** Facturas, Nueva Factura, NC / ND
- **Gestión:** Clientes, Nuevo Cliente
- **ARCA:** Consultar Cbte., Parámetros
- **Sistema:** API Keys, Configuración
- Pie: ambiente activo del server (Homologación / Producción) y CUIT, desde `GET /api/afip/config`

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
ARCA_INTEGRATION=1 AFIP_CUIT=20XXXXXXXXX npm test # + integración con ARCA homologación (emite comprobantes)
```

- `tests/arca-sdk.test.ts`: API de los SDKs (formatDate de common, QR, calcularTotales, armarComprobante y las
  validaciones de 6.1, requiereRecuperacion, errores, validación de CUIT/certificado, `wsaa` compartido, archivo
  de empleados) e integración con homologación (`describe.skipIf`: requiere `ARCA_INTEGRATION=1`, `AFIP_CUIT` y
  `backend/certs/cert.crt` + `key.key`).
- `tests/afip-routes.e2e.test.ts`: rutas `/api/afip` con los SDKs reales y ARCA simulado (`mockFetchWith` de
  `@ramiidv/arca-common/testing`): WSAA compartido, shapes camelCase, 600 → 503, bloqueo de WSAA y `/wsaa-reset`,
  `/config`, `/cert-info` y `/test-cert` con el ambiente activo, generar el certificado (se instala y no expone
  rutas), el rechazo de generar/renovar certificados de otra CUIT, otro ambiente o sin rol admin, y 409 con una
  generación en curso.
- `tests/arca-service.test.ts`: el server arranca sin certificados (SDKs lazy, 503 al usarlos).
- `tests/auth.routes.test.ts`: registro cerrado (primer usuario admin con token, 403 sin credenciales o sin rol
  admin, alta por un admin sin token, `registration-status`, dos primeros registros simultáneos) y 403 en
  generar/renovar certificado para no admins, con `authMiddleware` real y Prisma en memoria; error de escritura
  del certificado traducido sin rutas.
- `tests/listados.routes.test.ts`: `page`/`limit` y filtros de `GET /api/invoices` y `GET /api/clients` (400 si son
  inválidos o están fuera de rango).
- `tests/config.test.ts`: parseo de `TRUST_PROXY`.
- `tests/errorHandler.test.ts`: mapeo de cada error de los SDKs a HTTP, mensajes en español con los códigos de ARCA
  y los campos de Zod, Prisma P2034 (409) y body inválido (400) o demasiado grande (413).
- `tests/invoice.service.test.ts`: flujo incierto → recuperar con el SDK y Prisma mockeados, rechazo con
  `aprobada: false` (422 con `errors`), concepto por defecto (1) y estadísticas del dashboard (mes y notas de crédito).
- `tests/afip-empleados.route.test.ts`: `/empleados-generar` con `?formato=txt`, `fechaInicio` y `fechaReferencia`.

## Licencia

MIT
