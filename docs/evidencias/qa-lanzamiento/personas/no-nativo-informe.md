# Auditoría UX: persona «Hablante no nativo»

- **Sitio:** https://smartcitybga.duckdns.org (producción). **Fecha:** lunes 9 de noviembre de 2026, de 10:43 a 11:45 (hora de Colombia).
- **Persona:** su español es básico. Lee solo lo que está escrito, los tooltips y los iconos, de forma literal y sin suponer contexto.
- **Método:** usé mi propio Chromium headless con Playwright. Configuré dos navegadores: `es-CO` + `America/Bogota`, y `en-US` + `Europe/Madrid`. Recogí del DOM los textos, los atributos `title` y `aria-label` y el árbol de accesibilidad, e hice capturas.
- **Límites que respeté:** no inicié sesión ni envié órdenes, y no encendí DEV11. Hice una sola pregunta al asistente. En el diálogo «Desbloquear» solo leí el texto y lo cerré con Escape. No pulsé «Reconocer», «Resolver», «Generar» ni «Aplicar». Descargué el CSV de Histórico, que es una lectura.
- **Capturas y volcados:** están en esta misma carpeta (`01`…`61-*.png`, `texto-*.txt`, `loc-*.txt`, `dump-*.json`, `s8.json`, `s10.json`, `respuesta-nodo.txt`).

## Primer éxito: **parcial**

| Paso | ¿Lo logra solo con lo escrito? | Evidencia |
|---|---|---|
| Entender qué muestra la página principal | Sí, con esfuerzo. El modal de bienvenida lo explica: «Panel — La ciudad de un vistazo: lecturas en vivo, mapa y alertas abiertas». Pero la primera frase ya usa «IoT» y «MQTT» sin explicarlos. | `02-inicio.png` |
| Encontrar el valor actual de calidad del aire | Sí. La tarjeta «Calidad del aire · AQI» muestra «53 AQI» y debajo «Moderada». | `10-inicio-sin-modal.png` |
| Saber qué significa | **No.** «AQI» no se explica en ninguna parte: ni con texto, ni con `title`, ni con `aria-label`. «Moderada» no dice si es buena o mala, ni para quién. La barra de color tiene `aria-hidden` y no lleva escala ni etiquetas. En la ficha DEV02 solo aparecen «Índice AQI (EE. UU.)», «PM2.5» y «PM10», tampoco explicados, y la palabra «Moderada» ni siquiera aparece. Pregunté al asistente «¿Qué significa AQI 53?» y respondió un menú genérico de ayuda («Soy Nodo y leo los sensores… Ejemplos de lo que puedes preguntarme»), con la etiqueta «ayuda · 1174 tokens · 2.0 s». | `11-hover-aqi.png`, `20-esCO-Bogota-dev02.png`, `51-nodo-respuesta.png` |

## Recorrido literal

1. **Carga inicial.** En la primera visita, `page.goto` agotó los 30 s sin terminar, aunque `curl` respondió 200 en 1,5 s. En otro intento, después de 8 s el `body` seguía sin texto y la captura era una pantalla negra (`01-inicio-esCO.png`). La consola mostró «Refused to load the font 'data:font/woff2…' because it violates … font-src 'self'». En las cargas siguientes el contenido apareció en unos 3–5 s.
2. **Estado de arranque.** Durante unos 3 s (en una carga con en-US/Madrid lo vi aún después de unos 8 s) la cabecera dice «SIN ENLACE», «0/12 NODOS» y «ALERTAS ABIERTAS 0», y cada tarjeta muestra «—» y «sin datos». Luego cambia a «EN VIVO 11/12» y «1 alerta». La persona puede creer que la ciudad está caída.
3. **Modal «HOLA, SOY NODO».** Presenta seis secciones con icono y una frase. El pie dice: «Mirar es libre. Para controlar dispositivos pulsa «Desbloquear» (contraseña de operador). Lo simulado lleva la etiqueta SIM». El botón «Empezar» solo cierra el modal. La «X» tiene `aria-label="Cerrar la guía"`, pero no tiene `title`.
4. **Panel.** La cabecera muestra «11:35:03 LUN, 09 DE NOV · COT». La zona horaria solo se explica en un `title` («Hora oficial de Colombia (UTC−5)»); «COT» no se explica en ningún texto visible. Debajo aparece «SANTANDER, COLOMBIA · 7°07′ N 73°07′ O · 959 M S. N. M.».
   - Cada tarjeta tiene una minigráfica sin etiqueta y la pareja «19,7–28,0 / 6 h» sin explicar.
   - La tarjeta de viento dice «NO · 907 hPa». «NO» significa noroeste, pero se lee como «no».
   - Las tarjetas del panel no llevan ninguna etiqueta «SIM» (0 apariciones), aunque la guía dice que lo simulado la lleva.
   - La bitácora se titula «BITÁCORA EN VIVO · MQTT → WebSocket».
   - La alerta se lee así: «Nodo ESP32 (Wokwi) sin conexión (conexión perdida (LWT)) · DEV11 · 20:56 · advertencia». La hora no indica la fecha, que era el día anterior.
