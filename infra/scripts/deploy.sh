#!/usr/bin/env bash
# SmartCityBGA — despliegue reproducible a la VM desde Git Bash / Linux.
#
#   bash infra/scripts/deploy.sh                    # todos los servicios (compose solo recrea lo que cambió)
#   bash infra/scripts/deploy.sh backend web        # solo esos servicios (menor hueco de captura)
#
# Qué hace:
#   1. Exige un árbol de trabajo limpio: se despliega exactamente el commit HEAD.
#   2. Empaqueta los archivos VERSIONADOS con `git archive` (nunca .env, claves ni credenciales)
#      y los extrae en ~/smartcity-iot de la VM. El .env y los volúmenes de la VM no se tocan.
#   3. `docker compose up -d --build <servicios>` (COMPOSE_FILE del .env de la VM fija base + prod).
#   4. Verifica /api/health por HTTPS y deja constancia del commit desplegado en la VM (DEPLOYED).
#
# Variables: SSH_KEY (por defecto ./vm-smartcity-iot_key.pem), VM (azureuser@158.23.162.76),
#            DOMAIN (smartcitybga.duckdns.org).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
SSH_KEY="${SSH_KEY:-vm-smartcity-iot_key.pem}"
VM="${VM:-azureuser@158.23.162.76}"
DOMAIN="${DOMAIN:-smartcitybga.duckdns.org}"
SSH=(ssh -i "$SSH_KEY" -o ConnectTimeout=15 -o BatchMode=yes "$VM")

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "✘ Hay cambios sin commit. Haga commit antes de desplegar." >&2
  exit 1
fi
COMMIT="$(git rev-parse --short HEAD)"
SERVICES=("$@")
echo "→ Desplegando $COMMIT en $VM (${SERVICES[*]:-todos los servicios})"

"${SSH[@]}" true || { echo "✘ Sin SSH. Si cambió su IP: infra/scripts/ssh-allow-ip.ps1" >&2; exit 1; }

git archive --format=tar HEAD | "${SSH[@]}" "mkdir -p ~/smartcity-iot && tar -x -C ~/smartcity-iot"
"${SSH[@]}" "cd ~/smartcity-iot && echo '$COMMIT $(date -u +%FT%TZ)' >> DEPLOYED && docker compose up -d --build ${SERVICES[*]:-} && docker image prune -f >/dev/null && docker compose ps --format '{{.Name}}\t{{.Status}}'"

echo "→ Verificando https://$DOMAIN/api/health"
for i in $(seq 1 20); do
  if curl -fsS -m 10 "https://$DOMAIN/api/health" | grep -q '"status":"ok"'; then
    echo "✔ Producción sana con $COMMIT"
    exit 0
  fi
  sleep 3
done
echo "✘ /api/health no respondió ok tras el despliegue" >&2
exit 1
