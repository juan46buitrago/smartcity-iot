import { randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildApp, type AppDeps } from '../app.js';
import { openDb } from '../db.js';
import { loadEnv } from '../env.js';
import type { SeriesPoint, VariableStats } from '../influx.js';
import { AGENTS } from './agents.js';
import { OpenAiCompatClient, type ChatMessage, type CompleteOptions, type LlmClient, type LlmResult } from './client.js';
import { hourlyProfile, hhmm, runExpert, type DataPort, type ExpertDeps } from './experts.js';
import { decisionJsonSchema, decisionSchema, route, RouterError, seriesVocabulary, systemPrompt } from './router.js';
import { AiService, chartStyleOf, normalizeQuestion } from './service.js';

/* ------------------------------ dobles de prueba ------------------------------ */

class FakeLlm implements LlmClient {
  readonly model = 'fake-flash';
  calls: { messages: ChatMessage[]; opts?: CompleteOptions }[] = [];
  constructor(private readonly replies: string[]) {}
  async complete(messages: ChatMessage[], opts?: CompleteOptions): Promise<LlmResult> {
    this.calls.push({ messages, opts });
    const content = this.replies[Math.min(this.calls.length - 1, this.replies.length - 1)]!;
    return { content, usage: { prompt_tokens: 250, completion_tokens: 30 }, ms: 5, model: this.model };
  }
}

const NOW = new Date('2026-11-08T20:00:00.000Z'); // 15:00 en Bogotá

function fakeData(): DataPort & { seriesCalls: number } {
  return {
    seriesCalls: 0,
    async series(_d: string, _f: string, from: Date, to: Date) {
      this.seriesCalls++;
      // Una lectura por hora con pico a las 18 h de Bogotá (23 UTC).
      const points: SeriesPoint[] = [];
      for (let t = from.getTime(); t < to.getTime(); t += 3600_000) {
        const hUtc = new Date(t).getUTCHours();
        points.push({ t: new Date(t).toISOString(), v: hUtc === 23 ? 90 : 20 + hUtc / 10 });
      }
      return { every: '3600s', points };
    },
    async stats(): Promise<VariableStats> {
      return { count: 120, mean: 22.5, min: 18.2, min_at: '2026-11-08T10:00:00Z', max: 29.9, max_at: '2026-11-08T19:30:00Z', stddev: 2.1, first_at: null, last_at: null };
    },
  };
}

function deps(over: Partial<ExpertDeps> = {}): ExpertDeps {
  const db = openDb(':memory:');
  return {
    data: fakeData(),
    db,
    live: { get: () => ({ status: null, config: null, telemetry: null }), isOnline: () => true } as unknown as ExpertDeps['live'],
    alerts: { list: () => [] },
    now: () => NOW,
    ...over,
  };
}

const decision = (o: Record<string, unknown>) => JSON.stringify({ experto: 'estadisticas', series: ['DEV01.temperature'], horas: 24, desfase_horas: 0, ...o });

/* ------------------------------ enrutador (CDM) ------------------------------ */

