# SmartCityBGA — Simulación previa al lanzamiento (QA y resiliencia)

> Fecha: 2026-11-09 · Sistema bajo prueba: **máquina virtual de Azure** `vm-smartcity-iot` (Standard B2as_v2, Ubuntu 24.04, 2 vCPU,
> 7,7 GB), **IP pública 158.23.162.76**, publicada como **https://smartcitybga.duckdns.org** · commit base `15d9e4b`.
> Evidencia completa: [`docs/evidencias/qa-lanzamiento/`](evidencias/qa-lanzamiento/).

## 1. Objetivo, alcance y reglas

Simular el lanzamiento antes de abrir el sitio al público, en tres fases:
1. **Resiliencia (ingeniería del caos):** clasificar la arquitectura e inyectar fallos (base de datos colgada o caída, 502/504 del
   gateway, respuestas cortadas o con forma inesperada, caídas de terceros) para ver si hay degradación controlada, reintentos,
   cortacircuitos y mensajes útiles, y si los fallos se propagan o quedan aislados.
2. **Usuarios simulados:** cinco agentes de IA, cada uno con un navegador propio, recorren el sitio como usuarios nuevos:
   el impaciente, el escéptico, el de móvil con 3G, el hablante no nativo y el que intenta romper cosas.
3. **Backlog, correcciones y regresión:** lista única priorizada por número de usuarios afectados, correcciones y repetición de
   las pruebas sobre la versión corregida.

Reglas que se cumplieron durante toda la prueba:
- **Producción no se interrumpió.** En la VM solo se hicieron lecturas, una copia de seguridad previa y navegación normal. La
  inyección de fallos de servidor (parar o congelar contenedores) en la VM fue **bloqueada por el sistema de permisos del agente**,
  así que se hizo en una **réplica local idéntica** (mismo commit, mismos 7 servicios, Docker en el Mac del propietario).
- Los fallos de red se simularon **dentro del navegador de prueba** (interceptando `/api/*`), sin enviar tráfico anómalo al servidor.
- Los payloads hostiles (XSS, inyección SQL/Flux, JWT alterados, doble clic agresivo) se lanzaron **solo contra la réplica**.
- **Credenciales:** las del propietario (aplicación, Grafana y Node-RED) se usaron solo en memoria y en un archivo temporal con
  permisos 600 fuera del repositorio. No aparecen en este documento, en la evidencia ni en Git (verificado con búsqueda antes de copiar
  la evidencia). La clave SSH `.pem` sigue ignorada por `.gitignore`.

## 2. Bitácora de la sesión (hora de Colombia)

| Hora | Acción | Resultado |
|---|---|---|
| 10:08 | Inventario de solo lectura de la VM por SSH | 8 contenedores sanos, 1,2 GB de RAM usados de 7,7 GB, disco al 35 %, puertos abiertos 22, 80, 443 y 8883 |
| 10:11 | **Copia de seguridad** previa (`backup.sh`) | `backups/2026-11-09` en la VM (856 KB: InfluxDB completo y SQLite) |
| 10:11 | Línea base de latencia | Desde la VM `/api/health` en 25 ms. Desde Internet de 0,5 a 15 s: la red del cliente era irregular (ICMP filtrado), no el servidor |
| 10:15 | Prueba de credenciales | Grafana y Node-RED aceptan `admin`. La aplicación solo tiene un operador (`operador`): `admin` y `user4` dan 401 |
| 10:20 | Inyección de fallos de servidor en la VM | **Bloqueada por el sistema de permisos** → réplica local |
| 10:22 | Fallos simulados en el navegador contra producción (R1–R7, 56 combinaciones) | 12 pantallas en blanco |
| 10:25–10:42 | Montaje de la réplica local | Se descubren 2 defectos de instalación (§5, B-18 y B-19) |
| 10:45 | Arranque de 4 usuarios simulados contra producción | — |
| 10:50–11:30 | Pausa pedida por el propietario | Todo detenido y producción verificada sana |
| 11:31–11:46 | Inyección de fallos de servidor F1–F9 en la réplica | §3 |
| 11:33–12:00 | Correcciones con pruebas primero (TDD) | §6 |
| 11:51–17:30 | Usuarios simulados (los 4 de producción reanudados y el quinto en la réplica) | §4. Hubo dos cortes ajenos: el límite de uso de la cuenta del agente y una caída de red |
| 17:30–18:40 | Regresión: los 5 usuarios y los fallos de navegador y de servidor sobre la réplica corregida | §7 |

