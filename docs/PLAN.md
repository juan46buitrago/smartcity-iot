# Smart City Bucaramanga (SmartCityBGA) — Plan técnico

> Versión 1.4 — 2026-11-07. Estado: **aprobado con modificaciones (DEV04, DEV06)**.
> Etapa actual: **Etapa 4 (despliegue) completada** — https://smartcitybga.duckdns.org; ver [`DESPLIEGUE.md`](DESPLIEGUE.md).
> Etapa 3: ver [`PRUEBAS.md`](PRUEBAS.md). Siguiente: Etapa 5 (captura ≥ 5 días y documentación).

## 1. Hallazgos de la Etapa 1

### 1.1 Referencias
- `referencias/ArquitecturaIoTCapstoneFinal.excalidraw`: arquitectura del curso — fuentes
  (dispositivo real `python.py`, API, gemelo digital, dataset) → broker (MQTT/AMQP/REST/CoAP)
  → servicio cloud en VM con contenedores (front, back, analysis, database, broker) → Grafana/KPI.
  Bloque opcional "openAI API" en análisis.
- `referencias/Weather Forecast.postman_collection.json`: contiene **2 claves de Azure Maps en
  claro** y **credenciales Basic del servicio GPS**. El archivo está excluido de Git
  (`.gitignore`). Las claves deben **regenerarse** (acción del propietario en el portal).
  La petición de incidentes de tráfico usaba un bbox de EE. UU., no de Bucaramanga.

### 1.2 APIs verificadas (2026-11-06)
| Fuente | Resultado | Observación |
|---|---|---|
| Open-Meteo Forecast | ✅ 200 | Sin clave, actualización 15 min, ≤10 000 llamadas/día |
| Open-Meteo Air Quality | ✅ 200 | Datos de **modelo CAMS**, no estación terrestre. Horario |
| Open-Meteo Flood | ✅ 200 | Caudal diario modelado (complemento) |
| IDEAM `bdmn-sqnh` (datos.gov.co) | ✅ 200 | Estación **MAJADAS – Bucaramanga** (23197700), nivel horario en m, ~1 día de retraso |
| Azure Maps | 401 sin clave | Claves expuestas no se reutilizan |
| OpenAQ v3 | 401 | Requiere clave; no necesario |
| gpsmobile.co | 200 | Responde con datos reales que incluyen datos personales → ver §4.6 |

### 1.3 Infraestructura (consulta de solo lectura)
- VM `vm-smartcity-iot` en ejecución, IP pública **estática** 158.23.162.76, sin auto-shutdown.
- NSG: solo SSH 22 abierto a `*`. 80/443 cerrados.
- `smartcitybga.duckdns.org` resolvía a una IP distinta de la VM → corregir antes de HTTPS.
- SSH desde el PC con `~/.ssh/id_ed25519` rechazado → confirmar qué clave se usa.
- Docker Desktop local está instalado pero el motor no estaba en ejecución.

## 2. Decisiones técnicas aprobadas
| Componente | Decisión | Motivo |
|---|---|---|
| Broker | Mosquitto 2, `allow_anonymous false`, passwords + ACL por dispositivo | Ligero, estándar |
| Integración | Node-RED: MQTT → validación → InfluxDB + reglas entre dispositivos | Requisito del curso, automatización visible |
| Series temporales | **InfluxDB 2.7** (`raw` 30 días + `agg_5m` 1 año) | InfluxDB 3 Core limita consultas a 72 h |
| Configuración / registro | **SQLite** (better-sqlite3) en el backend | Sin servidor extra, suficiente |
| Backend | Node.js 20 + TypeScript + Fastify + zod + mqtt.js + WebSocket | Validación fuerte, bajo consumo |
| Frontend | **Vite + React + TS + Tailwind + Recharts + Leaflet** (SPA estática) | No requiere SSR; ahorra un contenedor |
| Dispositivos | Servicio `devices`: 10 clientes MQTT independientes, credencial y LWT propios | Comportamiento de dispositivo real |
| Análisis | Grafana provisionado, detrás de Nginx con login | Complementario |
| Proxy | Nginx + Let's Encrypt (DuckDNS) | HTTPS |
| Acceso web | Dashboard de **lectura pública**; **controles y configuración requieren login (JWT)** | Mínimo privilegio |

Presupuesto de memoria (mem_limit): InfluxDB 1.5 GB, Grafana 256 MB, Node-RED 256 MB,
backend 256 MB, devices 192 MB, Mosquitto 64 MB, Nginx 64 MB → ≈2.6 GB de 8 GB.
Logs Docker: `json-file` 10 MB × 3.