5. **Mapa.** Los 12 marcadores son `role=button` y su único nombre accesible es «01»…«12». Los botones de zoom tienen `title` en inglés: «Zoom in» y «Zoom out». El enlace «Leaflet» tiene `title` «A JavaScript library for interactive maps». La ventana que se abre al pulsar el marcador 02 dice «Índice AQI (EE. UU.) 53 AQI», sin significado. Abajo: «Modelo probabilístico sobre 202 tramos reales de OpenStreetMap. No son reportes reales».
6. **Dispositivos.** La intro dice: «…simulados, gemelos digitales, APIs, un dataset y un ESP32. Cada uno es un cliente MQTT independiente con credencial propia, último testamento (LWT)…». En la columna de frecuencia aparecen valores como «cada 10 s · twin», «cada 60 s · espejo», «cada 10 s · normal» y «cada 10 s · auto». La etiqueta SIM tiene un `title` claro: «Dato sintético: simulación o gemelo digital, no es una medición real».
7. **Ficha DEV02.**
   - Aviso amarillo: «Última observación de la fuente: 09/11 11:00 (hora local)».
   - «Última lectura: 9 de nov, 11:00 · hace 33 min» y «recibido 11:10:01», sin zona horaria.
   - Junto a «Última lectura» hay un icono sin nombre: es un `svg` con `aria-hidden` y sin `title`.
   - Los botones «Apagar», «Aplicar» y «Reiniciar dispositivo» están deshabilitados y ninguno tiene `title` que diga por qué.
   - En «Mantenimiento» se lee: «verifica el estado de conexión y el LWT».
8. **Ficha DEV11.**
   - Error: «No pudo arrancar: Wokwi rechazó el simulador (cuota gratuita mensual de minutos agotada, token inválido o sin red). Mira el log del controlador.» El visitante no tiene acceso a ese log.
   - La tabla de auditoría muestra «set_params» y «{"relay":false}».
   - El texto dice «firmware real (firmware/dev11-esp32) … MQTT sobre TLS (8883)».
9. **Histórico.**
   - Texto: «Agregación: media por ventana de 300s. Fuente: bucket «raw» de InfluxDB».
   - Texto: «Gravedad: alta 1 · baja 4 · critica 1 · media 2». «critica» va sin tilde.
   - En la opción «Personalizado» hay dos campos: «Desde (hora local)» y «Hasta».
   - El botón «CSV» descarga `smartcitybga-historico-2026-11-09T1641.csv` a las 11:41 hora de Colombia. El archivo tiene la columna `tiempo_utc` y los decimales con punto (`26.17142857142857`).
10. **Alertas.**
    - Intro: «…detección de valores atípicos (z-score)… Cada alerta se reconoce y se resuelve con trazabilidad».
    - Los botones «Reconocer» y «Resolver» aparecen habilitados (`disabled=false`) para un visitante sin sesión. No los pulsé.
11. **Asistente.**
    - Muestra «MODELO qwen3.8-flash · CONSULTAS 50 · TOKENS / CONSULTA 918 · LATENCIA MEDIA 1.8 s» y «CADA AGENTE VE SOLO SU TEMA: MENOS TOKENS Y RESPUESTAS MÁS PRECISAS».
    - Los párrafos generados por IA usan punto decimal («55.8 dB(A)», «19.6–28.2 °C»), fechas ISO («2026-11-06 a 2026-11-08, UTC-5») y una frase en inglés («SmartCityBGA traffic simulator»).
    - El botón «Generar» está habilitado, aunque el texto dice «Requiere sesión de operador».
12. **Configuración.**
    - El encabezado dice «DEV04 · SIMULATED», en inglés.
    - En la misma pantalla aparecen «config v0», «Backend», «Broker MQTT», «InfluxDB», «SQLite» y «backend activo hace 872 min».