## 3. Fase 1 — Arquitectura y resiliencia

### 3.1 Clasificación de las rutas críticas

| Ruta | Cadena | Acoplamiento | Qué pasa si falla una pieza |
|---|---|---|---|
| Ingesta | dispositivos → MQTT (Mosquitto) → Node-RED → InfluxDB | **Distribuida y desacoplada** por el broker (QoS 1, sesiones persistentes, cola persistente en Node-RED, almacenamiento y reenvío en los dispositivos) | Se encola y se recupera sin pérdida |
| Datos en vivo | dispositivos → MQTT → backend → WebSocket → navegador | Distribuida; **no depende de InfluxDB** | Si cae la base de datos, lo en vivo sigue |
| Histórico | navegador → Nginx → backend → InfluxDB | **Síncrona**: una petición espera a la base de datos | Antes de corregir: espera de 20 s y «Error interno» |
| Control | navegador → Nginx → backend → MQTT → dispositivo → confirmación (≤ 10 s) | Síncrona con tiempo límite | Antes de corregir: con el broker caído, «Error interno» |
| Interfaz | todo pasa por el backend | **Monolito modular** (REST, WebSocket, puente MQTT, alertas, IA, SQLite en un proceso) | Es el único punto de fallo de la interfaz |

**Conclusión:** la arquitectura es **distribuida en los bordes** (ingesta, Grafana y Node-RED en contenedores aislados que se comunican
por MQTT) y tiene un **núcleo monolítico** (el backend). Los fallos de los servicios de borde quedaron aislados en la prueba. El backend
es el punto único de fallo de la interfaz, aunque no de la captura: Node-RED sigue escribiendo en InfluxDB si el backend cae.

### 3.2 Fallos de servidor (réplica local, antes de corregir)

| # | Fallo inyectado | Comportamiento observado | ¿Se propaga? |
|---|---|---|---|
| F1 | InfluxDB colgado 30 s (`docker pause`) | Histórico: **500 «Error interno» tras 19,8 s**. `/api/health` «degraded». En vivo y órdenes funcionan | Aislado al histórico, pero con espera larga |
| F2 | InfluxDB caído (`docker stop`) | Histórico: 500 «Error interno» al instante. Recupera en 5,9 s | Aislado |
| F3 | Backend caído | API 504 a los 4,9 s y luego 502 HTML de Nginx. La interfaz muestra **«0/12 nodos», «0 alertas», «sin datos»** como si fueran datos reales, y «Error 502» | **Se propaga a toda la interfaz**; la ingesta sigue |
| F4 | Backend colgado (`docker pause`) | **Cada petición espera 59 s** y da 504. El WebSocket sigue «abierto» y la pantalla se congela **sin ningún aviso** | Se propaga a toda la interfaz (fallo silencioso) |
| F5 | Broker MQTT caído 30 s | Dispositivos 0/12 y vuelven en 6,4 s. **Hueco máximo de 10 s = sin pérdida de datos**. Una orden responde **503 «Error interno del servidor»** (el motivo real quedaba oculto) | Aislado; mensaje engañoso |
| F6 | Node-RED caído 30 s | Ingesta detenida; hueco máximo de 10 s al volver (el broker retuvo los mensajes). `/nodered/` → 502 HTML de Nginx | Aislado |
| F7 | Grafana caído | `/grafana/` → 502 HTML. El resto funciona | Aislado |
| F8 | Proveedor de IA inalcanzable | Chat → 502 «El proveedor de IA no respondió; intenta de nuevo…» en 0,06 s | Aislado, mensaje claro |
| F9 | APIs externas bloqueadas (Open-Meteo, datos.gov.co) | Los dispositivos reinician y siguen conectados; 11/12 en línea | Aislado |