describe('enrutador', () => {
  it('el vocabulario contiene solo variables numéricas del catálogo', () => {
    const v = seriesVocabulary();
    expect(v).toContain('DEV01.temperature');
    expect(v).toContain('DEV05.vehicles_per_min');
    expect(v).not.toContain('DEV06.state'); // texto, no numérica
    expect(v).not.toContain('DEV09.risk');
  });

  it('el esquema JSON es estricto (todo requerido, sin propiedades extra, enums cerrados)', () => {
    const s = decisionJsonSchema() as { additionalProperties: boolean; required: string[]; properties: Record<string, { enum?: unknown[]; items?: { enum: unknown[] } }> };
    expect(s.additionalProperties).toBe(false);
    expect(s.required.sort()).toEqual(Object.keys(s.properties).sort());
    expect(s.properties.experto!.enum).toContain('perfil_horario');
    expect(s.properties.series!.items!.enum).toEqual(seriesVocabulary());
  });

  it('el prompt de sistema es compacto y no incluye datos', () => {
    const p = systemPrompt();
    expect(p.length).toBeLessThan(4000); // ≈ 800 tokens como cota superior holgada
    expect(p).toContain('DEV03');
    expect(p).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // ninguna marca de tiempo / lectura
  });

  it('envía solo [system, user], con esquema y pocos tokens de salida', async () => {
    const llm = new FakeLlm([decision({})]);
    const r = await route(llm, 'promedio de temperatura hoy');
    expect(r.decision.experto).toBe('estadisticas');
    expect(r.attempts).toBe(1);
    expect(llm.calls[0]!.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(llm.calls[0]!.opts?.schema?.name).toBe('decision');
    expect(llm.calls[0]!.opts?.maxTokens).toBeLessThanOrEqual(100);
  });

  it('reintenta una vez si el contenido es inválido y luego acierta', async () => {
    const llm = new FakeLlm([decision({ series: ['DEV99.x'] }), decision({})]);
    const r = await route(llm, 'x');
    expect(r.attempts).toBe(2);
    expect(r.usage.prompt_tokens).toBe(500);
  });

  it('falla de forma controlada tras dos intentos inválidos', async () => {
    const llm = new FakeLlm(['no es json']);
    await expect(route(llm, 'x')).rejects.toBeInstanceOf(RouterError);
    expect(llm.calls).toHaveLength(2);
  });

  it('tolera JSON envuelto en ```json (modo de respaldo) y elimina series repetidas', async () => {
    const llm = new FakeLlm(['```json\n' + decision({ series: ['DEV01.temperature', 'DEV01.temperature'] }) + '\n```']);
    const r = await route(llm, 'x');
    expect(r.decision.series).toEqual(['DEV01.temperature']);
  });

  it('rechaza horas fuera del conjunto permitido', () => {
    expect(decisionSchema().safeParse({ experto: 'serie', series: [], horas: 5, desfase_horas: 0 }).success).toBe(false);
  });
});

/* ------------------------------ cliente HTTP ------------------------------ */

describe('cliente OpenAI-compatible', () => {
  it('envía temperature 0, sin razonamiento y response_format json_schema estricto', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.temperature).toBe(0);
      expect(body.enable_thinking).toBe(false);
      expect(body.response_format.json_schema.strict).toBe(true);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 41, completion_tokens: 12 } }), { status: 200 });
    });
    const c = new OpenAiCompatClient({ baseUrl: 'https://x/v1/', apiKey: 'k', model: 'm', timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    const r = await c.complete([{ role: 'user', content: 'hola' }], { schema: { name: 's', schema: {} } });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://x/v1/chat/completions');
    expect(r.usage).toEqual({ prompt_tokens: 41, completion_tokens: 12 });
  });

  it('si el proveedor rechaza json_schema (400) reintenta en modo json_object', async () => {
    const formats: string[] = [];
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const f = JSON.parse(init.body as string).response_format.type;
      formats.push(f);
      return f === 'json_schema' ? new Response('bad', { status: 400 }) : new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
    });
    const c = new OpenAiCompatClient({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    await c.complete([{ role: 'user', content: 'x' }], { schema: { name: 's', schema: {} } });
    expect(formats).toEqual(['json_schema', 'json_object']);
  });
});

/* ------------------------------ expertos (0 tokens) ------------------------------ */

