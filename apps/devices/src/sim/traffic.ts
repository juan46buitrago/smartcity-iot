import { trafficDemand } from './demand.js';
import { haversineM, type RoadSegment } from './roads.js';

/** Efecto de un incidente activo sobre un segmento. */
export interface SegmentImpact {
  segment_id: string;
  impact: number; // 0–1 de reducción de velocidad
}

/**
 * Modelo de tráfico compartido por DEV04 (incidentes) y DEV05 (detector).
 *
 * Velocidad de segmento:
 *   v = v_libre × (1 − 0.55·demanda²) × (1 − impacto_incidente)
 * El impacto se propaga a segmentos vecinos del mismo corredor (cola aguas arriba)
 * con un factor 0.5 dentro de 600 m.
 */
export class TrafficModel {
  private impacts = new Map<string, number>();
  private readonly neighbors = new Map<string, string[]>();
  readonly byId: Map<string, RoadSegment>;
  readonly totalLengthM: number;

  constructor(readonly segments: RoadSegment[]) {
    this.byId = new Map(segments.map((s) => [s.id, s]));
    this.totalLengthM = segments.reduce((a, s) => a + s.length_m, 0);
    for (const s of segments) {
      this.neighbors.set(
        s.id,
        segments.filter((o) => o.id !== s.id && o.road_name === s.road_name && haversineM(o.mid, s.mid) < 600).map((o) => o.id),
      );
    }
  }

  /** Actualiza los impactos a partir de los incidentes activos. */
  setImpacts(list: SegmentImpact[]): void {
    const m = new Map<string, number>();
    for (const { segment_id, impact } of list) {
      m.set(segment_id, Math.max(m.get(segment_id) ?? 0, impact));
      for (const n of this.neighbors.get(segment_id) ?? []) m.set(n, Math.max(m.get(n) ?? 0, impact * 0.5));
    }
    this.impacts = m;
  }

  impactOn(segmentId: string): number {
    return this.impacts.get(segmentId) ?? 0;
  }

  /** Velocidad esperada (sin ruido) en km/h. */
  speedKmh(segmentId: string, at: Date, demandFactor = 1): number {
    const s = this.byId.get(segmentId);
    if (!s) return 0;
    const d = Math.min(1.3, trafficDemand(at) * demandFactor);
    const recurrent = 1 - 0.55 * d * d;
    return Math.max(3, s.free_speed_kmh * recurrent * (1 - this.impactOn(segmentId)));
  }

  /** Índice de congestión de la red (0–100) y velocidad media ponderada por longitud. */
  networkState(at: Date): { congestion_index: number; network_speed_kmh: number } {
    let wSpeed = 0;
    let wCong = 0;
    for (const s of this.segments) {
      const v = this.speedKmh(s.id, at);
      wSpeed += v * s.length_m;
      wCong += (1 - v / s.free_speed_kmh) * s.length_m;
    }
    return {
      congestion_index: (100 * wCong) / this.totalLengthM,
      network_speed_kmh: wSpeed / this.totalLengthM,
    };
  }

  nearestSegment(lat: number, lon: number, roadName?: string): RoadSegment {
    let best: RoadSegment | null = null;
    let bd = Infinity;
    for (const s of this.segments) {
      if (roadName && s.road_name !== roadName) continue;
      const d = haversineM(s.mid, [lat, lon]);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (!best) throw new Error('Red vial vacía');
    return best;
  }
}