### 3.3 Fallos simulados en el navegador (antes de corregir, contra producción)

8 respuestas anómalas de `/api/*` × 8 rutas = 64 combinaciones: **20 dejaban la aplicación en blanco** (JSON cortado: 8 de 8 rutas;
cuerpo `{}`: 4; lista de dispositivos con objetos incompletos: 8 de 8). Con 502, 504 o conexión cortada la aplicación no se caía,
pero mostraba «Error 502» o «Failed to fetch».

## 4. Fase 2 — Usuarios simulados

| Persona | Entorno | ¿Primer éxito? | Hallazgos |
|---|---|---|---|
| Impaciente | Producción | Sí, a los 3,4 s (temperatura en vivo). **Abandonó en Histórico** por un «Rate limit exceeded» en inglés | 12 |
| Escéptico | Producción | Confianza **condicionada**: TLS, HSTS, CSP y ausencia de rastreadores bien; sin operador identificado, sin privacidad ni contacto, y datos sintéticos sin etiqueta en el panel | 16 |
| Móvil 375 px con 3G | Producción | Sí, a los ~11 s. **8,1 s de pantalla en blanco**; el asistente desbordaba a 418 px y la bienvenida se abría desplazada | 16 |
| Hablante no nativo | Producción | Parcial: encuentra «53 AQI · Moderada» pero nada explica qué significa; jerga (MQTT, LWT, z-score), horas sin zona | 35 |
| Rompe cosas | Réplica | Ningún XSS ejecutado; inyecciones y JWT alterados rechazados. **Doble clic = 2 órdenes**; fecha extrema o sessionStorage corrupto = pantalla negra; 3 errores 500 por parámetros | 15 |

Informes completos: `docs/evidencias/qa-lanzamiento/personas/*-informe.md`.

## 5. Fase 3 — Backlog consolidado (priorizado por número de usuarios afectados)

