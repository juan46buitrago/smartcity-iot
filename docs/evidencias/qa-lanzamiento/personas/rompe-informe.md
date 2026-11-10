# Informe QA: «El que rompe cosas», réplica local de SmartCityBGA

- Destino: solo http://127.0.0.1:8380. No se tocó producción.
- Fecha: 2026-11-09. El código citado sale de `git show HEAD:<ruta>`.
- Volumen: ráfagas de 30 peticiones como máximo, con pausas de 2 a 3 s cada 25.
- Contraseña: la leyeron los scripts en tiempo de ejecución y no aparece aquí.
- Scripts y logs en `scratchpad/personas/rompe/`:
  - `t1_auth.mjs` → `t1.log`
  - `t2_cmds.mjs` → `t2.log`
  - `t3_hist.mjs` → `t3.log`
  - `t4_ai.mjs` → `t4.log`
  - `t5_ui.mjs` → `t5a.log` (sección A) y `t5b.log` (secciones B a D)
  - `t6_dbl.mjs` → `t6.log`
- Capturas: `*.png` en esa misma carpeta.
- Estado final de DEV01: encendido, intervalo 10 s, modo `twin`, igual que al empezar.

## 1. Pruebas ejecutadas (entrada exacta → resultado observado)

### 1.1 Autenticación y JWT (t1)
- Login con contraseña correcta → 200. Payload `{"sub":"operador","role":"operator",iat,exp}`, con exp a 30 días.
- `POST /api/auth/login {}` → 400 «Contraseña requerida».
- `{"password":123}` → 400 «Contraseña requerida».
- `{"username":"admin' OR '1'='1' --","password":"' OR 1=1 --"}` → 401 «Credenciales inválidas».
- Cuerpo `{"password":` con Content-Type JSON → 400 «Body is not valid JSON but content-type is set to 'application/json'» (en inglés).
- 6.º intento en el mismo minuto → 429 «Rate limit exceeded, retry in 1 minute» (en inglés).
- `/api/auth/me`:
  - Sin token → 401 «Se requiere iniciar sesión como operador».
  - Token válido → 200.
  - `alg:none` → 401.
  - Payload alterado (`sub:root`, `role:admin`) → 401.
  - `exp` alterado → 401.
  - Firma alterada → 401.
  - `Bearer ` vacío → 401.
  - `Basic …` → 401.
  - `Bearer tok, Bearer x` → 401.
  - `Bearer` + 8000 caracteres «A» → 401.
  - `Bearer` en minúsculas con token válido → 200.
- `Authorization` de 40 000 caracteres → 400 HTML de nginx «Request Header Or Cookie Too Large».
- `POST /api/devices/DEV01/commands` con token `alg:none` o alterado → 401.
- `POST /api/alerts/1/ack` sin token → 401.
- `POST /api/ai/analysis/DEV01` sin token → 401.

### 1.2 Órdenes y parámetros de ruta en la API (t2, t3)
- `GET /api/devices/<id>` → 404 JSON «Dispositivo no encontrado» con cada uno de estos valores:
  - `<script>alert(1)</script>`
  - `dev01`
  - `DEV01%20`
  - `😀`
  - `DEV01' OR '1'='1`
  - `__proto__`
  - `constructor`
- `GET /api/devices/..%2F..%2Fetc%2Fpasswd` → 200 `text/html`: es el index.html de la SPA, no un archivo del sistema. Con `curl --path-as-is` y `/api/devices/../../etc/passwd` → 200 `text/html`, también la SPA.
- `GET /api/devices/DEV01%00` → 400 de nginx.
- `GET /api/devices/` + 5000 «A» → 414 `{"error":"Bad Request","code":"FST_ERR_MAX_PARAM_LENGTH","message":"'/api/devices/AAAA…"}`. Devuelve la ruta completa en el mensaje y no sigue el formato `{error}` del resto de la API.
- `PUT /api/devices/DEV01/commands` → 404 `{"message":"Route PUT:… not found","error":"Not Found","statusCode":404}`. Mismo formato para `/api/nonexistent`.
- `?limit=` en los listados de órdenes:
  - `limit=-5`, `abc` y `1e9` → 200.
  - `/api/commands?limit=-1` y `limit=Infinity` → 200 con todas las filas, sin el tope de 200. Con 8 filas en la base, `-1` y `200` devolvieron lo mismo.
  - **`/api/commands?limit=0.5`, `limit=1e-7` y `/api/devices/DEV01/commands?limit=1.5` → 500 «Error interno del servidor».**
