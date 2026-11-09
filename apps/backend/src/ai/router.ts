/**
 * Enrutador de preguntas con decodificación restringida (CDM).
 *
 * Al modelo NO se le envían datos: solo el vocabulario (dispositivos y variables) y la pregunta.
 * Su única tarea es devolver una decisión de ~40 tokens con valores cerrados (enums del esquema).
 * El cálculo lo hacen los expertos en código (experts.ts) con cero tokens.
 *
 * Cada agente (agents.ts) acota el vocabulario a sus dispositivos: el prompt se achica y el
 * esquema impide que el modelo elija una serie fuera del tema.
 */
import { DEVICE_CATALOG, DEVICE_IDS, type DeviceId } from '@scbga/shared';
import { z } from 'zod';
import { AGENTS, type AgentSpec } from './agents.js';
import type { LlmClient, LlmUsage } from './client.js';

export const EXPERTS = ['estadisticas', 'serie', 'perfil_horario', 'estado', 'resumen', 'alertas', 'incidentes', 'dispositivos', 'resumen_dia', 'accion', 'ayuda', 'fuera_de_tema'] as const;
export type Expert = (typeof EXPERTS)[number];
export const HOURS = [1, 3, 6, 12, 24, 48, 72, 144, 168] as const;
export const OFFSETS = [0, 24, 48, 72] as const;

/** Series numéricas consultables ("DEV01.temperature") de los dispositivos dados. */
export function seriesVocabulary(devices: readonly DeviceId[] = DEVICE_IDS): string[] {
  return devices.flatMap((id) => DEVICE_CATALOG[id].variables.filter((v) => v.kind === 'number').map((v) => `${id}.${v.key}`));
}

export function decisionJsonSchema(series = seriesVocabulary()) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['experto', 'series', 'horas', 'desfase_horas'],
    properties: {
      experto: { type: 'string', enum: [...EXPERTS] },
      series: { type: 'array', maxItems: 4, items: { type: 'string', enum: series } },
      horas: { type: 'integer', enum: [...HOURS] },
      desfase_horas: { type: 'integer', enum: [...OFFSETS] },
    },
  };
}

export function decisionSchema(series = seriesVocabulary()) {
  const set = new Set(series);
  return z.object({
    experto: z.enum(EXPERTS),
    series: z
      .array(z.string().refine((s) => set.has(s), 'serie desconocida'))
      .max(4)
      .transform((a) => [...new Set(a)]),
    horas: z.coerce.number().refine((h) => (HOURS as readonly number[]).includes(h)),
    desfase_horas: z.coerce.number().refine((h) => (OFFSETS as readonly number[]).includes(h)),
  });
}
export type Decision = z.infer<ReturnType<typeof decisionSchema>>;