| ID | Problema | Usuarios afectados (+ fase 1) | Estado |
|---|---|---|---|
| B-01 | Error de CSP en consola en cada página (fuente incrustada como `data:`) | 4 (impaciente, escéptico, móvil, rompe) | ✅ Corregido |
| B-02 | Carga lenta en 3G sin ningún indicador | 4 (móvil, impaciente, no nativo, escéptico) | ✅ Indicador inmediato (primer contenido de 8,1 a 2,1 s). 🟡 El fragmento de gráficas (144 KB) aún se descarga en todas las rutas |
| B-03 | Mensajes técnicos o en inglés («Error 502», «Failed to fetch», «Rate limit exceeded», «Error interno») | 3 + F1–F5 | ✅ Corregido en cliente, backend y Nginx. 🟡 Quedan en inglés algunos 400/413/415 de Fastify y zod |
| B-04 | Pantalla en blanco ante datos inesperados (JSON cortado, objetos incompletos, fecha extrema, sessionStorage corrupto) | 2 + R4/R5/R8 | ✅ Corregido |
| B-05 | Mientras carga (o si el backend cae) se muestran ceros y «Sin respuesta» como si fueran datos reales | 3 (no nativo, móvil, escéptico) + F3 | ✅ Corregido |
| B-06 | Etiquetas SIM/REAL ausentes en el panel o contradictorias (DEV06 REAL en Histórico) | 2 (escéptico, no nativo) | ✅ Corregido. 🟡 REAL agrupa salidas de modelos y el reanálisis (E06) |
| B-07 | Bienvenida: se abre desplazada en móvil y aparece también en enlaces directos | 3 (móvil, impaciente, no nativo) | ✅ Desplazamiento corregido. 🟡 Aparición en enlaces directos pendiente |
| B-08 | Jerga sin explicar (AQI, LWT, MQTT, z-score, «twin», «bucket») | 2 (no nativo, impaciente) | 🟡 AQI y LWT corregidos; el resto pendiente |
| B-09 | Sesión de operador: dura 30 días y no se revoca en el servidor; otra pestaña seguía operando tras cerrar sesión | 2 (escéptico, rompe) | ✅ Sesión de 12 h, token anulado en el servidor al cerrar sesión y pestañas sincronizadas |
| B-10 | Zonas táctiles menores de 44 px y botón flotante de Nodo que tapa contenido | 2 (móvil, impaciente) | 🟡 Cabecera corregida; resto pendiente |
| B-11 | Error de DEV11 que pide «mirar el log del controlador» | 2 (escéptico, no nativo) | ✅ Corregido (requiere redesplegar el controlador en la VM) |
| B-12 | Sin aviso cuando se pierde la conexión; un backend colgado congela la pantalla en silencio | 1 + F3/F4 | ✅ Corregido: latido cada 20 s, vigilante a 45 s y aviso inmediato si el navegador detecta que no hay red |
| B-13 | Espera de 59 s ante un backend colgado y de 20 s ante InfluxDB colgado | F1/F4 | ✅ Límites por ruta en Nginx y en el cliente, y cortacircuitos de InfluxDB |
| B-14 | Con el broker caído, la orden respondía «Error interno» y ocultaba el motivo | F5 | ✅ Corregido |
| B-15 | Doble envío de órdenes y de preguntas al asistente | 1 (rompe) | ✅ Corregido |
| B-16 | Errores 500 por parámetros (`limit` decimal o negativo, `series` repetido) | 1 (rompe) | ✅ Corregido |
| B-17 | Sin operador identificado, privacidad, términos ni contacto | 1 (escéptico) | ✅ Pie y página /acerca (también /privacidad, /terminos y /contacto) con qué es, procedencia, privacidad, términos de uso y contacto del equipo académico |
| B-18 | Instalación limpia rota en Linux o macOS: el script que crea `agg_5m` no era ejecutable en Git | Montaje de la réplica | ✅ Corregido |
| B-19 | `docker build --target test` del backend fallaba (5 pruebas): faltaban las muestras del firmware | Montaje de la réplica | ✅ Corregido |
| B-20 | Alertas decía «Todo tranquilo» cuando la carga fallaba | 1 (impaciente) | ✅ Corregido |
| B-21 | Desborde horizontal del asistente a 375 px | 1 (móvil) | ✅ Corregido |
| B-22 | Saltos de diseño (CLS) en Configuración y por el pie de página | 1 (móvil) | ✅ Corregido. 🟡 Alertas (0,13) pendiente |
| B-23 | Grafana mostraba su versión exacta sin iniciar sesión | 1 (escéptico) | ✅ Corregido |
| B-24 | Saludo y horas según la zona del navegador, no la de Colombia | 1 (no nativo) | ✅ Corregido el saludo y los campos de Histórico; 🟡 otras horas sin zona |
| B-25 | Texto «sin conexión (conexión perdida (LWT))» | 1 (impaciente) | ✅ Corregido |

## 6. Correcciones aplicadas

Todas se hicieron **con la prueba primero** (se vio fallar antes de corregir) cuando la lógica lo permitía. Las de solo interfaz se
verificaron con los usuarios simulados y el arnés de fallos.

