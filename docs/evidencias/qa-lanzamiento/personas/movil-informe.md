# Persona «Móvil con red limitada»: informe de auditoría UX

- Sitio: https://smartcitybga.duckdns.org (producción). Fecha: 2026-11-09, 11:30–11:55 (hora de Bogotá).
- Entorno: Chromium headless (Playwright 1.48.2), viewport de 375×667, `isMobile` y `hasTouch`, DPR 2, `es-CO`. Red emulada por CDP: 400 kbps de bajada y de subida, 400 ms de latencia.
- Cada carga se hizo en frío, con un contexto nuevo y sin caché. Hice 2 repeticiones por ruta y las dos coinciden (diferencia < 0,7 s). El TTFB de base sin emulación es de unos 0,3 s.
- Límites respetados: no inicié sesión, no envié ninguna orden (0 peticiones POST/PUT/DELETE registradas), no toqué DEV11 y no pregunté nada al asistente (0 preguntas).
- Limitación: para no salir del dominio, todo host externo se bloqueó por DNS. Las teselas de OpenStreetMap no se cargaron, así que el mapa sin fondo de las capturas lo causa esta guarda, no la app.
- Scripts: `lib.js`, `cold.js`, `final.js`. Datos en bruto: `cold.jsonl`. Todo está en esta carpeta.

## Mediciones por ruta (3G emulada, primera carga en frío, repeticiones 1 / 2)

«Dato útil» quiere decir lo siguiente en cada ruta: panel, temperatura «xx,x °C» visible; mapa, los 12 marcadores; dispositivos, la lectura de temperatura de DEV01; DEV03, la lectura «Nivel de ruido xx,x dB(A)» (y entre paréntesis, la gráfica); histórico, la gráfica pintada; alertas, la lista; asistente, el campo de texto; configuración, el bloque «Mensajes MQTT procesados».

| Ruta | FCP (ms) | Dato útil (ms) | LCP (ms) | 1.er frame WS (ms) | Transferido | JS (gzip) | Peticiones | CLS | Desbordamiento horizontal (scrollWidth) |
|---|---|---|---|---|---|---|---|---|---|
| / (1.ª visita, con modal) | 8431 / 8138 | 11177 / 11043 (tapado por el modal) | 11835 / 11806 | 13508 / 12849 | 537 KB | 372,5 KB | 28 | 0,043 / 0,034 | 375, no hay |
| / (ya visitado) | 8527 / 8149 | 11197 / 11139 | 12237 / 12028 | 9874 / 9876 | 537 KB | 372,5 KB | 28 | 0,049 / 0,035 | 375, no hay |
| /mapa | 8222 / 8108 | 12439 / 12438 | 12566 / 12566 | 11406 / 11846 | 517 KB | 375,2 KB | 28 | 0,002 | 375, no hay |
| /dispositivos | 8123 / 8144 | 10339 / 10046 | 8123 / 8144 | 9821 / 9989 | 482 KB | 316,9 KB | 26 | 0,005 | 375, no hay |
| /dispositivos/DEV03 | 8249 / 8132 | 9804 / 9740 (gráfica 10603 / 10562) | 11446 / 11399 | 12484 / 13774 | 485 KB | 316,9 KB | 28–29 | 0,048 | 375; la tabla de auditoría se desplaza dentro de su caja (341/641 px) |
| /historico | 8098 / 8265 | 10639 / 10336 | 10139 / 9876 | 11350 / 10774 | 470 KB | 322,9 KB | 30 | 0,016 / 0,014 | 375; una fila de botones se desplaza dentro de su caja (341/396) |
| /alertas | 8117 / 8132 | 9035 / 8853 | 8117 / 8132 | 9549 / 10413 | 485 KB | 316,9 KB | 30 | **0,200 / 0,216** | 375, no hay |
| /asistente | 8100 / 8724 | 8083 / 8676 | 9300 / 9097 | 10597 / 11348 | 491 KB | 319,4 KB | 28 | 0 | **418 > 375**; además, la página abre desplazada (scrollY 487 / 563) |
| /configuracion | 8223 / 8328 | 9038 / 9235 | 8223 / 8328 | 10625 / 13893 | 459 KB | 316,9 KB | 26 | **0,449 / 0,449** | 375, no hay |