- `POST /api/devices/DEV01/commands` con token:
  - `{}` → 400 «Orden inválida…».
  - `action:"rm -rf"` → 400 «Orden inválida…».
  - `action:["restart"]` → 400 «Orden inválida…».
  - `params:"interval_s=10"` → 400 «Orden inválida…».
  - `params:null` → 400 «Orden inválida…».
  - `interval_s:"10"` → 400 «interval_s: Invalid input: expected number, received string».
  - `interval_s:-1` → 400 «Too small: expected number to be >=2».
  - `interval_s:2.5` → 400 «expected int».
  - `interval_s:1e308` → 400 con dos mensajes encadenados.
  - Campo extra `evil:"<img…>"` → 400 «Unrecognized key».
  - `mode:"<img src=x onerror=alert(1)>"` → 400 «Invalid option».
  - `calibrate variable:"__proto__"` → 400.
  - `offset:21` → 400 «<=20».
  - `threshold:{min,max}` → 400 «Unrecognized keys».
  - JSON con `__proto__` y `constructor.prototype` → 400 «Body is not valid JSON…»: el parser lo rechaza, pero el mensaje no dice el motivo real.
  - JSON truncado → 400.
  - `text/plain` → 400.
  - `x-www-form-urlencoded` → 415 «Unsupported Media Type».
  - Sin Content-Type → 400.
  - 20 KB → 413 «Request body is too large».
  - 5000 corchetes anidados → 400.
  - `application/json; charset=utf-16` con cuerpo UTF-8 → 200: aceptado y la orden se ejecutó.
  - `/api/devices/<svg onload=alert(1)>/commands` → 404.
- Los mensajes de validación de zod y de Fastify llegan al usuario en inglés: «Too small…», «Body is not valid JSON…», «Rate limit exceeded…».

### 1.3 Histórico, comparación, incidentes y alertas (t3)
- `/api/history/DEV01/temperature`:
  - `?from=ayer` → 400 «Parámetros de rango inválidos (use ISO 8601)».
  - `?from=…Z' OR 1=1--` → 400.
  - Variable `temperature") |> drop(columns:["_value"]) //` (inyección Flux) → 404 «Variable no numérica o inexistente».
  - Variable `__proto__` → 404.
  - `from>to` → 400 «"from" debe ser anterior a "to"».
  - Rango de 10 meses → 400 «El rango máximo es de 90 días».
  - `points=0`, `1e9` y `abc` → 400. El mensaje, «use ISO 8601», no corresponde al campo que falla.
  - Años 1900 y 9999 → 200 con la serie vacía.
  - Offsets `+14:00` y `-12:00` → 200.
  - `from` repetido → 400.
- `/api/compare`:
  - 5 series → 400.
  - `,,,,` → 400.
  - `DEV01.__proto__` → 404.
  - `constructor.x` → 404.
  - Serie duplicada → 200.
  - **`?series=DEV01.temperature&series=DEV01.humidity` → 500 «Error interno del servidor».**
- `/api/capture?from=x` → 400.
- `/api/incidents/stats?from=…'); DROP TABLE incidents;--` → 400.
- `/api/incidents?scope=all` → 400.
- `/api/incidents?limit=-1` → 400.
- `/api/alerts?status=abierta' OR 1=1--`, `limit=0` y `device=DEV99` → 400 «Filtro de alertas inválido».
- `POST /api/alerts/<id>/ack` con token:
  - `abc`, `-1`, `0`, `1.5` y `%20` → 400 «Identificador inválido».
  - `1e3`, `99999999999999999999`, `0x7fffffff` y `9007199254740993` → 404 «Alerta no encontrada o ya resuelta». Es decir, el backend acepta notación exponencial y hexadecimal como identificador válido.
- CORS: `OPTIONS` con `Origin: http://evil.example` → 204 sin `Access-Control-Allow-Origin`.
- La SPA envía estas cabeceras: CSP estricta (`script-src 'self'`), `X-Frame-Options: DENY` y `nosniff`.

