# SmartCityBGA — Asistente IA

El asistente responde preguntas en lenguaje natural sobre los datos de la ciudad, dibuja la gráfica
que corresponde y redacta el análisis de comportamiento de cada dispositivo para el informe.
Código: `apps/backend/src/ai/` · Interfaz: panel lateral en todas las páginas (botón «Pregúntale a la IA»,
`components/AssistantDrawer.tsx`) y página completa `/asistente`; ambos comparten la conversación
(`lib/assistant.tsx`). Enlace directo: cualquier ruta con `?asistente=<pregunta>` abre el panel y la pregunta.

## Agentes expertos
Cada agente acota el vocabulario que ve el enrutador a sus dispositivos (`agents.ts`): el prompt es más
corto y el esquema JSON impide elegir series fuera del tema.

| Agente | Dispositivos | Tokens por pregunta (medido) |
|---|---|---|
| General | los 12 | ≈ 1 050 |
| Clima | DEV01, DEV10, DEV11, DEV12 | — |
| Aire y ruido | DEV02, DEV03 | ≈ 650 |
| Movilidad | DEV04, DEV05, DEV06, DEV08 | ≈ 720 |
| Agua y lluvia | DEV09, DEV10, DEV12 | ≈ 730 |
| Alumbrado | DEV07 | ≈ 640 |
| Operación | los 12 (estado, alertas, incidentes, inventario) | ≈ 1 030 |

**Seguimientos.** El cliente manda la *decisión* de la respuesta anterior (≈ 40 tokens), no el
historial: «¿y ayer?» conserva las series y cambia el desfase. Si el seguimiento pide el pasado de un
valor actual, se responde con estadísticas de esa ventana. El servidor valida el contexto contra el
vocabulario y lo ignora si es inválido.

## Arquitectura

```
Pregunta ──► Enrutador (LLM, ~750 tokens) ──► decisión JSON cerrada ──► Experto (código, 0 tokens) ──► texto + gráfica
              qwen3.8-flash · temperature 0          {experto, series,         InfluxDB · SQLite · estado vivo
              sin historial · sin razonamiento        horas, desfase_horas}
              response_format json_schema strict
```

**La regla:** el modelo decide, el código calcula. Al modelo nunca se le envían lecturas: solo el
vocabulario (dispositivos y variables numéricas del catálogo) y la pregunta.

| Pieza | Archivo | Qué hace |
|---|---|---|
| Cliente | `client.ts` | `POST /chat/completions` compatible con OpenAI con `fetch`. `temperature: 0`, `enable_thinking: false`, `response_format: json_schema` estricto; si el proveedor responde 400, reintenta en modo `json_object` (plan B). Tiempo límite 15 s. |
| Enrutador | `router.ts` | Prompt de sistema compacto + esquema JSON con **enums cerrados** (8 expertos, todas las series `DEVxx.variable`, ventanas 1–168 h, desfase 0–72 h). Validación zod (el CDM garantiza el formato, zod el contenido) y **máximo 2 intentos**. |
| Expertos | `experts.ts` | `estadisticas` (promedio/mín/máx/desviación con hora local), `serie` (hasta 4 series, tendencia), `perfil_horario` (promedio por hora del día), `alertas`, `incidentes` (siempre marcados `[SIMULACIÓN]`), `estado` (valor actual con nombre del equipo; lat/lon como ubicación), `resumen` (equipos en línea, alertas y valor principal de cada equipo del agente), `dispositivos` (inventario), `ayuda`, `fuera_de_tema`. Devuelven texto, `chart` (línea o barras) y `links` a la vista de la app. |
| Agentes | `agents.ts` | Siete agentes con dispositivos y preguntas de ejemplo. |
| Servicio | `service.ts` | Caché de decisiones por agente y contexto (pregunta normalizada → 0 tokens al repetir), atajo de "ayuda" sin modelo, presupuesto diario (`AI_DAILY_MAX_CALLS`), registro de tokens, latencias, pregunta y agente en SQLite (`ai_usage`), análisis por dispositivo (`ai_analysis`). |
| Rutas | `routes.ts` | Ver abajo. |

### Decodificación restringida (CDM)
En cada token el proveedor solo permite los caracteres legales según el esquema: después de
`"experto": "` el modelo solo puede escribir uno de los 8 expertos, y en `series` solo nombres de
variables que existen. Eso elimina las respuestas mal formadas; zod descarta las bien formadas pero
inválidas (p. ej. series repetidas) y se reintenta una sola vez.

### Por qué gasta tan poco
1. Sin datos en el prompt (vocabulario, no tablas).
2. Sin historial: cada pregunta es `[system, user]`.
3. Sin razonamiento (`enable_thinking: false`).
4. Salida mínima y cerrada (~40 tokens).
5. `temperature: 0` y como mucho 2 intentos.
6. Los expertos no llaman al modelo; solo el análisis de dispositivo genera prosa (≈ 400 tokens de salida).

