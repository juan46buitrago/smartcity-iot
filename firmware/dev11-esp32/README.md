# DEV11 — Nodo ESP32 «real» (Wokwi o hardware físico)

Firmware de un ESP32 que se conecta **por Internet** al broker Mosquitto de SmartCityBGA con **MQTT sobre TLS (puerto 8883)** y cumple el mismo contrato que los dispositivos virtuales DEV01–DEV10 (`packages/shared`). El mismo `sketch.ino` funciona en el simulador [Wokwi](https://wokwi.com) y en un ESP32 físico.

- Sensores: DHT22 (temperatura, humedad) y fotorresistencia/LDR (luz %).
- Actuador: relé (y un LED indicador). Modo `auto`: el relé se activa cuando `light_pct < light_threshold_pct`; modo `manual`: lo fija la orden `set_params {relay}`.
- Catálogo: `DEV11`, `source_type = "real"`, categoría ambiente, ubicación «Campus UNAB (aprox.)».

> **Honestidad de los datos.** En Wokwi el firmware, la conexión MQTT y el TLS son reales, pero los valores de los sensores los fija una persona con los controles deslizantes del simulador. Por eso el firmware publica `provenance.synthetic = true`. En un ESP32 físico con sensores reales ponga `SYNTHETIC_DATA false` en `sketch.ino` (y ajuste `PROVIDER`).

## Archivos

| Archivo | Para qué |
|---|---|
| `sketch.ino` | Firmware (Arduino core ESP32). |
| `diagram.json` | Circuito de Wokwi. |
| `libraries.txt` | Librerías de Wokwi: PubSubClient, DHT sensor library for ESPx, ArduinoJson (v7). |
| `secrets.h.example` | Plantilla de credenciales. Copiar a `secrets.h` (ignorado por Git). |
| `wokwi.toml` | Solo para la extensión Wokwi de VS Code. |
| `samples/*.json` | Mensajes tal como los construye el firmware; `packages/shared/src/schemas.test.ts` los valida contra los esquemas zod (el contrato queda verificado por pruebas). |

## Conexiones

| Componente | Pin del ESP32 | Nota |
|---|---|---|
| DHT22 SDA | GPIO15 | VCC a 3V3, GND a GND |
| Módulo fotorresistencia AO | GPIO34 | Entrada ADC (solo lectura). VCC 3V3, GND |
| LED + resistencia 220 Ω | GPIO2 | Refleja el estado del relé |
| Módulo relé IN | GPIO4 | VCC a 5V (VIN), GND |

El módulo de Wokwi entrega más voltaje con menos luz; el firmware lo compensa con `LDR_INVERTIDO 1`. Con un LDR físico en divisor LDR→GND cambie a `0`.

## Ejecutar en Wokwi (extensión de VS Code) — recomendado

La extensión no compila: carga el binario que indica `wokwi.toml` (`build/dev11-esp32.ino.bin`).
Si ese archivo no existe, el simulador **no carga**.

1. Cree `secrets.h` desde `secrets.h.example` con la contraseña MQTT de DEV11 (está en
   `~/smartcity-iot/.local-credentials.txt` de la VM). `secrets.h` y `build/` están en `.gitignore`.
2. Compile (≈ 2,5 min la primera vez; instala el core ESP32 y las librerías si faltan):
   ```bash
   bash firmware/dev11-esp32/build.sh
   ```
3. En VS Code abra `firmware/dev11-esp32/diagram.json` y ejecute **Wokwi: Start Simulator**
   (F1). La primera vez la extensión pide activar la licencia gratuita en el navegador.
4. En la app, DEV11 pasa a «En línea» y responde a las órdenes del panel.

Cada vez que cambie `sketch.ino` o `secrets.h`, vuelva a correr `build.sh`.

## Ejecutar en la VM, bajo demanda (Wokwi CLI)

DEV11 corre en la VM **solo cuando alguien lo enciende desde la página** y se apaga solo si nadie la mira. Así sirve para demostraciones sin gastar simulador el resto del tiempo. Los sensores quedan fijos en los valores de `diagram.json` (24,5 °C, 60 %).

```
navegador ──► backend (/api/dev11, operador) ──► controlador (VM, :8790, token) ──► wokwi-cli ──► MQTT/TLS 8883
```

- **Encender/apagar:** en la ficha de DEV11 (`/dispositivos/DEV11`) el botón «Encender para la demostración» (pide la sesión de operador). El simulador tarda 1–2 min en conectarse.
- **Apagado automático:** mientras alguien tenga una pestaña visible, la web renueva un «arriendo» de 150 s (`POST /api/dev11/ping`). Sin latidos el controlador lo apaga. Tope por sesión: 90 min.
- **Límite de la cuenta gratis de Wokwi:** cada simulación se corta a los 5 min; el controlador la relanza mientras haya arriendo (se ve un par de cortes cortos de DEV11).
- **Cuota mensual de la cuenta gratis:** Wokwi CI da una cantidad limitada de minutos al mes. Si se agota, el simulador no arranca: tras 3 intentos fallidos rápidos el controlador se detiene y la ficha de DEV11 muestra «No pudo arrancar…». Mientras tanto DEV11 se puede ejecutar con la extensión de VS Code (sección de arriba), que no usa minutos de CI, o con un ESP32 físico.
- **Seguridad:** el controlador solo acepta peticiones con `Authorization: Bearer $CTL_TOKEN`, que conoce únicamente el backend (`DEV11_CTL_TOKEN` en el `.env`). El navegador nunca lo ve; encender y apagar exigen operador, el ping es público pero solo renueva un arriendo ya activo.

Instalación (una vez), con `~/dev11/` en la VM:

1. Token de Wokwi CI: wokwi.com/dashboard/ci. Es secreto; no lo pegue en el chat ni en Git.
2. Compile en su PC (`bash firmware/dev11-esp32/build.sh`) y copie a `~/dev11/`: `wokwi.toml`, `diagram.json`, `build/dev11-esp32.ino.{bin,elf}` y `vm/`.
3. En la VM: `curl -L https://wokwi.com/ci/install.sh | sh`
4. `~/dev11/controller.env` (permisos 600) con `CTL_TOKEN=<aleatorio de 32+ caracteres>` y `WOKWI_CLI_TOKEN=<token de Wokwi>`.
5. `sudo cp ~/dev11/vm/dev11-controller.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now dev11-controller`
6. En el `.env` del servidor: `DEV11_CTL_URL=http://host.docker.internal:8790` y `DEV11_CTL_TOKEN=<el mismo CTL_TOKEN>`; luego desplegar (`bash infra/scripts/deploy.sh backend`).
7. Logs (monitor serie del ESP32): `journalctl -u dev11-controller -f`

El puerto 8790 no está abierto en el NSG de Azure: solo lo alcanza el backend por la red de Docker.

## Ejecutar en wokwi.com (navegador)

1. Cree la contraseña de DEV11 en el servidor (ver «Producción» abajo) y téngala a mano. **No la pegue en el chat ni en Git.**
2. En wokwi.com cree un proyecto **ESP32** (Arduino).
3. Reemplace el contenido de `sketch.ino` y `diagram.json` con los de esta carpeta, y el de `libraries.txt` en la pestaña *Library Manager*.
4. Cree un archivo nuevo `secrets.h` (botón *New file*) copiando `secrets.h.example` y poniendo la contraseña real en `MQTT_PASS`. Wokwi guarda el proyecto en su nube: **use un proyecto privado** y no comparta el enlace con la contraseña.
5. Ejecute (▶). En el monitor serie verá `[WIFI]`, `[NTP]`, `[MQTT] Conectado` y `[TEL] #n …`. Mueva los deslizadores del DHT22 y del sensor de luz para variar las lecturas.

Wokwi se conecta con la red virtual `Wokwi-GUEST` (sin clave) y sale a Internet por su pasarela.

## ESP32 físico

1. Instale el core *esp32 by Espressif* y las tres librerías (Arduino IDE o `arduino-cli`).
2. Copie `secrets.h.example` a `secrets.h` y ponga su WiFi y la contraseña MQTT de DEV11.
3. Si el sketch no está en una carpeta del mismo nombre, Arduino IDE lo pedirá: renombre `sketch.ino` a `dev11-esp32.ino` en una carpeta `dev11-esp32/`.
4. Cambie `SYNTHETIC_DATA` a `false` y revise `LDR_INVERTIDO`.
5. Compile y suba: `arduino-cli compile --fqbn esp32:esp32:esp32 dev11-esp32` y `arduino-cli upload -p COMx --fqbn esp32:esp32:esp32 dev11-esp32`.

## Tópicos (contrato MQTT)

| Tópico | Dirección | Retenido | Contenido |
|---|---|---|---|
| `smartcity/DEV11/telemetry` | publica | no | Lecturas cada `interval_s` (por defecto 10 s). |
| `smartcity/DEV11/status` | publica | sí | `online` al conectar; el **LWT** (QoS1, retenido) publica `offline` si se cae. |
| `smartcity/DEV11/config` | publica | sí | Configuración vigente (modo, intervalo, umbrales, calibración, parámetros, versión). |
| `smartcity/DEV11/control` | suscribe | — | Órdenes del backend / Node-RED. |
| `smartcity/DEV11/ack` | publica | no | Confirmación de cada orden. |

Variables de telemetría: `temperature` (°C), `humidity` (%), `light_pct` (%), `relay` (0/1). Si el DHT22 falla, se publica `status: "degraded"` sin temperatura/humedad.

Limitaciones de PubSubClient: publica con QoS 0 (el LWT y la suscripción sí usan QoS 1). La configuración (modo, intervalo, umbrales, calibración) vive en RAM: tras un reinicio vuelve a los valores por defecto del catálogo.

## Órdenes

Se envían desde la API/panel (el backend las valida con el mismo catálogo). Formato en `smartcity/DEV11/control`:

```json
{"command_id":"<uuid>","action":"set_params","params":{"relay":true},"issued_at":"2026-11-08T15:00:00Z","issued_by":"operador"}
```

Reglas del firmware: ignora `command_id` repetidos (últimos 16; reenvía el mismo ack), rechaza órdenes con `issued_at` de más de 60 s de antigüedad y valida rangos.

| `action` | `params` | Efecto |
|---|---|---|
| `power` | `{"on":false}` | Apaga/enciende la telemetría (el estado sigue `online`, `state: stopped`); el relé se desactiva mientras está apagado. |
| `set_interval` | `{"interval_s":5}` | Entero 2–300. |
| `set_mode` | `{"mode":"manual"}` | `auto` o `manual`. |
| `set_params` | `{"relay":true}` / `{"light_threshold_pct":45}` | Relé manual (boolean) y umbral de luz 0–100 para el modo auto. |
| `set_thresholds` | `{"variable":"temperature","threshold":{"warn_high":28,"crit_high":32}}` | Guarda los umbrales (`temperature` o `humidity`); la evaluación de alertas la hace el backend. |
| `calibrate` | `{"variable":"humidity","offset":-3.5}` | Offset −20…20 sumado a la lectura. |
| `restart` | `{}` | Publica `offline` («reinicio solicitado») y ejecuta `ESP.restart()`. |

Ack: `{"command_id","device_id":"DEV11","action","ok","error?","timestamp","config_version?"}`.

## Seguridad

- **TLS 1.2+** en el puerto 8883 con el certificado de Let's Encrypt del dominio del servidor. El firmware valida al broker con la CA raíz **ISRG Root X1** incrustada en `sketch.ino` (vence en 2035). Si Let's Encrypt cambia a otra raíz (p. ej. ISRG Root X2), actualice el PEM.
- La validación del certificado necesita la hora: por eso el firmware sincroniza NTP antes de conectar.
- **Credencial propia** (`DEV11` / `MQTT_PASS_DEV11`) con ACL de mínimo privilegio: solo escribe en `smartcity/DEV11/{telemetry,status,config,ack,events}` y solo lee `smartcity/DEV11/control`. El broker no admite acceso anónimo.
- La contraseña vive solo en `secrets.h` (ignorado por Git, `firmware/**/secrets.h`) y en el `.env` del servidor. Nunca la suba al repositorio ni la pegue en chats; si se expone, regenérela (`MQTT_PASS_DEV11` en `.env` y reinicie Mosquitto).
- El puerto 1883 (sin TLS) sigue siendo interno de Docker.

## Producción (resumen; el despliegue lo hace el operador)

1. En la VM: `bash infra/scripts/setup.sh` completa `MQTT_PASS_DEV11` en `.env` sin tocar los demás valores y anota la contraseña en `.local-credentials.txt` (línea `DEV11_MQTT`).
2. Abrir el puerto **8883/TCP** en el NSG de Azure (y en el firewall de la VM si lo hay).
3. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` (recrea `mosquitto` con el volumen de Let's Encrypt y el puerto 8883).
4. Comprobar: `openssl s_client -connect smartcitybga.duckdns.org:8883 -servername smartcitybga.duckdns.org </dev/null` y los logs de `mosquitto` («listener TLS 8883 habilitado»).
5. Tras cada renovación del certificado (~60 días) el entrypoint copia los archivos nuevos y envía SIGHUP; si el broker sigue sirviendo el anterior: `docker compose -f docker-compose.yml -f docker-compose.prod.yml restart mosquitto`.