describe('expertos', () => {
  it('estadísticas: texto con promedio/mín/máx en hora local y gráfica con líneas de referencia', async () => {
    const a = await runExpert({ experto: 'estadisticas', series: ['DEV01.temperature'], horas: 24, desfase_horas: 0 }, deps());
    expect(a.text).toContain('promedio 22,5 °C');
    expect(a.text).toContain('máximo 29,9 °C (14:30)'); // 19:30 UTC → 14:30 Bogotá
    expect(a.chart?.type).toBe('line');
    expect(a.chart?.type === 'line' && a.chart.refs?.map((r) => r.label)).toEqual(['promedio', 'mín', 'máx']);
    expect(a.synthetic).toBe(true); // DEV01 es gemelo digital
  });

  it('perfil horario: detecta el pico en hora de Bogotá', async () => {
    const a = await runExpert({ experto: 'perfil_horario', series: ['DEV05.vehicles_per_min'], horas: 144, desfase_horas: 0 }, deps());
    expect(a.text).toContain('hacia las 18:00');
    expect(a.chart?.type === 'bar' && a.chart.bars).toHaveLength(24);
  });

  it('ventana con desfase ("ayer")', async () => {
    const data = fakeData();
    const spy = vi.spyOn(data, 'series');
    await runExpert({ experto: 'serie', series: ['DEV03.noise_db'], horas: 24, desfase_horas: 24 }, deps({ data }));
    const [, , from, to] = spy.mock.calls[0]!;
    expect(to.toISOString()).toBe('2026-11-07T20:00:00.000Z');
    expect(from.toISOString()).toBe('2026-11-06T20:00:00.000Z');
  });

  it('pide aclaración si no hay series', async () => {
    const a = await runExpert({ experto: 'estadisticas', series: [], horas: 24, desfase_horas: 0 }, deps());
    expect(a.text).toMatch(/No identifiqué/);
    expect(a.chart).toBeUndefined();
  });

  it('estado sin series: resume equipos en línea y fuera de línea', async () => {
    const a = await runExpert({ experto: 'estado', series: [], horas: 24, desfase_horas: 0 }, deps({ live: { get: () => ({ status: null, config: null, telemetry: null }), isOnline: (id: string) => id !== 'DEV09' } as unknown as ExpertDeps['live'] }));
    expect(a.text).toMatch(/\d+ de \d+ equipos en línea \(fuera de línea: DEV09\)/);
  });

  const liveWith = (values: Record<string, Record<string, number>>) =>
    ({
      get: (id: string) => ({ status: null, config: null, telemetry: values[id] ? { timestamp: '2026-11-08T19:30:00Z', variables: Object.fromEntries(Object.entries(values[id]!).map(([k, v]) => [k, { value: v }])) } : null }),
      isOnline: () => true,
    }) as unknown as ExpertDeps['live'];

  it('estado: valor actual con nombre del dispositivo y enlace a su ficha', async () => {
    const a = await runExpert({ experto: 'estado', series: ['DEV01.temperature'], horas: 24, desfase_horas: 0 }, deps({ live: liveWith({ DEV01: { temperature: 24.3 } }) }));
    expect(a.text).toMatch(/Temperatura en Estación ambiental \(DEV01\): 24,3 °C a las 14:30/);
    expect(a.links).toContainEqual({ label: 'Abrir DEV01', to: '/dispositivos/DEV01' });
  });

  it('estado: latitud y longitud se unen en una ubicación con enlace al mapa', async () => {
    const a = await runExpert({ experto: 'estado', series: ['DEV06.lat', 'DEV06.lon'], horas: 24, desfase_horas: 0 }, deps({ live: liveWith({ DEV06: { lat: 7.10106, lon: -73.11314 } }) }));
    expect(a.text.split('\n')).toHaveLength(2);
    expect(a.text).toMatch(/está en 7,10106, -73,11314/);
    expect(a.links?.[0]).toEqual({ label: 'Ver en el mapa', to: '/mapa' });
  });

  it('resumen: equipos, alertas y valores actuales del agente', async () => {
    const alerts = { list: () => [{ device_id: 'DEV02', severity: 'critical', message: 'AQI alto' }, { device_id: 'DEV05', severity: 'warning', message: 'flujo' }] as never[] };
    const a = await runExpert({ experto: 'resumen', series: [], horas: 24, desfase_horas: 0 }, deps({ alerts, live: liveWith({ DEV02: { us_aqi: 61 }, DEV03: { noise_db: 55 } }) }), AGENTS.aire);
    expect(a.text).toMatch(/^Aire y ruido: 2 de 2 equipos en línea; 1 alerta activa, 1 críticas\./);
    expect(a.text).toContain('Monitor de calidad del aire — Índice AQI (EE. UU.): 61 AQI');
    expect(a.text).not.toMatch(/DEV05/); // alerta de otro tema
  });

  it('estado con desfase (seguimiento "¿y ayer?") responde con estadísticas del pasado', async () => {
    const a = await runExpert({ experto: 'estado', series: ['DEV01.temperature'], horas: 24, desfase_horas: 24 }, deps());
    expect(a.text).toMatch(/^Estadísticas \(24 h que terminan hace 24 h\)/);
  });

  it('dispositivos: lista acotada al agente', async () => {
    const a = await runExpert({ experto: 'dispositivos', series: [], horas: 24, desfase_horas: 0 }, deps(), AGENTS.movilidad);
    expect(a.text).toMatch(/^4 dispositivos en Movilidad/);
    expect(a.text).toMatch(/DEV06 Rastreador GPS — API, en línea/);
    expect(a.chart?.type).toBe('bar');
  });

  it('incidentes: siempre marcados como simulación', async () => {
    const a = await runExpert({ experto: 'incidentes', series: [], horas: 24, desfase_horas: 0 }, deps());
    expect(a.text.startsWith('[SIMULACIÓN]')).toBe(true);
    expect(a.synthetic).toBe(true);
  });

  it('utilidades de hora y perfil', () => {
    expect(hhmm('2026-11-08T05:07:00Z')).toBe('00:07');
    const p = hourlyProfile([{ t: '2026-11-08T05:00:00Z', v: 10 }, { t: '2026-11-09T05:30:00Z', v: 20 }]);
    expect(p[0]!.mean).toBe(15);
  });
});

