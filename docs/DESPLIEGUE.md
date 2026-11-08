# SmartCityBGA — Etapa 4: despliegue en Azure

> Fecha: 2026-11-07 · VM existente `vm-smartcity-iot` (Standard B2as_v2, Ubuntu 24.04.5, 2 vCPU, 7,7 GB RAM)
> · IP 158.23.162.76 · **https://smartcitybga.duckdns.org**
> No se creó, contrató ni eliminó ningún recurso de Azure. Los únicos cambios en Azure son las reglas del NSG (§3).

## 1. Arquitectura en producción

```
Internet ──► NSG (22 solo IP del propietario · 80 · 443)
              │
              ▼
           Nginx (web) :80 → 301 HTTPS (y desafíos ACME) · :443 TLS Let's Encrypt
              ├── /            SPA React
              ├── /api/, /ws   backend (Fastify)       ┐
              ├── /grafana/    Grafana (login propio)   │ red interna Docker "iot"
              └── /nodered/    Node-RED (login propio)  │ (sin puertos publicados)
           Mosquitto · InfluxDB · devices · certbot     ┘
```

- `docker-compose.yml` (base) + `docker-compose.prod.yml` (puertos 80/443, TLS, certbot, Grafana con URL pública).
  En la VM, `COMPOSE_FILE` en `.env` fija esa combinación: `docker compose` nunca usa el override local.
- Nginx elige su configuración al arrancar (`infra/nginx/prod/40-scbga-tls.sh`): sin certificado solo atiende
  el desafío ACME; con certificado, HTTPS completo. Peticiones por IP o con otro nombre se cierran (444).
- Cabeceras: HSTS (1 año), CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Límites por IP en Nginx: API 20 r/s; inicio de sesión (app, Grafana y Node-RED) 10/min con ráfaga de 5.

## 2. Pasos ejecutados y verificación de cada uno

| # | Paso | Verificación (resultado real) |
|---|---|---|
| 0 | Comprobaciones previas | SSH con la clave del propietario ✔ · Docker 29.9.3 / Compose v5.7.0 ✔ · disco 26 GB libres · RAM 7,1 GB libres · solo SSH en escucha · UFW inactivo · hora sincronizada |
| 0 | Estado de DuckDNS | `smartcitybga.duckdns.org` ya resolvía a **158.23.162.76** → no se modificó |
| 1 | Vía de recuperación | `az vm run-command invoke` ejecuta comandos como root sin SSH ✔ (≈ 37 s) |
| 2 | Preparación de la VM | `azureuser` en el grupo `docker`; swap de 2 GB (swappiness 10); `unattended-upgrades` activo |
| 3 | Transferencia | 153 archivos versionables (1,3 MB); 0 con secretos; sin `.env`, credenciales, colección Postman ni override local |
| 3 | Secretos | `.env` **nuevo** generado en la VM (`setup.sh`): contraseñas, JWT y tokens de InfluxDB distintos de los locales; `.env` y `.local-credentials.txt` con permisos 600 |
| 4a | Mosquitto + InfluxDB | anónimo y contraseña incorrecta → `not authorised` ✔ · sin puertos publicados ✔ · buckets `raw` 30 d, `agg_5m` 1 año ✔ |
| 4b | Dispositivos | 10/10 conectados con credencial propia, estado retenido `online` ✔ · DEV06 en `simulated_route` (sin autorización de gpsmobile) |
| 4c | Node-RED | conectado al broker, contexto persistente activo, escribiendo en InfluxDB ✔ |
| 4d | Backend | `/api/health` ok (MQTT, InfluxDB, SQLite) ✔ · fuentes reales desde Azure: DEV02 y DEV10 Open-Meteo ✔, DEV09 IDEAM ✔ (última observación publicada 2026-11-05 23:00, retraso habitual de IDEAM) |
| 4e | Grafana + Nginx (arranque) | ambos sanos; solo `web` publica puertos (80/443) |
| 5 | NSG 80/443 | reglas `Allow-HTTP` (310) y `Allow-HTTPS` (320) ✔ |
| 5 | Certificado | prueba en staging ✔ → certificado real Let's Encrypt (emisor YE2), válido hasta **2027-02-05** ✔ · renovación simulada (`certbot renew --dry-run`) ✔ · renovación automática cada 12 h + recarga de Nginx cada 6 h |
| 6 | SSH restringido | regla `SSH` → solo la IP pública del propietario (/32) ✔ · SSH desde esa IP ✔ · Run Command sigue funcionando ✔ |
| 7 | Verificación externa | ver §4 |

## 3. Reglas del NSG `vm-smartcity-iot-nsg`

