#!/usr/bin/env bash
# =====================================================================
# SmartCityBGA — configuración inicial (local o VM). Idempotente.
#  1. Crea .env desde .env.example con secretos aleatorios (si no existe).
#  2. Genera hashes de las contraseñas del operador (scrypt) y de Node-RED (bcrypt).
#  3. Arranca InfluxDB y crea tokens de mínimo privilegio (escritura / lectura).
# Las contraseñas en claro se guardan SOLO en .local-credentials.txt (ignorado por Git, permisos 600).
# Uso: bash infra/scripts/setup.sh
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

ENV_FILE=.env
CRED_FILE=.local-credentials.txt
NODE_IMG=node:24-alpine
NODERED_IMG=nodered/node-red:4.0.9-22

rand() { openssl rand -hex "${1:-24}"; }
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'$//"; }
set_var() { # set_var CLAVE VALOR  (valor entre comillas simples: evita interpolación de '$')
  local key="$1" val="$2" tmp
  tmp=$(mktemp)
  awk -v k="$key" -v v="'$val'" 'BEGIN{done=0} $0 ~ "^"k"=" {print k"="v; done=1; next} {print} END{if(!done) print k"="v}' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}
fill_if_empty() { [ -n "$(get "$1")" ] || set_var "$1" "$2"; }

if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  echo "• Creado $ENV_FILE desde .env.example"
fi
chmod 600 "$ENV_FILE" 2>/dev/null || true

# --- Secretos aleatorios ---
for k in MQTT_PASS_BACKEND MQTT_PASS_NODERED MQTT_PASS_DEV01 MQTT_PASS_DEV02 MQTT_PASS_DEV03 MQTT_PASS_DEV04 \
         MQTT_PASS_DEV05 MQTT_PASS_DEV06 MQTT_PASS_DEV07 MQTT_PASS_DEV08 MQTT_PASS_DEV09 MQTT_PASS_DEV10 \
         INFLUX_ADMIN_PASSWORD NODERED_CREDENTIAL_SECRET GRAFANA_ADMIN_PASSWORD; do
  fill_if_empty "$k" "$(rand 18)"
done
fill_if_empty INFLUX_ADMIN_TOKEN "$(rand 32)"
fill_if_empty JWT_SECRET "$(rand 48)"

# --- Contraseña del operador (API) → hash scrypt ---
if [ -z "$(get ADMIN_PASSWORD_HASH)" ]; then
  OP_PASS=$(rand 9)
  HASH=$(docker run --rm -e P="$OP_PASS" "$NODE_IMG" node -e '
    const c=require("crypto");const s=c.randomBytes(16);const h=c.scryptSync(process.env.P,s,64,{N:16384,r:8,p:1});
    process.stdout.write(["scrypt",16384,8,1,s.toString("base64url"),h.toString("base64url")].join(":"));')
  set_var ADMIN_PASSWORD_HASH "$HASH"
  echo "OPERADOR_API usuario=$(get ADMIN_USER) contraseña=$OP_PASS" >> "$CRED_FILE"
fi

# --- Contraseña del editor Node-RED → hash bcrypt ---
if [ -z "$(get NODERED_ADMIN_HASH)" ]; then
  NR_PASS=$(rand 9)
  HASH=$(docker run --rm -e P="$NR_PASS" --entrypoint node "$NODERED_IMG" -e '
    const b=require("/usr/src/node-red/node_modules/bcryptjs");process.stdout.write(b.hashSync(process.env.P,10));')
  set_var NODERED_ADMIN_HASH "$HASH"
  echo "NODE_RED usuario=$(get NODERED_ADMIN_USER) contraseña=$NR_PASS" >> "$CRED_FILE"
fi

if ! grep -q '^GRAFANA' "$CRED_FILE" 2>/dev/null; then
  echo "GRAFANA usuario=$(get GRAFANA_ADMIN_USER) contraseña=$(get GRAFANA_ADMIN_PASSWORD)" >> "$CRED_FILE"
fi
chmod 600 "$CRED_FILE" 2>/dev/null || true

# Marcadores para que docker compose pueda interpolar antes de crear los tokens.
fill_if_empty INFLUX_WRITE_TOKEN pending
fill_if_empty INFLUX_READ_TOKEN pending

# --- Tokens de InfluxDB de mínimo privilegio ---
if [ "$(get INFLUX_WRITE_TOKEN)" = "pending" ] || [ "$(get INFLUX_READ_TOKEN)" = "pending" ]; then
  echo "• Arrancando InfluxDB para crear tokens…"
  docker compose up -d influxdb
  for i in $(seq 1 40); do
    if docker compose exec -T influxdb influx ping >/dev/null 2>&1 && \
       docker compose exec -T influxdb influx bucket list --name agg_5m --hide-headers >/dev/null 2>&1; then break; fi
    sleep 3
  done
  ORG=$(get INFLUX_ORG)
  bucket_id() { docker compose exec -T influxdb influx bucket list --org "$ORG" --name "$1" --hide-headers | awk '{print $1}'; }
  RAW_ID=$(bucket_id "$(get INFLUX_BUCKET_RAW)")
  AGG_ID=$(bucket_id "$(get INFLUX_BUCKET_AGG)")
  [ -n "$RAW_ID" ] && [ -n "$AGG_ID" ] || { echo "No se encontraron los buckets de InfluxDB" >&2; exit 1; }
  token_of() { sed -n 's/.*"token": *"\([^"]*\)".*/\1/p' | head -1; }
  W=$(docker compose exec -T influxdb influx auth create --org "$ORG" --write-bucket "$RAW_ID" \
        --description "nodered-write (solo escritura en raw)" --json | token_of)
  R=$(docker compose exec -T influxdb influx auth create --org "$ORG" --read-bucket "$RAW_ID" --read-bucket "$AGG_ID" \
        --description "backend/grafana-read (solo lectura)" --json | token_of)
  [ -n "$W" ] && [ -n "$R" ] || { echo "No se pudieron crear los tokens" >&2; exit 1; }
  set_var INFLUX_WRITE_TOKEN "$W"
  set_var INFLUX_READ_TOKEN "$R"
  echo "• Tokens de InfluxDB creados (escritura y lectura separados)"
fi

echo "✔ Configuración lista. Credenciales en claro: $CRED_FILE (no lo suba a Git)."
echo "  Siguiente paso: docker compose up -d --build"
