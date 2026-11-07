/** DEV01 (estación ambiental, gemelo digital) y DEV03 (sensor de ruido, simulado). */
import type { DeviceConfig } from '@scbga/shared';
import { currentWeather } from '../adapters/openMeteo.js';
import { clamp, normal, type Rng } from '../core/random.js';
import { bogotaTime } from '../core/time.js';
import { VirtualDevice, type DeviceDeps, type Sample } from '../core/VirtualDevice.js';
import { trafficDemand } from '../sim/demand.js';

const BASELINE_REFRESH_MS = 15 * 60_000;
const TAU_S = 600; // constante de tiempo del gemelo (inercia térmica del sensor/abrigo)

/**
 * DEV01 — Gemelo digital de estación ambiental.
 * Modo `twin`: converge hacia la línea base real de Open-Meteo con inercia y ruido AR(1).
 * Modo `manual`: converge hacia los valores fijados por el operador (simulación de escenarios).
 */
export class EnvironmentalStation extends VirtualDevice {
  private t: number | null = null;
  private h: number | null = null;
  private noiseT = 0;
  private noiseH = 0;
  private lastAt = 0;
  private baseline: { t: number; h: number; at: Date } | null = null;
  private baselineFetchedAt = 0;
  private baselineError: string | null = null;

  constructor(deps: DeviceDeps, private readonly rng: Rng) {
    super('DEV01', deps);
  }

  /** Climatología aproximada de Bucaramanga si no hay línea base (ciclo diario). */
  private climatology(now: Date) {
    const { hour } = bogotaTime(now);
    const phase = Math.cos(((hour - 14) / 24) * 2 * Math.PI);
    return { t: 23 + 4.5 * phase, h: 75 - 15 * phase };
  }

  private async refreshBaseline(now: Date) {
    if (now.getTime() - this.baselineFetchedAt < BASELINE_REFRESH_MS) return;
    this.baselineFetchedAt = now.getTime();
    try {
      const w = await currentWeather(this.spec.location.lat, this.spec.location.lon);
      this.baseline = { t: w.temperature, h: w.humidity, at: w.observed_at };
      this.baselineError = null;
    } catch (e) {
      this.baselineError = (e as Error).message;
      this.log.warn({ err: this.baselineError }, 'Línea base no disponible; se usa la última conocida o climatología');
    }
  }

  protected override async sample(now: Date): Promise<Sample> {
    const manual = this.config.mode === 'manual';
    if (!manual) await this.refreshBaseline(now);
    const target = manual
      ? { t: this.param<number>('manual_temperature'), h: this.param<number>('manual_humidity') }
      : this.baseline ?? this.climatology(now);
    const dt = this.lastAt ? (now.getTime() - this.lastAt) / 1000 : TAU_S;
    this.lastAt = now.getTime();
    const alpha = 1 - Math.exp(-dt / TAU_S);
    this.t = this.t === null ? target.t : this.t + (target.t - this.t) * alpha;
    this.h = this.h === null ? target.h : this.h + (target.h - this.h) * alpha;
    const amp = this.param<number>('noise_amplitude');
    this.noiseT = 0.85 * this.noiseT + normal(this.rng, 0, amp * 0.5);
    this.noiseH = 0.85 * this.noiseH + normal(this.rng, 0, amp * 1.5);

    const baselineRef = manual ? 'modo manual (escenario del operador)' : this.baseline ? `línea base Open-Meteo ${this.baseline.at.toISOString()}` : 'climatología (sin línea base)';
    return {
      variables: { temperature: this.t + this.noiseT, humidity: clamp(this.h + this.noiseH, 0, 100) },
      provenance: { provider: this.spec.provenance.provider, synthetic: true, ref: baselineRef },
      degraded: !manual && this.baselineError !== null && this.baseline === null,
    };
  }

  protected override idleReason() {
    return this.baselineError && this.config.mode === 'twin' ? `Línea base no actualizada: ${this.baselineError}` : undefined;
  }

  protected override async onConfigChanged(prev: DeviceConfig, next: DeviceConfig) {
    if (prev.mode !== next.mode) this.baselineFetchedAt = 0;
  }
}

/**
 * DEV03 — Sonómetro simulado. Nivel equivalente en dB(A) ligado a la demanda de tráfico,
 * con eventos puntuales (pitos, motos) y modos de operación.
 */
export class NoiseSensor extends VirtualDevice {
  private ar = 0;

  constructor(deps: DeviceDeps, private readonly rng: Rng) {
    super('DEV03', deps);
  }

  protected override async sample(now: Date): Promise<Sample> {
    let level = 45 + 22 * trafficDemand(now) + this.param<number>('base_offset_db');
    if (this.config.mode === 'evento') level += this.param<number>('event_boost_db');
    if (this.config.mode === 'silencio') level -= 8;
    this.ar = 0.7 * this.ar + normal(this.rng, 0, 1.6);
    level += this.ar;
    if (this.rng.next() < 0.05) level += 8 + this.rng.next() * 7; // evento acústico puntual
    return { variables: { noise_db: clamp(level, 30, 110) } };
  }
}