### 1.4 Asistente, API (t4)
- `question` con valor `a`, 301 caracteres, `"      a       "` o `12345` → 400 «Escribe una pregunta de 2 a 300 caracteres».
- `agent:"<script>"` → 400 con el mismo mensaje de longitud, aunque la pregunta era válida.
- `<img src=x onerror=alert(document.domain)>` → 502.
- 150 o 151 emojis (300 o 302 unidades UTF-16) → 502.
- `previous` de 15 KB → 502.
- Texto con RTL, ZWSP, `\u0000` y BOM → 502.
- En todos los 502 el mensaje es «El proveedor de IA no respondió; intenta de nuevo en unos segundos.».
- `/api/ai/status` responde `enabled:true` y los fallos se van contando (`failed:6`).
- `POST /api/ai/analysis/DEV01 {"hours":"abc"}` → 400 «Ventana inválida (1 a 336 horas)».
- `/api/ai/analysis/..%2FDEV01` → 404.
- `{"hours":1}` → 502 con el mismo mensaje.

### 1.5 Interfaz: parámetros de ruta (t5, sección A)
- Se probó `/dispositivos/<p>` con estos valores. Ninguno ejecutó un payload, no apareció ningún `#pwn` ni `[onerror]`, no hubo `pageerror` ni diálogos, y todos mostraron «Dispositivo no encontrado»:
  - `<img id=pwn src=x onerror=alert(1)>`
  - `%3Csvg id=pwn onload…%3E`
  - `__proto__`
  - `constructor`
  - `😀ñ‮`
  - 3000 «A»
  - `javascript:alert(1)`
- `dev01`, `DEV01?x=<script>` y `DEV01#<img…>` → muestran la ficha de DEV01 sin inyección.
- `/dispositivos/..%2F..%2Fetc%2Fpasswd` y `/dispositivos/DEV01%00` → página 400 de nginx, no la SPA (captura `A-ruta-*`).
- `/esto/no/existe/<b>x</b>` → «Esa calle no está en el mapa».
- En consola sale «Refused to load the font 'data:font/woff2;base64,…'»: la CSP (`font-src 'self'`) bloquea una fuente embebida.

### 1.6 Interfaz: histórico (t5, sección B)
- `/historico?from=<img…>&to=9999&series=DEV01.__proto__` → se ignoran los parámetros y la página carga normal.
- Rango «Personalizado» con Desde `2026-11-09T12:00` y Hasta `2026-11-01T12:00` → mensaje de error, sin caída.
- Desde `1900-01-01T00:00` → «No se pudo consultar el histórico · El rango máximo es de 90 días».
- **Hasta `275760-09-13T00:00` → la app entera queda en negro (`#root` sin hijos) con `RangeError: Invalid time value`.** Captura `B-275760.png`.
- Borrar Desde (campo vacío) → no se cae. El encabezado muestra «1 de ene, 05:00 → 9 de nov» con el campo vacío y el error de 90 días. `new Date(':00-05:00')` da el 1 de enero de 2000. Captura `B-desde-vacio.png`.

### 1.7 Interfaz: asistente y sessionStorage (t5 sección C; t6 sección G)
- Pregunta `<img id=pwn src=x onerror=alert(1)>{{7*7}}${7*7}<script>alert(2)</script>` → se muestra como texto literal, no se ejecuta y no hay diálogos. Error visible: «El proveedor de IA no respondió; intenta de nuevo en unos segundos.» con el botón «Reintentar» (captura `C-xss-error.png`).
- Esa pregunta queda guardada en `sessionStorage['scbga.assistant']`. Al recargar se vuelve a pintar como texto y sigue sin ejecutarse.
- El textarea con 400 caracteres tecleados se queda en 300 (`maxLength`).
- **Dos `click()` sincrónicos en «Enviar pregunta» → 2 `POST /api/ai/chat`.**
- Pulsar Enter dos veces → 1 POST.
- sessionStorage manipulado:
  - Respuesta `ai` bien formada con texto `<img …onerror…>`, `[enlace](javascript:alert(4))` y `links[].to="javascript:alert(5)"` → no hay inyección. React reemplaza los `href` por `javascript:throw new Error('React has blocked a javascript: URL…')`.
  - **Mensajes `ai` sin `usage` o sin `res`, o `msgs` que no es un array → toda la app queda en negro, también tras recargar.** Errores:
    - `Cannot read properties of undefined (reading 'prompt_tokens')`
    - `… (reading 'usage')`
    - `t.current.msgs.map is not a function`
  - JSON roto o agente inexistente → se recupera.

