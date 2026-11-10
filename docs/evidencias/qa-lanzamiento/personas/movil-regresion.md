# Regresión: persona «Móvil con red limitada»

- Entorno: réplica local http://127.0.0.1:8380 (HTTP, sin proveedor de IA, sin DEV11). Fecha: 2026-11-09, 17:39–18:05.
- Emulación igual que en el informe: 375×667, `isMobile` y `hasTouch`, 3G de 400/400 kbps y 400 ms. Producción no se tocó.
- Muestra: 1 carga en frío por ruta, y 2 en las rutas con CLS anómalo (mapa, dispositivos, asistente y alertas). El corte de 60 s se hizo 2 veces.
- Comparación: «antes» es producción (informe.md, 2 repeticiones); «después» es la réplica.
- La réplica no respondía al empezar (puerto cerrado, daemon de colima parado). No toqué nada y respondió sola a las 17:39:44.
- En la réplica, `/api/dev11` devuelve 404 en cada carga; es esperable, porque allí DEV11 no existe. ERR_NAME_NOT_RESOLVED viene de mi bloqueo de hosts externos (teselas OSM).
- Datos en bruto: `regresion/reg.log`, `regresion/cold.jsonl`, `regresion/cold2.jsonl`. Capturas: `regresion/R*.png`.

## Resultado por hallazgo

| id | estado | evidencia (antes → después) |
|---|---|---|
| M1 | corregido | scrollWidth en /asistente: 418 → **375** (= clientWidth); elementos fuera de la pantalla: 84 → 0. «Enviar pregunta» pasa de x 358–394 a **x 299–335**, entero. La barra inferior se ve completa. Captura: `R05_asistente.png`. |
| M2 | persiste (atenuado) | /asistente sigue abriendo desplazada: scrollY 487 / 563 → **143 / 166 / 166** (3 cargas). La cabecera y el título siguen fuera de la vista y la captura abre a mitad del texto introductorio. Captura: `R05_asistente.png`. |
| M3 | corregido | Scroll del overlay del modal: 462 de 462 → **0 de 462**. Título «Hola, soy Nodo» en y = 57 y botón de cerrar en y = 37 (antes, −425). El foco sigue en «Empezar». El diálogo mide igual (1097 px) y el botón de cerrar sigue en 36×36. Captura: `R02_modal.png`. |
| M4 | corregido (pantalla en blanco); el dato útil sigue igual | «Cargando Smart City Bucaramanga…» aparece a 0,50–0,54 s; FCP 8,1–8,7 s → **2,1–2,3 s**. El dato útil no cambia: panel 11,1 → 12,1–12,4 s; mapa 12,4 → 12,3–12,6 s; dispositivos 10,0–10,3 → 10,1–10,4 s. JS todavía 321–380 KB gzip. Captura: `R01_cargando.png`. |
| M5 | persiste | `charts` sigue pesando 143,6 KB gzip y se descarga en las 9 cargas, incluidas /dispositivos, /alertas y /configuracion. `index` pasa de 172,4 a 176,8 KB. |
| M6 | corregido | CLS en /configuracion: 0,449 / 0,449 → **0,010**. |
| M7 | corregido | Mientras carga se ve «Consultando…» (a los 793 ms) hasta que llega health (1391 ms). No aparece «Sin respuesta» en ningún momento. Captura: `R07_config_consultando.png`. |
| M8 | persiste (atenuado) | CLS en /alertas: 0,200 / 0,216 → **0,129 / 0,128**, todavía por encima de 0,1. Fuentes: el pie (0,036) y un salto de 0,091 a los 10,9 s, cuando la fila de filtros baja de y 350 a 318. |
| M9 | corregido en parte | El aviso «Sin conexión con el servidor. Lo que ves puede estar desactualizado; la página reintenta sola.» **sí aparece**, pero a los **51,4 s y 59,3 s** del corte, no a los 6 s. El socket no se cierra en un corte silencioso: lo cierra el vigilante a los ~46 s (`closed@46098`), luego reintenta a los 48, 52 y 60 s, y el aviso sale unos 6 s después del cierre. Al volver la red: primer frame en 0,55 s, refresco de la API (alerts, incidents, devices) y aviso retirado en ≤ 5 s (corte 2) o 18 s (corte 1). **Corte 1:** tras volver, el panel mostró «Esta pantalla no se pudo mostrar» (`R10_vuelta.png`). **Corte 2:** no se repitió y hubo 0 errores de página (`R11_repro_60s.png`). Ver N2. |
| M10 | persiste | El FAB de Nodo con su globo «Pregúntale a Nodo» o «Hay 1 alerta abierta» sigue tapando la primera tarjeta del panel (`R03_panel.png`) y la atribución del mapa (prueba de golpe negativa en /mapa). |
| M11 | corregido | «¿Cómo se usa?» y «Cambiar a tema claro» ya no figuran entre los controles menores de 44 px en ninguna ruta (antes medían 36×36). |
| M12 | persiste | En /mapa, zoom de 30×30 y marcadores de 36×36; el 06 queda tapado. |
| M13 | persiste | Siguen a 32 px de alto: rangos 1 h / 6 h / 24 h / 5 d (41–51×32), «Gráfico» y «Tabla», «Reconocer» y «Resolver», filtros, «Apagar», «Normal / Evento / Silencio» y «Desbloquear». «Normalizar» sigue en 44×24. |
| M14 | persiste | «Gestionar» 76×20, «Todos los dispositivos» 154×20, «Ver en el mapa →» 110×21. «Consola de dispositivos» midió 160×20 en una carga y 145×40 en otra. Hay un enlace nuevo, «Acerca y privacidad», de 102×16. |
| M15 | corregido | El error de CSP «Refused to load the font 'data:…'» ya no aparece en ninguna carga (antes salía en todas). Fuentes: 91–114 KB, igual que antes. |
| M16 | persiste | La tabla de DEV03 sigue en 341/641 px y la fila del histórico en 341/396, ambas sin pista de desplazamiento. |

## Observaciones nuevas en la réplica

| id | severidad | qué pasó | evidencia |
|---|---|---|---|
| N1 | media | Hay un salto de diseño nuevo: el pie de página (`footer … pb-28`) se pinta en y ≈ 518 durante la carga y luego salta a y = 0, con un CLS de 0,223 en cada aparición. El CLS sube de 0,002 a 0,231 en /mapa (2 de 2 cargas), de 0,005 a 0,230–0,238 en /dispositivos (2 de 2), de 0,048 a 0,254 en DEV03, de 0,016 a 0,237 en /historico y de 0 a 0,384–0,415 en /asistente (2 de 2). En /asistente se suma otro salto de 0,161 a los 10,3 s, cuando se mueve la rejilla de agentes. | `regresion/cold2.jsonl` → `shifts` |
| N2 | alta (por confirmar) | Tras un corte de 60 s, al volver la red, el panel cayó una vez en la pantalla de error «Esta pantalla no se pudo mostrar». No se repitió en el segundo intento, y en el primero no registré el error de página. | `R10_vuelta.png` (corte 1) frente a `R11_repro_60s.png` (corte 2) |