Peso de JS por fragmento (gzip / descomprimido):
- `index` 172,4 / 480,5 KB y `charts` (Recharts) 143,5 / 436,2 KB, en **todas** las rutas.
- `map` (Leaflet) 52,9 / 149,9 KB en el panel y el mapa.
- Fragmentos de página: 2,5–6 KB.
- Todos los fragmentos se sirven con `cache-control: max-age=31536000, immutable`.

Otros pesos: fuentes 91–114 KB por carga; CSS 22,7 KB; datos de la API 26–33 KB. Las tareas largas (long tasks) suman ≤ 354 ms. Cada frame de telemetría del WebSocket pesa unos 0,4–0,5 KB.

La documentación de navegación (`responseStart`) dio unos 300 ms aun con los 400 ms de latencia emulada, así que la emulación no parece afectar al documento HTML. Los tiempos de FCP (~8,1 s) vienen sobre todo de descargar unos 317–375 KB de JS a 400 kbps (≈ 6,5–7,5 s).

## Recorrido de la persona y «primer éxito»

1. **Primera visita (/).** La pantalla queda vacía hasta unos 8,1–8,4 s. Al pintarse, aparece el modal de bienvenida, pero **desplazado hasta el final**:
   - Se ven la lista de secciones y «Empezar» con el foco; no se ven el título «Hola, soy Nodo» ni el botón de cerrar.
   - Medido: `overlay.scrollTop` = 462 de 462 posibles, diálogo de 1097 px de alto (1,6 pantallas), botón de cerrar en y = −425.
   - Capturas: `00_recon_home.png` (sin limitar la red) y `01_primera_3g_8400ms.png` (3G).
2. **Tras tocar «Empezar».** El panel ya tiene datos: temperatura de DEV01 visible a unos 11,1 s desde el inicio. La tarjeta se entiende: «Temperatura · DEV01 · 27,7 °C · 19,5–28,0 · 6 h · ahora». Captura: `00_recon_home_cerrado.png`.
   - Dentro del primer pliegue solo se ven los KPI (nodos 11/12, alertas 1, última lectura con hora y «ahora»). La primera tarjeta de lectura asoma a y ≈ 517 y queda medio tapada por el botón flotante de Nodo y su globo «Hay 1 alerta abierta».
   - El dato en vivo se actualiza: el reloj de «Última lectura» y la temperatura cambian con el WebSocket (11:52:54 → 11:53:38, 28,3 → 28,5 °C).
3. **Resultado: sí llegué al primer éxito** (un dato en vivo, comprensible, en el móvil). Hacen falta unos 11 s en 3G más un toque en «Empezar», y hay que hacer scroll porque el FAB tapa parte de la primera tarjeta.

## Navegación con el pulgar

- La barra inferior fija tiene 7 destinos (Panel, Mapa, Equipos, Histórico, Alertas, IA y Ajustes) y todos sus elementos miden ≥ 44 px. El punto rojo en Alertas anuncia la alerta abierta. Funciona bien con el pulgar.
- El FAB de Nodo (215×70 px con el globo) está fijo justo encima de la barra, a la derecha. Tapa contenido en todas las rutas salvo /asistente: la primera tarjeta del panel, la atribución del mapa (marcada como tapada en la prueba de golpe) y filas de listas.
- Los botones de la cabecera («¿Cómo se usa?» y tema) quedan arriba a la derecha, la zona más difícil para el pulgar, y miden 36×36.

## Red cortada y recuperada (panel, 3G)

