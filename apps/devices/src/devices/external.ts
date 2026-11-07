/** Dispositivos basados en fuentes reales: DEV02 (calidad del aire), DEV09 (IDEAM), DEV10 (meteorología). */
import { currentAirQuality, currentWeather } from '../adapters/openMeteo.js';
import { levelsAfter } from '../adapters/ideam.js';
import { VirtualDevice, type DeviceDeps, type Sample } from '../core/VirtualDevice.js';
import { toBogotaIso } from '../core/time.js';

interface StoredSample {
  timestamp: string;
  variables: Sample['variables'];
  provenance: Sample['provenance'];
}

/**
 * Publica solo cuando la fuente tiene una observación nueva (deduplicación por hora de origen).
 * Al (re)conectarse vuelve a publicar la última observación con su marca de tiempo ORIGINAL, para que
 * los consumidores tengan el último valor aunque la fuente publique con poca frecuencia (IDEAM ~1/día).
 * InfluxDB sobrescribe el punto idéntico (mismo tiempo y etiquetas), por lo que no se duplican datos.
 */
abstract class PollingDevice extends VirtualDevice {
  protected lastObserved: string | null = null;
  protected lastPollAt: Date | null = null;

  protected remember(s: Sample) {
    if (!s.timestamp) return;
    const stored: StoredSample = { timestamp: s.timestamp.toISOString(), variables: s.variables, provenance: s.provenance };
    this.store.set(this.id, 'last_sample', stored);
  }

  protected override async onConnected() {
    const last = this.store.get<StoredSample>(this.id, 'last_sample');
    if (last && this.config.enabled) await this.publishTelemetry({ timestamp: new Date(last.timestamp), variables: last.variables, provenance: last.provenance });
  }

  protected markObserved(at: Date): boolean {
    const iso = at.toISOString();
    this.lastPollAt = new Date();
    if (iso === this.lastObserved) return false;
    this.lastObserved = iso;
    this.store.set(this.id, 'last_observed', iso);
    return true;
  }

  protected keep(s: Sample): Sample {
    this.remember(s);
    return s;
  }

  /** Sin última observación guardada no hay nada que republicar: se fuerza una relectura de la fuente. */
  protected get hasStoredSample(): boolean {
    return this.store.get(this.id, 'last_sample') !== undefined;
  }

  protected override async onStart() {
    this.lastObserved = this.hasStoredSample ? (this.store.get<string>(this.id, 'last_observed') ?? null) : null;
  }

  protected override idleReason() {
    if (!this.lastObserved) return undefined;
    const local = toBogotaIso(new Date(this.lastObserved));
    return `Última observación de la fuente: ${local.slice(8, 10)}/${local.slice(5, 7)} ${local.slice(11, 16)} (hora local)`;
  }
}

export class AirQualityMonitor extends PollingDevice {
  constructor(deps: DeviceDeps) {
    super('DEV02', deps);
  }

  protected override async sample(): Promise<Sample | null> {
    const aq = await currentAirQuality(this.spec.location.lat, this.spec.location.lon);
    if (!this.markObserved(aq.observed_at)) return null;
    return this.keep({
      timestamp: aq.observed_at,
      variables: { us_aqi: aq.us_aqi, pm2_5: aq.pm2_5, pm10: aq.pm10 },
      provenance: { provider: 'Open-Meteo Air Quality API (modelo CAMS)', synthetic: false, ref: 'air-quality-api.open-meteo.com' },
    });
  }
}

export class WeatherStation extends PollingDevice {
  constructor(deps: DeviceDeps) {
    super('DEV10', deps);
  }

  protected override async sample(): Promise<Sample | null> {
    const w = await currentWeather(this.spec.location.lat, this.spec.location.lon);
    if (!this.markObserved(w.observed_at)) return null;
    return this.keep({
      timestamp: w.observed_at,
      variables: {
        wind_speed: w.wind_speed,
        wind_direction: w.wind_direction,
        pressure: w.pressure,
        precipitation: w.precipitation,
        temperature: w.temperature,
      },
      provenance: { provider: 'Open-Meteo Forecast API', synthetic: false, ref: 'api.open-meteo.com' },
    });
  }
}

/**
 * DEV09 — Nivel de río de la estación IDEAM MAJADAS. Publica cada observación nueva con su
 * marca de tiempo original (incluidas las que llegan con retraso), sin rellenar huecos.
 */
export class WaterLevelSensor extends PollingDevice {
  private cursor: string | null = null;

  constructor(deps: DeviceDeps, private readonly station: string, private readonly appToken?: string) {
    super('DEV09', deps);
  }

  protected override async onStart() {
    await super.onStart();
    this.cursor = this.hasStoredSample ? (this.store.get<string>(this.id, 'cursor') ?? null) : null;
  }

  private risk(level: number): string {
    const t = this.config.thresholds.water_level ?? {};
    if (t.crit_high !== undefined && level >= t.crit_high) return 'alto';
    if (t.warn_high !== undefined && level >= t.warn_high) return 'medio';
    return 'bajo';
  }

  protected override async sample(): Promise<Sample[] | null> {
    const obs = await levelsAfter(this.station, this.cursor, this.appToken);
    if (obs.length === 0) return null;
    this.cursor = obs[obs.length - 1]!.raw_time;
    this.store.set(this.id, 'cursor', this.cursor);
    this.markObserved(obs[obs.length - 1]!.observed_at);
    const samples = obs.map((o) => ({
      timestamp: o.observed_at,
      variables: { water_level: o.level_m, risk: this.risk(o.level_m) },
      provenance: { provider: 'IDEAM vía datos.gov.co', synthetic: false, ref: `bdmn-sqnh:${this.station}` },
    }));
    this.remember(samples[samples.length - 1]!);
    return samples;
  }
}