| Capa | Archivo | Cambio |
|---|---|---|
| Cliente HTTP | `apps/frontend/src/lib/api.ts` | Tiempo límite (25 s, IA 60 s); mensajes claros en español por tipo de fallo; **un reintento** de lecturas ante 502/504 o corte de red (las escrituras nunca se repiten); validación de la forma de cada respuesta (`expect`); un 504 sin registro de orden ya no se trata como orden |
| Interfaz | `components/ErrorBoundary.tsx`, `main.tsx` | Barrera de error global y por ruta: en vez de pantalla en blanco, explicación con «Recargar» e «Ir al panel» |
| Datos en vivo | `lib/live.tsx`, `lib/liveData.ts` | Descarta dispositivos o eventos con forma inesperada; vigilante del WebSocket (sin mensajes en 45 s → reconexión); estado de error de carga |
| Aviso de conexión | `components/Layout.tsx` | Banda «Sin conexión con el servidor…» a los 6 s de corte, o al instante si el navegador sabe que no hay red; «…» mientras carga; pie con proyecto académico y enlace a /acerca |
| Entradas | `lib/guards.ts`, `HistoryPage.tsx`, `assistant.tsx` | Fechas inválidas o vacías avisan y muestran 24 h; conversación guardada corrupta se descarta |
| Doble envío | `DeviceControls.tsx`, `assistant.tsx` | Guarda síncrona (`useRef`) |
| Sesión | `lib/auth.tsx`, `apps/backend/src/{app,env,db}.ts` | Sesión de 12 h (antes 30 días); cada token lleva un identificador y `POST /api/auth/logout` lo anula en el servidor (tabla `revoked_tokens`); los tokens antiguos sin identificador dejan de valer; cerrar o abrir sesión en otra pestaña se refleja al instante |
| Contenido | `Dashboard.tsx`, `AboutPage.tsx`, `AssistantChat.tsx`, `AlertsPage.tsx`, `SettingsPage.tsx`, `DevicesPage.tsx` | Etiqueta SIM/REAL en el panel, explicación del AQI, saludo en hora de Colombia, página «Acerca y privacidad», aviso de privacidad en el asistente, error visible en Alertas y fichas, «Consultando…» en Configuración, sin jerga LWT |
| Móvil | `AssistantPage.tsx`, `Welcome.tsx`, `index.html`, `Layout.tsx` | Sin desborde, foco sin desplazar, indicador de carga en el HTML, botones de cabecera de 44 px, altura mínima del contenido |
| Build | `vite.config.ts` | Las fuentes nunca se incrustan como `data:` (cumple la CSP `font-src 'self'`) |
| Backend | `circuitBreaker.ts`, `influx.ts`, `app.ts` | Cortacircuitos de InfluxDB (3 fallos → 15 s respondiendo al instante); 503 «El histórico no está disponible…»; los errores deliberados conservan su mensaje; límite de solicitudes en español; `limit` entero entre 1 y 200; `series` repetido → 400; latido de WebSocket cada 20 s; procedencia real de DEV06 en estadísticas |
| Backend | `ai/routes.ts`, `alerts.ts` | Mensaje propio para agente inválido; «sin conexión: motivo» sin paréntesis doble |
| Gateway | `infra/nginx/snippets/app.conf`, `proxy.conf` | 502/504 de la API en JSON en español; página propia si Grafana o Node-RED no responden; `proxy_read_timeout` 30 s (IA 65 s) en vez de 60 s; conexión interna 2 s |
| Infra | `docker-compose.yml`, `infra/influxdb/init/…sh`, `apps/backend/Dockerfile` | Grafana oculta su versión; script de InfluxDB ejecutable; la imagen de pruebas incluye las muestras del firmware |
| Dispositivos | `VirtualDevice.ts`, `sketch.ino`, `samples/status-offline.json`, `vm/controller.py` | Motivos de desconexión y error de DEV11 en lenguaje claro |

Pruebas nuevas: `api.test.ts` (25), `liveData.test.ts` (11), `guards.test.ts` (11), `resilience.test.ts` (21) y `session.test.ts` (5).
**Total: 193 pruebas unitarias en verde** (shared 21, devices 22, backend 83, frontend 47, Node-RED 20), sin errores de tipos, y las imágenes de Docker se
construyen con su etapa de pruebas en verde.

## 7. Regresión sobre la versión corregida (réplica local)

### 7.1 Fallos simulados en el navegador

| | Antes | Después |
|---|---|---|
| Pantallas en blanco (64 combinaciones) | **20** | **0** |
| Errores de JavaScript | 20 | 0 |
| Mensajes técnicos («Error 502», «Failed to fetch») | 3 rutas | 0 |

### 7.2 Fallos de servidor

