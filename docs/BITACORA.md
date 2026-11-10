# SmartCityBGA — Bitácora del proyecto

Registro cronológico de trabajo, decisiones, pruebas, despliegues y huecos de captura.
Cada entrada indica **qué** se hizo, **por qué**, **cómo se verificó** y el commit asociado.
Documentos de detalle: [`PLAN.md`](PLAN.md) · [`PRUEBAS.md`](PRUEBAS.md) · [`DESPLIEGUE.md`](DESPLIEGUE.md).

## Resumen de requisitos del curso y estado

| Requisito | Estado | Dónde |
|---|---|---|
| Sensores, datos y variables | ✅ 10 dispositivos, 30+ variables | `packages/shared/src/catalog.ts` |
| ≥10 dispositivos en Real / Digital Twin / API / DataSet | 🟡 faltan "Real" y un dataset verdadero → DEV11 (ESP32 Wokwi) y DEV12 (CSV) | §2026-11-08 |
| Protocolo de comunicación (envío y recepción) | ✅ MQTT 3.1.1/5 QoS 0/1, LWT, retenidos, ACL | `PLAN.md §3` |
| Plataforma (bróker/endpoints) | ✅ Mosquitto + Node-RED + API REST/WS | `docker-compose.yml` |
| Visualización | ✅ App web + Grafana · 🟡 min/máx en Grafana | `infra/grafana` |
| "Retroceso" (control) | ✅ órdenes con ack, calibración, umbrales, on/off | `PRUEBAS.md CTL-*` |
| Nube con URL propia | ✅ https://smartcitybga.duckdns.org (Azure) | `DESPLIEGUE.md` |
| 4–6 días de datos | 🟡 captura desde 2026-11-07; meta 6 días el 2026-11-13 | esta bitácora |
| Análisis de gráficas con IA | 🟡 módulo IA en construcción | §2026-11-08 |
| Documento PDF | ⏳ al cerrar la captura | `docs/informe/INFORME-SmartCityBGA.pdf` |

---

## 2026-11-06 — Etapa 1: análisis y planificación
- Revisión de la arquitectura de referencia del curso y de la colección Postman (contenía claves
  expuestas → excluida de Git).
- APIs verificadas: Open-Meteo (Forecast, Air Quality, Flood), IDEAM `bdmn-sqnh` (MAJADAS),
  gpsmobile.co (con datos personales → minimización, ver `PLAN.md §4.6`).
- Decisiones: Mosquitto, Node-RED, InfluxDB 2.7, SQLite, Fastify, React+Vite. Ver `PLAN.md §2`.

## 2026-11-06/07 — Etapa 2: desarrollo local
- Contrato compartido (zod), 10 dispositivos virtuales, simulador de tráfico/incidentes sobre vías
  reales de OSM (Poisson no homogéneo), adaptador GPS, Node-RED, backend, frontend, Grafana.
- Desviaciones documentadas en `PLAN.md §7.1` (Node 24, fila ancha en InfluxDB, etc.).

## 2026-11-07 — Etapa 3: pruebas
- 55 pruebas unitarias + 31 de integración contra el stack real; 7 defectos (D1–D7) encontrados y
  corregidos (inyección de line protocol, pérdida de lecturas en cortes, spoofing de X-Forwarded-For…).
- Evidencias: `docs/evidencias/etapa3/`.

## 2026-11-07 — Etapa 4: despliegue en Azure
- VM existente `vm-smartcity-iot` (B2as_v2, Ubuntu 24.04), HTTPS Let's Encrypt, NSG con solo 80/443
  públicos y SSH restringido a la IP del propietario.
- **Inicio de la captura en producción: 2026-11-07.**

## 2026-11-08 — Diagnóstico para cerrar el proyecto
**Hallazgos**
1. `tarea.txt` (enunciado con llaves de Azure Maps y b.ai) **no estaba ignorado** por Git: la regla
   decía `.tarea.txt ` (punto inicial y espacio final). Corregido → commit `chore(git)`.
   Acción del propietario: **rotar** ambas llaves.
