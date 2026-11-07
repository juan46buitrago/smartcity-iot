/**
 * Motor de incidentes viales sintéticos para DEV04.
 *
 * Proceso de Poisson no homogéneo por segmento de la red vial real (OSM):
 *   λ_seg(t) [inc/día] = tasa_base × f_clase × longitud_km × f_demanda(t) × f_lluvia × intensidad × amortiguación
 *   P(incidente en Δt) = 1 − exp(−λ_seg · Δt / 86400)
 *
 * El tipo y la gravedad dependen de la hora, la demanda, la lluvia y la clase de vía.
 * Cada incidente sigue el ciclo activo → en_atencion → resuelto con duraciones log-normales.
 * Restricciones: 1 incidente por segmento, distancia mínima entre activos, enfriamiento por
 * segmento y límite global de simultáneos. TODOS los incidentes son sintéticos.
 */
import {
  INCIDENT_SEVERITIES,
  type Incident,
  type IncidentSeverity,
  type IncidentType,
} from '@scbga/shared';
import { clamp, lognormal, pickWeighted, type Rng } from '../core/random.js';
import { bogotaTime } from '../core/time.js';
import { trafficDemand } from './demand.js';
import { haversineM, pointAlong, type RoadClass, type RoadSegment } from './roads.js';

export interface IncidentParams {
  intensity: number;
  base_rate_per_km_day: number;
  max_concurrent: number;
  cooldown_min: number;
  rain_sensitivity: number;
}

export interface Conditions {
  /** Precipitación reciente en mm por 15 min (DEV10), o null si no se conoce. */
  rain_mm_15min: number | null;
}

export interface EngineState {
  active: Incident[];
  cooldowns: Record<string, number>; // segment_id → epoch ms hasta el que no se permiten incidentes
  /** Momento planificado de llegada de la atención (interno; no se publica). */
  attend_plan: Record<string, number>;
  counter: number;
}

export interface Transition {
  event: 'incident_created' | 'incident_attended' | 'incident_resolved';
  incident: Incident;
}

const CLASS_FACTOR: Record<RoadClass, number> = { motorway: 1.3, trunk: 1.3, primary: 1.0, secondary: 0.75 };
const MIN_DISTANCE_M = 300;
const DURATION_MEDIAN_MIN: Record<IncidentType, number> = { congestion: 35, accidente: 50, vehiculo_averiado: 30, cierre_parcial: 120 };
const SEVERITY_DURATION: Record<IncidentSeverity, number> = { baja: 0.7, media: 1, alta: 1.6, critica: 2.4 };
const RESPONSE_MEDIAN_MIN: Record<IncidentSeverity, number> = { critica: 6, alta: 10, media: 15, baja: 22 };

const CAUSES: Record<IncidentType, string[]> = {
  accidente: ['Choque simple entre dos vehículos', 'Colisión de motocicleta con automóvil', 'Choque por alcance en semáforo', 'Volcamiento de motocicleta', 'Colisión múltiple'],
  vehiculo_averiado: ['Vehículo particular varado en el carril derecho', 'Bus con falla mecánica', 'Camión de carga varado', 'Motocicleta sin combustible en la calzada', 'Taxi con llanta pinchada'],
  cierre_parcial: ['Obras de mantenimiento de la malla vial', 'Reparación de red de acueducto', 'Poda de árboles en el separador', 'Instalación de redes eléctricas', 'Demarcación vial'],
  congestion: ['Alto volumen vehicular', 'Semáforo fuera de servicio', 'Evento en la zona', 'Reducción de calzada por vehículos estacionados', 'Salida masiva de colegios'],
};

export function rainLevel(c: Conditions): number {
  if (c.rain_mm_15min === null) return 0;
  return clamp(c.rain_mm_15min / 2.5, 0, 1); // 2.5 mm/15 min ≈ lluvia fuerte
}

export class IncidentEngine {
  state: EngineState;

  constructor(
    private readonly segments: RoadSegment[],
    private readonly rng: Rng,
    initial?: EngineState,
  ) {
    this.state = { active: [], cooldowns: {}, attend_plan: {}, counter: 0, ...initial };
  }