| # | Fallo | Antes | Después |
|---|---|---|---|
| F1 | InfluxDB colgado | Histórico 500 «Error interno» tras 19,8 s, en cada petición | 503 «El histórico no está disponible… las lecturas en vivo siguen funcionando». La primera petición espera ~20 s y **las siguientes responden en 2–5 ms** (cortacircuitos); vuelve solo ~18 s después de que InfluxDB se recupera |
| F2 | InfluxDB caído | 500 «Error interno» | 503 con el mismo mensaje claro en 0,03 s |
| F3 | Backend caído | 504 a los 4,9 s; ceros en el panel; «Error 502» | 504 JSON en español a los **2,0 s**; cabecera «Sin conexión · …/12 nodos», banda de aviso y «No se pudieron cargar los dispositivos… reintenta sola» |
| F4 | Backend colgado | **59,1 s** por petición; pantalla congelada sin aviso | **29,5 s** con mensaje «El servidor tardó demasiado…» y banda «Sin conexión con el servidor» |
| F5 | Broker MQTT caído | Orden → 503 «Error interno del servidor» | Orden → 503 «El backend no está conectado al broker MQTT». Sin pérdida de datos (hueco máximo 9,9 s) |
| F6 | Node-RED caído | 502 HTML de Nginx | 503 página propia en español; sin pérdida de datos (hueco máximo 9,9 s) |
| F7 | Grafana caído | 502 HTML de Nginx | 503 página propia en español |
| F8 | IA no disponible | 502 con mensaje claro | Igual (ya estaba bien) |
| F9 | APIs externas caídas | Aislado | Igual (ya estaba bien) |
| Red | Corte de red de 60 s en móvil | Aviso a los 51–59 s | Aviso **a los 4 s** en 3 de 3 cortes; 0 pantallas de error y 0 errores de JavaScript al volver |

### 7.3 Usuarios simulados

| Persona | Corregidos y verificados en ejecución | Persisten (pendientes) |
|---|---|---|
| Impaciente | I-01, I-02, I-05, I-11 (I-07 en parte) | I-03 límite por IP compartida, I-04, I-06, I-09, I-10, I-12 |
| Escéptico | E01, E03, E04, E08, E14 (E02 en parte); E02 (términos y contacto), E05, E07 y E09 corregidos después de su regresión | E06, E11, E12, E13, E15 |
| Móvil | M1 (418 → 375 px), M3, M4 (8,1 → 2,1 s), M6 (CLS 0,449 → 0,010), M7, M11, M15; M9 y N1 corregidos después | M2 en parte, M5, M8, M10, M12–M14, M16 |
| No nativo | NN-03, NN-05, NN-21 (NN-01, NN-09 y NN-10 en parte) | Jerga restante, horas sin zona, CSV en UTC, textos en inglés de Leaflet y de los modos |
| Rompe cosas | R1, R2, R3, R4, R6, R7, R8, R10, R15 (R11 en parte); R5 (revocación del JWT) y R13 corregidos después | R9, R12, R14 |

El usuario móvil vio una vez la pantalla de error al volver la red tras un corte de 60 s (N2). Se repitió 3 veces con el mismo
guion y **no se reprodujo** (0 pantallas de error, 0 errores de JavaScript). Queda abierto como no confirmado.

## 8. Pendientes y riesgos

| # | Pendiente | Quién |
|---|---|---|
| 1 | **Desplegar estas correcciones en la VM** (`bash infra/scripts/deploy.sh backend web devices grafana`) y reiniciar el controlador de DEV11 (`systemctl restart dev11-controller`) tras copiar `controller.py` | Propietario (requiere su aprobación) |
| 2 | Restringir de nuevo la regla `SSH_ANY` del NSG a la IP del propietario (ya figuraba en `DESPLIEGUE.md`) | Propietario |
| 3 | Backlog 🟡 de §5 (jerga, zonas táctiles, fragmento de gráficas, bienvenida en enlaces directos, mensajes en inglés de Fastify y zod) | Equipo |
| 4 | Volver a ejecutar en producción los fallos de navegador (`route_faults.mjs`) tras el despliegue | Equipo |
