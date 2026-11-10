# SmartCityBGA — Etapa 3: pruebas

> Fecha: 2026-11-07 · Entorno: stack local con Docker Compose (Windows 11, Docker Desktop), 7 contenedores.
> Todas las cifras de este documento salen de ejecuciones reales; la evidencia completa está en
> [`docs/evidencias/etapa3/`](evidencias/etapa3/).

## 1. Resumen

| Nivel | Qué cubre | Resultado | Evidencia |
|---|---|---|---|
| Unitarias — contrato | Esquemas MQTT (telemetría, estado, config, órdenes, ack, incidentes), validación de órdenes | **11/11** | `unitarias-final.txt` |
| Unitarias — dispositivos | Modelo de incidentes (Monte Carlo 14 días), tráfico, adaptador GPS (lista blanca anti-PII) | **16/16** | `unitarias-final.txt` |
| Unitarias — Node-RED | Line protocol (escape, anti-inyección), incidentes, cola persistente con reintento, reglas con histéresis | **19/19** | `unitarias-final.txt` |
| Unitarias — backend | Autenticación scrypt, motor de alertas, detección de atípicos, ventanas de agregación | **9/9** (Node 24) | `unitarias-final.txt` |
| Integración (stack real) | Seguridad, API, broker/ACL, control bidireccional, LWT, persistencia y recuperación | **31/31** | `integracion-*.md / .json` |
| Dependencias | `npm audit` | **0 vulnerabilidades** | `unitarias-final.txt` |

> **2026-11-09:** simulación previa al lanzamiento (resiliencia, 5 usuarios simulados y regresión): ver
> [`QA-LANZAMIENTO.md`](QA-LANZAMIENTO.md). Desde entonces el frontend también tiene pruebas (`npm test -w @scbga/frontend`).

## 2. Cómo ejecutarlas

```bash
npm test                       # unitarias de shared, devices y backend (requiere Node ≥ 22)
npm run test:nodered           # funciones de Node-RED
docker build --target test -f apps/backend/Dockerfile .   # backend en Node 24
npm run test:integration       # batería completa contra el stack (≈ 8 min; reinicia servicios)
npm run test:integration:safe  # solo pruebas que no interrumpen servicios
```

La batería de integración lee `.env` y `.local-credentials.txt` solo en memoria y, antes de escribir la
evidencia, comprueba que ningún secreto aparezca en ella (si apareciera, aborta sin escribir).
Las pruebas que cambian configuración la revierten al terminar.

## 3. Pruebas de integración

Ejecución `integracion-2026-11-07T07-47-49` — 2026-11-07T07:47:49.300Z → 2026-11-07T07:54:24.262Z. **31 pasan · 0 fallan.**

