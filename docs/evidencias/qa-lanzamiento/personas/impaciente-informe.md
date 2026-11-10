# Auditoría UX: persona «El impaciente»

**Sitio:** https://smartcitybga.duckdns.org · **Fecha:** 2026-11-09, 10:44 a 11:39 (hora de Colombia) · **Navegador:** Chromium headless propio (Playwright 1.48.2), 1366×768, sin sesión.

Las capturas y mediciones citadas están en esta misma carpeta.

## Resultado

- **Primer éxito: sí**, a unos **3,4 s** de abrir la URL: se entiende qué es (una frase en la bienvenida) y se ve la temperatura en vivo tras un clic en «Empezar».
- **Abandono: sí, en la pasada 1, en Histórico** (unos 24,6 s desde la llegada). La gráfica no carga y aparece en pantalla «Rate limit exceeded, retry in 16 seconds». Ya había logrado el primer éxito, pero es el primer error visible y esta persona se iría ahí.
- **Después del abandono:** Alertas afirma «Todo tranquilo» mientras la insignia indica 1 alerta. Es el hallazgo más grave, y este usuario no lo notaría.
- **Sin 429 todo va bien:** en las pasadas 2 y 3 hubo 0 respuestas 429 y cada sección respondió entre 56 y 429 ms tras el clic.

### Condiciones que afectan a la lectura

- **Red irregular.** Referencia con `curl` en la misma máquina: google.com tardó 1,1 a 3,7 s (HEAD) y la raíz del sitio, 1,3 a 6,3 s. Los tiempos de carga en frío incluyen esa red; no se puede separar con certeza qué parte es de la app.
- **IP compartida.** Durante la auditoría corrían desde esta máquina otros agentes de persona (`esceptico`, y carpetas activas de `movil` y `no-nativo`) y un `chaos.mjs`, visibles con `ps`. El presupuesto de 300 peticiones/min por IP se comparte entre todos. Las 429 **no** demuestran que un visitante aislado las reciba; lo que sí se observó es cómo reacciona la interfaz al recibirlas.

## Recorrido paso a paso

### Pasada 1: visitante nuevo, clics sin pausa

| # | Acción | Qué vi | Tiempo medido |
|---|---|---|---|
| 1 | Abrir la URL en frío | Pantalla oscura vacía, sin logo ni indicador de carga (`01-carga-500ms.png`, tomada entre 1,9 y 2,9 s de esa carga) | FCP 1,9 a 4,5 s (ver tabla de cargas) |
| 2 | Echar un vistazo | Modal «Hola, soy Nodo»: una frase explicativa, 6 tarjetas y «Empezar»; los datos quedan difuminados detrás (`02-primera-vista.png`) | Modal a 2,6 s |
| 3 | Clic en «Empezar» | El modal desaparece y se ve el panel (`03-tras-empezar.png`) | 62 ms de pulsación a modal retirado, con ratón real (pasada 2) |
| 4 | **Primer éxito** | «La ciudad, ahora»; 27,5 °C, AQI 53 Moderada, ruido 62,3 dB(A) sobre el pliegue | Unos 3,4 s desde la llegada |
| 5 | Comprobar que es en vivo (15 s sin tocar) | Cambia el ruido (62,3 a 61,9 a 61,3), el flujo (66 a 48 veh/min) y la temperatura (27,5 a 27,4); el reloj avanza (`04-panel-15s.png`) | Primer cambio en un tile a 1,03 s |
| 6 | Mapa | Mapa con 12 nodos (`05-mapa.png`) | Contenido 181 ms |
| 7 | Dispositivos | Tabla con lecturas (`06-dispositivos.png`) | Contenido 163 ms |
| 8 | Histórico | **«No se pudo consultar el histórico / Rate limit exceeded, retry in 16 seconds»**; CSV deshabilitado (`07-histórico.png`). 4 respuestas 429. **Aquí abandonaría** | Contenido 316 ms; error en 456 ms |
| 9 | Alertas | **«No hay alertas con este filtro / Todo tranquilo por aquí»** con la insignia en 1 y la burbuja «Hay 1 alerta abierta» (`08-alertas.png`). 429 en `/api/alerts` | Contenido 52 ms |
| 10 | Asistente | Página correcta en la parte visible (`09-asistente.png`). 429 en `/api/ai/analysis`, sin efecto visible sin hacer scroll | Contenido 185 ms |
| 11 | Configuración | Correcta, controles bloqueados (`10-configuracion.png`). 429 en `/api/health`, sin efecto visible | Contenido 56 ms |
| 12 | Volver al Panel | Correcto (`11-panel.png`) | Contenido 74 ms |

