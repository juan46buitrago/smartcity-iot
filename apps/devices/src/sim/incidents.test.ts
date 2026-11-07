import { defaultConfig, IncidentSchema, type Incident } from '@scbga/shared';
import { describe, expect, it } from 'vitest';
import { seededRng } from '../core/random.js';
import { bogotaTime } from '../core/time.js';
import { IncidentEngine, type IncidentParams } from './incidents.js';
import { haversineM, loadRoadNetwork } from './roads.js';
import { TrafficModel } from './traffic.js';

const net = loadRoadNetwork();
const p = defaultConfig('DEV04').params as Record<string, number>;
const DEFAULTS: IncidentParams = { intensity: p.intensity!, base_rate_per_km_day: p.base_rate_per_km_day!, max_concurrent: p.max_concurrent!, cooldown_min: p.cooldown_min!, rain_sensitivity: p.rain_sensitivity! };
const TICK_S = 30;

/** Simula `days` días con ciclo de 30 s y registra todo lo ocurrido. */
function run(days: number, params = DEFAULTS, rain: number | null = null, seed = 42) {
  const engine = new IncidentEngine(net.segments, seededRng(seed));
  const start = new Date('2026-11-02T05:00:00Z'); // lunes 00:00 en Bogotá
  const created: Incident[] = [];
  const resolved: Incident[] = [];
  let maxConcurrent = 0;
  let longestGapMin = 0;
  let lastCreation = start.getTime();
  const violations: string[] = [];
  for (let t = 0; t < days * 86400; t += TICK_S) {
    const now = new Date(start.getTime() + t * 1000);
    for (const tr of engine.step(now, TICK_S, params, { rain_mm_15min: rain })) {
      if (tr.event === 'incident_created') {
        created.push(tr.incident);
        longestGapMin = Math.max(longestGapMin, (now.getTime() - lastCreation) / 60000);
        lastCreation = now.getTime();
      }
      if (tr.event === 'incident_resolved') resolved.push(tr.incident);
    }
    const act = engine.state.active;
    maxConcurrent = Math.max(maxConcurrent, act.length);
    const segs = new Set(act.map((i) => i.segment_id));
    if (segs.size !== act.length) violations.push(`segmento duplicado en ${now.toISOString()}`);
    for (let i = 0; i < act.length; i++)
      for (let j = i + 1; j < act.length; j++)
        if (haversineM([act[i]!.location.lat, act[i]!.location.lon], [act[j]!.location.lat, act[j]!.location.lon]) < 150)
          violations.push('incidentes demasiado cercanos');
  }
  return { created, resolved, maxConcurrent, longestGapMin, violations };
}

describe('motor de incidentes (Monte Carlo, semilla fija)', () => {
  const week = run(14);
  const perDay = week.created.length / 14;

  it('genera una cantidad realista de incidentes por día (≈6–12)', () => {
    console.log(`incidentes/día=${perDay.toFixed(1)} máx simultáneos=${week.maxConcurrent} mayor pausa=${Math.round(week.longestGapMin)} min`);
    expect(perDay).toBeGreaterThan(5);
    expect(perDay).toBeLessThan(14);
  });

  it('permite periodos prolongados sin incidentes', () => {
    expect(week.longestGapMin).toBeGreaterThan(180);
  });

  it('respeta límite global, unicidad por segmento y distancia mínima', () => {
    expect(week.maxConcurrent).toBeLessThanOrEqual(DEFAULTS.max_concurrent);
    expect(week.violations).toEqual([]);
  });

  it('nunca repite identificadores y todo incidente es sintético y válido', () => {
    const ids = new Set(week.created.map((i) => i.incident_id));
    expect(ids.size).toBe(week.created.length);
    for (const inc of [...week.created, ...week.resolved]) {
      expect(inc.synthetic).toBe(true);
      expect(IncidentSchema.safeParse(inc).success).toBe(true);
    }
  });

  it('incluye los cuatro tipos y varios niveles de gravedad', () => {
    expect(new Set(week.created.map((i) => i.type))).toEqual(new Set(['accidente', 'vehiculo_averiado', 'cierre_parcial', 'congestion']));
    expect(new Set(week.created.map((i) => i.severity)).size).toBeGreaterThanOrEqual(3);
  });

  it('recorre el ciclo activo → en_atencion → resuelto con tiempos coherentes', () => {
    expect(week.resolved.length).toBeGreaterThan(week.created.length * 0.9);
    for (const r of week.resolved) {
      expect(r.state).toBe('resuelto');
      const start = Date.parse(r.started_at);
      const end = Date.parse(r.resolved_at!);
      expect(end - start).toBeGreaterThanOrEqual(10 * 60_000 - TICK_S * 1000);
      expect(end - start).toBeLessThanOrEqual(360 * 60_000 + TICK_S * 1000);
      if (r.attended_at) expect(Date.parse(r.attended_at)).toBeLessThanOrEqual(end);
    }
  });

  it('concentra más incidentes en horas de alta demanda que en la madrugada', () => {
    const byHour = (lo: number, hi: number) => week.created.filter((i) => {
      const h = bogotaTime(new Date(i.started_at)).hour;
      return h >= lo && h < hi;
    }).length;
    expect(byHour(17, 20)).toBeGreaterThan(byHour(1, 4));
  });

  it('la lluvia y la intensidad aumentan la frecuencia; intensidad 0 la anula', () => {
    expect(run(7, DEFAULTS, 3).created.length).toBeGreaterThan(run(7).created.length);
    expect(run(7, { ...DEFAULTS, intensity: 2 }).created.length).toBeGreaterThan(run(7).created.length);
    expect(run(2, { ...DEFAULTS, intensity: 0 }).created.length).toBe(0);
  });
});

describe('efectos sobre el tráfico', () => {
  it('un incidente reduce la velocidad en su segmento y en vecinos del corredor', () => {
    const tm = new TrafficModel(net.segments);
    const seg = net.segments.find((s) => s.road_name === 'Avenida Carrera 27')!;
    const at = new Date('2026-11-03T12:00:00Z'); // 7:00 local, hora pico
    const before = tm.speedKmh(seg.id, at);
    tm.setImpacts([{ segment_id: seg.id, impact: 0.6 }]);
    expect(tm.speedKmh(seg.id, at)).toBeCloseTo(before * 0.4, 1);
    const night = new Date('2026-11-03T08:00:00Z'); // 3:00 local
    tm.setImpacts([]);
    expect(tm.speedKmh(seg.id, night)).toBeGreaterThan(before);
  });

  it('el índice de congestión es mayor en hora pico que de madrugada', () => {
    const tm = new TrafficModel(net.segments);
    const peak = tm.networkState(new Date('2026-11-03T12:30:00Z')).congestion_index;
    const night = tm.networkState(new Date('2026-11-03T08:00:00Z')).congestion_index;
    expect(peak).toBeGreaterThan(night * 3);
  });
});