### 1.8 Interfaz: sesión en localStorage (t5 sección D; t6 sección F)
- `scbga.session` con token caducado (`exp:100`) → se borra al cargar y la interfaz queda sin sesión. Correcto.
- Token con firma falsa y `exp` futuro → la interfaz se muestra desbloqueada. Al pulsar «Reiniciar», el backend responde 401, el frontend borra la sesión de localStorage y abre «Desbloquear controles». Correcto.
- `user:"<img id=pwn…>"` → no se ejecuta.
- `user:{a:1}`, `token:123`, JSON roto o `null` → `/configuracion` carga sin `pageerror`.
- Logout en la pestaña A → `scbga.session` queda en `null` en A.
- **La pestaña B sigue desbloqueada, «Reiniciar» crea 1 orden nueva y no pide login. El token anterior sigue dando 200 en `/api/auth/me` después del logout.**

### 1.9 Interfaz: doble clic, recarga y atrás a mitad de orden (t6 sección E)
- **Dos `click()` sincrónicos en «Reiniciar» → 2 POST y 2 órdenes nuevas en `/api/devices/DEV01/commands`.**
- `dblclick()` de Playwright en «Reiniciar» → 1 POST y 1 orden.
- **Dos `click()` sincrónicos en «Apagar» → 2 órdenes `power {"on":false}`, ambas `confirmed`.** El dispositivo se volvió a encender después.
- Respuesta de la orden retenida 4 s y recarga a los 0,5 s → 1 orden en el backend. Tras recargar, la página está completa y «Reiniciar» está habilitado. Interfaz coherente.
- Misma retención, con atrás y adelante a los 0,3 s → 1 orden y la ruta queda en `/dispositivos/DEV01`. A los 5 s «Reiniciar» seguía deshabilitado y no se veía ningún toast de resultado. No pude determinar si era por un `busy` colgado o porque el dispositivo estaba reiniciándose; queda como observación.

## 2. Hallazgos

