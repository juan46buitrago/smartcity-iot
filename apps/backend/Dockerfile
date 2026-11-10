# ---------- dependencias + build ----------
FROM node:24-alpine AS build
# Herramientas por si better-sqlite3 no tiene binario precompilado para la plataforma.
RUN apk add --no-cache python3 make g++
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/devices/package.json apps/devices/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci -w @scbga/shared -w @scbga/backend --include-workspace-root=false
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN npm run build -w @scbga/shared && npm run build -w @scbga/backend

# ---------- pruebas (docker build --target test) ----------
FROM build AS test
# Las pruebas del contrato MQTT validan las muestras que publica el firmware DEV11.
COPY firmware/dev11-esp32/samples firmware/dev11-esp32/samples
RUN npx -w @scbga/shared vitest run && npx -w @scbga/backend vitest run

# ---------- dependencias de producción ----------
FROM build AS prod-deps
RUN npm prune --omit=dev -w @scbga/shared -w @scbga/backend --include-workspace-root=false && npm cache clean --force

# ---------- runtime ----------
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prod-deps /repo/node_modules node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/backend/package.json apps/backend/
COPY --from=build /repo/apps/backend/dist apps/backend/dist
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
WORKDIR /repo/apps/backend
EXPOSE 3000
CMD ["node", "dist/index.js"]