| ID | Prueba | Resultado | Evidencia clave |
|---|---|---|---|
| INF-01 | Los 7 servicios están en ejecución y los que tienen healthcheck están sanos | ✅ pasa | 7 contenedores en ejecución; 6 con healthcheck sanos (devices no tiene, ver O1) |
| INF-02 | /api/health informa MQTT, InfluxDB y SQLite operativos | ✅ pasa | status ok; mqtt=true, influxdb=true, sqlite=true |
| SEC-01 | En local todos los puertos publicados están ligados solo a 127.0.0.1 | ✅ pasa | backend 127.0.0.1:3100, influxdb 127.0.0.1:8086, mosquitto 127.0.0.1:1883, web 127.0.0.1:8380 |
| SEC-02 | En la configuración de producción (sin override) solo nginx publica puertos | ✅ pasa | docker-compose.yml no publica ningún puerto (80/443 en Etapa 4) |
| SEC-03 | Nginx envía cabeceras de seguridad (CSP, anti-clickjacking, nosniff, referrer) | ✅ pasa | CSP con frame-ancestors 'none', X-Frame-Options DENY, nosniff, strict-origin-when-cross-origin |
| SEC-04 | Node-RED, Grafana e InfluxDB rechazan peticiones sin credenciales | ✅ pasa | GET /nodered/flows → 401; GET /grafana/api/search → 401; GET influxdb /api/v2/buckets → 401 |
| SEC-05 | El token de lectura de InfluxDB no puede escribir (mínimo privilegio) | ✅ pasa | escritura con token de lectura → 403 |
| SEC-06 | Archivos con secretos ignorados por Git y ningún secreto en archivos versionables | ✅ pasa | .env y .local-credentials.txt ignorados; 145 archivos revisados, 0 secretos; colección Postman no versionada |
| API-01 | Login: credenciales incorrectas → 401; correctas → JWT | ✅ pasa | incorrecta → 401; cuerpo inválido → 400; /me con JWT → 200 |
| API-02 | Endpoints de control protegidos: sin token, token falso o token alterado → 401 | ✅ pasa | sin token → 401; token inventado → 401; payload alterado → 401; reconocer alerta sin token → 401 |
| API-03 | Validación de entradas: acción, parámetros, rango, dispositivo y variable | ✅ pasa | 7 casos, todos 4xx (incl. inyección Flux → 404) |
| API-04 | Histórico y estadísticas devuelven datos reales almacenados | ✅ pasa | 338 puntos en 1 h; respuesta 46 ms |
| MQTT-01 | El broker rechaza conexiones anónimas y contraseñas incorrectas | ✅ pasa | anonima: rechazada (código 135); DEV01 contraseña incorrecta: rechazada (código 135); usuario inexistente: rechazada (código 135) |
| MQTT-02 | ACL: un dispositivo no puede escribir en tópicos de otro ni enviarse órdenes | ✅ pasa | PUBACK 135 (no autorizado) en ambos intentos; 0 mensajes entregados |
| MQTT-03 | ACL: un dispositivo no puede leer la telemetría ni las órdenes de otros | ✅ pasa | suscripción a +/telemetry, DEV05/control y #: 0 mensajes ajenos en 12 s |
| CTL-01 | Orden → ack → config retenida en los 10 dispositivos (vía API) | ✅ pasa | 10/10 confirmadas y revertidas; ida y vuelta mediana 84 ms, máx. 85 ms; config retenida publicada en las 10 |
| CTL-02 | Apagar/encender DEV03 detiene y reanuda realmente la telemetría | ✅ pasa | estado “stopped”; 0 telemetrías en 25 s apagado; reanuda en 0.5 s |
| CTL-03 | El dispositivo rechaza órdenes caducadas (> 60 s) y con parámetros inválidos | ✅ pasa | “Orden caducada (120 s)”; “interval_s: Too big: expected number to be <=300” |
| CTL-04 | Idempotencia: la misma orden entregada dos veces se aplica una sola vez | ✅ pasa | 2 acks idénticos; versión 36→37 (se aplicó una vez) |
| CTL-05 | Mensajes malformados en /control se descartan sin tumbar el dispositivo | ✅ pasa | 4 mensajes malformados (incl. 60 KB) → 0 acks; orden posterior confirmed |
| PER-01 | La telemetría publicada en MQTT llega a InfluxDB con el mismo timestamp y valor | ✅ pasa | mismo timestamp y valor en MQTT e InfluxDB (48.9 dB) |
| LWT-01 | Corte de red: LWT de los 10, órdenes bloqueadas y sin pérdida de lecturas (almacenar y reenviar) | ✅ pasa | 10 LWT en 47.2 s; orden → 409; lecturas del corte guardadas: 5 (esperadas ≈ 4); hueco máx. 10.0 s; 10/10 en línea en 5.1 s |
| LWT-02 | Caída abrupta del proceso (SIGKILL): LWT inmediato y la configuración sobrevive al reinicio | ✅ pasa | 10 LWT en 0.54 s; config conservada en los 10 |
| PER-02 | Reinicio de InfluxDB: no se pierde histórico y la cola de Node-RED reintenta sin huecos | ✅ pasa | reinicio 6.3 s; hueco máx. 10.0 s; histórico 24 h 1104→1110 |
| PER-03 | Reinicio de Node-RED: la sesión persistente MQTT entrega lo publicado mientras estaba caído | ✅ pasa | reinicio 6.4 s; hueco máx. 10.0 s (ventana con bordes) |
| PER-06 | Caída de InfluxDB de 60 s con reinicio de Node-RED en medio: la cola persistente no pierde datos | ✅ pasa | InfluxDB caído 65.8 s con Node-RED reiniciado en medio; lecturas guardadas 6 (esperadas ≈ 6); hueco máx. 10.0 s |
| PER-04 | Reinicio del broker: mensajes retenidos persisten y todos se reconectan | ✅ pasa | 10 configs retenidas; 10/10 en línea en 6.7 s |
| PER-05 | Reinicio del backend: órdenes y alertas en SQLite se conservan | ✅ pasa | órdenes 192→192, alertas 8→8 |
| SEC-08 | Límite de órdenes: más de 30 por minuto por cliente → 429 con Retry-After | ✅ pasa | 35 peticiones → 5 con 429, Retry-After 60 s |
| SEC-09 | Falsificar X-Forwarded-For no permite esquivar el límite de intentos de login | ✅ pasa | 401, 401, 401, 401, 429, 429 (cada intento con otra IP falsificada) |
| SEC-07 | Límite de intentos de login: el 6.º intento en un minuto → 429 | ✅ pasa | 429, 429, 429, 429, 429, 429, 429 |