## Rutas

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/api/ai/status` | público | Modelo, límite diario y consumo (24 h y total): llamadas, caché, fallos, tokens promedio, latencia |
| GET | `/api/ai/agents` | público | Agentes, sus dispositivos y preguntas de ejemplo |
| POST | `/api/ai/chat` `{question, agent?, previous?}` | público, 12/min/IP | Respuesta `{text, chart?, links?, synthetic, agent, decision, usage, ms, cached, model}` |
| GET | `/api/ai/analysis` | público | Último análisis por dispositivo |
| POST | `/api/ai/analysis/:id` `{hours=144}` | operador (JWT) | Calcula hechos (promedio, mín, máx, desviación, hora pico/valle, primer vs último cuarto) y pide al modelo un párrafo ≤ 150 palabras con esos números |

Errores: 400 (pregunta de 2–300 caracteres), 429 (límite diario o de frecuencia), 502 (el enrutador
no logró decidir o el proveedor no respondió), 503 (sin `AI_API_KEY`).

## Configuración

| Variable | Por defecto | Nota |
|---|---|---|
| `AI_BASE_URL` | `https://api.b.ai/v1` | Cualquier API compatible con OpenAI |
| `AI_API_KEY` | — | Sin clave el asistente queda deshabilitado; el resto de la app funciona igual |
| `AI_MODEL` | `qwen3.8-flash` | Elegido por medición (abajo) |
| `AI_DAILY_MAX_CALLS` | `2000` | Llamadas reales al modelo en 24 h |

## Nodo: personalidad, voz, órdenes y gráficas (2026-11-08)

- **Identidad.** El asistente es **Nodo**, un robot-nodo de red (cuerpo lavanda, ojos verdes) que vive en la app: rebota en la esquina de cada página, parpadea, sus ojos siguen el cursor y cambia de humor (`reposo`, `pensando`, `hablando`, `alerta`, `contento`). Es SVG + CSS (`components/Nodo.tsx`, sección «Nodo» de `index.css`); con `prefers-reduced-motion` queda quieto. El segundo acento `--ai` (lavanda apagado) se reserva a la voz de la IA.
- **Voz (TTS).** `lib/speech.ts` usa la Web Speech API del navegador (voz en español, es-CO si existe): sin servidor, sin costo y sin enviar texto a terceros. Botón de altavoz en el panel; la preferencia se guarda en el navegador.
- **Resumen del día** (`resumen_dia`): promedio, rango y hora del máximo de la variable principal de cada equipo en 24 h, más equipos en línea y alertas. Cálculo en código, 0 tokens extra.
- **Órdenes en lenguaje natural** (`accion`): Nodo **solo propone**. Un segundo llamado (salida cerrada, ~90 tokens, solo cuando la pregunta es una orden) convierte la frase en `{dispositivo, acción, valor…}`; `validateCommand` (el mismo del catálogo) la valida y se devuelve una *propuesta*. La app muestra «Orden lista para enviar» y, al confirmar, la envía a `POST /api/devices/:id/commands`, que exige sesión de operador. Autorización y confirmación siguen siendo humanas. Acciones permitidas: encender/apagar, intervalo, modo, parámetros y reinicio (no calibración ni pruebas de incidente).
- **Formas de gráfica.** Palabras como «en barras», «como área» o «en torta» fijan `chart.style` (`chartStyleOf`, sin tokens). Línea/área/barras para series y barras/torta para conteos.
- **Costo.** El enrutador sigue siendo una sola llamada pequeña (el prompt creció ≈ 8 % por los dos expertos nuevos); la segunda llamada existe únicamente para órdenes.
- **Pruebas.** 43 en `ai.test.ts` (7 nuevas: resumen del día, propuesta de orden, rango inválido, dispositivo fuera del agente, JSON inválido, estilos) y 3 en `dev11.test.ts`.

## Mediciones (2026-11-08)

Prueba de humo `apps/backend/src/scripts/ai-smoke.ts` (10 preguntas variadas contra el proveedor real;
resultado en `docs/evidencias/ia/enrutador-2026-11-08.json`):

| Modelo | Aciertos | Tokens/pregunta (entrada + salida) | Latencia media |
|---|---|---|---|
| `qwen3.8-flash` | **10/10** | **≈ 750** (711 + 39) | **1,8 s** |
| `deepseek-v4.1-flash` | — | se descartó: con 80 tokens de salida devolvió vacío (razonamiento interno) | 3,1 s |

La primera versión del prompt acertó 9/10 (confundía "¿cuántos incidentes…?" con estadísticas de
`DEV04.active_incidents`); se precisó la descripción del experto `incidentes`.

```bash
AI_API_KEY=... npx tsx apps/backend/src/scripts/ai-smoke.ts --json docs/evidencias/ia/enrutador-AAAA-MM-DD.json
```

## Pruebas
`apps/backend/src/ai/ai.test.ts` (35 pruebas, sin red): esquema estricto y vocabulario, solo
`[system, user]`, reintento único, JSON envuelto en Markdown, plan B `json_object`, cada experto
con datos simulados (hora de Bogotá, desfase "ayer", perfil horario), caché, presupuesto diario,
narrador que recibe solo hechos numéricos, agentes (vocabulario y caché acotados), seguimientos con
contexto validado, resumen, inventario, ubicación, y las rutas HTTP (200/400/401/502/503).

## Límites conocidos
- "Ayer" se interpreta como la ventana de 24 h que terminó hace 24 h, no como el día calendario.
- El análisis describe lo que muestran los números; no sustituye la revisión humana de las gráficas.
- Las respuestas sobre dispositivos simulados llevan la etiqueta SIM.
- Varias series con unidades distintas se dibujan como gráficas separadas (nunca doble eje); el botón PNG exporta la primera.
