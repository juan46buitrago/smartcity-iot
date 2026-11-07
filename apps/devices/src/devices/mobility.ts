/** Movilidad: DEV04 (incidentes), DEV05 (detector), DEV06 (GPS) y DEV08 (parqueadero). */
import {
  IncidentEventSchema,
  TelemetrySchema,
  topic,
  type Command,
  type DeviceConfig,
  type IncidentEvent,
  type IncidentSeverity,
  type IncidentType,
} from '@scbga/shared';
import { GpsMobileSource } from '../adapters/gps/gpsMobile.js';
import { SimulatedRouteSource, type RouteState } from '../adapters/gps/simulatedRoute.js';
import type { GpsSource } from '../adapters/gps/types.js';
import type { DevicesEnv } from '../core/env.js';
import { clamp, normal, poisson, type Rng } from '../core/random.js';
import { bogotaTime } from '../core/time.js';
import { VirtualDevice, type DeviceDeps, type Sample } from '../core/VirtualDevice.js';
import { trafficDemand } from '../sim/demand.js';
import { IncidentEngine, type Conditions, type EngineState, type IncidentParams } from '../sim/incidents.js';
import type { RoadSegment } from '../sim/roads.js';
import type { TrafficModel } from '../sim/traffic.js';

const RAIN_MAX_AGE_MS = 60 * 60_000;

/* ================================ DEV04 ================================ */

export class IncidentMonitor extends VirtualDevice {
  private engine!: IncidentEngine;
  private lastStep: number | null = null;
  private rain: { mm: number; at: number } | null = null;

  constructor(deps: DeviceDeps, private readonly traffic: TrafficModel, private readonly rng: Rng) {
    super('DEV04', deps);
  }

  protected override async onStart() {
    const saved = this.store.get<EngineState>(this.id, 'engine');
    this.engine = new IncidentEngine(this.traffic.segments, this.rng, saved);
    this.syncTraffic();
  }

  /** Escucha la lluvia publicada por DEV10 (comunicación entre dispositivos vía broker). */
  protected override async onConnected() {
    this.client?.subscribe(topic('DEV10', 'telemetry'), { qos: 0 });
  }

  protected override async onMessage(t: string, payload: Buffer) {
    if (t !== topic('DEV10', 'telemetry')) return;
    let json: unknown;
    try {
      json = JSON.parse(payload.toString('utf8'));
    } catch {
      return;
    }
    const parsed = TelemetrySchema.safeParse(json);
    if (!parsed.success) return;
    const p = parsed.data.variables.precipitation?.value;
    if (typeof p === 'number') this.rain = { mm: p, at: Date.parse(parsed.data.timestamp) };
  }

  private conditions(now: Date): Conditions {
    const fresh = this.rain && now.getTime() - this.rain.at < RAIN_MAX_AGE_MS;
    return { rain_mm_15min: fresh ? this.rain!.mm : null };
  }

  private params(): IncidentParams {
    return {
      intensity: this.param<number>('intensity'),
      base_rate_per_km_day: this.param<number>('base_rate_per_km_day'),
      max_concurrent: this.param<number>('max_concurrent'),
      cooldown_min: this.param<number>('cooldown_min'),
      rain_sensitivity: this.param<number>('rain_sensitivity'),
    };
  }

  private syncTraffic() {
    this.traffic.setImpacts(this.engine.state.active.map((i) => ({ segment_id: i.segment_id, impact: i.speed_impact })));
    this.store.set(this.id, 'engine', this.engine.state);
  }

  private async emit(transitions: { event: IncidentEvent['event']; incident: IncidentEvent['incident'] }[], now: Date) {
    for (const tr of transitions) {
      const ev: IncidentEvent = {
        device_id: 'DEV04',
        timestamp: now.toISOString(),
        event: tr.event,
        incident: tr.incident,
        source_type: 'simulated',
        provenance: { provider: 'SmartCityBGA traffic simulator', synthetic: true, ref: 'modelo probabilístico — no es un reporte real' },
      };
      const check = IncidentEventSchema.safeParse(ev);
      if (!check.success) {
        this.log.error({ issues: check.error.issues }, 'Evento de incidente inválido; no se publica');
        continue;
      }
      await this.publish('events', ev, { qos: 1 });
      this.log.info({ event: tr.event, id: tr.incident.incident_id, type: tr.incident.type, severity: tr.incident.severity, road: tr.incident.road_name }, 'Incidente sintético');
    }
  }