13. **Errores de ruta.** En `/no-existe-esta-pagina` aparece «Esa calle no está en el mapa. Volver al panel» (una metáfora). En `/dispositivos/DEV99` el contenido principal solo dice «Dispositivo no encontrado», sin acción.
14. **Locale en-US con zona Europe/Madrid.**
    - **Correcto:** `lang="es"` en todas las rutas. Los números de la interfaz siguen igual en ambos navegadores (coma decimal, punto de miles), y el reloj y las horas se muestran en hora de Colombia.
    - **Problemas:**
      - El saludo sigue la hora del navegador. A las 11:36 en Colombia, con el navegador en Madrid, Nodo dijo «Buenas tardes», mientras el reloj de la cabecera marcaba 11:36 COT.
      - El selector nativo de fecha y hora mostró «04/11/2026, 11:39 AM»: mezcla un orden de fecha ambiguo con el formato AM/PM en inglés. Ese valor es la hora de Colombia, no la «hora local» del visitante, que en Madrid eran las 17:39.
      - No hay selector de idioma, y el `<title>` es el mismo en todas las rutas: «Smart City Bucaramanga».
15. **Contador de alertas inconsistente.** En una misma pasada la burbuja flotante dijo «Hay 3 alertas abiertas» en `/dispositivos/DEV11` y en `/historico`, y «Hay 1 alerta abierta» en las otras rutas. La pestaña de navegación seguía en «Alertas 1».

## Hallazgos

