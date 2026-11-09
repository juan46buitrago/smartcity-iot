/**
 * Servicio del asistente IA: orquesta enrutador → experto, registra el consumo de tokens,
 * aplica un presupuesto diario y genera el análisis de comportamiento por dispositivo.
 */
import { DEVICE_CATALOG, type DeviceId } from '@scbga/shared';
import type { Db } from '../db.js';
import { proposeCommand } from './actions.js';
import { agentOf, type AgentSpec } from './agents.js';
import type { LlmClient, LlmUsage } from './client.js';
import { hourlyProfile, runExpert, type ExpertAnswer, type ExpertDeps } from './experts.js';
import { decisionSchema, route, type Decision } from './router.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ai_usage (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  at                TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('chat','analysis')),
  model             TEXT NOT NULL,
  prompt_tokens     INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  llm_ms            INTEGER NOT NULL,
  total_ms          INTEGER NOT NULL,
  ok                INTEGER NOT NULL,
  cached            INTEGER NOT NULL DEFAULT 0,
  expert            TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_at ON ai_usage(at);
CREATE TABLE IF NOT EXISTS ai_analysis (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id  TEXT NOT NULL,
  hours      INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  model      TEXT NOT NULL,
  text       TEXT NOT NULL,
  facts      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_dev ON ai_analysis(device_id, created_at DESC);
`;

export interface ChatResponse extends ExpertAnswer {
  decision: Decision | null;
  agent: string;
  usage: LlmUsage;
  ms: { llm: number; total: number };
  cached: boolean;
  model: string | null;
}

export class AiUnavailableError extends Error {
  readonly statusCode = 503;
}
export class AiBudgetError extends Error {
  readonly statusCode = 429;
}

// «Resumen del día» es una frase fija: se resuelve sin modelo (0 tokens), como la ayuda.
const DAY_RE = /^\s*(dame |hazme |necesito )?(un |el )?(res[uú]men|balance) (del d[ií]a|de hoy)\s*[.?!]*\s*$|^\s*(c[oó]mo estuvo|qu[eé] pas[oó]) (el d[ií]a|hoy)\s*[.?!¿]*\s*$/i;
const HELP_RE = /^\s*(ayuda|help|\?|qu[eé] puedo preguntar\??)\s*$/i;
const CACHE_MAX = 200;

export type ChartStyle = 'area' | 'bars' | 'pie';

/** «Muéstramelo en barras / como área / en torta»: el estilo se detecta con palabras, sin gastar tokens. */
export function chartStyleOf(question: string): ChartStyle | null {
  const q = question.toLowerCase();
  if (/\b(torta|pastel|dona|circular)\b/.test(q)) return 'pie';
  if (/\b(barras?|columnas?|histograma)\b/.test(q)) return 'bars';
  // \b no entiende la «á» (no es ASCII), por eso se delimita con espacios o puntuación.
  if (/(^|[\s,.¿?¡!])(área|áreas|area|areas)($|[\s,.¿?¡!])/.test(q)) return 'area';
  return null;
}

export function applyStyle(chart: NonNullable<ExpertAnswer['chart']>, style: ChartStyle): NonNullable<ExpertAnswer['chart']> {
  if (chart.type === 'line') return style === 'pie' ? chart : { ...chart, style: style === 'bars' ? 'bars' : 'area' };
  return style === 'pie' ? { ...chart, style: 'pie' } : { ...chart, style: 'bars' };
}

export function normalizeQuestion(q: string) {
  return q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class AiService {
  private readonly cache = new Map<string, Decision>();

  constructor(
    private readonly llm: LlmClient | null,
    private readonly deps: ExpertDeps,
    private readonly db: Db,
    private readonly opts: { dailyMaxCalls: number } = { dailyMaxCalls: 2000 },
  ) {
    db.exec(SCHEMA);
    // Migración: columnas para depurar respuestas (qué se preguntó y a qué agente).
    const cols = new Set((db.prepare('PRAGMA table_info(ai_usage)').all() as { name: string }[]).map((c) => c.name));
    if (!cols.has('question')) db.exec('ALTER TABLE ai_usage ADD COLUMN question TEXT');
    if (!cols.has('agent')) db.exec('ALTER TABLE ai_usage ADD COLUMN agent TEXT');
  }

  get enabled() {
    return this.llm !== null;
  }

  private callsToday(): number {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    return (this.db.prepare('SELECT COUNT(*) n FROM ai_usage WHERE at >= ? AND cached = 0').get(since) as { n: number }).n;
  }

  private log(row: { kind: 'chat' | 'analysis'; usage: LlmUsage; llm_ms: number; total_ms: number; ok: boolean; cached: boolean; expert?: string; question?: string; agent?: string }) {
    this.db
      .prepare(
        `INSERT INTO ai_usage (at, kind, model, prompt_tokens, completion_tokens, llm_ms, total_ms, ok, cached, expert, question, agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(new Date().toISOString(), row.kind, this.llm?.model ?? 'none', row.usage.prompt_tokens, row.usage.completion_tokens, row.llm_ms, row.total_ms, row.ok ? 1 : 0, row.cached ? 1 : 0, row.expert ?? null, row.question?.slice(0, 300) ?? null, row.agent ?? null);
  }

  /**
   * Responde una pregunta. `agent` acota el tema; `previous` es la decisión anterior (no el texto)
   * para entender seguimientos como "¿y ayer?" sin enviar el historial.
   */
  async chat(question: string, opts: { agent?: string; previous?: unknown } = {}): Promise<ChatResponse> {
    const t0 = Date.now();
    const zero = { prompt_tokens: 0, completion_tokens: 0 };
    const agent: AgentSpec = agentOf(opts.agent);
    if (HELP_RE.test(question)) {
      const d: Decision = { experto: 'ayuda', series: [], horas: 24, desfase_horas: 0 };
      return { ...(await runExpert(d, this.deps, agent)), decision: d, agent: agent.id, usage: zero, ms: { llm: 0, total: Date.now() - t0 }, cached: true, model: null };
    }
    if (DAY_RE.test(question)) {
      const d: Decision = { experto: 'resumen_dia', series: [], horas: 24, desfase_horas: 0 };
      return { ...(await runExpert(d, this.deps, agent)), decision: d, agent: agent.id, usage: zero, ms: { llm: 0, total: Date.now() - t0 }, cached: true, model: null };
    }
    // El contexto solo se acepta si es una decisión válida del vocabulario del agente.
    const prev = opts.previous ? decisionSchema().safeParse(opts.previous) : null;
    const previous = prev?.success ? prev.data : null;
    const key = `${agent.id}|${previous ? JSON.stringify(previous) : ''}|${normalizeQuestion(question)}`;
    let decision = this.cache.get(key);
    let usage: LlmUsage = zero;
    let llmMs = 0;
    const cached = !!decision;
    if (!decision) {
      if (!this.llm) throw new AiUnavailableError('El asistente IA no está configurado en este servidor');
      if (this.callsToday() >= this.opts.dailyMaxCalls) throw new AiBudgetError('Se alcanzó el límite diario de consultas al asistente');
      try {
        const r = await route(this.llm, question, { agent, previous });
        decision = r.decision;
        usage = r.usage;
        llmMs = r.ms;
      } catch (err) {
        this.log({ kind: 'chat', usage, llm_ms: llmMs, total_ms: Date.now() - t0, ok: false, cached: false, question, agent: agent.id });
        throw err;
      }
      this.cache.set(key, decision);
      if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    }
    let answer: ExpertAnswer;
    if (decision.experto === 'accion' && this.llm) {
      // Segundo llamado, solo para órdenes: propone una acción validada; nunca la ejecuta.
      if (this.callsToday() >= this.opts.dailyMaxCalls) throw new AiBudgetError('Se alcanzó el límite diario de consultas al asistente');
      const p = await proposeCommand(this.llm, question, agent);
      answer = { ...p.answer, synthetic: false };
      usage = { prompt_tokens: usage.prompt_tokens + p.usage.prompt_tokens, completion_tokens: usage.completion_tokens + p.usage.completion_tokens };
      llmMs += p.ms;
    } else {
      answer = await runExpert(decision, this.deps, agent);
    }
    const style = chartStyleOf(question);
    if (answer.chart && style) answer = { ...answer, chart: applyStyle(answer.chart, style) };
    const total = Date.now() - t0;
    this.log({ kind: 'chat', usage, llm_ms: llmMs, total_ms: total, ok: true, cached, expert: decision.experto, question, agent: agent.id });
    return { ...answer, decision, agent: agent.id, usage, ms: { llm: llmMs, total }, cached, model: this.llm?.model ?? null };
  }

  /** Hechos numéricos de un dispositivo en la ventana (calculados en código). */
  async facts(device: DeviceId, hours: number) {
    const now = this.deps.now?.() ?? new Date();
    const to = now;
    const from = new Date(to.getTime() - hours * 3600_000);
    const spec = DEVICE_CATALOG[device];
    const vars = spec.variables.filter((v) => v.kind === 'number' && !['lat', 'lon'].includes(v.key));
    const out = await Promise.all(
      vars.map(async (v) => {
        const [s, ser] = await Promise.all([this.deps.data.stats(device, v.key, from, to), this.deps.data.series(device, v.key, from, to, Math.max(24, hours))]);
        const r = (x: number | null) => (x === null ? null : Number(x.toFixed(v.decimals ?? 2)));
        const prof = hourlyProfile(ser.points).filter((p) => p.mean !== null) as { hour: number; mean: number }[];
        const q = Math.max(1, Math.floor(ser.points.length / 4));
        const avg = (a: { v: number }[]) => (a.length ? a.reduce((x, y) => x + y.v, 0) / a.length : null);
        return {
          variable: v.label,
          unit: v.unit,
          n: s.count,
          mean: r(s.mean),
          min: r(s.min),
          max: r(s.max),
          stddev: r(s.stddev),
          peak_hour: prof.length ? prof.reduce((a, b) => (b.mean > a.mean ? b : a)).hour : null,
          low_hour: prof.length ? prof.reduce((a, b) => (b.mean < a.mean ? b : a)).hour : null,
          first_quarter_mean: r(avg(ser.points.slice(0, q))),
          last_quarter_mean: r(avg(ser.points.slice(-q))),
        };
      }),
    );
    // La procedencia real la dice la última lectura (p. ej. DEV06 usa ruta simulada sin autorización de la API GPS).
    const last = this.deps.live.get(device)?.telemetry?.provenance;
    return {
      device,
      name: spec.name,
      source: spec.source_type,
      synthetic: last?.synthetic ?? spec.provenance.synthetic,
      provider: last?.provider ?? spec.provenance.provider,
      hours,
      from: from.toISOString(),
      to: to.toISOString(),
      variables: out,
    };
  }

  /** Análisis de comportamiento en prosa (≈150 palabras) a partir de los hechos: solo el narrador usa texto libre. */
  async analyze(device: DeviceId, hours: number) {
    if (!this.llm) throw new AiUnavailableError('El asistente IA no está configurado en este servidor');
    const t0 = Date.now();
    const facts = await this.facts(device, hours);
    const r = await this.llm.complete(
      [
        {
          role: 'system',
          content:
            'Eres analista de datos IoT de una ciudad inteligente (Bucaramanga, Colombia, hora UTC-5). Redacta en español un párrafo de máximo 150 palabras que describa el comportamiento de las gráficas del dispositivo durante la ventana: rangos, ciclo diario (horas pico y valle), tendencia (compara primer y último cuarto), variabilidad y una posible causa física o urbana. Usa SOLO los números dados, sin inventar. Si synthetic es true, aclara que los datos son simulados. La ventana puede no ser múltiplo de 24 h: si el primer y el último cuarto caen en horas distintas del día (día vs noche), atribuye la diferencia al ciclo diario y no a una tendencia; no supongas fallas del equipo. Sin títulos ni viñetas.',
        },
        { role: 'user', content: JSON.stringify(facts) },
      ],
      { maxTokens: 400 },
    );
    const text = r.content.trim();
    this.log({ kind: 'analysis', usage: r.usage, llm_ms: r.ms, total_ms: Date.now() - t0, ok: !!text, cached: false, expert: device });
    const row = { device_id: device, hours, created_at: new Date().toISOString(), model: r.model, text, facts: JSON.stringify(facts) };
    this.db.prepare('INSERT INTO ai_analysis (device_id, hours, created_at, model, text, facts) VALUES (@device_id, @hours, @created_at, @model, @text, @facts)').run(row);
    return { ...row, facts, usage: r.usage, ms: r.ms };
  }

  latestAnalyses() {
    const rows = this.db
      .prepare(`SELECT a.* FROM ai_analysis a JOIN (SELECT device_id, MAX(id) id FROM ai_analysis GROUP BY device_id) m ON a.id = m.id ORDER BY a.device_id`)
      .all() as { device_id: string; hours: number; created_at: string; model: string; text: string; facts: string }[];
    return rows.map((r) => ({ ...r, facts: JSON.parse(r.facts) }));
  }

  usageSummary() {
    const agg = (where: string, ...args: unknown[]) =>
      this.db
        .prepare(
          `SELECT kind, COUNT(*) calls, SUM(cached) cached, SUM(1-ok) failed,
                  SUM(prompt_tokens) prompt_tokens, SUM(completion_tokens) completion_tokens,
                  ROUND(AVG(CASE WHEN cached=0 THEN prompt_tokens + completion_tokens END), 1) avg_tokens,
                  ROUND(AVG(CASE WHEN cached=0 THEN llm_ms END)) avg_llm_ms, ROUND(AVG(total_ms)) avg_total_ms
           FROM ai_usage ${where} GROUP BY kind`,
        )
        .all(...args);
    return {
      enabled: this.enabled,
      model: this.llm?.model ?? null,
      daily_limit: this.opts.dailyMaxCalls,
      last_24h: agg('WHERE at >= ?', new Date(Date.now() - 24 * 3600_000).toISOString()),
      all_time: agg(''),
    };
  }
}
