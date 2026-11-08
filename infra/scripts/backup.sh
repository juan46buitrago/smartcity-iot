#!/usr/bin/env bash
# SmartCityBGA — copia de seguridad diaria (se ejecuta EN LA VM, dentro de ~/smartcity-iot).
#
#   bash infra/scripts/backup.sh            # crea backups/AAAA-MM-DD/{influx/, smartcity.sqlite}
#
# - InfluxDB: `influx backup` completo (buckets raw y agg_5m, metadatos) con el token de administrador.
# - SQLite: copia en caliente consistente con la API de backup de better-sqlite3 (soporta WAL).
# - Rotación: conserva los últimos KEEP_DAYS días (7 por defecto).
#
# Cron sugerido (03:15 hora de Colombia):
#   15 3 * * * cd ~/smartcity-iot && bash infra/scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/../.."
KEEP_DAYS="${KEEP_DAYS:-7}"
DAY="$(TZ=America/Bogota date +%F)"
DEST="backups/$DAY"
mkdir -p "$DEST"
chmod 700 backups

TOKEN="$(grep -E '^INFLUX_ADMIN_TOKEN=' .env | cut -d= -f2-)"
[ -n "$TOKEN" ] || { echo "✘ INFLUX_ADMIN_TOKEN no está en .env" >&2; exit 1; }

echo "[$(date -u +%FT%TZ)] InfluxDB → $DEST/influx"
docker compose exec -T influxdb sh -c "rm -rf /tmp/scbga-backup && influx backup /tmp/scbga-backup -t \"\$0\" >/dev/null" "$TOKEN"
rm -rf "$DEST/influx"
docker compose cp influxdb:/tmp/scbga-backup "$DEST/influx" >/dev/null
docker compose exec -T influxdb rm -rf /tmp/scbga-backup

echo "[$(date -u +%FT%TZ)] SQLite → $DEST/smartcity.sqlite"
docker compose exec -T backend node -e "
const D = require('better-sqlite3');
new D('/app/data/smartcity.sqlite', { readonly: true }).backup('/app/data/backup.sqlite').then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });"
docker compose cp backend:/app/data/backup.sqlite "$DEST/smartcity.sqlite" >/dev/null
docker compose exec -T backend rm -f /app/data/backup.sqlite

chmod -R go-rwx "$DEST"
find backups -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "[$(date -u +%FT%TZ)] ✔ Copia completa: $(du -sh "$DEST" | cut -f1)"
