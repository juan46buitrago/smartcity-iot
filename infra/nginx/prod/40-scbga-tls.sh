#!/bin/sh
# Elige la configuración de Nginx al arrancar (lo ejecuta el entrypoint oficial de la imagen nginx).
#  - Sin PUBLIC_DOMAIN       → configuración local por HTTP (default.conf tal cual).
#  - Con dominio y sin cert. → arranque: solo desafío ACME.
#  - Con dominio y cert.     → HTTPS completo + redirección; recarga cada 6 h para tomar renovaciones.
set -eu
CONF=/etc/nginx/conf.d/default.conf
TPL=/etc/nginx/scbga-prod

[ -z "${PUBLIC_DOMAIN:-}" ] && exit 0

case "$PUBLIC_DOMAIN" in
  *[!a-zA-Z0-9.-]*) echo "scbga-tls: PUBLIC_DOMAIN no válido" >&2; exit 1 ;;
esac

if [ -s "/etc/letsencrypt/live/$PUBLIC_DOMAIN/fullchain.pem" ]; then
  envsubst '${PUBLIC_DOMAIN}' < "$TPL/https.conf.template" > "$CONF"
  echo "scbga-tls: HTTPS activo para $PUBLIC_DOMAIN"
else
  cp "$TPL/bootstrap.conf.template" "$CONF"
  echo "scbga-tls: sin certificado todavía; solo desafío ACME en :80"
fi

# Recarga periódica para aplicar certificados renovados por el contenedor certbot.
( while sleep 21600; do nginx -s reload 2>/dev/null || true; done ) &