/* ------------------------------ servicio ------------------------------ */

describe('servicio IA', () => {
  it('registra tokens, y una pregunta repetida usa la caché (0 tokens)', async () => {
    const d = deps();
    const llm = new FakeLlm([decision({})]);
    const ai = new AiService(llm, d, d.db);
    const r1 = await ai.chat('¿Promedio de temperatura hoy?');
    const r2 = await ai.chat('promedio de temperatura HOY');
    expect(r1.cached).toBe(false);
    expect(r1.usage.prompt_tokens).toBe(250);
    expect(r2.cached).toBe(true);
    expect(r2.usage.prompt_tokens).toBe(0);
    expect(llm.calls).toHaveLength(1);
    const s = ai.usageSummary().all_time[0] as { calls: number; cached: number; avg_tokens: number };
    expect(s.calls).toBe(2);
    expect(s.cached).toBe(1);
    expect(s.avg_tokens).toBe(280);
  });

  it('"ayuda" no llama al modelo', async () => {
    const d = deps();
    const llm = new FakeLlm([decision({})]);
    const r = await new AiService(llm, d, d.db).chat('ayuda');
    expect(llm.calls).toHaveLength(0);
    expect(r.text).toMatch(/Ejemplos/);
  });

  it('sin clave el asistente está deshabilitado', async () => {
    const d = deps();
    await expect(new AiService(null, d, d.db).chat('hola mundo')).rejects.toThrow(/no está configurado/);
  });

  it('respeta el presupuesto diario', async () => {
    const d = deps();
    const ai = new AiService(new FakeLlm([decision({})]), d, d.db, { dailyMaxCalls: 1 });
    await ai.chat('pregunta uno');
    await expect(ai.chat('pregunta dos')).rejects.toThrow(/límite diario/);
  });

  it('análisis: el narrador recibe solo hechos numéricos y se guarda el resultado', async () => {
    const d = deps();
    const llm = new FakeLlm(['La temperatura osciló entre 18,2 y 29,9 °C con pico vespertino.']);
    const ai = new AiService(llm, d, d.db);
    const r = await ai.analyze('DEV01', 144);
    const sent = JSON.parse(llm.calls[0]!.messages[1]!.content);
    expect(sent.device).toBe('DEV01');
    expect(sent.variables[0]).toMatchObject({ variable: 'Temperatura', mean: 22.5, min: 18.2, max: 29.9 });
    expect(r.text).toMatch(/osciló/);
    expect(ai.latestAnalyses()).toHaveLength(1);
  });

  it('análisis: la procedencia sale de la última lectura y no solo del catálogo', async () => {
    const d = deps({ live: { get: () => ({ status: null, config: null, telemetry: { provenance: { provider: 'Ruta simulada', synthetic: true } } }), isOnline: () => true } as unknown as ExpertDeps['live'] });
    const llm = new FakeLlm(['ok']);
    await new AiService(llm, d, d.db).analyze('DEV06', 48);
    const sent = JSON.parse(llm.calls[0]!.messages[1]!.content);
    expect(sent.synthetic).toBe(true);
    expect(sent.provider).toBe('Ruta simulada');
    expect(llm.calls[0]!.messages[0]!.content).toMatch(/no supongas fallas/);
  });

  it('el agente acota el vocabulario del enrutador y la caché', async () => {
    const d = deps();
    const llm = new FakeLlm([decision({ experto: 'estado', series: ['DEV02.us_aqi'] })]);
    const ai = new AiService(llm, d, d.db);
    const r = await ai.chat('cómo está el aire', { agent: 'aire' });
    expect(r.agent).toBe('aire');
    const sys = llm.calls[0]!.messages[0]!.content;
    expect(sys).toContain('DEV02');
    expect(sys).not.toContain('DEV05 ');
    expect((llm.calls[0]!.opts?.schema?.schema as { properties: { series: { items: { enum: string[] } } } }).properties.series.items.enum).toEqual(seriesVocabulary(AGENTS.aire.devices));
    await ai.chat('cómo está el aire', { agent: 'general' });
    expect(llm.calls).toHaveLength(2); // otra caché por agente
  });

  it('seguimientos: envía la decisión anterior (no el historial) y registra la pregunta', async () => {
    const d = deps();
    const llm = new FakeLlm([decision({ desfase_horas: 24 })]);
    const ai = new AiService(llm, d, d.db);
    const previous = { experto: 'estadisticas', series: ['DEV01.temperature'], horas: 24, desfase_horas: 0 };
    await ai.chat('¿y ayer?', { previous });
    expect(llm.calls[0]!.messages).toHaveLength(2);
    expect(llm.calls[0]!.messages[1]!.content).toMatch(/^Contexto \(decisión anterior\): \{"experto":"estadisticas".*\nPregunta: ¿y ayer\?$/s);
    await ai.chat('otra', { previous: { experto: 'hackeo', series: ['x'] } }); // contexto inválido: se ignora
    expect(llm.calls[1]!.messages[1]!.content).toBe('otra');
    const row = d.db.prepare('SELECT question, agent FROM ai_usage ORDER BY id LIMIT 1').get() as { question: string; agent: string };
    expect(row).toEqual({ question: '¿y ayer?', agent: 'general' });
  });

  it('normaliza preguntas (tildes, signos y mayúsculas)', () => {
    expect(normalizeQuestion('¿Qué  ALERTAS hay?')).toBe('que alertas hay');
  });
});

/* ------------------------------ rutas HTTP ------------------------------ */

describe('rutas /api/ai', () => {
  const salt = randomBytes(16);
  const env = loadEnv({
    MQTT_PASS_BACKEND: 'x'.repeat(16),
    INFLUX_READ_TOKEN: 'y'.repeat(16),
    JWT_SECRET: 'z'.repeat(40),
    ADMIN_PASSWORD_HASH: ['scrypt', 16384, 8, 1, salt.toString('base64url'), scryptSync('pw', salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64url')].join(':'),
    LOG_LEVEL: 'silent',
  });

  async function appWith(ai: AiService, d: ExpertDeps) {
    const stub = {} as never;
    return buildApp({ env, db: d.db, live: stub, alerts: stub, bridge: stub, influx: stub, hub: stub, ai } as AppDeps);
  }

  it('POST /api/ai/chat responde texto + gráfica + consumo', async () => {
    const d = deps();
    const app = await appWith(new AiService(new FakeLlm([decision({})]), d, d.db), d);
    const res = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { question: 'promedio de temperatura' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.decision.experto).toBe('estadisticas');
    expect(body.chart.type).toBe('line');
    expect(body.usage.prompt_tokens).toBe(250);
    await app.close();
  });

  it('GET /api/ai/agents lista los agentes y POST acepta agent', async () => {
    const d = deps();
    const app = await appWith(new AiService(new FakeLlm([decision({})]), d, d.db), d);
    const agents = (await app.inject({ method: 'GET', url: '/api/ai/agents' })).json() as { id: string; suggestions: string[] }[];
    expect(agents.map((a) => a.id)).toEqual(['general', 'clima', 'aire', 'movilidad', 'agua', 'alumbrado', 'operacion']);
    expect(agents.every((a) => a.suggestions.length >= 3)).toBe(true);
    const ok = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { question: 'temperatura', agent: 'clima' } });
    expect(ok.json().agent).toBe('clima');
    expect((await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { question: 'temperatura', agent: 'nope' } })).statusCode).toBe(400);
    await app.close();
  });

  it('valida la longitud de la pregunta', async () => {
    const d = deps();
    const app = await appWith(new AiService(new FakeLlm([decision({})]), d, d.db), d);
    expect((await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { question: 'x'.repeat(301) } })).statusCode).toBe(400);
    await app.close();
  });

  it('503 con mensaje claro si la IA no está configurada; análisis exige login', async () => {
    const d = deps();
    const app = await appWith(new AiService(null, d, d.db), d);
    const r = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { question: 'hola mundo' } });
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatch(/no está configurado/);
    expect((await app.inject({ method: 'POST', url: '/api/ai/analysis/DEV01' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/ai/status' })).json().enabled).toBe(false);
    await app.close();
  });

  it('502 controlado si el enrutador no logra una decisión', async () => {
    const d = deps();
    const app = await appWith(new AiService(new FakeLlm(['basura']), d, d.db), d);
    const r = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { question: 'algo raro' } });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toMatch(/reformularla/);
    await app.close();
  });
});

