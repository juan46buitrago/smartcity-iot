#!/bin/sh
# Genera el archivo de contraseñas de Mosquitto a partir de variables de entorno.
# Las contraseñas nunca se escriben en el repositorio ni en la imagen.
set -eu
PASSWD=/mosquitto/run/passwd
mkdir -p /mosquitto/run
: > "$PASSWD"
add_user() {
  user="$1"; pass="$2"
  if [ -z "$pass" ]; then echo "ERROR: falta la contraseña de $user" >&2; exit 1; fi
  mosquitto_passwd -b "$PASSWD" "$user" "$pass"
}
add_user backend "${MQTT_PASS_BACKEND:-}"
add_user nodered "${MQTT_PASS_NODERED:-}"
for i in 01 02 03 04 05 06 07 08 09 10 11; do
  eval "pass=\${MQTT_PASS_DEV$i:-}"
  add_user "DEV$i" "$pass"
done

# --- Listener TLS 8883 (solo producción) -------------------------------------------------------
# El compose de producción monta el volumen de Let's Encrypt en /etc/letsencrypt (solo lectura) y define
# PUBLIC_DOMAIN. Si existe el certificado, se habilita el listener 8883 para dispositivos externos (DEV11).
# En local no hay certificados: solo queda el listener interno 1883. mosquitto.conf incluye /mosquitto/run/conf.d.
CONF_D=/mosquitto/run/conf.d
CERT_DIR=/mosquitto/certs
LE_DIR="/etc/letsencrypt/live/${PUBLIC_DOMAIN:-}"
mkdir -p "$CONF_D"
rm -f "$CONF_D"/*.conf
copy_certs() {
  # La clave privada de Let's Encrypt es de root (0600): se copia a un directorio propiedad de mosquitto.
  mkdir -p "$CERT_DIR"
  cp -L "$LE_DIR/fullchain.pem" "$CERT_DIR/fullchain.pem.new"
  cp -L "$LE_DIR/privkey.pem" "$CERT_DIR/privkey.pem.new"
  chown mosquitto:mosquitto "$CERT_DIR"/*.new
  chmod 0644 "$CERT_DIR/fullchain.pem.new"
  chmod 0600 "$CERT_DIR/privkey.pem.new"
  mv "$CERT_DIR/fullchain.pem.new" "$CERT_DIR/fullchain.pem"
  mv "$CERT_DIR/privkey.pem.new" "$CERT_DIR/privkey.pem"
  chown mosquitto:mosquitto "$CERT_DIR"
  chmod 0750 "$CERT_DIR"
}
TLS_ENABLED=0
case "${PUBLIC_DOMAIN:-}" in
  *[!a-zA-Z0-9.-]*) echo "ERROR: PUBLIC_DOMAIN no válido" >&2; exit 1 ;;
esac
if [ -n "${PUBLIC_DOMAIN:-}" ] && [ -s "$LE_DIR/fullchain.pem" ] && [ -s "$LE_DIR/privkey.pem" ]; then
  copy_certs
  cat > "$CONF_D/tls.conf" <<EOF
# Generado por docker-entrypoint.sh (no editar): listener MQTT sobre TLS para dispositivos externos.
listener 8883 0.0.0.0
protocol mqtt
certfile $CERT_DIR/fullchain.pem
keyfile $CERT_DIR/privkey.pem
tls_version tlsv1.2
require_certificate false
EOF
  TLS_ENABLED=1
  echo "Mosquitto: listener TLS 8883 habilitado para $PUBLIC_DOMAIN"
else
  echo "Mosquitto: sin certificado Let's Encrypt; solo listener interno 1883 (sin TLS)"
fi
chown -R mosquitto:mosquitto /mosquitto/run /mosquitto/data
chmod 0700 /mosquitto/run
chmod 0600 "$PASSWD"
echo "Mosquitto: $(wc -l < "$PASSWD") usuarios cargados"

# Tras una renovación del certificado se copian los archivos nuevos y se envía SIGHUP (tras `exec`, $$ es
# el PID de mosquitto). Si su versión no recarga los certificados con SIGHUP, reinicie el servicio:
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml restart mosquitto
if [ "$TLS_ENABLED" = 1 ]; then
  (
    while sleep 43200; do
      if [ -s "$LE_DIR/fullchain.pem" ] && ! cmp -s "$LE_DIR/fullchain.pem" "$CERT_DIR/fullchain.pem"; then
        copy_certs && kill -HUP $$ && echo "Mosquitto: certificado renovado; recarga solicitada"
      fi
    done
  ) &
fi
exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