- Corté la red 40 s con `context.setOffline(true)` y la emulación CDP en `offline: true`. Durante el corte no llegó ningún frame.
- La interfaz **no muestra ningún aviso de conexión perdida**: cifras congeladas, sin banner. La única pista es «Última lectura 11:52:54 · hace 36 s». La palabra «Desconectado» que aparece en pantalla es el estado de DEV11 en la lista, no el de la red. Captura: `05_red_cortada_40s.png`.
- Al volver la red, el primer frame llegó en unos 1,0 s y la hora y los valores se actualizaron solos (`05_red_vuelta.png`). El WebSocket **no se cerró** durante el corte emulado (ningún evento close ni create nuevo), así que esta prueba no ejercita la lógica de reconexión con espera exponencial de `apps/frontend/src/lib/live.tsx`. Tampoco hubo un `refresh()` de la API después del corte.

## Hallazgos

| id | severidad | pantalla o ruta | qué pasó | evidencia | causa probable |
|---|---|---|---|---|---|
| M1 | alta | /asistente | La página es 43 px más ancha que la pantalla (scrollWidth 418 frente a 375) y no se puede desplazar en horizontal. El borde derecho queda cortado: el botón «Enviar pregunta» (x 358–394) asoma solo en parte, las preguntas sugeridas se cortan y en la barra inferior apenas se ve la «A» de «Ajustes». | `03_asistente_inicio.png`, `00_recon_6.png`; `cold.jsonl` (asistente: scrollW 418, 84 elementos fuera de la pantalla, en 2/2 cargas) | Una columna del layout (`section.panel … h-[calc(100dvh-14rem)]` y su contenedor `div.space-y-6`) crece hasta el ancho mínimo de su contenido, que es la fila de chips sin salto de línea. Probablemente le falta `min-w-0` en un hijo de grid o flex. |
| M2 | media | /asistente | La página abre ya desplazada hacia abajo (scrollY 487 y 563): se pierden la cabecera y el título, y el primer pliegue empieza a mitad del saludo. | `03_asistente_inicio.png`; `cold.jsonl` (y0) | Un foco o `scrollIntoView` automático sobre el campo de texto o el final del chat al montar la página. |
| M3 | alta | / (1.ª visita) | El modal de bienvenida abre desplazado hasta el final: el usuario ve una lista sin título ni contexto, y el botón de cerrar queda 425 px por encima de la pantalla. El diálogo mide 1097 px (1,6 pantallas de 667). | `00_recon_home.png`, `01_primera_3g_8400ms.png`; `overlayScrollTop` 462 de 462 | El autofoco sobre «Empezar» (`data-autofocus` en `Welcome.tsx`) hace que el navegador desplace el overlay para mostrar el botón, que es el último elemento. |
| M4 | alta | todas | En 3G, la pantalla queda en blanco unos 8,1–8,7 s en todas las rutas. El primer dato útil llega a los 8,9–12,4 s. No hay nada visible antes de que termine de bajar el JS. | Tabla de mediciones (FCP y dato útil, 2/2 repeticiones); `01_primera_3g_3000ms.png` | Es una SPA sin contenido en el HTML: el primer pintado espera a 317–375 KB de JS gzip. |
| M5 | media | todas | El fragmento `charts` (Recharts, 143,5 KB gzip y 436 KB sin comprimir) se descarga en todas las rutas, incluidas /dispositivos, /alertas y /configuracion. A 400 kbps son unos 2,9 s. | `cold.jsonl` → `sum.jsFiles` | `manualChunks` agrupa Recharts y d3 en un fragmento que importa el bundle de entrada, probablemente por las sparklines del panel o por componentes compartidos. |
| M6 | media | /configuracion | Salto de diseño grande (CLS 0,449 en 2/2): primero se pinta «Estado de los servicios» y luego la lista de dispositivos aparece encima y lo empuja hacia abajo. | `cold.jsonl`; `00_recon_7.png` frente a `04_config_3g_8600ms.png` | La lista de dispositivos se inserta sin reservarle altura mientras carga `/api/devices`. |
| M7 | media | /configuracion | Mientras `/api/health` carga, los cuatro servicios (Backend, Broker MQTT, InfluxDB y SQLite) aparecen en rojo como «Sin respuesta». En 3G duró unos 1 s (8070 → 9038 ms y 8085 → 9235 ms); sin limitar la red, seguía en rojo en la captura tomada a los 4 s. | `00_recon_7.png`; `cold.jsonl` (marcas «dato2» y «dato») | `SettingsPage.tsx`: el estado `health === null` se usa a la vez para «cargando» y para «falló», así que no hay estado de carga propio. |
| M8 | media | /alertas | Salto de diseño de CLS 0,200 / 0,216. | `cold.jsonl` | La lista de alertas o el filtro llegan después del primer pintado sin espacio reservado. |
| M9 | media | / (panel) y conexión | Con la red cortada 40 s no hay ningún aviso de «sin conexión»: los valores se quedan quietos con aspecto de vigentes y solo cambia «hace 36 s» bajo la última lectura. | `05_red_cortada_40s.png`; registro de `final.js` | No hay indicador ligado al estado `ws` de `live.tsx` (ni a `navigator.onLine`) en el panel móvil. |
| M10 | media | todas salvo /asistente | El botón flotante de Nodo (215×70 px con su globo) tapa contenido justo encima de la barra inferior: la primera tarjeta de lectura del panel, la atribución del mapa (prueba de golpe negativa) y filas de listas. | `00_recon_home_cerrado.png`, `00_recon_1.png`, `04_config_3g_8600ms.png` | Un FAB fijo con globo de texto ancho y sin margen inferior equivalente en el contenido. |
| M11 | media | todas (cabecera) | Los botones «¿Cómo se usa?» y «Cambiar a tema claro» miden 36×36 (< 44). | `targetsFn` en `cold.jsonl` | Usan `size-9`. |
| M12 | media | /, /mapa | Los controles de zoom del mapa miden 30×30. Los marcadores miden 36×36 y se solapan (03, 04 y 01 están juntos). | `00_recon_1.png`; `targetsFn` | Tamaño por defecto de Leaflet y marcadores de 36 px. |
| M13 | media | /dispositivos/DEV03, /historico, /alertas, /dispositivos, /configuracion | Muchos controles principales miden 32 px de alto: rangos «1 h / 6 h / 24 h / 5 d» (41–51×32), «Gráfico» y «Tabla», «Reconocer» y «Resolver», filtros por categoría o estado, «Apagar», «Normal / Evento / Silencio» y «Desbloquear». El interruptor «Normalizar» mide 44×24. | `targetsFn` en `cold.jsonl` y en la salida de `recon2.js` | Tamaño compacto de los botones (`h-8`) pensado para escritorio. |
| M14 | baja | /, /dispositivos/DEV03 | Algunos enlaces de texto tienen 20–21 px de alto: «Gestionar» (76×20), «Consola de dispositivos» (160×20), «Todos los dispositivos» (154×20) y «Ver en el mapa →» (110×21). | `targetsFn` | Enlaces en línea sin relleno vertical. |
| M15 | baja | todas | Error de consola en cada carga: «Refused to load the font 'data:font/woff2…'». La familia Martian Mono queda con una variante en estado `error`. Aparte, se descargan 91–114 KB de fuentes por carga. | Consola (`cold.jsonl` → `console`); `document.fonts` en `recon.js` | La CSP de nginx tiene `font-src 'self'` y no permite `data:`, y una fuente va incrustada en base64 en el CSS. |
| M16 | baja | /dispositivos/DEV03, /historico | La tabla «Órdenes recientes» (641 px en 341) y la fila de botones del histórico (396 en 341) se desplazan en horizontal dentro de su caja, sin pista visual de que hay más contenido. La página no desborda. | `overflowFn` (`inner`) | `overflow-x-auto` sin indicador de desplazamiento. |

Repasé todas las rutas pedidas. Solo /asistente desborda en horizontal (M1); en las demás, scrollWidth es 375 = clientWidth en las dos cargas.
