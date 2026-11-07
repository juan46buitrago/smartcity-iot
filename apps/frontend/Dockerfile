# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/devices/package.json apps/devices/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci -w @scbga/shared -w @scbga/frontend --include-workspace-root=false --ignore-scripts
COPY packages/shared packages/shared
COPY apps/frontend apps/frontend
RUN npm run build -w @scbga/shared && npm run build -w @scbga/frontend

# ---------- runtime: Nginx sirve la SPA y hace de proxy inverso ----------
FROM nginx:1.27-alpine
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/snippets /etc/nginx/snippets
# Producción (HTTPS): plantillas y script que elige la configuración según PUBLIC_DOMAIN y el certificado.
COPY infra/nginx/prod/https.conf.template infra/nginx/prod/bootstrap.conf.template /etc/nginx/scbga-prod/
COPY --chmod=755 infra/nginx/prod/40-scbga-tls.sh /docker-entrypoint.d/40-scbga-tls.sh
COPY --from=build /repo/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80 443
