# Regresión E01–E16 · persona «El escéptico»

Fecha: 2026-11-09. Réplica local `http://127.0.0.1:8380` (HTTP sin TLS, sin proveedor de IA, sin DEV11). No toqué producción ni los contenedores.

- **Segunda pasada (17:42–17:44 COT): en vivo.** Chromium headless con Playwright más curl. El navegador abortaba cualquier método que no fuera GET o HEAD, y no hubo ninguna petición bloqueada. Revisé E01–E04, E07, E08, E14 y E15.
- **Primera pasada: estática.** La réplica no respondía, así que revisé el código de `/Users/santiago/smartcity-iot/.claude/qa-replica`. Los ids que no se repitieron en vivo conservan esa evidencia de código.

Evidencias en `/private/tmp/claude-501/-Users-santiago-smartcity-iot/c75cc074-6e4a-4c36-bbf7-38f5aa59defc/scratchpad/personas/esceptico/reg/`: `reg.json`, `r-panel.png`, `r-footer.png`, `r-acerca.png`, `r-asistente.png`, `r-drawer.png`, `r-429.png` y `r-grafana.png`. El script es `reg.mjs`.

## Tabla

| id | estado | comprobado | evidencia |
|---|---|---|---|
| E01 | corregido | **en ejecución** | El `<footer>` de `/` dice «Proyecto académico de la UNAB · no es un servicio oficial de la Alcaldía de Bucaramanga · Acerca y privacidad» y enlaza a `/acerca` (`r-footer.png`, `r-429.png`). `/acerca` identifica la asignatura y la UNAB y declara la no afiliación. |
| E02 | **parcial: persiste falta de contacto y términos** | **en ejecución** | `/acerca` y `/privacidad` muestran la página «Acerca y privacidad», que cita la Ley 1581 (`r-acerca.png`). `/terminos` y `/contacto` siguen dando el 404 de la SPA, «Esa calle no está en el mapa». No hay canal de contacto ni de habeas data; queda pendiente del propietario. |
| E03 | corregido | **en ejecución** | Bajo el campo, tanto en `/asistente` como en el panel lateral de Nodo, se lee «Tus preguntas se envían a un proveedor externo de IA: no escribas datos personales. Privacidad» (`r-asistente.png`, `r-drawer.png`). No pude probar el chat porque la réplica no tiene proveedor de IA. |
| E04 | corregido | **en ejecución** | Las 9 tarjetas del panel llevan etiqueta: DEV01 SIM, DEV02 REAL, DEV03 SIM, DEV04 SIM, DEV05 SIM, DEV07 SIM, DEV08 SIM, DEV09 REAL y DEV10 REAL (`r-panel.png`). |
| E05 | persiste | en código | `packages/shared/src/catalog.ts:223`: DEV06 sigue con `synthetic: false`, y la tabla de evidencia (`HistoryPage.tsx:376`) lee del catálogo, así que seguirá mostrando DEV06 como REAL. |
| E06 | persiste (mitigado en texto) | en código y en ejecución | La etiqueta sigue siendo binaria. `/acerca` ya aclara que REAL incluye «salidas de modelos, no estaciones» y «un reanálisis histórico (ERA5) del mismo día del año anterior», pero el badge REAL de las tarjetas no lo distingue. |
| E07 | **persiste** | **en ejecución** (429 simulado en el navegador, sin cargar el servidor) | Con todas las respuestas `/api/*` forzadas a 429, la ficha `/dispositivos/DEV05` quedó más de 10 s en «Cargando…» con «…/12 NODOS» y **sin mensaje**. El texto nuevo «Demasiadas solicitudes seguidas…» (`lib/api.ts:30`) no aparece en esta vista (`r-429.png`). Al quitar el 429, `/historico` cargó normal. El límite sigue en `x-ratelimit-limit: 300`, con ventana de reinicio aproximada de 30 s. |
| E08 | corregido | **en ejecución** | El pie de `/grafana/login` dice «Documentation Support Community Open Source», **sin «Grafana vX.Y.Z»**. El HTML trae `"version":""` (`r-grafana.png`, curl). Las pantallas de login siguen siendo públicas en el mismo dominio, como decisión de diseño. |
| E09 | persiste (documentado) | en código y en ejecución | La sesión de operador sigue durando 30 días. Ahora `/acerca` lo dice («durante 30 días o hasta que cierres sesión»), pero sigue sin indicarse quién emite la contraseña. |
| E10 | no aplica en réplica | n/a | DEV11 no existe: `GET /api/dev11` responde 404 en cada página. La cadena «Mira el log del controlador» ya no está en el código. |
| E11 | persiste | en código | `AssistantPage.tsx:61`: «Análisis de gráficas con IA · ventana de 6 días» frente a `{a.hours / 24} días`. En vivo el encabezado sigue diciendo «VENTANA DE 6 DÍAS». En la réplica no hay análisis guardados con los que comparar. |
| E12 | persiste | en código | `apps/backend/src/influx.ts:140-147` sigue calculando la disponibilidad como `mean()` de `online`. |
| E13 | persiste | en código | `HistoryPage.tsx:83-84`: el CSV no tiene columna de procedencia. |
| E14 | corregido | **en ejecución** | No aparecen «Refused to load» ni avisos de CSP en `/`, `/mapa`, `/dispositivos/DEV01`, `/acerca`, `/asistente` e `/historico` (0 mensajes). La CSP sigue con `font-src 'self'`. |
| E15 | **persiste** | **en ejecución** | `curl` a `/robots.txt` y `/.well-known/security.txt` devuelve `200 text/html` de 1109 B (el `index.html` de la SPA). No hay `security.txt`. |
| E16 | no aplica en réplica | n/a | Era una latencia transitoria en producción. En la réplica, cada pantalla cargó en unos 4 s. |