| id | severidad | pantalla o ruta | texto o icono exacto | problema | sugerencia de texto |
|---|---|---|---|---|---|
| NN-01 | crítica | `/` tarjeta DEV02, `/dispositivos/DEV02`, ventana del marcador en `/mapa` | «Calidad del aire · AQI» «53 AQI» «Moderada» | Ni «AQI» ni «Moderada» se explican en ningún sitio, ni con `title` ni con `aria-label`. La barra de color tiene `aria-hidden` y no lleva escala. No se puede saber si 53 es bueno o malo. | «Índice de calidad del aire (AQI de EE. UU.): 53 — Moderada (51–100). Aceptable; las personas muy sensibles deben limitar el esfuerzo largo al aire libre.» Además, poner una escala visible: «0–50 Buena · 51–100 Moderada · 101–150 Dañina para grupos sensibles…» |
| NN-02 | alta | Asistente Nodo (panel lateral) | Pregunta «¿Qué significa AQI 53?» → respuesta «Soy Nodo y leo los sensores… Ejemplos de lo que puedes preguntarme», etiqueta «ayuda · 1174 tokens · 2.0 s» | La pregunta literal sobre el significado devuelve un menú genérico. Además, se muestra al público la jerga «tokens». | Responder a «¿Qué significa…?» con la definición. Si no se sabe responder: «No tengo esa explicación. Prueba: “¿Cómo está el aire ahora?”». Quitar «tokens» de la vista pública. |
| NN-03 | alta | `/`, `/dispositivos`, `/alertas`, `/dispositivos/DEV02` y `DEV11` | «conexión perdida (LWT)», «último testamento (LWT)», «verifica el estado de conexión y el LWT» | Sigla sin explicar. Su traducción literal, «último testamento», confunde a un no nativo. | «Se desconectó sin avisar (el sistema lo detectó automáticamente)» |
| NN-04 | alta | Modal de bienvenida, `/` bitácora, `/dispositivos`, `/configuracion` | «conectados por MQTT», «MQTT → WebSocket», «Broker MQTT», «Cada cambio viaja por MQTT» | Jerga técnica desde la primera frase del sitio. | «12 dispositivos conectados a internet que envían datos en tiempo real». Si se mantiene la sigla, añadir `title`: «MQTT: protocolo de mensajes entre sensores y servidor». |
| NN-05 | alta | `/`, carga inicial | «SIN ENLACE» «0/12 NODOS» «ALERTAS ABIERTAS 0» «—» «sin datos» | Mientras carga, el sitio afirma que no hay nodos ni datos, y el «0» de alertas es falso. No dice que está cargando ni qué hacer. | «Conectando… (unos segundos)». Mostrar el número de alertas solo cuando se conozca. |
| NN-06 | alta | `/` primera visita | Pantalla negra; `body` vacío a los 8 s; una carga agotó 30 s | Durante varios segundos no hay ningún texto, así que la persona no sabe si la página funciona. | Poner en el HTML inicial «Cargando el panel de la ciudad…» |
| NN-07 | media | `/` tarjeta Viento | «NO · 907 hPa · lluvia 0,0 mm» | «NO» (noroeste) se lee como la negación «no». «hPa» no se explica. | «Viento del noroeste · presión 907 hPa» |
| NN-08 | media | `/` cabecera | «LUN, 09 DE NOV · COT» | «COT» solo se explica en un `title`. Las demás horas («recibido 11:10:01», «20:56», bitácora «11:32:48») no indican zona horaria ni día. | «Hora de Colombia (UTC−5)» visible una vez. En horas de otro día: «ayer 20:56». |
| NN-09 | media | `/dispositivos/DEV02` aviso; `/historico` «Personalizado» | «09/11 11:00 (hora local)», «Desde (hora local)», «Hasta» | «09/11» es ambiguo (día/mes o mes/día). «Hora local» es la de Colombia, no la del visitante: con el navegador en Madrid muestra 11:39 cuando allí eran las 17:39. «Hasta» no indica zona. | «9 nov 2026, 11:00 (hora de Colombia, UTC−5)»; «Desde / Hasta (hora de Colombia)» |
| NN-10 | media | Nodo (saludo) con navegador en Europe/Madrid | «Buenas tardes, soy Nodo» a las 11:36 COT | El saludo usa la hora del navegador, mientras toda la página muestra la hora de Colombia. | Calcular el saludo con la hora de Bucaramanga, o usar «Hola, soy Nodo». |
| NN-11 | media | `/historico` en-US | Campo de fecha «04/11/2026, 11:39 AM» | El control nativo mezcla un orden de fecha ambiguo con AM/PM en inglés. | Mostrar al lado, en texto: «Desde: 4 nov 2026, 11:39 (hora de Colombia)». |
| NN-12 | media | `/asistente` (párrafos IA), CSV | «55.8 dB(A)», «19.6–28.2 °C», «LATENCIA MEDIA 1.8 s», CSV `26.17142857142857` | Punto decimal, mientras el resto de la interfaz usa coma («27,3»). Mezclar ambos confunde. Además, «94.896 lx» (punto de miles) puede leerse como decimal. | Usar siempre la coma decimal en la interfaz: «55,8 dB(A)», «1,8 s». En el CSV, avisar: «decimales con punto, horas en UTC». |
| NN-13 | media | `/historico` CSV | Archivo `smartcitybga-historico-2026-11-09T1641.csv`, columna `tiempo_utc` | El nombre usa la hora UTC (16:41) sin indicarlo; el usuario pidió los datos a las 11:41. | `…-2026-11-09_1141-COT.csv` o columna «hora_colombia». |
| NN-14 | media | `/dispositivos` | «cada 10 s · twin», «· espejo», «· normal», «· auto» | «twin» está en inglés. Los cuatro sufijos no tienen explicación ni `title`. | «cada 10 s · gemelo digital (simulado)», «· copia de un dataset» |
| NN-15 | media | `/dispositivos`, `/historico`, `/asistente` | «gemelos digitales», «Gemelo digital», «sintéticos» | Concepto técnico. Solo la etiqueta SIM lo explica, en un `title`. | «Gemelo digital (copia simulada de un sensor real)» |
| NN-16 | media | `/configuracion` | «DEV04 · SIMULATED» | Palabra en inglés. | «DEV04 · SIMULADO» |
| NN-17 | media | `/`, `/mapa` | Botones de marcador con nombre «01»…«12»; `title` «Zoom in», «Zoom out», «A JavaScript library for interactive maps» | Nombre accesible solo numérico, y tooltips en inglés. | Marcador: «DEV02 Monitor de calidad del aire — En línea»; zoom: «Acercar» y «Alejar». |
| NN-18 | media | `/dispositivos/DEV11` | «…token inválido o sin red). Mira el log del controlador.» | El visitante no puede ver ese log. El error no dice qué puede hacer. | «El simulador no pudo arrancar. Inténtalo más tarde; si sigue, avisa al operador.» |
| NN-19 | media | `/dispositivos/DEV11` (auditoría) | «set_params», «{"relay":false}» | Nombre de comando y JSON en inglés, en crudo. | «Cambiar parámetros: relé apagado» |
| NN-20 | media | `/historico`, `/asistente` frente a ficha `/dispositivos/DEV06` | DEV06 aparece como «REAL» en la tabla de Histórico y en Asistente; la ficha dice «DEV06 · MOVILIDAD · SIMULADO», «PROCEDENCIA SIM» | Etiquetas contradictorias. La persona confía en la etiqueta literal. | Usar una única procedencia en todas las vistas: «SIM — ruta simulada». |
| NN-21 | media | `/` tarjetas | Ninguna etiqueta «SIM» en las tarjetas | La guía promete «Lo simulado lleva la etiqueta SIM», pero el Panel no la muestra. | Añadir «SIM» a las tarjetas simuladas. |
| NN-22 | media | Burbuja flotante | «Hay 3 alertas abiertas» (DEV11, Histórico) frente a «Hay 1 alerta abierta» y la navegación «Alertas 1» | El mismo dato tiene valores distintos según la ruta. | Usar una sola fuente para el número. |
| NN-23 | media | `/alertas`, `/asistente` | Botones «Reconocer», «Resolver», «Generar» habilitados sin sesión; «Generar» dice «Requiere sesión de operador» | Los botones parecen usables. «Reconocer» no describe la acción. | «Marcar como vista», «Cerrar alerta». Deshabilitados con `title`: «Requiere desbloquear (contraseña de operador)». |
| NN-24 | baja | `/dispositivos/DEV02` y otras fichas | «Apagar», «Aplicar», «Reiniciar dispositivo» deshabilitados, sin `title` | No dicen por qué están grises; solo lo dice un banner lejano. | `title`: «Bloqueado: pulsa Desbloquear arriba» |
| NN-25 | baja | `/dispositivos/DEV02` «Última lectura» | Icono `svg` con `aria-hidden`, sin `title` | Icono sin significado para quien lo ve y sin nombre. | `title`: «Datos de fuente externa» (o el significado que tenga) |
| NN-26 | baja | Cabecera y Nodo | Tema: `aria-label` «Cambiar a tema claro» sin `title`; voz: `title` «Voz desactivada» frente a `aria-label` «Activar la voz de Nodo»; «Cerrar el asistente» y «Enviar pregunta» sin `title` | Al pasar el ratón, la persona no ve texto, o ve uno distinto del nombre accesible. | Poner `title` igual al `aria-label` en todos los botones de icono. |
| NN-27 | baja | `/` tarjetas | Minigráfica + «19,7–28,0 · 6 h» | Rango y periodo sin etiqueta. | «Mín.–máx. últimas 6 h: 19,7–28,0» |
| NN-28 | baja | `/alertas` | «valores atípicos (z-score)» | Término estadístico en inglés. | «valores muy distintos a lo normal» |
| NN-29 | baja | `/historico` | «media por ventana de 300s. Fuente: bucket «raw» de InfluxDB»; «Desv. estándar»; «dur. media» | Jerga y abreviaturas. | «Promedio cada 5 minutos»; «Desviación estándar»; «duración media» |
| NN-30 | baja | `/asistente` | «MODELO qwen3.8-flash · TOKENS / CONSULTA 918 · LATENCIA MEDIA 1.8 s» | Métricas técnicas en la vista pública. | Moverlas a un apartado «Detalles técnicos». |
| NN-31 | baja | `/historico` | «Gravedad: … critica 1» | Falta la tilde: «crítica». | «crítica» |
| NN-32 | baja | `/no-existe-esta-pagina`, `/dispositivos/DEV99` | «Esa calle no está en el mapa. Volver al panel»; «Dispositivo no encontrado» | Una metáfora que no se entiende literalmente, y un error sin acción. | «Esta página no existe. Volver al panel»; «No existe el dispositivo DEV99. Ver todos los dispositivos». |
| NN-33 | baja | `/historico` | Botón «CSV» | El texto no describe la acción. | «Descargar CSV» |
| NN-34 | baja | Todas | `<title>` siempre «Smart City Bucaramanga»; sin selector de idioma | Las pestañas no se distinguen y no hay ayuda de idioma. `lang="es"` es correcto. | «Calidad del aire DEV02 · Smart City Bucaramanga», etc. |
| NN-35 | baja | Varias | «PM2.5», «PM10», «dB(A)», «hPa», «lx», «veh/min», «M S. N. M.», «Cra», «C.C.», «v0» | Unidades y abreviaturas sin `title`. | Añadir `title`, por ejemplo «dB(A): decibelios, nivel de ruido»; «PM2.5: partículas finas». |

No observé «QoS» ni «ack» en ninguna ruta pública.
