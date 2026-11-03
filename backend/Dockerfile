# --- Build stage ---
FROM node:22-alpine AS builder

WORKDIR /app

# El schema tiene que estar antes de `npm ci`: el postinstall corre `prisma generate`.
COPY package.json package-lock.json* prisma.config.ts ./
COPY prisma ./prisma/
RUN npm ci

COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# --- Production stage ---
FROM node:22-alpine

WORKDIR /app

# /app/certs (certificado y clave) y /app/tickets (Tickets de Acceso de WSAA) se montan como
# volúmenes con nombre: al crearse toman este dueño, así el server puede escribir el
# certificado que genera desde la UI (POST /api/afip/generate-cert).
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
  && mkdir -p /app/certs /app/tickets \
  && chown appuser:appgroup /app/certs /app/tickets \
  && chmod 700 /app/certs /app/tickets

COPY package.json package-lock.json* prisma.config.ts ./
COPY prisma ./prisma/
# El CLI de prisma queda en dependencies porque el CMD corre `prisma migrate deploy`; su
# postinstall descarga los engines (el cliente que usa la app ya está compilado en dist/).
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