  /** Tasa esperada de incidentes nuevos (inc/día) en toda la red para el instante dado. */
  expectedDailyRate(at: Date, p: IncidentParams, c: Conditions): number {
    let sum = 0;
    for (const s of this.segments) sum += this.segmentRate(s, at, p, c, 0);
    return sum;
  }

  private segmentRate(s: RoadSegment, at: Date, p: IncidentParams, c: Conditions, activeCount: number): number {
    const demandMult = 0.25 + 1.2 * trafficDemand(at);
    const rainMult = 1 + p.rain_sensitivity * 0.8 * rainLevel(c);
    const damping = Math.pow(Math.max(0, 1 - activeCount / p.max_concurrent), 1.5);
    return p.base_rate_per_km_day * CLASS_FACTOR[s.road_class] * (s.length_m / 1000) * demandMult * rainMult * p.intensity * damping;
  }

  private eligible(s: RoadSegment, nowMs: number): boolean {
    if ((this.state.cooldowns[s.id] ?? 0) > nowMs) return false;
    return !this.state.active.some((i) => i.segment_id === s.id || haversineM([i.location.lat, i.location.lon], s.mid) < MIN_DISTANCE_M);
  }

  /** Avanza la simulación Δt segundos. Devuelve las transiciones ocurridas. */
  step(now: Date, dtSeconds: number, p: IncidentParams, c: Conditions): Transition[] {
    const out = this.advanceLifecycle(now, p);
    const nowMs = now.getTime();
    for (const s of this.segments) {
      if (this.state.active.length >= p.max_concurrent) break;
      const lambda = this.segmentRate(s, now, p, c, this.state.active.length);
      if (lambda <= 0) continue;
      const prob = 1 - Math.exp((-lambda * dtSeconds) / 86400);
      if (this.rng.next() < prob && this.eligible(s, nowMs)) {
        const inc = this.create(s, now, c);
        this.state.active.push(inc);
        out.push({ event: 'incident_created', incident: inc });
      }
    }
    return out;
  }

  private advanceLifecycle(now: Date, p: IncidentParams): Transition[] {
    const out: Transition[] = [];
    const nowIso = now.toISOString();
    const keep: Incident[] = [];
    for (const inc of this.state.active) {
      const plan = this.state.attend_plan[inc.incident_id];
      if (inc.state === 'activo' && plan !== undefined && plan <= now.getTime()) {
        inc.state = 'en_atencion';
        inc.attended_at = new Date(plan).toISOString();
        delete this.state.attend_plan[inc.incident_id];
        inc.speed_impact = Number((inc.speed_impact * 0.85).toFixed(3));
        out.push({ event: 'incident_attended', incident: { ...inc } });
      }
      if (Date.parse(inc.expected_end_at) <= now.getTime()) {
        inc.state = 'resuelto';
        inc.resolved_at = nowIso;
        delete this.state.attend_plan[inc.incident_id];
        inc.speed_impact = 0;
        this.state.cooldowns[inc.segment_id] = now.getTime() + p.cooldown_min * 60_000;
        out.push({ event: 'incident_resolved', incident: { ...inc } });
        continue;
      }
      keep.push(inc);
    }
    this.state.active = keep;
    for (const [k, until] of Object.entries(this.state.cooldowns)) if (until < now.getTime()) delete this.state.cooldowns[k];
    return out;
  }

  /** Crea un incidente de prueba (solicitado desde la UI). También es sintético. */
  inject(now: Date, c: Conditions, opts: { type?: IncidentType; severity?: IncidentSeverity } = {}): Transition {
    const nowMs = now.getTime();
    const pool = this.segments.filter((s) => this.eligible(s, nowMs));
    if (pool.length === 0) throw new Error('No hay segmentos disponibles para un incidente de prueba');
    const s = pool[Math.floor(this.rng.next() * pool.length)]!;
    const inc = this.create(s, now, c, opts, true);
    this.state.active.push(inc);
    return { event: 'incident_created', incident: inc };
  }