## 3. Contrato MQTT
Tópicos por dispositivo:
```
smartcity/DEVxx/telemetry   mediciones (QoS 0/1)
smartcity/DEVxx/status      estado, retenido; LWT = offline
smartcity/DEVxx/control     órdenes (QoS 1)
smartcity/DEVxx/config      configuración vigente, retenida
smartcity/DEVxx/ack         confirmación de órdenes
smartcity/DEVxx/events      eventos discretos (p. ej. ciclo de vida de incidentes DEV04)
```
Mensaje base: `device_id`, `timestamp` (momento de observación), `ingested_at`, `location`,
`status`, `source_type` (`simulated | digital_twin | api | dataset`), `provenance`
(`provider`, `synthetic`, `ref`), `variables` (`{nombre: {value, unit}}`), `seq`.

Flujo de control: UI → `POST /api/devices/:id/commands` (JWT) → validación zod por capacidades →
`control` con `command_id` (QoS 1) → dispositivo aplica → `ack` {command_id, ok, error?, state}
→ backend correlaciona, audita en SQLite, emite por WebSocket → UI: pendiente → confirmado /
rechazado / sin respuesta (timeout 10 s).

## 4. Dispositivos
| ID | Dispositivo | Fuente | Procedencia | Controles |
|---|---|---|---|---|
| DEV01 | Estación ambiental | Gemelo digital | Base Open-Meteo + dinámica propia | on/off, intervalo, offset de calibración, umbrales |
| DEV02 | Calidad del aire | API | Open-Meteo AQ (modelo CAMS) | on/off, intervalo, umbrales AQI/PM2.5 |
| DEV03 | Sensor de ruido | Simulado | Perfil horario urbano | on/off, intervalo, modo normal/evento, umbral dB |
| DEV04 | Incidentes viales | **Simulado (sintético)** | Modelo probabilístico sobre vías reales OSM — §4.4 | on/off, intensidad, tasa base, máx. simultáneos, incidente de prueba |
| DEV05 | Detector de vehículos | Simulado | Modelo de tráfico compartido con DEV04 | on/off, intervalo, factor de demanda |
| DEV06 | Rastreador GPS | **API gpsmobile.co (si hay autorización)** / ruta simulada | §4.6 | on/off, intervalo, fuente |
| DEV07 | Alumbrado público | Gemelo digital | Ciclo solar real de Bucaramanga | encender/apagar, auto/manual, atenuación |
| DEV08 | Parqueadero | Simulado | Entradas/salidas estocásticas | on/off, capacidad, intervalo |
| DEV09 | Nivel de agua | Dataset | IDEAM MAJADAS (real) | on/off, intervalo, umbrales de riesgo |
| DEV10 | Estación meteorológica | API | Open-Meteo Forecast | on/off, intervalo |

Intervalos por defecto (configurables): simulados 10 s (2–300 s); Open-Meteo clima 10 min;
Open-Meteo AQ 15 min; IDEAM 30 min; GPS 60 s; ciclo del motor de incidentes 30 s.
Las lecturas de API repetidas se descartan por marca de tiempo de origen.

### 4.4 DEV04 — Simulación realista de incidentes viales (MODIFICADO)
**Etiquetado:** todo incidente lleva `source_type: "simulated"`, `provenance.synthetic: true`,
`provider: "SmartCityBGA traffic simulator"`, identificador `SIM-INC-…` y en la UI la etiqueta
"Simulación — no es un reporte real". Nunca se mezcla con fuentes reales.

**Red vial real.** Catálogo de segmentos generado desde OpenStreetMap (© colaboradores de
OpenStreetMap, ODbL) mediante un script reproducible (`infra/scripts/build-road-segments.mjs`).
Vías con nombre de clase `trunk`/`primary`/`secondary` en Bucaramanga y área metropolitana
(Autopista Floridablanca, Av. Carrera 27, Av. Calle 45, Av. Quebrada Seca, Carrera 33,
Transversal Oriental, Diagonal 15, Anillo Vial, Av. Calle 56, Puerta del Sol/Calle 36, etc.).
Cada segmento: id, nombre, clase, carriles, velocidad libre, longitud y geometría.

**Modelo de generación (proceso de Poisson no homogéneo).** En cada ciclo Δt (30 s) y por
segmento sin incidente activo:
```
λ_seg(t) = tasa_base[clase] × longitud_km × demanda(t) × f_lluvia × intensidad_config
P(incidente en Δt) = 1 − exp(−λ_seg · Δt)
```
- `demanda(t)`: perfil horario y por día de la semana (picos 6:30–8:30, 11:30–14:00, 17:00–19:30;
  madrugada baja; fin de semana distinto).
- `f_lluvia`: 1.0 seco, hasta 1.8 con lluvia (lectura de DEV10 por MQTT; si no hay dato, 1.0).
- Calibración por defecto: ~6–12 incidentes/día en toda la ciudad con intensidad 1.0, de modo
  que **son normales periodos prolongados sin incidentes** (especialmente de noche).