Memoria al terminar: web 13.3MiB, backend 43.76MiB, nodered 54.49MiB, devices 38.14MiB, grafana 58.65MiB, mosquitto 1.289MiB, influxdb 65.61MiB.

**Cambio posterior (a petición del propietario, único operador):** se retiró el usuario “operador” de la
interfaz. El acceso a los controles pide solo la contraseña, la primera vez que se intenta controlar algo, y el
navegador recuerda la sesión 30 días (cierre de sesión en *Configuración*). Los endpoints de control siguen
protegidos. Verificado en la ejecución `integracion-2026-11-07T08-30-17` (modo seguro, 24/24): API-01 ahora
comprueba el login solo con contraseña (incorrecta → 401, sin contraseña → 400, correcta → 200) y la vigencia de
30 días del token; API-02 sigue devolviendo 401 en todos los intentos sin token válido.

## 4. Defectos reales encontrados por las pruebas y corregidos

| # | Defecto | Cómo se detectó | Corrección | Prueba que lo cubre |
|---|---|---|---|---|
| D1 | **Inyección en line protocol**: un texto con salto de línea partía la línea de InfluxDB en dos (DEV06 puede recibir textos de una API externa). | Unitaria nueva | `escStr`/`escTag` sustituyen `\r\n`; tags vacíos → `unknown`, máx. 64 caracteres | `functions.test.mjs` (2 casos) |
| D2 | **Un incidente con coordenadas ausentes envenenaba el lote**: `lat=NaN` → InfluxDB rechaza el lote entero (400) y se pierden también lecturas válidas de otros dispositivos. | Revisión al escribir las unitarias | `fn-incident.js` descarta solo ese evento si algún número no es finito | `functions.test.mjs` |
| D3 | **Pérdida de lecturas durante un corte de red**: `tick()` esperaba el PUBACK; con la red caída el dispositivo dejaba de medir (~4 lecturas perdidas en 45 s). | Integración (hueco de 46,7 s en InfluxDB) | Almacenar y reenviar: la publicación no bloquea la medición; cola QoS 1 de mqtt.js acotada a 2000 lecturas por dispositivo | LWT-01: lecturas del corte guardadas con su hora original |
| D4 | **Pérdida de datos al reiniciar Node-RED**: el lote del nodo `join` (hasta 5 s) y la cola de reintentos vivían en memoria. | Integración (hueco de 20 s en el reinicio, oculto al principio por un cálculo de huecos que no contaba los bordes) | Cola en contexto persistente en disco (`localfilesystem`, volcado cada 2 s y al detenerse) + envío por temporizador cada 2 s, una petición en vuelo | PER-03, PER-06 |
| D5 | **Se podía esquivar el límite de intentos de login** falsificando `X-Forwarded-For` (`trustProxy: true` toma la IP que pone el cliente). | Revisión de la evidencia de SEC-07 + prueba manual: 8 intentos sin 429 | nginx sobrescribe `X-Forwarded-For`; Fastify confía solo en un salto | SEC-09 |
| D6 | Los límites de nginx respondían **503** en vez de 429. | Evidencia de SEC-07 | `limit_req_status 429` | SEC-07 |
| D7 | Registro de Node-RED `InfluxDB no disponible ([object Object])`. | Logs durante PER-02 | Se registra el código de error (`ECONNREFUSED`) | — |

