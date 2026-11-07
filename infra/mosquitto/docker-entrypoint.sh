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
for i in 01 02 03 04 05 06 07 08 09 10; do
  eval "pass=\${MQTT_PASS_DEV$i:-}"
  add_user "DEV$i" "$pass"
done
chown -R mosquitto:mosquitto /mosquitto/run /mosquitto/data
chmod 0700 /mosquitto/run
chmod 0600 "$PASSWD"
echo "Mosquitto: $(wc -l < "$PASSWD") usuarios cargados"
exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