/* ------------------------------ resumen del día, órdenes y estilos ------------------------------ */

describe('resumen del día', () => {
  it('resume las últimas 24 h sin llamar a más modelos', async () => {
    const d = deps();
    const r = await runExpert({ experto: 'resumen_dia', series: [], horas: 24, desfase_horas: 0 }, d, AGENTS.clima);
    expect(r.text).toMatch(/Resumen del día en clima/);
    expect(r.text).toMatch(/promedio 22,5/);
    expect(r.text).toMatch(/equipos en línea/);
  });
});

describe('órdenes por lenguaje natural', () => {
  const cmd = (o: Record<string, unknown>) => JSON.stringify({ dispositivo: 'DEV07', accion: 'power', bandera: 'no', valor: 0, modo: 'na', parametro: 'na', ...o });

  it('propone la orden validada y NO la ejecuta', async () => {
    const d = deps();
    const llm = new FakeLlm([decision({ experto: 'accion', series: [] }), cmd({})]);
    const r = await new AiService(llm, d, d.db).chat('apaga la farola');
    expect(r.proposal).toEqual({ device_id: 'DEV07', action: 'power', params: { on: false }, summary: 'Apagar Alumbrado público (DEV07)' });
    expect(r.text).toMatch(/Confírmalo/);
    expect(llm.calls).toHaveLength(2); // enrutador + intérprete de la orden
    expect(r.usage.prompt_tokens).toBe(500);
  });

  it('"resumen del día" se resuelve sin modelo', async () => {
    const d = deps();
    const llm = new FakeLlm([decision({})]);
    const r = await new AiService(llm, d, d.db).chat('Resumen del día');
    expect(llm.calls).toHaveLength(0);
    expect(r.decision?.experto).toBe('resumen_dia');
    expect(r.text).toMatch(/Resumen del día/);
  });

  it('rechaza valores fuera de rango del catálogo', async () => {
    const d = deps();
    const llm = new FakeLlm([decision({ experto: 'accion', series: [] }), cmd({ accion: 'set_interval', bandera: 'na', valor: 1 })]);
    const r = await new AiService(llm, d, d.db).chat('mide cada segundo la farola');
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/solo admite un intervalo entre/);
  });

  it('un dispositivo fuera del agente no se puede ordenar', async () => {
    const d = deps();
    const llm = new FakeLlm([decision({ experto: 'accion', series: [] }), cmd({ dispositivo: 'DEV03' })]);
    const r = await new AiService(llm, d, d.db).chat('apaga el ruido', { agent: 'alumbrado' });
    expect(r.proposal).toBeUndefined();
  });

  it('una respuesta del modelo que no es JSON no produce orden', async () => {
    const d = deps();
    const llm = new FakeLlm([decision({ experto: 'accion', series: [] }), 'no sé']);
    const r = await new AiService(llm, d, d.db).chat('haz algo');
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/No pude convertir/);
  });
});

describe('estilo de gráfica', () => {
  it('detecta barras, área y torta por palabras', () => {
    expect(chartStyleOf('temperatura de hoy en barras')).toBe('bars');
    expect(chartStyleOf('muéstrame como área')).toBe('area');
    expect(chartStyleOf('dispositivos en torta')).toBe('pie');
    expect(chartStyleOf('temperatura de hoy')).toBeNull();
  });

  it('se aplica a la gráfica de la respuesta', async () => {
    const d = deps();
    const llm = new FakeLlm([decision({ experto: 'serie' })]);
    const r = await new AiService(llm, d, d.db).chat('temperatura de hoy en barras');
    expect(r.chart?.type === 'line' && r.chart.style).toBe('bars');
  });
});