## 5. Errores de las propias pruebas (corregidos)

Se dejan constancia porque explican las ejecuciones fallidas guardadas en `evidencias/etapa3/iteraciones/`:

- **CTL-01** usaba el mismo intervalo que el actual; el dispositivo, correctamente, no cambia la versión de
  configuración si nada cambia. Ahora hace un cambio real y lo revierte.
- **CTL-05 / reversión de CTL-04**: la batería superaba el límite de 30 órdenes/min y recibía 429 (el límite
  funcionaba). Ahora respeta `Retry-After`, y el límite se prueba explícitamente en SEC-08. Una reversión
  fallida dejó DEV03 con intervalo 11 s durante unos minutos; se restauró a 10 s.
- **PER-02 y LWT-01**: sus ventanas de medición se solapaban con la prueba anterior (corte de red, cambio
  de intervalo de CTL-04) y atribuían ese hueco al reinicio. Ahora cada prueba espera 15 s y mide solo su ventana.
- **Ejecución de las 07:34:56**: empezó 1 min después de otra que acaba probando fuerza bruta; el login seguía
  limitado y 20 pruebas fallaron con `login 429`. El login de la batería ahora espera `Retry-After`.
- Por error se borraron dos ficheros de evidencia en lugar de archivarlos: la ejecución de las 07:27:51
  (29/30; LWT-01 falló por el solapamiento descrito arriba, “5 de ~5 lecturas; hueco máximo 19,0 s”) y la de
  las 07:35:24 (30/30, anterior a la corrección D5). Los resultados citados proceden de la salida de consola.

## 6. Limitaciones y observaciones (no bloquean; se trasladan a la Etapa 4)

| # | Observación | Impacto | Propuesta |
|---|---|---|---|
| O1 | El contenedor `devices` no tiene healthcheck. | Docker no detecta un proceso colgado. | Añadir heartbeat en la Etapa 4. |
| O2 | La detección por LWT tarda ≈ 45–47 s (keepalive 30 s × 1,5). | La interfaz muestra “en línea” ese tiempo tras un corte de red. | Aceptable; bajar a 15 s si se quiere ≈ 23 s (más tráfico). |
| O3 | El campo `timestamp` del LWT es la hora de conexión (el mensaje se registra al conectar). | Solo informativo: Node-RED y el backend usan la hora de recepción. | Documentado. |
| O4 | La cola de almacenar y reenviar de los dispositivos vive en memoria. | Si el proceso muere *durante* un corte de red, se pierden las lecturas no enviadas. | Aceptable para dispositivos virtuales. |
| O5 | Un lote que InfluxDB rechace con 4xx se descarta (hasta 5000 líneas). | Solo ocurriría si una línea inválida superara la validación (D1, D2). | Validación estricta + unitarias. |
| O6 | Las credenciales MQTT de Node-RED se guardan sin cifrar en su volumen (`Using unencrypted credentials`). | Se generan desde el entorno en cada arranque; el volumen no es público. | Activar `credentialSecret` en la Etapa 4. |
| O7 | En local, el puerto 3100 del backend (solo 127.0.0.1) no pasa por nginx; ahí `X-Forwarded-For` sí es falsificable. | Solo desarrollo; en producción el backend no publica puertos (SEC-02). | — |