/** Prompt de sistema compacto: expertos + vocabulario del agente + ejemplos. */
export function systemPrompt(agent: AgentSpec = AGENTS.general): string {
  const vocab = agent.devices
    .map((id) => {
      const d = DEVICE_CATALOG[id];
      const vars = d.variables.filter((v) => v.kind === 'number').map((v) => `${v.key}=${v.label}${v.unit ? ` ${v.unit}` : ''}`);
      return `${id} ${d.name}: ${vars.join('; ')}`;
    })
    .join('\n');
  return [
    `Eres el enrutador de SmartCityBGA (IoT de Bucaramanga), agente "${agent.name}". Devuelve SOLO el JSON de decisión.`,
    'Expertos: estado=valor ACTUAL de variables ("temperatura actual", "está lloviendo", "dónde está", "hay cupo"); estadisticas=promedio/mín/máx/conteo en una ventana;',
    'serie=gráfica en el tiempo, evolución o comparar variables; perfil_horario=a qué hora sube o baja (promedio por hora del día);',
    'resumen=cómo está la ciudad/el tema, resumen general, si hay problemas; alertas=alertas activas; incidentes=incidentes o accidentes viales (conteo por tipo);',
    'resumen_dia=balance del día ("resumen del día", "cómo estuvo hoy", "qué pasó hoy"); accion=el usuario ORDENA algo a un dispositivo (apaga, enciende, mide cada N segundos, cambia el modo, reinicia); una pregunta nunca es accion;',
    'dispositivos=qué sensores/equipos hay, cuáles están en línea o fuera de línea; ayuda=qué se puede preguntar o saludo; fuera_de_tema=no trata de la ciudad ni de sus datos.',
    'series: variables del vocabulario (máx 4) que respondan la pregunta; si piden "temperatura" sin decir cuál, usa las de temperatura disponibles. [] solo si el experto no las usa.',
    'horas: ventana; desfase_horas: cuánto atrás termina (ayer → horas 24, desfase 24; esta semana → 168). Por defecto horas 24, desfase 0.',
    'Si hay "Contexto", la pregunta puede ser un seguimiento ("¿y ayer?", "ahora la humedad"): conserva lo que no cambie.',
    'Vocabulario:',
    vocab,
    'Ejemplos: "promedio de ruido hoy"→{"experto":"estadisticas","series":["DEV03.noise_db"],"horas":24,"desfase_horas":0}',
    '"temperatura actual"→{"experto":"estado","series":["DEV01.temperature","DEV10.temperature"],"horas":24,"desfase_horas":0}',
    '"compara temperatura de la estación y la meteorológica esta semana"→{"experto":"serie","series":["DEV01.temperature","DEV10.temperature"],"horas":168,"desfase_horas":0}',
    '"a qué hora hay más tráfico"→{"experto":"perfil_horario","series":["DEV05.vehicles_per_min"],"horas":144,"desfase_horas":0}',
    '"resumen del día"→{"experto":"resumen_dia","series":[],"horas":24,"desfase_horas":0}',
    '"apaga la farola"→{"experto":"accion","series":[],"horas":24,"desfase_horas":0}',
    '"hay algún problema"→{"experto":"resumen","series":[],"horas":24,"desfase_horas":0}',
  ].join('\n');
}

export interface RouteResult {
  decision: Decision;
  usage: LlmUsage;
  ms: number;
  attempts: number;
}

export interface RouteOptions {
  agent?: AgentSpec;
  /** Decisión de la pregunta anterior: permite seguimientos sin mandar el historial completo. */
  previous?: Decision | null;
}

export class RouterError extends Error {}

/** Máximo 2 intentos: el CDM garantiza el formato, zod verifica el contenido. */
export async function route(llm: LlmClient, question: string, opts: RouteOptions = {}): Promise<RouteResult> {
  const agent = opts.agent ?? AGENTS.general;
  const vocab = seriesVocabulary(agent.devices);
  const schema = decisionSchema(vocab);
  const user = opts.previous ? `Contexto (decisión anterior): ${JSON.stringify(opts.previous)}\nPregunta: ${question}` : question;
  const messages = [
    { role: 'system' as const, content: systemPrompt(agent) },
    { role: 'user' as const, content: user },
  ];
  const usage: LlmUsage = { prompt_tokens: 0, completion_tokens: 0 };
  let ms = 0;
  let lastErr = 'sin respuesta';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await llm.complete(messages, { schema: { name: 'decision', schema: decisionJsonSchema(vocab) }, maxTokens: 80 });
    usage.prompt_tokens += r.usage.prompt_tokens;
    usage.completion_tokens += r.usage.completion_tokens;
    ms += r.ms;
    try {
      const parsed = schema.safeParse(JSON.parse(extractJson(r.content)));
      if (parsed.success) return { decision: parsed.data, usage, ms, attempts: attempt };
      lastErr = parsed.error.issues[0]?.message ?? 'decisión inválida';
    } catch {
      lastErr = 'JSON inválido';
    }
  }
  throw new RouterError(`El enrutador no produjo una decisión válida (${lastErr})`);
}

/** Tolera ```json … ``` o texto alrededor (solo relevante en el modo JSON de respaldo). */
export function extractJson(s: string): string {
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}
