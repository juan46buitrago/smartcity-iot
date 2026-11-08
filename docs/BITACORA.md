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
| Documento PDF | ⏳ al cerrar la captura | `docs/INFORME.md` |

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