2. No existe dispositivo "Real" (no hay código ESP32/Arduino/Wokwi) y el bróker no está expuesto
   a Internet.
3. DEV09 está catalogado como `dataset`, pero consume la API de IDEAM; falta una reproducción real
   de dataset.
4. No hay módulo de IA (requisito "análisis de gráficas con IA" + plus de chat).
5. Grafana solo muestra medias; faltan mínimos/máximos y panel de alertas.
6. No hay backups automáticos ni procedimiento de despliegue reproducible.
7. Falta el informe (arquitectura de referencia, tabla de sensores con rangos, análisis).

**Verificación de la API de IA (b.ai, OpenAI-compatible)**
- `GET https://api.b.ai/v1/models` → 200; modelos *flash* disponibles: `qwen3.8-flash`,
  `deepseek-v4.1-flash`, `gemini-3.8-flash`, `glm-5.3-flash`, entre otros.
- Prueba de decodificación restringida (`response_format: json_schema, strict`) con
  `temperature: 0` y `enable_thinking: false`:

  | Modelo | Resultado | Tokens | Latencia |
  |---|---|---|---|
  | `qwen3.8-flash` | `{"experto":"stats"}` válido | 41 entrada + 12 salida = **53** | **1,5 s** |
  | `deepseek-v4.1-flash` | contenido vacío (gastó los 80 tokens razonando) | 196 | 3,1 s |

- **Decisión:** `qwen3.8-flash` como modelo del enrutador.

**Plan aprobado** (commits atómicos, cada uno con pruebas):
C2 DEV11 ESP32/Wokwi por MQTT TLS · C3 DEV12 dataset CSV · C4 módulo IA (enrutador CDM + expertos
en código) · C5 página "Asistente" con gráficas · C6 Grafana min/máx/alertas · C7 backups y
despliegue reproducible · C8 despliegue a la VM · C9 revisión e informe tras 6 días de captura.

## 2026-11-08 — Desarrollo de cierre (C2–C7)
Trabajo organizado con subagentes: Haiku para lecturas y ejecución de pruebas; Sonnet en un
worktree aislado para DEV11 (firmware + bróker TLS); integración y revisión por el agente líder.