### Pasada 2: visitante nuevo, sin 429 (47 llamadas `/api`, `x-ratelimit-remaining` 193 al empezar)

| Acción | Resultado | Tiempo |
|---|---|---|
| Clic en el tile de temperatura, ficha DEV01 | Se ve 28,2 °C sobre el pliegue; controles deshabilitados (`12-ficha-dev01.png`) | Dato a 73 ms |
| Alertas | **Sí** muestra la alerta de DEV11, en contraste con la pasada 1 (`14-alertas-b.png`) | Alerta a 186 ms |
| Recargar en `/alertas` | Sin modal; queda guardado `scbga.bienvenida` | Contenido a 236 ms |

### Pasada 3: visitante nuevo, la única pregunta a Nodo

| Acción | Resultado | Tiempo |
|---|---|---|
| Clic en «Toca aquí…» del héroe | Se abre el panel lateral con preguntas sugeridas (`15-nodo-abierto.png`) | 212 ms |
| Clic en «¿Cómo está la ciudad ahora?» (única pregunta, HTTP 200) | Aparece «Nodo está consultando a General…» (`16-nodo-pensando.png`) | Indicador a 39 ms |
| Respuesta | Lecturas por dispositivo y alerta reciente, con botones «Ver dispositivos» y «Ver alertas» (`17-nodo-respuesta.png`) | 2,8 s (la interfaz indica 2,6 s) |
| Histórico, sin 429 | Gráfica de 24 h y estadísticas (`18-historico-ok.png`) | Curva 398 ms; estadísticas 429 ms |
| Visitante nuevo con enlace directo a `/mapa` | Aparece igualmente la bienvenida (`19-directo-mapa.png`) | No medido |
| Visitante nuevo en una ruta inexistente | Aparece la bienvenida; debajo, «Esa calle no está en el mapa. Volver al panel» (`medicion-nodo.txt`) | No medido |

### Cargas en frío (5 secuenciales, contexto limpio)

| Métrica | Mínimo | Mediana | Máximo |
|---|---|---|---|
| FCP | 1 935 ms | 2 715 ms | 4 471 ms |
| LCP | 2 190 ms | 3 065 ms | 4 761 ms |
| Temperatura en el DOM | 2 788 ms | 3 689 ms | 5 463 ms |
| Primera línea de la Bitácora | 3 881 ms | 6 107 ms | 6 731 ms |

CLS de 0,025 a 0,027. Cada carga: 40 peticiones, unos 866 KB. La Bitácora en vivo queda muy bajo el pliegue (y = 1484 de un documento de 1793 px con ventana de 768). Detalle en `medicion-cargas.txt`.

## Hallazgos

