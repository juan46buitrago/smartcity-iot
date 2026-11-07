#!/bin/sh
# Arranque de Node-RED para SmartCityBGA:
#  1. Copia los flujos versionados (repo, solo lectura) al directorio de usuario.
#  2. Genera las credenciales del broker desde el entorno (nunca se versionan).
set -eu
cp /flows-src/flows.json /data/flows.json
node -e 'require("fs").writeFileSync("/data/flows_cred.json", JSON.stringify({ cfg_broker: { user: "nodered", password: process.env.MQTT_PASS_NODERED } }), { mode: 0o600 })'
exec ./entrypoint.sh "$@"