| id | severidad | superficie | entrada | qué pasó | evidencia | causa probable |
|---|---|---|---|---|---|---|
| R1 | alta | Histórico (UI) | «Personalizado», Hasta = `275760-09-13T00:00` | Pantalla en negro en toda la app; `RangeError: Invalid time value` | `t5b.log` B-275760, `B-275760.png` | `fromLocalInput` crea una fecha fuera de rango y `range.to.toISOString()` lanza dentro de `useEffect` (`apps/frontend/src/pages/HistoryPage.tsx:46-48` y `:112`). No hay ErrorBoundary en `main.tsx` |
| R2 | alta | Órdenes (UI) | Dos `click()` sincrónicos en «Reiniciar» o «Apagar» | 2 órdenes enviadas y confirmadas (`restart`×2; `power {"on":false}`×2) | `t6.log` E-reiniciar-click-click, E-power-click-click | `send` no comprueba `busy` antes del `await`; el botón solo se deshabilita en el siguiente render (`apps/frontend/src/components/DeviceControls.tsx:24-32`). El backend no desduplica (`apps/backend/src/mqttBridge.ts:214-221`) |
| R3 | media | API órdenes | `GET /api/commands?limit=0.5`, `?limit=1e-7`, `/api/devices/DEV01/commands?limit=1.5` | 500 «Error interno del servidor» | `t3.log` | `Number(req.query.limit) \|\| 50` acepta decimales y SQLite rechaza un `LIMIT` no entero (`apps/backend/src/app.ts:170-173`) |
| R4 | media | API compare | `/api/compare?series=DEV01.temperature&series=DEV01.humidity` | 500 | `t3.log` compare-array | Un parámetro repetido llega como array y `.split` falla (`apps/backend/src/app.ts:193`) |
| R5 | media | Sesión | Logout en la pestaña A y orden desde la pestaña B | B sigue operando; el token sigue válido tras el logout (`/api/auth/me` 200) | `t6.log` F-* | El logout solo borra localStorage (`apps/frontend/src/lib/auth.tsx:55-62`); no hay escucha de `storage` ni revocación del JWT (TTL de 30 días) |
| R6 | media | Asistente (UI) | Dos `click()` sincrónicos en «Enviar pregunta» | 2 `POST /api/ai/chat` (gasta cuota y límite de 12/min) | `t5b.log` C-doble-submit | La guarda `busy` de `ask` se lee de la clausura del render anterior (`apps/frontend/src/lib/assistant.tsx:88`) |
| R7 | baja | Asistente (UI) | sessionStorage `scbga.assistant` con un mensaje `ai` sin `usage` o `res`, o `msgs` no-array | Pantalla en negro en toda la app, persistente al recargar en esa pestaña | `t5b.log` C-ss-*, `C-ss-*.png` | `load()` no valida la forma de los datos (`apps/frontend/src/lib/assistant.tsx:46-54`); `res.usage.prompt_tokens` sin comprobar (`apps/frontend/src/components/AssistantChat.tsx:123`) |
| R8 | baja | API órdenes | `/api/commands?limit=-1` o `limit=Infinity` | 200 con todas las filas, sin el tope de 200 | `t3.log` | `Math.min(200, -1)` da `-1` y `LIMIT -1` en SQLite significa sin límite (`apps/backend/src/app.ts:170-173`) |
| R9 | baja | Asistente | Proveedor de IA no disponible | Mensaje «no respondió; intenta de nuevo en unos segundos» aunque el fallo es persistente; `/api/ai/status` dice `enabled:true` | `t4.log`, `C-xss-error.png` | `LlmError` se traduce a 502 con texto de error transitorio (`apps/backend/src/ai/routes.ts`, `aiErrorStatus`) |
| R10 | baja | API asistente | `{"question":"hola mundo","agent":"<script>"}` | 400 «Escribe una pregunta de 2 a 300 caracteres»: un mensaje equivocado | `t4.log` ai-agent-bad | Un único mensaje para cualquier fallo de `ChatBody` (`apps/backend/src/ai/routes.ts`, ruta `/api/ai/chat`) |
| R11 | baja | API, varios | JSON roto, 6.º login, cuerpo de 20 KB, `interval_s:-1`, ruta inexistente | Mensajes en inglés: «Body is not valid JSON…», «Rate limit exceeded…», «Request body is too large», «Too small: expected…», «Route GET:… not found». El panel de login muestra `err.message` tal cual | `t1.log`, `t2.log` | Mensajes por defecto de Fastify, `@fastify/rate-limit` y zod sin traducir (`apps/backend/src/app.ts:98-101`; `packages/shared/src/schemas.ts:224`) |
| R12 | baja | API, formato | Ruta de 5000 caracteres; método o ruta inexistente | 414 con `code` y la ruta completa en `message`; 404 con `{message,error,statusCode}`: no siguen el formato `{error}` | `t2.log` | Sin `setNotFoundHandler`; el error de router de Fastify no pasa por el manejador (`apps/backend/src/app.ts:98`) |
| R13 | baja | Histórico (UI) | Campo Desde vacío | El campo queda vacío pero el rango usado es «1 de ene 05:00» (año 2000) y aparece el error de 90 días | `B-desde-vacio.png` | `new Date(':00-05:00')` es una fecha válida en V8 (`apps/frontend/src/pages/HistoryPage.tsx:46-48`) |
| R14 | baja | API, validación | `points=abc` en el histórico; `ack` con id `1e3` o `0x7fffffff`; `charset=utf-16` | Mensaje «use ISO 8601» para `points`; ids exponenciales o hexadecimales aceptados como enteros (404 en vez de 400); cuerpo UTF-8 con charset UTF-16 aceptado | `t3.log`, `t2.log` | Mensaje único en `parseRange` (`apps/backend/src/app.ts:54`); `Number(req.params.id)` (`apps/backend/src/app.ts:230`) |
| R15 | baja | Frontend, CSP | Cualquier página | Consola: «Refused to load the font 'data:font/woff2…'» | `t5a.log` A-dialogs | La CSP de nginx tiene `font-src 'self'` sin `data:` y alguna dependencia incrusta la fuente |

Sin hallazgo en estas superficies:
- XSS reflejado o almacenado: no se ejecutó ningún payload en ruta, asistente, sessionStorage ni localStorage.
- Inyección SQL y Flux: todo se rechazó con 400 o 404.
- Path traversal: siempre devuelve la SPA o un 400 de nginx.
- JWT: `alg:none`, payload o firma alterados → 401.
- Token caducado: se limpia al cargar.
- Token con firma falsa: tras el primer 401 se limpia y se pide login.
- Recarga a mitad de orden: interfaz coherente.