Observación adicional de la réplica: en todas las páginas la consola registra «Failed to load resource… 404» por `GET /api/dev11`. Es esperable porque la réplica no tiene DEV11; en producción no debería pasar.

## Revisión crítica del texto nuevo de `/acerca`

Las cuatro observaciones anteriores quedaron reflejadas:
- El servidor guarda los primeros 300 caracteres de cada pregunta.
- La sesión dura 30 días.
- El ESP32 en Wokwi se marca SIM.
- Se indica el tipo de proveedor de IA.

El texto ahora coincide con lo que observé y con el código (`service.ts:116-119` guarda `question.slice(0,300)`; `auth.tsx:34` fija 30 días). Lo que sigue inexacto o incompleto:

1. **«el responsable es el equipo del proyecto académico»** no basta para la Ley 1581. El aviso de privacidad exige identificar al responsable (nombre o razón social), dar sus datos de contacto y explicar cómo se ejercen los derechos (consulta, reclamo, supresión). Hoy no hay nombre, correo ni canal. Ya se sabe que eso queda pendiente del propietario, pero mientras tanto la frase suena a cumplimiento sin serlo.
2. **No se dice cuánto tiempo se conservan las preguntas** guardadas en el registro de uso, ni para qué. Para el escéptico es el dato clave después de «se guarda».
3. **«servicio compatible con la API de OpenAI»** describe el protocolo, no al proveedor. No dice quién procesa el texto ni en qué país, así que la transferencia a terceros sigue sin identificarse.
4. **«El sitio no pide nombre, correo ni ningún dato de identificación»** es cierto. Pero el servidor sí recibe la IP en cada petición (el límite de tasa trabaja por IP, `x-ratelimit-*`). La página solo menciona la IP a propósito de OpenStreetMap. Falta una línea sobre los registros técnicos del propio servidor.
5. **«no usa cookies»** es cierto para el sitio público: no vi cookies. Grafana y Node-RED, enlazados desde Configuración y bajo el mismo dominio, usarán cookies de sesión al iniciar sesión. Bastaría con precisar «el panel público».
6. **«Cada dato lleva su procedencia»** sigue sin cumplirse del todo: el CSV exportado no la incluye (E13) y la tabla de evidencia marca DEV06 como REAL (E05).
7. **Correcto según lo observado:**
   - Sin registro, analítica ni scripts de terceros.
   - Preferencias en localStorage y chat en sessionStorage, que se borra al cerrar la pestaña.
   - OpenStreetMap recibe la IP.
   - Gratuito y sin planes de pago.
   - Datos de Open-Meteo descritos como salidas de modelos.
   - ERA5 descrito como el mismo día del año anterior.
   - No pude verificar la afirmación de que en Wokwi «los valores de sus sensores los fija una persona».