**Tipo según condiciones** (pesos condicionados):
| Tipo | Más probable cuando |
|---|---|
| Congestión | Hora pico, vías arteriales, alta demanda |
| Accidente | Lluvia, noche, vías de alta velocidad |
| Vehículo averiado | Distribución más uniforme, mayor en trunk |
| Cierre parcial | Horas valle y nocturnas (obras), vías secundarias |

**Gravedad:** `baja | media | alta | crítica`, con distribución dependiente del tipo y de la clase
de vía (p. ej. accidente en autopista con lluvia → mayor probabilidad de alta/crítica).

**Ciclo de vida:** `activo` → `en_atencion` (tras tiempo de respuesta log-normal según gravedad)
→ `resuelto` (duración total log-normal según tipo y gravedad; p. ej. averiado 20–60 min,
accidente grave 60–180 min). Cada transición se publica en `smartcity/DEV04/events`.

**Restricciones anti-duplicado y de realismo:**
- Máximo 1 incidente activo por segmento y radio mínimo entre incidentes simultáneos.
- Enfriamiento por segmento tras resolverse (por defecto 45 min).
- Límite global de simultáneos (por defecto 3, configurable) y amortiguación cuando ya hay
  incidentes activos.
- Identificadores únicos; un incidente nunca se reemite como nuevo.

**Efectos sobre el tráfico:** modelo de tráfico compartido (DEV04 + DEV05):
`velocidad_seg = v_libre × factor_demanda(t) × (1 − impacto_incidente)`, con impacto según
tipo, gravedad y carriles bloqueados. Se publica índice de congestión y velocidad media de los
segmentos afectados. DEV05 (sobre un segmento real) refleja la caída de flujo/velocidad si su
segmento o uno adyacente tiene un incidente.

**Configuración (UI/MQTT):** `enabled`, `intensity` (0–3), `base_rate_per_km_day` por clase,
`max_concurrent`, `cooldown_min`, `tick_seconds`, `rain_sensitivity`, `seed` opcional para
reproducibilidad, y comando `inject_test_incident` (también marcado como sintético).

### 4.6 DEV06 — Rastreador GPS (MODIFICADO)
**Adaptador desacoplado:**
```ts
interface GpsSource {
  readonly kind: 'gpsmobile' | 'simulated_route';
  fetchPosition(): Promise<GpsFix>;   // GpsFix = { lat, lon, speed_kmh, state, status_code?, observed_at, reported_at? }
}
```
- `GpsMobileSource`: HTTP con Basic Auth tomada de variables de entorno
  (`GPS_API_BASE_URL`, `GPS_API_USER`, `GPS_API_PASS`, `GPS_VEHICLE_PATH`). Credenciales solo en
  `.env` (no versionado); `.env.example` sin valores.
- `SimulatedRouteSource`: recorre una ruta real de OSM (Av. Carrera 27 / Autopista Floridablanca)
  con velocidades del modelo de tráfico; etiquetado `synthetic: true`.
- Selección: `GPS_SOURCE=simulated|gpsmobile`. El modo `gpsmobile` **solo se activa si además
  `GPS_USAGE_AUTHORIZED=true`**; si no, el dispositivo usa la ruta simulada y su estado lo indica.
- Si la API falla, el dispositivo pasa a `degraded`/`offline`; **no se sustituye en silencio** por
  datos simulados (opción `GPS_FALLBACK_TO_SIMULATED=false` por defecto). Cambio de fuente desde
  la UI con login.

**Minimización de datos (lista blanca en el límite del adaptador):** solo se extraen
`Lt` → lat, `Lg` → lon, `Vel` → speed_kmh, `FdE` → observed_at (hora del reporte GPS),
`FdS` → reported_at, `Std` → `status_code` (código sin semántica documentada).
`state` se deriva: `en_movimiento` (vel > 3 km/h), `detenido`, `sin_reporte` (dato > 15 min).
Placa, conductor, cliente, SIM, MAC, odómetro, dirección textual y demás campos se descartan
inmediatamente: no se registran en logs, no se publican por MQTT, no se almacenan ni se muestran.
Las fechas `dd/MM/yyyy hh:mm:ss a` se interpretan en `America/Bogota`. Consulta ≤ 1/min.

## 5. Captura, almacenamiento y alertas
- InfluxDB `raw` (30 días): measurement `telemetry`, tags `device_id`, `source_type`,
  `synthetic`, `variable`; campo `value`. Measurement `incident_events` para DEV04.
- Tarea de downsampling a `agg_5m` (mean/min/max, 1 año).
- Consultas por dispositivo, variable y rango; estadísticas avg/min/max; comparación de variables.
- Anomalías: umbrales configurables + z-score sobre ventana móvil.
- Alertas: `info | warning | critical`, estado `abierta | reconocida | resuelta`, en SQLite y
  WebSocket.