  protected override async sample(now: Date): Promise<Sample> {
    // El paso de simulación usa el tiempo real transcurrido (máx. 10 min si hubo una pausa).
    const dt = this.lastStep === null ? this.config.interval_s : Math.min(600, (now.getTime() - this.lastStep) / 1000);
    this.lastStep = now.getTime();
    const transitions = this.engine.step(now, dt, this.params(), this.conditions(now));
    this.syncTraffic();
    await this.emit(transitions, now);
    const net = this.traffic.networkState(now);
    return {
      variables: {
        active_incidents: this.engine.state.active.length,
        congestion_index: net.congestion_index,
        network_speed_kmh: net.network_speed_kmh,
      },
      provenance: { provider: this.spec.provenance.provider, synthetic: true, ref: 'simulación — no son reportes reales' },
    };
  }

  protected override async onConfigChanged(prev: DeviceConfig, next: DeviceConfig) {
    if (prev.enabled && !next.enabled) this.lastStep = null;
  }

  protected override async handleCustomCommand(action: Command['action'], params: Record<string, unknown>) {
    if (action !== 'inject_test_incident') throw new Error('Acción no soportada');
    const now = new Date();
    if (this.engine.state.active.length >= this.param<number>('max_concurrent')) throw new Error('Se alcanzó el máximo de incidentes simultáneos');
    const tr = this.engine.inject(now, this.conditions(now), { type: params.type as IncidentType | undefined, severity: params.severity as IncidentSeverity | undefined });
    this.syncTraffic();
    await this.emit([tr], now);
  }

  protected override validateCustom(action: Command['action']) {
    if (action === 'inject_test_incident' && !this.config.enabled) return 'El simulador está apagado';
    return null;
  }
}

/* ================================ DEV05 ================================ */

/** Lazo inductivo virtual sobre un segmento real; refleja incidentes del modelo compartido. */
export class VehicleDetector extends VirtualDevice {
  private readonly segment: RoadSegment;

  constructor(deps: DeviceDeps, private readonly traffic: TrafficModel, private readonly rng: Rng) {
    super('DEV05', deps);
    this.segment = traffic.nearestSegment(this.spec.location.lat, this.spec.location.lon, 'Avenida Carrera 27');
  }

  protected override async sample(now: Date): Promise<Sample> {
    const factor = this.param<number>('demand_factor');
    const demand = Math.min(1.3, trafficDemand(now) * factor);
    const impact = this.traffic.impactOn(this.segment.id);
    // ~30 veh/min por carril a capacidad; los incidentes reducen el flujo que pasa por el lazo.
    const expected = 30 * this.segment.lanes * 0.75 * demand * (1 - 0.7 * impact);
    const minutes = this.config.interval_s / 60;
    const count = poisson(this.rng, expected * minutes) / minutes;
    const speed = clamp(normal(this.rng, this.traffic.speedKmh(this.segment.id, now, factor), 3), 2, this.segment.free_speed_kmh * 1.15);
    return {
      variables: { vehicles_per_min: count, avg_speed_kmh: speed },
      provenance: { provider: this.spec.provenance.provider, synthetic: true, ref: this.segment.id },
    };
  }
}

/* ================================ DEV06 ================================ */

export class GpsTracker extends VirtualDevice {
  private source!: GpsSource;
  private simulated: SimulatedRouteSource;
  private lastObserved: string | null = null;
  private sourceNote: string | undefined;

  constructor(deps: DeviceDeps, private readonly env: DevicesEnv, route: [number, number][], rng: Rng) {
    super('DEV06', deps);
    this.simulated = new SimulatedRouteSource(route, rng, deps.store.get<RouteState>('DEV06', 'route'));
  }

  private apiAvailable(): string | null {
    if (!this.env.GPS_USAGE_AUTHORIZED) return 'uso de gpsmobile.co no autorizado (GPS_USAGE_AUTHORIZED=false)';
    if (!this.env.GPS_API_BASE_URL || !this.env.GPS_VEHICLE_PATH) return 'faltan GPS_API_BASE_URL o GPS_VEHICLE_PATH';
    return null;
  }

  private selectSource() {
    const wanted = this.param<string>('source');
    const blocked = wanted === 'gpsmobile' ? this.apiAvailable() : null;
    if (wanted === 'gpsmobile' && !blocked) {
      this.source = new GpsMobileSource({
        baseUrl: this.env.GPS_API_BASE_URL!,
        vehiclePath: this.env.GPS_VEHICLE_PATH!,
        user: this.env.GPS_API_USER,
        pass: this.env.GPS_API_PASS,
      });
      this.sourceNote = undefined;
    } else {
      this.source = this.simulated;
      this.sourceNote = blocked ? `Ruta simulada: ${blocked}` : undefined;
    }
    this.lastObserved = null;
    this.log.info({ source: this.source.kind, note: this.sourceNote }, 'Fuente GPS seleccionada');
  }

