# Regresión: persona «Hablante no nativo» (NN-01…NN-35)

**Comprobado en ejecución**, en el navegador, contra la réplica local `http://127.0.0.1:8380`, el 9 nov 2026 hacia las 17:43 hora de Colombia.

- **Navegador:** Chromium headless propio, con Playwright.
- **Configuraciones probadas:** `es-CO` con `America/Bogota`; `en-US` con `Asia/Tokyo`; `en-US` con `Europe/Madrid`.
- **Límites que respeté:** no toqué producción. Solo navegué y leí. No pulsé Reconocer, Resolver, Generar ni Aplicar. No envié ninguna pregunta al asistente.
- **Evidencia:** `reg/r1.mjs` (el script), `reg/r1.json` (los datos), `reg/texto-*.txt` y las capturas `reg/*.png`, todo en esta carpeta.
- **Versión anterior:** la de esta mañana solo revisaba el código, porque la réplica estaba caída. Esta la sustituye.

## Los 7 corregidos

| id | estado | evidencia en vivo |
|---|---|---|
| NN-01 | corregido en el panel; persiste en la ficha | La tarjeta DEV02 del panel tiene `title` y texto `sr-only`: «AQI: índice de calidad del aire (escala de la EPA, 0 a 500; más alto es peor). 0–50 buena · 51–100 moderada: aceptable…». El nombre accesible del enlace lo incluye. En `/dispositivos/DEV02` no aparece esa explicación, ni en texto ni en `title`. Captura `reg/03-hover-aqi.png`. |
| NN-03 | corregido | «LWT» y «testamento» no aparecen en ninguna de las 12 rutas recorridas: panel, dispositivos, DEV02, DEV06, DEV11, histórico, alertas, asistente, configuración, mapa, 404 y DEV99. Eso incluye el texto de Mantenimiento y el subtítulo de Dispositivos. No pude ver el motivo nuevo («se perdió la conexión con el broker»), porque en la réplica no había ninguna alerta de desconexión. La única alerta abierta era de umbral, en DEV12. |
| NN-05 | corregido | Durante la carga, de 150 ms a 2 s, se ve «CONECTANDO» y luego «EN VIVO», «…/12 NODOS», «ALERTAS ABIERTAS …», los valores como «—» y 0 apariciones de «sin datos». Ya no aparecen ceros falsos. |
| NN-09 | corregido, parcial | En `/historico` el campo dice «Desde (hora de Colombia) = 2026-11-04T17:43». Pero «Hasta» sigue sin zona horaria, y quedan «Última observación de la fuente: 09/11 17:00 (hora local)» en `/dispositivos/DEV02` e «Incidentes por hora del día (hora local)» en `/historico`. |
| NN-10 | corregido en el panel; persiste en el chat | El panel dice «Nodo: Buenas tardes» a las 17:43 COT en las tres zonas probadas. El saludo del chat de Nodo sigue la hora del navegador: con Tokio (7:44 allí) dice «Buenos días, soy Nodo»; con Madrid (23:44 allí) dice «Buenas noches, soy Nodo». En los dos casos la cabecera marcaba 17:44 COT. |
| NN-18 | no aplica en réplica | `/dispositivos/DEV11` muestra «ESTADO Sin datos» sin el bloque de encendido ni ningún mensaje de error. En el código (`firmware/dev11-esp32/vm/controller.py:125`) el mensaje ahora termina en «Vuelve a intentarlo más tarde…», sin pedir el log. |
| NN-21 | corregido | Las tarjetas del panel llevan 6 «SIM» y 3 «REAL», con `title` «Dato sintético: simulación o gemelo digital…» y «Dato de fuente externa real». Captura `reg/02-inicio.png`. |

## Los demás (pendientes)

| id | estado | evidencia en vivo |
|---|---|---|
| NN-02 | no aplica en réplica | Sin proveedor de IA. No envié preguntas. |
| NN-04 | persiste | El modal dice «…12 dispositivos IoT conectados por MQTT». «MQTT» sigue en el panel, dispositivos, DEV11 y configuración. |
| NN-06 | no aplica en réplica | Con red local hay texto visible a los 150 ms; no se puede comparar con producción. |
| NN-07 | persiste | El viento se muestra abreviado («NE» en esta lectura); no hay texto «noreste»/«noroeste». |
| NN-08 | persiste | La cabecera dice «LUN, 09 DE NOV · COT»; la zona solo se explica en el `title`. |
| NN-11 | persiste | El control nativo `datetime-local` depende del navegador. Con en-US/Madrid el valor es la hora de Colombia (17:44), ahora con la etiqueta correcta. |
| NN-12 | persiste | La alerta dice «5.80 mm (límite 5)», con punto decimal, mientras el resto de la interfaz usa coma. |
| NN-13 | persiste | A las 17:44 COT el CSV se llama `smartcitybga-historico-2026-11-09T2244.csv` (hora UTC sin indicarlo). |
| NN-14 | persiste | Aparece «· twin» en `/dispositivos`. |
| NN-15 | persiste | «Gemelo digital» en dispositivos e histórico, sin explicación en texto. |
| NN-16 | persiste | «SIMULATED» en `/configuracion`. |
| NN-17 | persiste | Los marcadores solo se llaman «01», «02»…; el zoom tiene `title` «Zoom in» y «Zoom out». |
| NN-19 | no aplica en réplica | DEV11 no tiene datos ni órdenes en la réplica. |
| NN-20 | persiste | La ficha dice «DEV06 · MOVILIDAD · SIMULADO»; la tabla de `/historico` dice «REAL». |
| NN-22 | no reproducido | La burbuja dice «Hay 1 alerta abierta» en todas las rutas, igual que la navegación. |
| NN-23 | persiste | «Reconocer» y «Resolver» están habilitados (`disabled=false`) sin sesión. |
| NN-24 | persiste | «Apagar» y «Aplicar» están deshabilitados con `title` vacío. |
| NN-25, NN-26, NN-27, NN-35 | persiste (sin cambios observados) | No están entre los corregidos; no hice una comprobación específica. |
| NN-28 | persiste | «valores atípicos (z-score)» en `/alertas`. |
| NN-29 | persiste | «bucket «raw» de InfluxDB» en `/historico`. |
| NN-30 | persiste | «tokens» en `/asistente`. |
| NN-31 | no reproducido | Ahora solo se ve «Gravedad: alta 1». En el código la severidad se sigue imprimiendo en crudo (`HistoryPage.tsx:324`). |
| NN-32 | persiste | La 404 dice «Esa calle no está en el mapa». `/dispositivos/DEV99` solo dice «Dispositivo no encontrado», sin acción. |
| NN-33 | persiste | El botón sigue diciendo «CSV». |
| NN-34 | persiste | El `<title>` es «Smart City Bucaramanga» en todas las rutas; `lang="es"` es correcto. |
