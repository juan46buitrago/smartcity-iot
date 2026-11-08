/**
 * Prueba de humo del enrutador IA contra el proveedor real (no toca InfluxDB ni MQTT).
 * Mide decisión, tokens y latencia por pregunta y compara con la decisión esperada.
 *
 *   AI_API_KEY=... npx tsx apps/backend/src/scripts/ai-smoke.ts [--json salida.json]
 */
import { writeFileSync } from 'node:fs';
import { OpenAiCompatClient } from '../ai/client.js';
import { route, type Expert } from '../ai/router.js';

const CASES: { q: string; experto: Expert; series?: string[]; horas?: number; desfase?: number }[] = [
  { q: '¿Cuál fue el promedio, mínimo y máximo de temperatura de la estación ambiental hoy?', experto: 'estadisticas', series: ['DEV01.temperature'], horas: 24 },
  { q: 'compara el ruido con el flujo de vehículos esta semana', experto: 'serie', series: ['DEV03.noise_db', 'DEV05.vehicles_per_min'], horas: 168 },
  { q: '¿a qué hora hay más ruido?', experto: 'perfil_horario', series: ['DEV03.noise_db'] },
  { q: 'qué alertas hay activas', experto: 'alertas' },
  { q: '¿cuántos incidentes viales hubo ayer?', experto: 'incidentes', horas: 24, desfase: 24 },
  { q: '¿qué dispositivos están fuera de línea?', experto: 'estado' },
  { q: 'muéstrame el nivel del río de los últimos 3 días', experto: 'serie', series: ['DEV09.water_level'], horas: 72 },
  { q: 'cómo está la calidad del aire ahora, pm2.5', experto: 'estado', series: ['DEV02.pm2_5'] },
  { q: 'ocupación del parqueadero en las últimas 6 horas', experto: 'serie', series: ['DEV08.occupancy_pct'], horas: 6 },
  { q: 'dame una receta de arepas', experto: 'fuera_de_tema' },
];

const key = process.env.AI_API_KEY;
if (!key) {
  console.error('Defina AI_API_KEY');
  process.exit(1);
}
const llm = new OpenAiCompatClient({
  baseUrl: process.env.AI_BASE_URL ?? 'https://api.b.ai/v1',
  apiKey: key,
  model: process.env.AI_MODEL ?? 'qwen3.8-flash',
  timeoutMs: 20_000,
});

const rows = [];
for (const c of CASES) {
  try {
    const r = await route(llm, c.q);
    const d = r.decision;
    const ok =
      d.experto === c.experto &&
      (!c.series || c.series.every((s) => d.series.includes(s))) &&
      (c.horas === undefined || d.horas === c.horas) &&
      (c.desfase === undefined || d.desfase_horas === c.desfase);
    rows.push({ q: c.q, ok, decision: d, tokens: r.usage.prompt_tokens + r.usage.completion_tokens, ...r.usage, ms: r.ms, attempts: r.attempts });
    console.log(`${ok ? '✔' : '✘'} ${String(r.ms).padStart(5)} ms ${String(r.usage.prompt_tokens + r.usage.completion_tokens).padStart(4)} tok  ${c.q}\n      → ${JSON.stringify(d)}`);
  } catch (err) {
    rows.push({ q: c.q, ok: false, error: (err as Error).message });
    console.log(`✘ ERROR ${c.q}: ${(err as Error).message}`);
  }
}
const okRows = rows.filter((r) => 'tokens' in r) as { ok: boolean; tokens: number; ms: number; prompt_tokens: number; completion_tokens: number }[];
const avg = (f: (r: (typeof okRows)[number]) => number) => Math.round(okRows.reduce((a, r) => a + f(r), 0) / Math.max(1, okRows.length));
const summary = {
  model: llm.model,
  at: new Date().toISOString(),
  aciertos: `${rows.filter((r) => r.ok).length}/${rows.length}`,
  tokens_promedio: avg((r) => r.tokens),
  entrada_promedio: avg((r) => r.prompt_tokens),
  salida_promedio: avg((r) => r.completion_tokens),
  latencia_promedio_ms: avg((r) => r.ms),
};
console.log('\nResumen:', summary);
const i = process.argv.indexOf('--json');
if (i > 0 && process.argv[i + 1]) writeFileSync(process.argv[i + 1]!, JSON.stringify({ summary, rows }, null, 2));