  protected override async onStart() {
    // La fuente inicial respeta GPS_SOURCE la primera vez; luego, la configuración persistida.
    if (this.store.get(this.id, 'config') === undefined) this.config.params.source = this.env.GPS_SOURCE;
    this.selectSource();
  }

  protected override validateCustom(action: Command['action'], params: Record<string, unknown>) {
    if (action === 'set_params' && params.source === 'gpsmobile') {
      const blocked = this.apiAvailable();
      if (blocked) return `No se puede activar gpsmobile: ${blocked}`;
    }
    return null;
  }

  protected override async onConfigChanged(prev: DeviceConfig, next: DeviceConfig) {
    if (prev.params.source !== next.params.source) this.selectSource();
  }

  protected override idleReason() {
    return this.sourceNote;
  }

  protected override async sample(now: Date): Promise<Sample | null> {
    let fix;
    try {
      fix = await this.source.fetchPosition(now);
    } catch (e) {
      if (this.source.kind === 'gpsmobile' && this.env.GPS_FALLBACK_TO_SIMULATED) {
        this.log.warn({ err: (e as Error).message }, 'API GPS falló; respaldo explícito a ruta simulada');
        fix = await this.simulated.fetchPosition(now);
        return this.toSample(fix, this.simulated, true);
      }
      throw e; // el dispositivo queda en estado degradado; no se sustituye en silencio
    }
    if (this.source === this.simulated) this.store.set(this.id, 'route', this.simulated.state);
    // Con la API real, solo se publica cuando el proveedor reporta una posición nueva.
    if (this.source.kind === 'gpsmobile') {
      const iso = fix.observed_at.toISOString();
      if (iso === this.lastObserved) return null;
      this.lastObserved = iso;
    }
    return this.toSample(fix, this.source, false);
  }

  private toSample(fix: Awaited<ReturnType<GpsSource['fetchPosition']>>, src: GpsSource, fallback: boolean): Sample {
    return {
      timestamp: fix.observed_at,
      location: { lat: fix.lat, lon: fix.lon, name: src.synthetic ? 'Vehículo (ruta simulada)' : 'Vehículo (GPS)' },
      variables: { lat: fix.lat, lon: fix.lon, speed_kmh: fix.speed_kmh, state: fix.state },
      source_type: src.synthetic ? 'simulated' : 'api',
      provenance: {
        provider: src.provider,
        synthetic: src.synthetic,
        ref: fallback ? 'respaldo simulado por fallo de la API' : fix.status_code !== null ? `status_code=${fix.status_code}` : undefined,
      },
      degraded: fallback,
    };
  }
}

/* ================================ DEV08 ================================ */

/** Fracción de la capacidad que llega por hora (centro comercial). */
const ARRIVALS = [0.005, 0.003, 0.002, 0.002, 0.002, 0.005, 0.01, 0.02, 0.05, 0.12, 0.15, 0.18, 0.25, 0.2, 0.15, 0.15, 0.18, 0.25, 0.3, 0.25, 0.1, 0.02, 0.005, 0.005];

export class SmartParking extends VirtualDevice {
  private occupied: number;
  private lastAt: number | null = null;

  constructor(deps: DeviceDeps, private readonly rng: Rng) {
    super('DEV08', deps);
    this.occupied = deps.store.get<number>('DEV08', 'occupied') ?? 20;
  }

  protected override async sample(now: Date): Promise<Sample> {
    const cap = this.param<number>('capacity');
    const dt = this.lastAt === null ? this.config.interval_s : Math.min(900, (now.getTime() - this.lastAt) / 1000);
    this.lastAt = now.getTime();
    const { hour, dow } = bogotaTime(now);
    const weekend = dow === 0 || dow === 6 ? 1.3 : 1;
    const modeMult = this.config.mode === 'evento' ? 1.8 : this.config.mode === 'cerrado' ? 0 : 1;
    const arrPerMin = (cap * ARRIVALS[Math.floor(hour)]! * weekend * this.param<number>('demand_factor') * modeMult) / 60;
    const stayMin = hour >= 21 || hour < 6 ? 20 : this.config.mode === 'cerrado' ? 30 : 120;
    const minutes = dt / 60;
    const arrivals = poisson(this.rng, arrPerMin * minutes);
    const departures = poisson(this.rng, (this.occupied / stayMin) * minutes);
    this.occupied = clamp(this.occupied + arrivals - departures, 0, cap);
    this.store.set(this.id, 'occupied', this.occupied);
    return {
      variables: { occupied: this.occupied, free_spaces: cap - this.occupied, occupancy_pct: (100 * this.occupied) / cap },
    };
  }
}
