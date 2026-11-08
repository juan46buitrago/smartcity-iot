/**
 * Expertos del asistente: resuelven la decisión del enrutador con código y consultas (0 tokens).
 * Cada experto devuelve un texto corto en español y, si aplica, una especificación de gráfica
 * que el frontend dibuja con Recharts.
 */
import { DEVICE_CATALOG, DEVICE_IDS, isDeviceId, type DeviceId } from '@scbga/shared';
import type { AlertRow } from '../alerts.js';
import type { Db } from '../db.js';
import type { SeriesPoint, VariableStats } from '../influx.js';
import type { LiveState } from '../state.js';
import { AGENTS, type AgentSpec } from './agents.js';
import type { Decision } from './router.js';

export interface DataPort {
  series(device: string, field: string, from: Date, to: Date, maxPoints?: number): Promise<{ every: string; points: SeriesPoint[] }>;
  stats(device: string, field: string, from: Date, to: Date): Promise<VariableStats>;
}
export interface AlertsPort {
  list(filter: { status?: string; device?: string; limit: number }): AlertRow[];
}

export interface ExpertDeps {
  data: DataPort;
  live: Pick<LiveState, 'get' | 'isOnline'>;
  alerts: AlertsPort;
  db: Db;
  now?: () => Date;
}

export interface ChartSeries {
  key: string;
  label: string;
  unit: string | null;
  synthetic: boolean;
  points: SeriesPoint[];
}
export type ChartSpec =
  | { type: 'line'; title: string; series: ChartSeries[]; refs?: { label: string; value: number }[] }
  | { type: 'bar'; title: string; unit: string | null; bars: { label: string; value: number }[] };

export interface ExpertAnswer {
  text: string;
  chart?: ChartSpec;
  /** Accesos a la vista de la app que amplía la respuesta. */
  links?: { label: string; to: string }[];
  /** Verdadero si alguna serie usada proviene de simulación. */
  synthetic: boolean;
}

const BOGOTA_OFFSET_H = -5;

export function windowOf(d: Decision, now: Date) {
  const to = new Date(now.getTime() - d.desfase_horas * 3600_000);
  const from = new Date(to.getTime() - d.horas * 3600_000);
  return { from, to };
}

export function meta(key: string) {
  const [dev, variable] = key.split('.');
  if (!dev || !isDeviceId(dev)) return null;
  const spec = DEVICE_CATALOG[dev];
  const v = spec.variables.find((x) => x.key === variable && x.kind === 'number');
  if (!v) return null;
  return { device: dev as DeviceId, variable: v.key, label: `${v.label} (${dev})`, unit: v.unit, decimals: v.decimals ?? 1, synthetic: spec.provenance.synthetic };
}