- Backups: export diario de InfluxDB + copia de SQLite, rotación 7 días.
- No se generan datos históricos retroactivos; el histórico es solo lo capturado en vivo.

## 6. Estructura del repositorio
```
apps/backend      Fastify: api/, mqtt/, alerts/, db/, influx/
apps/devices      core/, devices/DEV01..DEV10, adapters/ (openmeteo, ideam, gps), sim/ (traffic, incidents), data/
apps/frontend     Vite React: Dashboard, Mapa, Dispositivos, Histórico, Alertas, Configuración
packages/shared   esquemas zod y tipos del contrato MQTT
infra/            mosquitto/, nodered/, influxdb/, grafana/, nginx/, scripts/
docker-compose.yml, docker-compose.override.yml (local), docker-compose.prod.yml
docs/             plan, arquitectura, informe académico, evidencias
```

## 7. Riesgos y pendientes
| # | Riesgo / pendiente | Responsable | Estado |
|---|---|---|---|
| 1 | Regenerar claves Azure Maps expuestas y contraseña GPS | Propietario | Pendiente |
| 2 | Confirmar autorización de uso de gpsmobile.co | Propietario/docente | Pendiente (DEV06 arranca en `simulated`) |
| 3 | DuckDNS apunta a IP incorrecta | Propietario / Etapa 4 | Resuelto (resuelve a 158.23.162.76; no hizo falta cambiarlo) |
| 4 | SSH 22 abierto a `*`; abrir 80/443 en Etapa 4 | Autorizado | Resuelto: SSH solo IP del propietario; 80/443 abiertos |
| 5 | Clave SSH de la VM desde este PC | Propietario | Resuelto (clave del propietario) |
| 6 | Plazo de 5 días de captura → posible despliegue temprano del pipeline | Requiere autorización | Pendiente |
| 7 | VM burstable B2as_v2 (créditos de CPU) | Desarrollo | Mitigado por límites |
| 8 | IDEAM con retraso/huecos; AQ es modelo | Documentación | Documentado |

## 7.1 Desviaciones respecto al plan (Etapa 2)
| Tema | Plan | Implementado | Motivo |
|---|---|---|---|
| Runtime | Node.js 20 | **Node.js 24 LTS** en contenedores | Node 20 sin soporte (abr-2026); `better-sqlite3` y `cookie` exigen ≥ 22 |
| Mapa base | Leaflet + teselas | Teselas estándar de **OpenStreetMap** (filtro CSS en modo oscuro) | CARTO ahora exige API key (verificado) |
| Persistencia InfluxDB | Tag `variable` + campo `value` | Fila ancha: un campo por variable | Menos series, consultas y Grafana más simples |
| Credenciales Node-RED | Sustitución `${VAR}` | Generadas por `scbga-entrypoint.sh` en el volumen | Node-RED no sustituye variables en credenciales |
| Puertos locales | 3000 / 8080 | 3100 / 8380 (solo 127.0.0.1) | 3000 ocupado y 8080 reservado por Windows |
| Tasa base DEV04 | ~6–12 inc/día | 0.15 inc/km·día → **8.0 inc/día** (Monte Carlo 14 días) | Calibración |
| Telemetría en cortes de red (Etapa 3) | Publicación QoS 1 | **Almacenar y reenviar**: la medición no espera el PUBACK; cola acotada a 2000 lecturas/dispositivo | Las pruebas mostraron lecturas perdidas durante un corte (D3) |
| Escritura en InfluxDB (Etapa 3) | Lote con nodo `join` (5 s) en memoria | Cola en **contexto persistente** de Node-RED (disco) + envío cada 2 s | Reinicios de Node-RED perdían datos (D4) |
| IP del cliente tras nginx (Etapa 3) | `trustProxy: true` | nginx sobrescribe `X-Forwarded-For`; Fastify confía en 1 salto | Se podía esquivar el límite de login (D5) |

## 8. Etapas
1. **Análisis y planificación** — completada.
2. **Desarrollo local** — contrato compartido → compose base (Mosquitto, InfluxDB) → `devices`
   (10 dispositivos, modelo de tráfico/incidentes, adaptador GPS) → Node-RED → backend →
   frontend → Grafana.
3. **Pruebas** — **completada**: 55 unitarias + 31 de integración contra el stack real (seguridad, ACL,
   control bidireccional, LWT, persistencia y recuperación). 7 defectos encontrados y corregidos. Ver `PRUEBAS.md`.
4. **Despliegue** — **completado** con autorización: VM existente, HTTPS (Let's Encrypt), solo 80/443 públicos, SSH restringido. Ver `DESPLIEGUE.md`.
5. **Recolección y documentación** — ≥5 días, estadísticas, informe.