  private chooseType(s: RoadSegment, now: Date, c: Conditions): IncidentType {
    const d = trafficDemand(now);
    const { hour } = bogotaTime(now);
    const night = hour >= 20 || hour < 5;
    const r = rainLevel(c);
    const major = s.road_class === 'trunk' || s.road_class === 'motorway';
    return pickWeighted<IncidentType>(this.rng, {
      congestion: 0.5 * d * d * (major || s.road_class === 'primary' ? 1.2 : 0.8) + 0.02,
      accidente: 0.25 * (1 + 1.5 * r) * (night ? 1.4 : 1) * (major ? 1.3 : 1),
      vehiculo_averiado: 0.3 * (major ? 1.3 : 1),
      cierre_parcial: 0.15 * (d < 0.5 ? 1.6 : 0.5) * (s.road_class === 'secondary' ? 1.4 : 1),
    });
  }

  private chooseSeverity(type: IncidentType, s: RoadSegment, c: Conditions): IncidentSeverity {
    const base: Record<IncidentType, number[]> = {
      congestion: [0.35, 0.45, 0.17, 0.03],
      accidente: [0.3, 0.4, 0.22, 0.08],
      vehiculo_averiado: [0.55, 0.35, 0.09, 0.01],
      cierre_parcial: [0.3, 0.5, 0.18, 0.02],
    };
    const w = [...base[type]];
    if (type === 'accidente') {
      const boost = (1 + rainLevel(c)) * (s.road_class === 'trunk' || s.road_class === 'motorway' ? 1.3 : 1);
      w[2]! *= boost;
      w[3]! *= boost;
    }
    return pickWeighted<IncidentSeverity>(this.rng, Object.fromEntries(INCIDENT_SEVERITIES.map((k, i) => [k, w[i]!])) as Record<IncidentSeverity, number>);
  }

  private lanesBlocked(type: IncidentType, sev: IncidentSeverity, lanes: number): number {
    const sevIdx = INCIDENT_SEVERITIES.indexOf(sev);
    switch (type) {
      case 'congestion':
        return 0;
      case 'cierre_parcial':
        return Math.min(1, lanes - 1); // parcial: nunca cierra toda la calzada
      case 'vehiculo_averiado':
        return sevIdx === 0 && this.rng.next() < 0.5 ? 0 : 1;
      case 'accidente':
        return clamp([1, 1, 2, 3][sevIdx]!, 1, Math.max(1, lanes - (sevIdx < 3 ? 1 : 0)));
    }
  }

  private create(s: RoadSegment, now: Date, c: Conditions, opts: { type?: IncidentType; severity?: IncidentSeverity } = {}, test = false): Incident {
    const type = opts.type ?? this.chooseType(s, now, c);
    const severity = opts.severity ?? this.chooseSeverity(type, s, c);
    const sevIdx = INCIDENT_SEVERITIES.indexOf(severity);
    const lanes_blocked = this.lanesBlocked(type, severity, s.lanes);
    const impact =
      type === 'congestion'
        ? [0.25, 0.4, 0.55, 0.7][sevIdx]!
        : Math.min(0.85, (lanes_blocked / s.lanes) * 0.9 + [0.05, 0.1, 0.15, 0.2][sevIdx]!);
    const durationMin = clamp(lognormal(this.rng, DURATION_MEDIAN_MIN[type] * SEVERITY_DURATION[severity], 0.45), 10, 360);
    const responseMin = Math.min(lognormal(this.rng, RESPONSE_MEDIAN_MIN[severity], 0.4), durationMin * 0.6);
    const [lat, lon] = pointAlong(s.geometry, 0.15 + 0.7 * this.rng.next());
    this.state.counter++;
    const id = `SIM-INC-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${this.state.counter.toString(36).toUpperCase().padStart(4, '0')}${Math.floor(this.rng.next() * 36 ** 3).toString(36).toUpperCase().padStart(3, '0')}`;
    this.state.attend_plan[id] = now.getTime() + responseMin * 60_000;
    const causes = CAUSES[type];
    return {
      incident_id: id,
      type,
      severity,
      state: 'activo',
      segment_id: s.id,
      road_name: s.road_name,
      road_class: s.road_class,
      location: { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)), name: s.road_name },
      lanes_blocked,
      speed_impact: Number(impact.toFixed(3)),
      started_at: now.toISOString(),
      attended_at: null,
      resolved_at: null,
      expected_end_at: new Date(now.getTime() + durationMin * 60_000).toISOString(),
      cause: causes[Math.floor(this.rng.next() * causes.length)]!,
      synthetic: true,
      test,
    };
  }
}