| id | severidad | pantalla o ruta | qué pasó | evidencia | causa probable |
|---|---|---|---|---|---|
| I-01 | alta | `/alertas` | Con 429 en `/api/alerts` la página afirma «No hay alertas… Todo tranquilo por aquí» mientras la insignia marca 1 y la burbuja dice «Hay 1 alerta abierta». Sin 429 muestra la alerta de DEV11 | `08-alertas.png` frente a `14-alertas-b.png`; 429 en `medicion-recorrido.txt` | Cualquier error se convierte en lista vacía: `.catch(() => setRows([]))` en `AlertsPage.tsx:27` (commit 15d9e4b) |
| I-02 | media | `/historico` | Error en inglés y con detalle técnico: «Rate limit exceeded, retry in 16 seconds». **Punto de abandono.** No comprobé si se recupera solo | `07-histórico.png` | El texto del backend se muestra tal cual; el título sí está en español |
| I-03 | media | Varias rutas | 7 respuestas 429 en unos 7 s de navegación con clics normales (Histórico, Alertas, Asistente, Configuración). No se repitió en las pasadas 2 y 3 | `medicion-recorrido.txt`; `x-ratelimit-limit` 300 y `remaining` 193 al iniciar la pasada 2 en `medicion-recorrido2.txt` | Límite global de 300/min por IP (`app.ts:94`, commit 15d9e4b) agotado entre varias sesiones de esta auditoría en la misma IP. Inferencia no observada: un Panel gasta unas 21 llamadas, así que unas 14 cargas por minuto tras una misma IP (por ejemplo, un aula) lo agotarían |
| I-04 | media | `/`, enlaces directos y rutas inexistentes | La bienvenida se interpone antes del primer dato, también en enlaces directos y en la página de ruta inexistente. Cuesta un clic; solo aparece en la primera visita | `02-primera-vista.png`, `19-directo-mapa.png`, `medicion-nodo.txt` | Modal de primera visita sin distinción de ruta de entrada |
| I-05 | baja | `/` en frío | Pantalla oscura sin ningún indicador hasta el FCP: de 1,9 a 4,5 s en 5 cargas, con la red degradada | `01-carga-500ms.png`, `medicion-cargas.txt` | HTML casi vacío (1,3 KB) que depende del JS para pintar. No se puede separar la parte de la red |
| I-06 | baja | Panel, cabecera, `/mapa` | Lo primero que se lee es «11/12 nodos» en ámbar, «1 alerta abierta», el nodo 11 en rojo y la burbuja de alerta; la alerta es de DEV11, abierta desde el 8 de nov a las 20:56, sin explicación en el Panel | `03-tras-empezar.png`, `14-alertas-b.png` | DEV11 funciona bajo demanda y su desconexión queda como alerta abierta |
| I-07 | baja | Bienvenida, Dispositivos, Alertas, Nodo | Jerga en las primeras pantallas: «conectados por MQTT», «último testamento (LWT)», «z-score», «1172 tokens»; paréntesis doble en «(conexión perdida (LWT))» | `02-primera-vista.png`, `14-alertas-b.png`, `17-nodo-respuesta.png` | Textos orientados a la evaluación técnica |
| I-08 | baja | Panel de Nodo | Al terminar, la vista queda al final de la respuesta: el comienzo y la pregunta quedan fuera de la zona visible | `17-nodo-respuesta.png` | Autoscroll al último contenido |
| I-09 | baja | Cabecera a 1366 px | La marca ocupa 3 líneas y «EN VIVO» y la fecha se parten en 2 | Cualquier captura, p. ej. `03-tras-empezar.png` | Demasiados elementos para ese ancho |
| I-10 | baja | `/historico` | La burbuja flotante «Hay 1 alerta abierta» queda sobre el tramo final de la gráfica, el de los datos más recientes | `18-historico-ok.png` | Elemento flotante sin reserva de espacio |
| I-11 | baja | Todas | Error de consola en cada carga: la CSP rechaza una fuente `data:`. Es el subconjunto cirílico de Martian Mono; sin efecto visible en español | `medicion-recorrido.txt`; regla en el CSS servido | Fuente pequeña incrustada en el CSS y `font-src 'self'` en la CSP de nginx |
| I-12 | baja | `/configuracion` | Abre con DEV04 preseleccionado en lugar del primero de la lista (visto una vez) | `10-configuracion.png` | No determinada |

## Lo que funcionó para esta persona

Un único CTA claro y ya enfocado; clic a pantalla en menos de medio segundo en todas las secciones sin 429; datos que cambian a la vista en un segundo; indicador inmediato al preguntar a Nodo y respuesta en menos de 3 s; recarga sin repetir la bienvenida.

## Límites y mediciones descartadas

- **FCP de 44 s en la primera carga:** no se reproduce en las cargas posteriores. En esa carga las capturas se bloquearon 30 s cada una y la red estaba irregular; no se atribuye a la app.
- **Cuatro cargas iniciales:** mi `waitForFunction` falló, así que solo dejaron tiempos de HTML y CSS (CSS de hasta 6,4 s). Descartadas para FCP.
- **Histórico «50 ms» en `medicion-recorrido2.txt`:** inválido, el selector aún veía la gráfica de la ficha anterior. El valor correcto es el de la pasada 3 (398 ms).
- **`Empezar` 740 ms en la pasada 1:** incluye la espera de accionabilidad de Playwright. El valor real es 62 ms.
- **`20-ruta-inexistente.png`:** no sirve como evidencia; quité el modal por script y quedó solo el fondo difuminado. El texto observado está en `medicion-nodo.txt`.
- **Tiles del mapa:** el tiempo de `/mapa` se midió con los tiles ya cargados por el Panel.
- **Volumen generado:** 16 cargas en frío contabilizadas, secuenciales, más una ejecución interrumpida de la que no consta cuántas llegó a hacer. Anuncié 3 cargas en una tanda y se ejecutaron 5 porque el script ya tenía aplicado el cambio anterior.
- **Código citado:** del commit 15d9e4b. No verifiqué que sea exactamente lo desplegado, y el árbol de trabajo cambió durante la auditoría, con ediciones ajenas a mí en esos mismos archivos.
- **Respetado:** sin iniciar sesión, sin órdenes, sin abrir la ficha de DEV11 ni tocar su encendido, 1 sola pregunta a la IA, sin salir del dominio y sin modificar el repositorio.