export function fmt(v: number | null | undefined, decimals = 1, unit: string | null = null) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = v.toLocaleString('es-CO', { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
  return unit ? `${s} ${unit}` : s;
}

/** Hora local de Bogotá (HH:mm) de una marca ISO. */
export function hhmm(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(Date.parse(iso) + BOGOTA_OFFSET_H * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function rangeText(d: Decision) {
  const h = d.horas >= 48 && d.horas % 24 === 0 ? `${d.horas / 24} días` : `${d.horas} h`;
  const last = h.endsWith('días') ? `últimos ${h}` : `últimas ${h}`;
  return d.desfase_horas ? `${h} que terminan hace ${d.desfase_horas} h` : last;
}

function needSeries(d: Decision): ExpertAnswer | null {
  if (d.series.length) return null;
  return { text: 'No identifiqué qué variable consultar. Prueba, por ejemplo: "promedio de temperatura de la estación ambiental hoy".', synthetic: false };
}

/** Promedio por hora del día (hora de Bogotá). */
export function hourlyProfile(points: SeriesPoint[]) {
  const sum = new Array<number>(24).fill(0);
  const n = new Array<number>(24).fill(0);
  for (const p of points) {
    const h = (new Date(p.t).getUTCHours() + 24 + BOGOTA_OFFSET_H) % 24;
    sum[h]! += p.v;
    n[h]!++;
  }
  return sum.map((s, h) => ({ hour: h, mean: n[h] ? s / n[h]! : null }));
}

async function estadisticas(d: Decision, deps: ExpertDeps, now: Date): Promise<ExpertAnswer> {
  const missing = needSeries(d);
  if (missing) return missing;
  const { from, to } = windowOf(d, now);
  const metas = d.series.map(meta).filter((m) => m !== null);
  const [stats, series] = await Promise.all([
    Promise.all(metas.map((m) => deps.data.stats(m.device, m.variable, from, to))),
    Promise.all(metas.map((m) => deps.data.series(m.device, m.variable, from, to, 300))),
  ]);
  const lines = metas.map((m, i) => {
    const s = stats[i]!;
    if (!s.count) return `• ${m.label}: sin datos en el rango.`;
    return `• ${m.label}: promedio ${fmt(s.mean, m.decimals, m.unit)}, mínimo ${fmt(s.min, m.decimals, m.unit)} (${hhmm(s.min_at)}), máximo ${fmt(s.max, m.decimals, m.unit)} (${hhmm(s.max_at)}), desviación ${fmt(s.stddev, m.decimals)}, ${s.count.toLocaleString('es-CO')} lecturas.`;
  });
  const refs =
    metas.length === 1 && stats[0]!.count
      ? [
          { label: 'promedio', value: stats[0]!.mean! },
          { label: 'mín', value: stats[0]!.min! },
          { label: 'máx', value: stats[0]!.max! },
        ]
      : undefined;
  return {
    text: `Estadísticas (${rangeText(d)}):\n${lines.join('\n')}`,
    chart: { type: 'line', title: metas.map((m) => m.label).join(' vs '), series: metas.map((m, i) => ({ key: `${m.device}.${m.variable}`, label: m.label, unit: m.unit, synthetic: m.synthetic, points: series[i]!.points })), refs },
    synthetic: metas.some((m) => m.synthetic),
  };
}

async function serie(d: Decision, deps: ExpertDeps, now: Date): Promise<ExpertAnswer> {
  const missing = needSeries(d);
  if (missing) return missing;
  const { from, to } = windowOf(d, now);
  const metas = d.series.map(meta).filter((m) => m !== null);
  const series = await Promise.all(metas.map((m) => deps.data.series(m.device, m.variable, from, to, 400)));
  const lines = metas.map((m, i) => {
    const pts = series[i]!.points;
    if (!pts.length) return `• ${m.label}: sin datos.`;
    const vals = pts.map((p) => p.v);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const first = vals[0]!;
    const last = vals[vals.length - 1]!;
    const trend = Math.abs(last - first) < Math.abs(mean) * 0.05 + 1e-9 ? 'estable' : last > first ? 'al alza' : 'a la baja';
    return `• ${m.label}: promedio ${fmt(mean, m.decimals, m.unit)}, último ${fmt(last, m.decimals, m.unit)}, tendencia ${trend}.`;
  });
  return {
    text: `Serie (${rangeText(d)}):\n${lines.join('\n')}`,
    chart: { type: 'line', title: metas.map((m) => m.label).join(' vs '), series: metas.map((m, i) => ({ key: `${m.device}.${m.variable}`, label: m.label, unit: m.unit, synthetic: m.synthetic, points: series[i]!.points })) },
    synthetic: metas.some((m) => m.synthetic),
  };
}

async function perfilHorario(d: Decision, deps: ExpertDeps, now: Date): Promise<ExpertAnswer> {
  const missing = needSeries(d);
  if (missing) return missing;
  const m = meta(d.series[0]!)!;
  const { from, to } = windowOf({ ...d, horas: Math.max(d.horas, 24) }, now);
  const { points } = await deps.data.series(m.device, m.variable, from, to, Math.ceil((to.getTime() - from.getTime()) / 3600_000));
  const prof = hourlyProfile(points).filter((p) => p.mean !== null) as { hour: number; mean: number }[];
  if (!prof.length) return { text: `${m.label}: sin datos suficientes para el perfil horario.`, synthetic: m.synthetic };
  const max = prof.reduce((a, b) => (b.mean > a.mean ? b : a));
  const min = prof.reduce((a, b) => (b.mean < a.mean ? b : a));
  return {
    text: `Perfil horario de ${m.label} (${rangeText({ ...d, horas: Math.max(d.horas, 24) })}): el valor más alto se da hacia las ${max.hour}:00 (${fmt(max.mean, m.decimals, m.unit)}) y el más bajo hacia las ${min.hour}:00 (${fmt(min.mean, m.decimals, m.unit)}).`,
    chart: { type: 'bar', title: `${m.label} · promedio por hora del día`, unit: m.unit, bars: prof.map((p) => ({ label: `${String(p.hour).padStart(2, '0')}h`, value: Number(p.mean.toFixed(m.decimals)) })) },
    synthetic: m.synthetic,
  };
}

function withLinks(a: ExpertAnswer, links: { label: string; to: string }[]): ExpertAnswer {
  return { ...a, links: [...(a.links ?? []), ...links] };
}

function alertas(d: Decision, deps: ExpertDeps, agent: AgentSpec): ExpertAnswer {
  const devices = [...new Set(d.series.map((s) => s.split('.')[0]!))];
  const rows = activeAlerts(deps, devices.length ? devices : agent.devices);
  if (!rows.length) return { text: 'No hay alertas activas en este momento.', synthetic: false };
  const bySev = { critical: 0, warning: 0, info: 0 };
  for (const r of rows) bySev[r.severity]++;
  const top = rows.slice(0, 5).map((r) => `• [${r.severity}] ${r.device_id}: ${r.message}`);
  return {
    text: `Hay ${rows.length} alertas activas (${bySev.critical} críticas, ${bySev.warning} de advertencia, ${bySev.info} informativas):\n${top.join('\n')}`,
    chart: { type: 'bar', title: 'Alertas activas por gravedad', unit: null, bars: [{ label: 'crítica', value: bySev.critical }, { label: 'advertencia', value: bySev.warning }, { label: 'info', value: bySev.info }] },
    synthetic: rows.some((r) => r.synthetic === 1),
  };
}

function incidentes(d: Decision, deps: ExpertDeps, now: Date): ExpertAnswer {
  const { from, to } = windowOf(d, now);
  const args = [from.toISOString(), to.toISOString()];
  const rows = deps.db.prepare(`SELECT type, COUNT(*) n FROM incidents WHERE started_at >= ? AND started_at < ? AND test = 0 GROUP BY type ORDER BY n DESC`).all(...args) as { type: string; n: number }[];
  const active = (deps.db.prepare(`SELECT COUNT(*) n FROM incidents WHERE state != 'resuelto'`).get() as { n: number }).n;
  const total = rows.reduce((a, r) => a + r.n, 0);
  return {
    text: `[SIMULACIÓN] En las ${rangeText(d)} se generaron ${total} incidentes viales sintéticos${rows.length ? ` (${rows.map((r) => `${r.type.replace('_', ' ')}: ${r.n}`).join(', ')})` : ''}. Activos ahora: ${active}.`,
    chart: rows.length ? { type: 'bar', title: 'Incidentes simulados por tipo', unit: null, bars: rows.map((r) => ({ label: r.type.replace('_', ' '), value: r.n })) } : undefined,
    synthetic: true,
  };
}

/** Variable principal de cada dispositivo para los resúmenes. */
const HEADLINE: Record<DeviceId, string> = {
  DEV01: 'temperature', DEV02: 'us_aqi', DEV03: 'noise_db', DEV04: 'congestion_index', DEV05: 'vehicles_per_min', DEV06: 'speed_kmh',
  DEV07: 'power_w', DEV08: 'free_spaces', DEV09: 'water_level', DEV10: 'precipitation', DEV11: 'temperature', DEV12: 'temperature',
};

function currentValue(deps: ExpertDeps, key: string) {
  const m = meta(key);
  if (!m) return null;
  const t = deps.live.get(m.device).telemetry;
  const v = t?.variables[m.variable]?.value;
  return { m, v: typeof v === 'number' ? v : null, at: t?.timestamp ?? null, online: deps.live.isOnline(m.device) };
}

const bareLabel = (m: { label: string; device: string }) => m.label.replace(` (${m.device})`, '');

function estado(d: Decision, deps: ExpertDeps, agent: AgentSpec): ExpertAnswer {
  if (!d.series.length) return resumen(deps, agent);
  const keys = d.series.filter((k) => !k.endsWith('.lon') || !d.series.includes(k.replace('.lon', '.lat')));
  const lines = keys.map((key) => {
    const c = currentValue(deps, key)!;
    const name = DEVICE_CATALOG[c.m.device].name;
    if (c.m.variable === 'lat') {
      const lon = currentValue(deps, `${c.m.device}.lon`);
      return `• ${name} (${c.m.device}) está en ${fmt(c.v, 5)}, ${fmt(lon?.v, 5)}${c.at ? ` (${hhmm(c.at)})` : ''}.`;
    }
    const val = c.v === null ? 'sin lectura' : fmt(c.v, c.m.decimals, c.m.unit);
    return `• ${bareLabel(c.m)} en ${name} (${c.m.device}): ${val}${c.at ? ` a las ${hhmm(c.at)}` : ''}${c.online ? '' : ' — fuera de línea'}.`;
  });
  const devices = [...new Set(keys.map((k) => k.split('.')[0]!))];
  const map = keys.some((k) => k.endsWith('.lat'));
  return {
    text: `Ahora mismo:\n${lines.join('\n')}`,
    synthetic: keys.some((k) => meta(k)?.synthetic),
    links: [...(map ? [{ label: 'Ver en el mapa', to: '/mapa' }] : []), ...devices.slice(0, 2).map((id) => ({ label: `Abrir ${id}`, to: `/dispositivos/${id}` }))],
  };
}

function activeAlerts(deps: ExpertDeps, devices: readonly string[]) {
  const set = new Set(devices);
  return deps.alerts.list({ status: 'activas', limit: 300 }).filter((r) => set.has(r.device_id));
}

/** Foto del momento: equipos en línea, alertas activas y la variable principal de cada dispositivo. */
function resumen(deps: ExpertDeps, agent: AgentSpec): ExpertAnswer {
  const devs = agent.devices;
  const offline = devs.filter((id) => !deps.live.isOnline(id));
  const rows = activeAlerts(deps, devs);
  const crit = rows.filter((r) => r.severity === 'critical').length;
  const head = `${devs.length - offline.length} de ${devs.length} equipos en línea${offline.length ? ` (fuera de línea: ${offline.join(', ')})` : ''}; ${rows.length ? `${rows.length} ${rows.length === 1 ? 'alerta activa' : 'alertas activas'}${crit ? `, ${crit} críticas` : ''}` : 'sin alertas activas'}.`;
  const values = devs
    .map((id) => currentValue(deps, `${id}.${HEADLINE[id]}`))
    .filter((c): c is NonNullable<typeof c> => !!c && c.v !== null)
    .slice(0, 8)
    .map((c) => `• ${DEVICE_CATALOG[c.m.device].name} — ${bareLabel(c.m)}: ${fmt(c.v, c.m.decimals, c.m.unit)}`);
  const top = rows.slice(0, 3).map((r) => `• ${r.severity === 'critical' ? 'Crítica' : r.severity === 'warning' ? 'Advertencia' : 'Info'} · ${r.device_id}: ${r.message}`);
  const scope = agent.id === 'general' || agent.id === 'operacion' ? 'Estado de la ciudad' : agent.name;
  const text = [`${scope}: ${head}`, values.length ? `Valores actuales:\n${values.join('\n')}` : '', top.length ? `Alertas más recientes:\n${top.join('\n')}` : '']
    .filter(Boolean)
    .join('\n\n');
  return {
    text,
    synthetic: devs.some((id) => DEVICE_CATALOG[id].provenance.synthetic),
    links: [{ label: 'Ver dispositivos', to: '/dispositivos' }, ...(rows.length ? [{ label: 'Ver alertas', to: '/alertas' }] : [])],
  };
}

const SOURCE_TEXT: Record<string, string> = { simulated: 'simulado', digital_twin: 'gemelo digital', api: 'API', dataset: 'dataset', real: 'real (ESP32)' };

function dispositivos(deps: ExpertDeps, agent: AgentSpec): ExpertAnswer {
  const lines = agent.devices.map((id) => {
    const s = DEVICE_CATALOG[id];
    return `• ${id} ${s.name} — ${SOURCE_TEXT[s.source_type] ?? s.source_type}, ${deps.live.isOnline(id) ? 'en línea' : 'fuera de línea'}`;
  });
  const bySource = new Map<string, number>();
  for (const id of agent.devices) {
    const k = SOURCE_TEXT[DEVICE_CATALOG[id].source_type] ?? DEVICE_CATALOG[id].source_type;
    bySource.set(k, (bySource.get(k) ?? 0) + 1);
  }
  const whole = agent.id === 'general' || agent.id === 'operacion';
  return {
    text: `${agent.devices.length} dispositivos${whole ? '' : ` en ${agent.name}`}:\n${lines.join('\n')}`,
    chart: agent.devices.length > 2 ? { type: 'bar', title: 'Dispositivos por tipo de fuente', unit: null, bars: [...bySource].map(([label, value]) => ({ label, value })) } : undefined,
    synthetic: false,
    links: [{ label: 'Ver dispositivos', to: '/dispositivos' }],
  };
}

export const HELP_TEXT =
  'Puedo responder sobre los datos de la ciudad. Ejemplos:\n• "Promedio, mínimo y máximo de temperatura hoy"\n• "Compara el ruido con el flujo vehicular esta semana"\n• "¿A qué hora hay más tráfico?"\n• "¿Qué alertas hay activas?"\n• "¿Cuántos incidentes hubo ayer?"\n• "¿Qué dispositivos están fuera de línea?"';

export async function runExpert(d: Decision, deps: ExpertDeps, agent: AgentSpec = AGENTS.general): Promise<ExpertAnswer> {
  const now = deps.now?.() ?? new Date();
  switch (d.experto) {
    case 'estadisticas':
      return estadisticas(d, deps, now);
    case 'serie':
      return serie(d, deps, now);
    case 'perfil_horario':
      return perfilHorario(d, deps, now);
    case 'alertas':
      return withLinks(alertas(d, deps, agent), [{ label: 'Ver alertas', to: '/alertas' }]);
    case 'incidentes':
      return incidentes(d, deps, now);
    case 'estado':
      // "¿Y ayer?" tras un valor actual: el pasado no tiene "valor actual", se responde con estadísticas.
      return d.desfase_horas > 0 && d.series.length ? estadisticas(d, deps, now) : estado(d, deps, agent);
    case 'resumen':
      return resumen(deps, agent);
    case 'dispositivos':
      return dispositivos(deps, agent);
    case 'ayuda':
      return { text: HELP_TEXT, synthetic: false };
    case 'fuera_de_tema':
      return { text: 'Solo puedo responder sobre los sensores y datos de SmartCityBGA. Escribe "ayuda" para ver ejemplos.', synthetic: false };
  }
}
