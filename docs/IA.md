# SmartCityBGA — Asistente IA

El asistente responde preguntas en lenguaje natural sobre los datos de la ciudad, dibuja la gráfica
que corresponde y redacta el análisis de comportamiento de cada dispositivo para el informe.
Código: `apps/backend/src/ai/` · Interfaz: `apps/frontend/src/pages/AssistantPage.tsx` (`/asistente`).

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
| Expertos | `experts.ts` | `estadisticas` (promedio/mín/máx/desviación con hora local), `serie` (hasta 4 series, tendencia), `perfil_horario` (promedio por hora del día), `alertas`, `incidentes` (siempre marcados `[SIMULACIÓN]`), `estado`, `ayuda`, `fuera_de_tema`. Devuelven texto y `chart` (línea o barras). |
| Servicio | `service.ts` | Caché de decisiones (pregunta normalizada → 0 tokens al repetir), atajo de "ayuda" sin modelo, presupuesto diario (`AI_DAILY_MAX_CALLS`), registro de tokens y latencias en SQLite (`ai_usage`), análisis por dispositivo (`ai_analysis`). |
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
| POST | `/api/ai/chat` `{question}` | público, 12/min/IP | Respuesta `{text, chart?, synthetic, decision, usage, ms, cached, model}` |
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
`apps/backend/src/ai/ai.test.ts` (27 pruebas, sin red): esquema estricto y vocabulario, solo
`[system, user]`, reintento único, JSON envuelto en Markdown, plan B `json_object`, cada experto
con datos simulados (hora de Bogotá, desfase "ayer", perfil horario), caché, presupuesto diario,
narrador que recibe solo hechos numéricos, y las rutas HTTP (200/400/401/502/503).

## Límites conocidos
- "Ayer" se interpreta como la ventana de 24 h que terminó hace 24 h, no como el día calendario.
- El análisis describe lo que muestran los números; no sustituye la revisión humana de las gráficas.
- Las respuestas sobre dispositivos simulados llevan la etiqueta SIM.
