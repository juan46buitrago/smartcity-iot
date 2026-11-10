# Regresión: «El que rompe cosas», réplica con correcciones (http://127.0.0.1:8380)

## Cómo se probó
- Fecha: 2026-11-09.
- Solo se usó 127.0.0.1:8380.
- Scripts y salida, todos en `scratchpad/personas/rompe/`:
  - `r_all.mjs` → `r.log`
  - `r_b.mjs` → `r_b.log`
  - `r_c.mjs` → `r_c.log`
- Capturas: `reg-*.png`.
- La réplica se reinició dos veces durante la prueba: dio ECONNREFUSED y luego `uptime_s` 13 y 149. Las pruebas afectadas se repitieron con la réplica ya arriba.

## Estado de DEV01
- Al inicio y al final: `enabled:true`, `interval_s:10`, `mode:twin`.
- Tras apagarlo en la prueba de R2, se volvió a encender.

## Credenciales y token
- El token vivió solo en memoria.
- `personas/rompe/.token` se borró al empezar y no queda ninguna copia.
- La contraseña no aparece en ningún archivo.

| id | estado | evidencia |
|---|---|---|
| R1 | corregido | Hasta = `275760-09-13T00:00`: la página sigue entera (`#root` con 2 hijos) y no hay `pageerror`. Aviso: «Fechas no válidas: «Desde» debe ser anterior a «Hasta» y ambas entre 2000 y 2100. Se muestran las últimas 24 h.». La serie mostrada va del 8 nov 17:39 al 9 nov 17:39 (`reg-R1.png`, `r.log` R1). |
| R2 | corregido | Dos `click()` sincrónicos en «Reiniciar dispositivo» → 1 POST y 1 orden nueva (`r.log` R2-reiniciar). Dos `click()` sincrónicos en «Apagar» → 1 orden `power {"on":false}` confirmada (`r_c.log` R2-power). |
| R3 | corregido | `/api/commands?limit=0.5`, `limit=1e-7` y `/api/devices/DEV01/commands?limit=1.5` → 200, ya no 500 (`r.log`). Con `limit=1.5` devuelve 1 fila. |
| R4 | corregido | `/api/compare?series=DEV01.temperature&series=DEV01.humidity` → 400 «Indique las series en un solo parámetro, separadas por comas». |
| R5 | corregido en la interfaz; el servidor sigue igual | Cerrar sesión en la pestaña A → la pestaña B muestra «Controles bloqueados», «Reiniciar» queda deshabilitado y no crea órdenes (`r.log` R5, `reg-R5-pestanaB.png`). El JWT anterior sigue dando 200 en `/api/auth/me` tras el logout: no hay revocación, como se avisó. |
| R6 | corregido | Dos `click()` sincrónicos en «Enviar pregunta» → 1 `POST /api/ai/chat` (`r.log` R6). |
| R7 | corregido | sessionStorage con un mensaje `ai` sin `usage`, un mensaje `ai` sin `res` o `msgs:"hola"` → la app carga sin `pageerror` y el almacenamiento se reescribe como `{"msgs":[],"agent":"general"}` (`r.log` R7-*). |
| R8 | corregido | `limit=-1`, `0`, `Infinity` y `1e9` devuelven 20 filas, el total de la tabla (por debajo del valor por defecto, 50). `limit=2` devuelve 2. Con 20 filas no se puede ver el tope de 200 directamente; el código del árbol de trabajo (`listLimit`, `apps/backend/src/app.ts:65-68`) limita a 1..200 y usa 50 por defecto. |
| R9 | persiste | `POST /api/ai/chat` → 502 «El proveedor de IA no respondió; intenta de nuevo en unos segundos.». `/api/ai/status` sigue con `enabled:true` y `failed:11`. No estaba en la lista de corregidos. |
| R10 | corregido | `{"question":"hola mundo","agent":"<script>"}` → 400 «Agente no válido: elige uno de la lista». |
| R11 | parcial | Corregido: el límite de intentos de login responde 429 «Demasiadas solicitudes seguidas. Espera N s e inténtalo de nuevo.», y el popover muestra ese texto (`r_b.log` R11-popover, `reg-R11-login.png`). Persisten en inglés: JSON roto → «Body is not valid JSON but content-type is set to 'application/json'»; 413 → «Request body is too large»; 415 → «Unsupported Media Type»; zod → «interval_s: Too small: expected number to be >=2». Los 502/504 de nginx en JSON no se pudieron provocar sin parar contenedores. |
| R12 | persiste | `/api/nonexistent` y `PUT /api/devices/DEV01/commands` → 404 `{"message":"Route … not found","error":"Not Found","statusCode":404}`. Ruta de 5000 caracteres → 414 `{"error":"Bad Request","code":"FST_ERR_MAX_PARAM_LENGTH","message":"'/api/devices/AAAA…"}`. No estaba en la lista de corregidos. |
| R13 | persiste | Con «Desde» vacío no aparece ningún aviso. El encabezado muestra «1 de ene, 05:00 → 9 de nov, 17:40» y el error «El rango máximo es de 90 días» (`reg-R13.png`). La fecha fantasma (año 2000) cae dentro de la validación nueva de 2000 a 2100. |
| R14 | persiste | `points=abc` → 400 «Parámetros de rango inválidos (use ISO 8601)». `POST /api/alerts/1e3/ack` y `/api/alerts/0x7fffffff/ack` → 404, no 400. Content-Type `application/json; charset=utf-16` con cuerpo UTF-8 → 200: se ejecutó `set_interval 10`, que ya era el valor vigente. No estaba en la lista de corregidos. |
| R15 | corregido | Tras cargar `/historico`, la consola no tiene ningún «Refused to load the font». Solo quedan los 404/400 de las consultas que se forzaron a propósito (`r.log` R15-consola). |
| Obs. atrás/adelante | no es defecto | Se retuvo la respuesta de «Reiniciar» 4 s y se hizo atrás y adelante a los 0,3 s. Resultado: 1 orden y la ruta queda en `/dispositivos/DEV01`. Muestras cada 1,5 s: la primera, botón deshabilitado y «desconectado» en pantalla; de la segunda en adelante, botón habilitado y en línea (`r_b.log`). El bloqueo que se vio en la primera ronda corresponde al reinicio real del dispositivo (desconectado unos segundos), no a un `busy` colgado. |
