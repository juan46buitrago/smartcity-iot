# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/devices/package.json apps/devices/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci -w @scbga/shared -w @scbga/devices --include-workspace-root=false --ignore-scripts
COPY packages/shared packages/shared
COPY apps/devices apps/devices
RUN npm run build -w @scbga/shared && npm run build -w @scbga/devices

# ---------- runtime ----------
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/devices/package.json apps/devices/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci -w @scbga/shared -w @scbga/devices --include-workspace-root=false --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/devices/dist apps/devices/dist
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
WORKDIR /repo/apps/devices
CMD ["node", "dist/index.js"]