| Commit | Qué | Verificación |
|---|---|---|
| `c131d65` | **Asistente IA (backend)**: enrutador CDM + 8 expertos en código, caché, presupuesto diario, registro de tokens, análisis por dispositivo. Ver [`IA.md`](IA.md) | 27 pruebas nuevas · humo real: **10/10 aciertos, ≈ 750 tokens, 1,8 s** (`evidencias/ia/`) |
| `b0e7979` | **Página Asistente** (`/asistente`): chat sin historial, gráficas a pedido exportables a PNG, panel de análisis | `tsc` + `vite build` |
| `5e25f51` | **deploy.sh** (git archive → VM → compose → health) y **backup.sh** (InfluxDB + SQLite, 7 días) | sintaxis `bash -n`; ejecución pendiente de acceso SSH |
| `d2e6958` · `6c26fc3` · `097fefb` · `009817b` | **DEV11 ESP32 (Wokwi)**: `source_type: real`, listener **MQTT/TLS 8883** solo en producción (certificado Let's Encrypt), credencial propia, firmware con LWT/ack/deduplicación/NTP, muestras de contrato validadas con zod | shared 21/21 · `arduino-cli` compila para ESP32 (81 % flash) · TLS y Wokwi pendientes de prueba en vivo |
| `d5e9519` | **DEV12 dataset**: reanálisis ERA5 de Bucaramanga (nov. 2025, 720 h, CC BY 4.0) reproducido en modo *espejo* (mismo día y hora de 2025) | 6 pruebas nuevas (lector, interpolación, espejo, integridad del CSV) |
| `85fb148` | **Grafana**: tabla promedio/mín/máx/lecturas sobre el rango del selector de tiempo; comparación DEV01 vs DEV10 vs DEV12; paneles DEV11 y DEV12 | consulta Flux pendiente de validar contra InfluxDB de producción |

**Distribución de los 12 dispositivos por tipo de fuente**

| Real | Gemelo digital | API | Dataset | Simulado |
|---|---|---|---|---|
| DEV11 (ESP32) | DEV01, DEV07 | DEV02, DEV06*, DEV10 | DEV09 (IDEAM), DEV12 (ERA5 CSV) | DEV03, DEV04, DEV05, DEV08 |

\* DEV06 usa ruta simulada mientras no haya autorización de gpsmobile.co.

**Pruebas al cierre del día:** shared 21 · devices 22 · backend 36 · Node-RED 20 = **99 pruebas en verde**;
frontend compila (`tsc` + `vite build`).

**Decisiones**
- `qwen3.8-flash` como modelo (medido; `deepseek-v4.1-flash` gasta la salida razonando).
- Sin Docker en el PC de desarrollo: la verificación integral se hace en la VM.
- El despliegue reinicia solo los servicios cambiados; los huecos de captura se registran abajo.

**Bloqueos (acción del propietario)**
1. SSH a la VM rechazado: la IP pública cambió (ahora 190.67.56.196) y el NSG solo admite la anterior.
   Este PC no tiene Azure CLI.
2. Abrir **8883/TCP** en el NSG para DEV11 (cambio en Azure, requiere confirmación).
3. Rotar las llaves de Azure Maps y b.ai que estaban en `tarea.txt`.

### Registro de despliegues y huecos de captura
| Fecha/hora (COT) | Commit | Servicios | Hueco aproximado |
|---|---|---|---|
| 2026-11-07 | inicial | todos | inicio de la captura |
| 2026-11-08 17:08:56–17:09:20 | `5120560` | mosquitto, devices, nodered, backend, web (Grafana recargó el tablero sin reinicio) | **≈ 24 s** |

## 2026-11-08 — Despliegue del cierre en producción
**Acceso.** La IP pública del propietario cambió; el propietario creó en el NSG la regla `SSH_ANY`
(22 desde cualquier origen). ⚠️ Pendiente: volver a restringirla a una IP /32.

**Procedimiento ejecutado**
1. Lectura del estado: 8/8 servicios sanos con 37 h de actividad, disco 32 %, 6,7 GB de RAM libres.
2. Validación en solo lectura de la consulta Flux de la tabla de Grafana contra InfluxDB de producción
   (últimas 24 h: ≈ 8 600 lecturas por dispositivo simulado; DEV09 con 6 por el retraso del IDEAM).
3. Copia del `.env` (`.env.bak-20261108`, permisos 600) y transferencia del código (`git archive`).
4. `setup.sh`: agregó **solo** `MQTT_PASS_DEV11` y `MQTT_PASS_DEV12`; se comprobó que ningún valor
   existente cambió.
5. Primera copia de seguridad (InfluxDB completo + SQLite, 568 KB). Defecto encontrado: `backup.sh`
   enviaba el token con comillas → 401; corregido (commit `fix(infra)`).
6. `docker compose build` (con los contenedores en marcha) y `docker compose up -d`.
7. Cron diario de copias: `15 8 * * *` UTC (03:15 COT).

**Verificación**
- `/api/health` → ok (MQTT, InfluxDB, SQLite).
- 12 dispositivos en el catálogo; **11/11 virtuales en línea**, DEV12 publicando (22,1 °C · 89 %),
  DEV11 a la espera del ESP32.
- Mosquitto: "listener TLS 8883 habilitado", 14 usuarios. `openssl s_client` desde la VM → certificado
  Let's Encrypt (YE2) válido, TLS 1.3. Desde Internet sigue cerrado hasta abrir 8883 en el NSG.
- `/asistente` → 200; `/api/ai/status` → `enabled: false` hasta configurar `AI_API_KEY` en la VM.
- Grafana: el tablero muestra la tabla de promedio/mín/máx y los paneles de DEV11 y DEV12.

## 2026-11-08 — Validación en producción, IA activa e informe preliminar
**IA en la VM.** `AI_API_KEY` se agregó al `.env` de la VM (sin imprimirla) y se reinició solo el backend
(≈ 22:22 UTC; las mediciones siguen llegando a InfluxDB por Node-RED, sin hueco de captura).
`/api/ai/status` → `enabled: true`, modelo `qwen3.8-flash`.
- Chat en producción: 6/6 preguntas bien enrutadas, ≈ 870 tokens y ≈ 1,5 s por consulta; la misma
  pregunta repetida sale de caché con 0 tokens en ≈ 140 ms.
- Análisis por dispositivo (`POST /api/ai/analysis/:id`, ventana 48 h) generado para 11 dispositivos.

**Defectos encontrados y corregidos**
| Defecto | Causa | Corrección (commit) |
|---|---|---|
| 70 alertas de atípico abiertas a la vez | cada atípico tenía una referencia única y nunca se cerraba | se resuelven solas cuando \|z\| < 2 (`243fbac`) |
| "últimos 2 día" en respuestas | concordancia de número | `7ae1251` |
| El análisis de DEV06 afirmaba datos reales | usaba la procedencia del catálogo y no la de la última lectura (ruta simulada) | `553d0f6`; prompt: la diferencia día/noche entre cuartos no es tendencia ni falla |

Los dos arreglos de backend se desplegaron con `infra/scripts/deploy.sh backend` (solo backend).

**DEV11 de punta a punta por Internet** (NSG con 8883/TCP abierto por el propietario)
- `openssl s_client` desde el PC → certificado Let's Encrypt válido, TLS 1.3.
- Emulador del contrato del ESP32 (mismo tópico, credencial y payload que `firmware/dev11-esp32`):
  conexión anónima y con clave incorrecta **rechazadas**; con la credencial de DEV11 **aceptada**;
  orden desde la API confirmada (`ack`) en **466 ms**; el backend vio la telemetría.
- Quedan 4 lecturas de prueba en InfluxDB con `ref = "emulador-prueba-e2e"`.
- Pendiente del propietario: correr el sketch en Wokwi con la clave de DEV11 en `secrets.h`
  (la clave está en `.local-credentials.txt` de la VM).

**Informe preliminar** (`docs/informe/`)
- `generar_informe.py` consulta la API pública, dibuja las figuras (matplotlib, paleta validada),
  toma capturas de la app y arma `informe.html` → `INFORME-SmartCityBGA.pdf` (Chrome/Edge sin cabeza).
- Ventana actual: 07/11 00:00 → 08/11 17:44 (≈ 1,7 días, 74 600 lecturas). Lleva una franja de
  "versión preliminar" mientras la ventana termine antes del 13/11.
- Para la versión final (≥ 13/11): regenerar los análisis IA con 144 h y correr
  `python docs/informe/generar_informe.py` con un entorno que tenga matplotlib.
- Decisión: la cobertura se calcula como lecturas / lecturas esperadas por intervalo, porque la
  "disponibilidad" de `/api/capture` promedia eventos y sobreestima.

## 2026-11-08 — Asistente en panel lateral, agentes expertos y arreglo de Wokwi
**Reporte del propietario:** el asistente era difícil de usar, daba errores y «Wokwi no carga».

**Diagnóstico** (batería de preguntas reales contra producción + consola del navegador)
| Síntoma | Causa |
|---|---|
| La página `/asistente` se caía al llegar una respuesta (pantalla en blanco) | En Chrome reciente `scrollIntoView` devuelve una promesa; el `useEffect` la retornaba y React la tomaba como función de limpieza («destroy is not a function») |
| «temperatura actual» respondía cuántos equipos había en línea | El enrutador elegía `estado` sin series |
| «qué dispositivos hay» devolvía la ayuda; «hay algún problema» no miraba alertas | No existían expertos de inventario ni de resumen |
| «resumen del día» mezclaba °C, AQI y dB en un solo eje | La gráfica dibujaba todas las series juntas |
| «¿y ayer?» no se entendía | Cada pregunta viajaba sin contexto |
| Wokwi (extensión de VS Code) no cargaba | `wokwi.toml` apunta a `build/dev11-esp32.ino.bin`, que nunca se había compilado; tampoco existía `secrets.h` |

**Cambios** (commits `0719b88`, `4a115a5`, `fa5dc6e`, `a07050f`)
- Siete **agentes expertos** (general, clima, aire y ruido, movilidad, agua y lluvia, alumbrado,
  operación). Cada uno acota el vocabulario del enrutador: ≈ 640–780 tokens por pregunta frente a
  ≈ 1 050 del general. `GET /api/ai/agents`.
- Expertos nuevos `resumen` y `dispositivos`; `estado` nombra el equipo y une lat/lon; las respuestas
  traen accesos a la vista relacionada.
- Seguimientos: el cliente manda la decisión anterior (no el historial); «¿y ayer?» tras un valor
  actual responde con estadísticas de ayer.
- `ai_usage` guarda la pregunta y el agente (para depurar respuestas futuras).
- Interfaz: botón «Pregúntale a la IA» en todas las páginas; panel acoplado a la derecha en pantallas
  anchas (el contenido se corre) y a pantalla completa en móvil; misma conversación en `/asistente`;
  viñetas, accesos, errores con «Reintentar», Enter envía; gráficas en pequeños múltiplos por unidad.
- Firmware: `firmware/dev11-esp32/build.sh` compila con arduino-cli hacia `build/`; se creó el
  `secrets.h` local con la clave de DEV11 traída de la VM sin imprimirla (ignorado por Git).
  Compilación verificada: 81 % de la flash, 16 % de la RAM.

**Pruebas:** backend 46/46 (8 nuevas). Producción: «temperatura actual» → valores de DEV01/DEV10;
«¿y ayer?» → estadísticas del día anterior; «hay algún problema» → resumen con DEV11 fuera de línea
y 1 alerta; «a qué hora hay más ruido» (agente aire, 659 tokens) → pico 13:00. Capturas del panel
en escritorio (acoplado) y móvil revisadas.

**Despliegues:** backend 18:13 COT (`0719b88`) y backend + web 18:17:46–18:18:25 COT. Solo se reinició el
backend (la captura sigue por Node-RED → InfluxDB) y la web: **sin hueco de captura**.

## 2026-11-08 · Nodo, acento de la IA, DEV11 en la VM y capturas

- **DEV11 en la VM con Wokwi CLI, bajo demanda** (`firmware/dev11-esp32/vm/`): primero como servicio permanente; la cuenta gratis corta cada simulación a 5 min y dejaba a DEV11 desconectado ~30 % del tiempo (con alertas de desconexión). Ahora lo enciende el operador desde la ficha del dispositivo y se apaga solo sin espectadores (controlador + `/api/dev11`). Token de Wokwi y del controlador solo en la VM (600), fuera de Git.
- **Personalidad del asistente:** se llama **Nodo**. Saludo según la hora, textos de ayuda/fuera de tema con voz propia (`experts.ts`). Solo cambian textos; el esquema del enrutador y los expertos no.
- **Segundo acento `--ai` (lavanda apagado, oklch 295):** únicamente para la voz de la IA (botón, avatar, agente elegido). Nunca para estados; ámbar/rojo/verde siguen siendo semánticos. Excepción deliberada a «sin púrpura» de `.impeccable.md`: es apagado y acotado a un solo rol.
- **UX menor:** 404 con enlace de vuelta, `group` faltante en el hover de las tarjetas del panel.
- **Verificación:** typecheck y 89 pruebas en verde (21 + 22 + 46); capturas revisadas en `docs/capturas/`.
- **Hallazgos pendientes de la auditoría (no hechos):** sin pruebas de frontend ni de rutas HTTP del backend (login, alertas, captura, `/ws`) ni de `mqttBridge`; sin CI; texto de 10–11 px en panel/mapa; estado de dispositivo solo por color en el mapa; errores tratados como «vacío» en Alertas/Asistente; sin confirmación al apagar/reiniciar un dispositivo; panel del asistente en móvil sin `role=dialog` ni gestión de foco.
- **Nodo cobra vida:** mascota SVG animada (rebota, parpadea, sigue el cursor, 5 humores), voz TTS opcional, resumen del día, órdenes propuestas con confirmación y estilos de gráfica por palabras. Ver `docs/IA.md`.
- **Ilustración de cada dispositivo** con «qué representa» (sin presentar lo simulado como medido) y «dónde está» con salto al mapa (`/mapa?dev=DEVxx`).
- **Primera visita:** guía de bienvenida de Nodo con dónde está cada cosa, reabrible con el botón «¿Cómo se usa?» del encabezado (`?bienvenida=0` la omite, p. ej. para capturas).
- **Hallazgo:** la cuota mensual gratis de minutos de CI de Wokwi se agotó (el servicio permanente de la primera versión, con reinicios cada 5 min, la consumió). El encendido bajo demanda quedó verificado de extremo a extremo salvo la conexión del simulador: arranque, arriendo, apagado automático a los ~155 s sin espectadores, rechazo sin token (401) y freno ante fallos. Hasta que la cuota se renueve (o se use otra cuenta/plan) DEV11 se ejecuta con la extensión de VS Code o un ESP32 físico.
- **Verificación:** typecheck y 100 pruebas en verde (21 + 22 + 56).
- **Informe PDF actualizado** (`docs/informe/`, 23 páginas): portada institucional UNAB con logo y los tres integrantes, sección de Node-RED (flujos de persistencia y de automatización), tablero de Grafana, Nodo (identidad, voz, órdenes con confirmación, resumen del día), DEV11 bajo demanda con su limitación de cuota, y las capturas nuevas del sitio. Se regenera con `python docs/informe/generar_informe.py` (datos reales de producción; sigue marcado «preliminar» hasta completar 6 días de captura el 13/11).

## 2026-11-09 · Simulación previa al lanzamiento (QA y resiliencia)

- **Qué:** simulación completa de lanzamiento sobre la VM de Azure `vm-smartcity-iot` (IP pública **158.23.162.76**,
  https://smartcitybga.duckdns.org): clasificación de la arquitectura, inyección de 9 fallos de servidor y 8 de red, cinco
  usuarios simulados por agentes de IA (impaciente, escéptico, móvil con 3G, hablante no nativo y el que rompe cosas),
  backlog priorizado, correcciones y regresión. Detalle completo en [`QA-LANZAMIENTO.md`](QA-LANZAMIENTO.md).
- **Por qué:** comprobar antes de abrir el sitio que los fallos de dependencias quedan aislados, que el usuario recibe mensajes
  útiles y que la interfaz no se rompe con datos inesperados ni con entradas hostiles.
- **Cómo:** copia de seguridad previa en la VM. Producción solo se leyó y se navegó; los fallos de servidor y los payloads hostiles se
  lanzaron en una réplica local del mismo commit, porque el sistema de permisos del agente bloqueó parar contenedores en la VM.
- **Hallazgos principales:** 20 de 64 respuestas anómalas dejaban la app en blanco; un backend colgado congelaba la pantalla 59 s sin
  aviso; InfluxDB caído daba «Error interno» tras 20 s; doble clic enviaba 2 órdenes; 3 errores 500 por parámetros; error de CSP en cada
  página; faltaba identificar al operador, la privacidad y los términos; la sesión de operador duraba 30 días sin revocación; la instalación limpia fallaba en Linux/macOS (script de InfluxDB sin permiso
  de ejecución) y la imagen de pruebas del backend fallaba (faltaban las muestras del firmware).
- **Verificación:** 193 pruebas unitarias en verde (73 nuevas), regresión de los 5 usuarios y de los fallos sobre la réplica corregida:
  0 de 64 pantallas en blanco. **No desplegado todavía en la VM** (pendiente de aprobación del propietario).