| Regla | Prioridad | Origen | Puerto | Antes |
|---|---|---|---|---|
| SSH | 300 | IP del propietario (/32) | 22 | `*` (todo Internet) |
| Allow-HTTP | 310 | Internet | 80 | — (nueva) |
| Allow-HTTPS | 320 | Internet | 443 | — (nueva) |
| SSH_ANY (2026-11-08) | 330 | **Cualquiera** | 22 | creada por el propietario al cambiar su IP — **restringir a /32** |
| MQTT-TLS (pendiente) | — | Internet | 8883 | necesaria para DEV11 (ESP32 en Wokwi) |

## 4. Verificación externa (desde Internet)

- `http://smartcitybga.duckdns.org/mapa` → **301** a `https://…/mapa`.
- `https://smartcitybga.duckdns.org/` → **200**, certificado verificado (Let's Encrypt), HSTS/CSP/XFO presentes.
- `/api/health` → `ok`; la interfaz carga y muestra datos en vivo por WebSocket seguro (10/10 nodos).
- `/nodered/flows` → **401**; `/grafana/api/search` → **401**.
- `http://158.23.162.76/` (acceso directo por IP) → conexión cerrada sin respuesta.
- Puertos desde Internet: **22, 80, 443 abiertos**; 1883, 8883, 8086, 1880, 3000, 3100, 9001 **cerrados/filtrados**.
- Control en producción: login incorrecto → 401; orden sin token → 401; orden DEV03 `set_interval` 10→11
  confirmada en 60 ms y revertida (confirmada).
- Memoria en uso tras el despliegue: ≈ 1,1 GB de 7,7 GB.

## 5. Operación

```bash
# Conectarse (desde la IP autorizada)
ssh -i <ruta-a-su-clave>.pem azureuser@158.23.162.76
cd ~/smartcity-iot

docker compose ps                     # estado (usa base + prod automáticamente)
docker compose logs -f --tail 100 backend
docker compose restart <servicio>
```

- **Si cambia su IP pública** y SSH deja de responder: `powershell -File infra\scripts\ssh-allow-ip.ps1`
  (actualiza la regla a su nueva IP /32; requiere `az login`). Recuperación sin SSH:
  `az vm run-command invoke -g rg-smartcity-iot -n vm-smartcity-iot --command-id RunShellScript --scripts "<comando>"`.
- **Credenciales de producción** (operador, Node-RED, Grafana): están solo en la VM, en
  `~/smartcity-iot/.local-credentials.txt` (permisos 600). Léalas usted en su propia terminal
  (`ssh … cat ~/smartcity-iot/.local-credentials.txt`), guárdelas en su gestor de contraseñas y, si quiere,
  borre después ese archivo. No se han mostrado ni copiado fuera de la VM.
- **Actualizar el código** (desde el PC, Git Bash, con el árbol limpio): `bash infra/scripts/deploy.sh [servicios…]`.
  Empaqueta solo los archivos versionados del commit HEAD (`git archive`), los extrae en la VM, ejecuta
  `docker compose up -d --build` y verifica `/api/health`. El `.env` y los volúmenes de la VM no se tocan; cada
  despliegue queda registrado en `~/smartcity-iot/DEPLOYED`. Para no cortar la captura, despliegue solo los
  servicios cambiados (p. ej. `backend web`): los dispositivos y Node-RED siguen escribiendo en InfluxDB.
- **Copias de seguridad** (en la VM): `bash infra/scripts/backup.sh` → `backups/AAAA-MM-DD/` (InfluxDB completo +
  SQLite en caliente), rotación de 7 días. Cron: `15 3 * * * cd ~/smartcity-iot && bash infra/scripts/backup.sh >> backups/backup.log 2>&1`.
- **Credenciales nuevas del GPS (DEV06)**: cuando las tenga y exista autorización, edite en la VM
  `GPS_API_BASE_URL`, `GPS_VEHICLE_PATH`, `GPS_API_USER`, `GPS_API_PASS`, `GPS_SOURCE=gpsmobile` y
  `GPS_USAGE_AUTHORIZED=true`, y ejecute `docker compose up -d devices`. Nunca reutilice la contraseña antigua.
- **Azure Maps**: la aplicación no usa Azure Maps (el mapa usa teselas de OpenStreetMap), así que no necesita
  ninguna clave. Las claves antiguas de la colección Postman siguen pendientes de rotación por el propietario.

## 6. Pendientes

| # | Pendiente | Responsable |
|---|---|---|
| 1 | Rotar las claves antiguas de Azure Maps y la contraseña anterior del GPS (no se afirma que estén rotadas) | Propietario |
| 2 | Autorización de uso de gpsmobile.co (DEV06 sigue en ruta simulada) | Propietario |
| 3 | Guardar las credenciales de producción en un gestor y retirar `.local-credentials.txt` de la VM | Propietario |
| 4 | ~~Copias de seguridad~~ → **hecho 2026-11-08**: `backup.sh` diario por cron (03:15 COT), 7 días | — |
| 5 | Observaciones O1–O6 de `PRUEBAS.md` (healthcheck de `devices`, cifrado de credenciales de Node-RED…) | Etapa 5 |
