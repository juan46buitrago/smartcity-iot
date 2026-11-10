# Regresión: persona «El impaciente»

**Entorno:** réplica local http://127.0.0.1:8380 (HTTP, sin proveedor de IA, sin DEV11) · **Fecha:** 2026-11-09, 17:39 a 17:42 · **Navegador:** Chromium headless propio, 1366×768.

Producción no se tocó. Las 429 se forzaron solo en mi navegador con `page.route`, con dos cuerpos: el JSON que construye el backend corregido (`errorResponseBuilder` en `apps/backend/src/app.ts` de la réplica) y una página HTML de nginx sin campo `error`. Capturas y salida en `regresion/`; los tiempos y textos están en `regresion/medicion.txt`.

Al empezar la réplica rechazaba conexiones. Respondió 200 tras unos 90 s de reintentos con `curl`; no paré ni reinicié nada.

| id | estado | evidencia |
|---|---|---|
| I-01 | corregido | Con 429 en `/api/alerts` aparece una franja de aviso: «No se pudo actualizar la lista de alertas. Demasiadas solicitudes seguidas. Espera 16 s e inténtalo de nuevo.» (`r10-alertas-429-backend.png`). Ya no dice «Todo tranquilo». Debajo queda un «Sin datos por ahora.», más neutro. Sin 429 la alerta abierta se lista (`r05-alertas-normal.png`) |
| I-02 | corregido | Histórico con 429: «No se pudo consultar el histórico · Demasiadas solicitudes seguidas. Espera 16 s e inténtalo de nuevo.» (`r11-historico-429-backend.png`). Con el cuerpo HTML de nginx sale el texto genérico, también en español: «Espera un momento e inténtalo de nuevo.» (`r11-historico-429-nginx.png`). Si el cuerpo trae un `error` en inglés, la interfaz lo muestra tal cual («Too Many Requests», primera tanda de `medicion.txt`); el backend corregido ya no lo envía |
| I-03 | persiste | El límite sigue en 300 por minuto por IP: cabeceras `x-ratelimit-limit: 300`, `remaining: 297`, y `max: 300` en el `app.ts` de la réplica. No intenté agotarlo, porque la réplica la comparten otros agentes desde la misma IP |
| I-04 | persiste | Visitante nuevo: la bienvenida aparece en `/`, en el enlace directo `/mapa` (`r08-directo-mapa.png`) y en `/no-existe` (`r09-inexistente.png`) |
| I-05 | corregido | El HTML servido incluye «Cargando Smart City Bucaramanga…» dentro de `#root`. Con el JS retrasado 2,5 s en mi navegador, el texto de la página a 0,9 s era exactamente ese (`medicion.txt`). La captura `r01-cargando.png` no sirve: salió ya con el modal |
| I-06 | persiste (otra causa) | La cabecera y el Panel muestran «11/12» en ámbar y «1 alerta abierta» (`r02-panel.png`). En la réplica la alerta es de DEV12 (precipitación por encima del umbral), no de DEV11. Que la desconexión de DEV11 quede como alerta no se puede verificar aquí |
| I-07 | persiste (parcial) | La jerga sigue: «conectados por MQTT» en la bienvenida (`r01-cargando.png`) y «z-score» en Alertas (`r10-alertas-429-backend.png`). El paréntesis doble «(conexión perdida (LWT))» no se puede verificar: en la réplica no hay alertas de desconexión y no encontré la plantilla en el código. Sin acceso al proveedor de IA tampoco pude comprobar «tokens» en Nodo |
| I-08 | no aplica en réplica | Sin proveedor de IA no hay respuesta con la que comprobar el autoscroll |
| I-09 | persiste | A 1366 px la marca sigue en 3 líneas y «EN VIVO» y la fecha se parten en 2 (`r02-panel.png`, `r04-historico.png`) |
| I-10 | persiste | La burbuja «Hay 1 alerta abierta» (x 1131 a 1346, y 682 a 752) tapa el tramo final de la gráfica de Histórico (`r04-historico.png`) |
| I-11 | corregido | Ya no aparece el error de CSP por la fuente `data:` en ninguna carga. El único error de consola es un 404 de `/api/dev11`, esperable porque DEV11 no existe en la réplica (`medicion.txt`) |
| I-12 | persiste | Configuración abre de nuevo con «DEV04 · SIMULATED» preseleccionado (`r03-config.png`) |
