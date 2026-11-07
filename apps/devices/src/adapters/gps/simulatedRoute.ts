/**
 * Ruta simulada sobre vías reales (Av. Carrera 27 → Autopista Floridablanca, geometría OSM).
 * El vehículo va y vuelve por la ruta; la velocidad depende de la demanda horaria y de
 * detenciones aleatorias (semáforos, paraderos). Los datos son sintéticos.
 */
import { clamp, normal, type Rng } from '../../core/random.js';
import { trafficDemand } from '../../sim/demand.js';
import { haversineM } from '../../sim/roads.js';
import { deriveState, type GpsFix, type GpsSource } from './types.js';

export interface RouteState {
  pos: number;
  dir: 1 | -1;
}

export class SimulatedRouteSource implements GpsSource {
  readonly kind = 'simulated_route' as const;
  readonly synthetic = true;
  readonly provider = 'Ruta simulada SmartCityBGA (geometría © OpenStreetMap)';
  private readonly cum: number[] = [0];
  readonly totalM: number;
  private pos: number;
  private dir: 1 | -1;
  private lastAt: number | null = null;
  private stopUntil = 0;

  constructor(private readonly route: [number, number][], private readonly rng: Rng, initial?: RouteState) {
    if (route.length < 2) throw new Error('Ruta simulada vacía');
    for (let i = 1; i < route.length; i++) this.cum.push(this.cum[i - 1]! + haversineM(route[i - 1]!, route[i]!));
    this.totalM = this.cum[this.cum.length - 1]!;
    this.pos = clamp(initial?.pos ?? 0, 0, this.totalM);
    this.dir = initial?.dir ?? 1;
  }

  get state(): RouteState {
    return { pos: this.pos, dir: this.dir };
  }

  private pointAt(m: number): [number, number] {
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i]! < m) i++;
    const a = this.route[i - 1]!;
    const b = this.route[i]!;
    const seg = this.cum[i]! - this.cum[i - 1]!;
    const t = seg === 0 ? 0 : (m - this.cum[i - 1]!) / seg;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  async fetchPosition(now: Date): Promise<GpsFix> {
    const t = now.getTime();
    const dt = this.lastAt === null ? 0 : Math.min(600, (t - this.lastAt) / 1000);
    this.lastAt = t;
    let speed: number;
    if (t < this.stopUntil) {
      speed = 0;
    } else {
      const cruise = 48 * (1 - 0.5 * trafficDemand(now));
      speed = clamp(normal(this.rng, cruise, 6), 5, 70);
      // En promedio, una detención cada ~1.5 km recorridos.
      if (this.rng.next() < ((speed / 3.6) * dt) / 1500) this.stopUntil = t + (20 + this.rng.next() * 70) * 1000;
    }
    this.pos += this.dir * (speed / 3.6) * dt;
    if (this.pos >= this.totalM) {
      this.pos = Math.max(0, this.totalM - (this.pos - this.totalM));
      this.dir = -1;
    } else if (this.pos <= 0) {
      this.pos = Math.min(this.totalM, -this.pos);
      this.dir = 1;
    }
    const [lat, lon] = this.pointAt(this.pos);
    return {
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      speed_kmh: Math.round(speed),
      state: deriveState(speed, now, now),
      status_code: null,
      observed_at: now,
      reported_at: now,
    };
  }
}
