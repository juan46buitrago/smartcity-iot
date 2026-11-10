import mqtt, { type MqttClient } from 'mqtt';
import {
  CommandSchema,
  DEVICE_CATALOG,
  DeviceConfigSchema,
  defaultConfig,
  topic,
  validateCommand,
  type Ack,
  type Command,
  type DeviceConfig,
  type DeviceId,
  type DeviceSpec,
  type DeviceStatus,
  type GeoLocation,
  type SourceType,
  type Telemetry,
} from '@scbga/shared';
import { logger, type Logger } from './logger.js';
import type { StateStore } from './stateStore.js';
import { toBogotaIso } from './time.js';

export const FIRMWARE = 'scbga-vdev/1.0';
/** Órdenes más antiguas que esto se rechazan (evita ejecutar órdenes encoladas tarde). */
const MAX_COMMAND_AGE_MS = 60_000;
/** Lecturas sin confirmar que se retienen durante un corte (≈ 5,5 h a 10 s por lectura). */
const MAX_PENDING_TELEMETRY = 2000;

export type VarValue = number | string | boolean | null;

export interface Sample {
  /** Momento de la observación. Por defecto, ahora. */
  timestamp?: Date;
  variables: Record<string, VarValue>;
  source_type?: SourceType;
  provenance?: Telemetry['provenance'];
  location?: GeoLocation;
  degraded?: boolean;
}

export interface MqttSettings {
  url: string;
  username: string;
  password: string;
}

export interface DeviceDeps {
  mqtt: MqttSettings;
  store: StateStore;
}

type OpState = NonNullable<DeviceStatus['state']>;

/**
 * Dispositivo virtual: un cliente MQTT independiente con identidad, LWT, ciclo de
 * medición configurable y ejecución de órdenes con confirmación (ack).
 *
 * Las subclases implementan `sample()` y, opcionalmente, ganchos de validación y
 * de órdenes personalizadas.
 */
export abstract class VirtualDevice {
  readonly id: DeviceId;
  readonly spec: DeviceSpec;
  protected config: DeviceConfig;
  protected client: MqttClient | null = null;
  protected readonly log: Logger;
  protected readonly store: StateStore;

  private seq: number;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private pendingTelemetry = 0;
  private droppedTelemetry = 0;
  private readonly startedAt = Date.now();
  private lastSampleAt: Date | null = null;
  private opState: OpState = 'running';
  private reason: string | undefined;
  private readonly recentCommands = new Map<string, Ack>();
  private stopping = false;

  constructor(id: DeviceId, protected readonly deps: DeviceDeps) {
    this.id = id;
    this.spec = DEVICE_CATALOG[id];
    this.store = deps.store;
    this.log = logger.child({ device: id });
    this.seq = this.store.get<number>(id, 'seq') ?? 0;
    const saved = DeviceConfigSchema.safeParse(this.store.get(id, 'config'));
    this.config = saved.success ? this.mergeWithDefaults(saved.data) : defaultConfig(id);
    if (!this.config.enabled) this.opState = 'stopped';
  }

  /** Mezcla la configuración guardada con la del catálogo (por si se añadieron parámetros). */
  private mergeWithDefaults(saved: DeviceConfig): DeviceConfig {
    const def = defaultConfig(this.id);
    const params = { ...def.params };
    for (const k of Object.keys(params)) if (k in saved.params) params[k] = saved.params[k]!;
    const { min, max } = this.spec.interval;
    return {
      ...def,
      ...saved,
      params,
      calibration: { ...def.calibration, ...saved.calibration },
      interval_s: Math.min(max, Math.max(min, saved.interval_s)),
      mode: this.spec.modes.includes(saved.mode) ? saved.mode : def.mode,
    };
  }

  /* ------------------------------ ciclo de vida ------------------------------ */

  async start(): Promise<void> {
    await this.onStart();
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearTimer();
    await this.onStop();
    if (this.client) {
      await this.publish('status', this.statusPayload('offline', 'apagado del servicio'), { retain: true, qos: 1 });
      await this.client.endAsync();
    }
  }

  private connect(): void {
    const { url, username, password } = this.deps.mqtt;
    const willPayload: DeviceStatus = {
      device_id: this.id,
      timestamp: new Date().toISOString(),
      connection: 'offline',
      reason: 'se perdió la conexión con el broker',
      firmware: FIRMWARE,
    };
    this.client = mqtt.connect(url, {
      clientId: `scbga-${this.id.toLowerCase()}`,
      username,
      password,
      clean: true,
      keepalive: 30,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
      will: { topic: topic(this.id, 'status'), payload: Buffer.from(JSON.stringify(willPayload)), qos: 1, retain: true },
    });

    this.client.on('connect', () => {
      this.log.info('Conectado al broker');
      this.client!.subscribe(topic(this.id, 'control'), { qos: 1 }, (err) => {
        if (err) this.log.error({ err: err.message }, 'No se pudo suscribir a control');
      });
      void this.publishConfig();
      void this.publishStatus();
      void this.onConnected();
      this.schedule(true);
    });
    this.client.on('message', (t, payload) => {
      if (t === topic(this.id, 'control')) void this.handleCommand(payload);
      else void this.onMessage(t, payload);
    });
    this.client.on('reconnect', () => this.log.debug('Reintentando conexión'));
    this.client.on('offline', () => this.log.warn('Sin conexión con el broker; la telemetría QoS1 se encola'));
    this.client.on('error', (err) => this.log.error({ err: err.message }, 'Error MQTT'));
  }

  /* ------------------------------ medición ------------------------------ */

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(immediate = false): void {
    this.clearTimer();
    if (this.stopping) return;
    const delay = immediate ? 500 : this.config.interval_s * 1000;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (this.busy) return this.schedule();
    this.busy = true;
    try {
      if (!this.config.enabled) return;
      const out = await this.sample(new Date());
      const samples = out === null ? [] : Array.isArray(out) ? out : [out];
      for (const s of samples) await this.publishTelemetry(s);
      const degraded = samples.some((s) => s.degraded);
      this.setState(degraded ? 'degraded' : 'running', degraded ? this.reason : this.idleReason());
    } catch (e) {
      const msg = (e as Error).message;
      this.log.warn({ err: msg }, 'Fallo al medir');
      this.setState('degraded', `Fallo de la fuente: ${msg}`.slice(0, 200));
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  /** Motivo informativo cuando no hay error (p. ej. "sin datos nuevos"). */
  protected idleReason(): string | undefined {
    return undefined;
  }

  protected setState(state: OpState, reason?: string): void {
    if (state === this.opState && reason === this.reason) return;
    this.opState = state;
    this.reason = reason;
    void this.publishStatus();
  }

  private applyCalibration(vars: Record<string, VarValue>): Record<string, VarValue> {
    const out = { ...vars };
    for (const [k, off] of Object.entries(this.config.calibration)) {
      const v = out[k];
      if (typeof v === 'number' && off) out[k] = v + off;
    }
    return out;
  }

  protected async publishTelemetry(s: Sample): Promise<void> {
    const vars = this.applyCalibration(s.variables);
    const units = new Map(this.spec.variables.map((v) => [v.key, v]));
    const variables: Telemetry['variables'] = {};
    for (const [k, value] of Object.entries(vars)) {
      const spec = units.get(k);
      if (!spec) continue; // solo variables declaradas en el catálogo
      const v = typeof value === 'number' && spec.decimals !== undefined ? Number(value.toFixed(spec.decimals)) : value;
      variables[k] = { value: v, unit: spec.unit };
    }
    const now = new Date();
    const msg: Telemetry = {
      device_id: this.id,
      timestamp: toBogotaIso(s.timestamp ?? now),
      ingested_at: toBogotaIso(now),
      location: s.location ?? this.spec.location,
      status: s.degraded ? 'degraded' : 'online',
      source_type: s.source_type ?? this.spec.source_type,
      provenance: s.provenance ?? { provider: this.spec.provenance.provider, synthetic: this.spec.provenance.synthetic },
      variables,
      seq: ++this.seq,
    };
    this.store.set(this.id, 'seq', this.seq);
    this.lastSampleAt = now;
    // Almacenar y reenviar: no se espera el PUBACK para no detener la medición durante un corte de red.
    // mqtt.js guarda cada QoS 1 en su cola saliente y la reenvía al reconectar (con el timestamp original).
    if (this.pendingTelemetry >= MAX_PENDING_TELEMETRY) {
      this.droppedTelemetry++;
      if (this.droppedTelemetry % 100 === 1) this.log.warn({ pending: this.pendingTelemetry, dropped: this.droppedTelemetry }, 'Cola de telemetría llena; se descartan lecturas nuevas');
      return;
    }
    this.pendingTelemetry++;
    void this.publish('telemetry', msg, { qos: 1 }).finally(() => this.pendingTelemetry--);
  }

  /* ------------------------------ órdenes ------------------------------ */

  private async handleCommand(payload: Buffer): Promise<void> {
    let cmd: Command;
    try {
      const parsed = CommandSchema.safeParse(JSON.parse(payload.toString('utf8')));
      if (!parsed.success) {
        this.log.warn({ issues: parsed.error.issues.length }, 'Orden con formato inválido descartada');
        return;
      }
      cmd = parsed.data;
    } catch {
      this.log.warn('Orden no es JSON válido; descartada');
      return;
    }

    // Idempotencia: QoS 1 puede entregar la misma orden dos veces.
    const prev = this.recentCommands.get(cmd.command_id);
    if (prev) return void this.publish('ack', prev, { qos: 1 });

    const ack = await this.execute(cmd);
    this.recentCommands.set(cmd.command_id, ack);
    if (this.recentCommands.size > 200) this.recentCommands.delete(this.recentCommands.keys().next().value!);
    await this.publish('ack', ack, { qos: 1 });
    this.log.info({ action: cmd.action, ok: ack.ok, error: ack.error }, 'Orden procesada');
    if (ack.ok && cmd.action === 'restart') void this.simulateRestart();
  }

  private async execute(cmd: Command): Promise<Ack> {
    const base = { command_id: cmd.command_id, device_id: this.id, action: cmd.action, timestamp: new Date().toISOString() };
    const age = Date.now() - Date.parse(cmd.issued_at);
    if (age > MAX_COMMAND_AGE_MS) return { ...base, ok: false, error: `Orden caducada (${Math.round(age / 1000)} s)` };

    const v = validateCommand(this.id, cmd.action, cmd.params);
    if (!v.ok) return { ...base, ok: false, error: v.error };
    const customError = this.validateCustom(cmd.action, v.params);
    if (customError) return { ...base, ok: false, error: customError };

    const prev = structuredClone(this.config);
    const next = structuredClone(this.config);
    const p = v.params as Record<string, any>;
    switch (cmd.action) {
      case 'power':
        next.enabled = p.on;
        break;
      case 'set_interval':
        next.interval_s = p.interval_s;
        break;
      case 'set_mode':
        next.mode = p.mode;
        break;
      case 'set_params':
        Object.assign(next.params, p);
        break;
      case 'set_thresholds':
        next.thresholds[p.variable] = p.threshold;
        break;
      case 'calibrate':
        next.calibration[p.variable] = p.offset;
        break;
      case 'restart':
        break;
      case 'inject_test_incident':
        try {
          await this.handleCustomCommand(cmd.action, p);
        } catch (e) {
          return { ...base, ok: false, error: (e as Error).message };
        }
        break;
    }

    const changed = JSON.stringify(prev) !== JSON.stringify(next);
    if (changed) {
      next.version = prev.version + 1;
      next.updated_at = new Date().toISOString();
      this.config = next;
      this.store.set(this.id, 'config', next);
      await this.onConfigChanged(prev, next);
      await this.publishConfig();
      if (prev.enabled !== next.enabled) this.setState(next.enabled ? 'running' : 'stopped', next.enabled ? undefined : 'apagado por orden remota');
      if (prev.interval_s !== next.interval_s || (!prev.enabled && next.enabled)) this.schedule(!prev.enabled && next.enabled);
    }
    return { ...base, ok: true, config_version: this.config.version };
  }

  /** Simula el reinicio del dispositivo: desconexión ordenada y reconexión a los 3 s. */
  private async simulateRestart(): Promise<void> {
    this.clearTimer();
    await this.publish('status', this.statusPayload('offline', 'reinicio solicitado'), { retain: true, qos: 1 });
    await this.client?.endAsync();
    setTimeout(() => this.connect(), 3000);
  }

  /* ------------------------------ publicación ------------------------------ */

  protected async publish(channel: 'telemetry' | 'status' | 'config' | 'ack' | 'events', body: unknown, opts: { qos?: 0 | 1; retain?: boolean } = {}) {
    if (!this.client) return;
    try {
      await this.client.publishAsync(topic(this.id, channel), JSON.stringify(body), { qos: opts.qos ?? 1, retain: opts.retain ?? false });
    } catch (e) {
      this.log.warn({ err: (e as Error).message, channel }, 'No se pudo publicar');
    }
  }

  private statusPayload(connection: 'online' | 'offline', reason?: string): DeviceStatus {
    return {
      device_id: this.id,
      timestamp: new Date().toISOString(),
      connection,
      state: this.config.enabled ? this.opState : 'stopped',
      reason: reason ?? this.reason,
      uptime_s: Math.round((Date.now() - this.startedAt) / 1000),
      last_sample_at: this.lastSampleAt?.toISOString() ?? null,
      firmware: FIRMWARE,
    };
  }

  protected publishStatus() {
    return this.publish('status', this.statusPayload('online'), { retain: true, qos: 1 });
  }

  private publishConfig() {
    return this.publish('config', this.config, { retain: true, qos: 1 });
  }

  /* ------------------------------ ganchos ------------------------------ */

  /** Toma una o varias observaciones. Devuelve null si no hay datos nuevos. */
  protected abstract sample(now: Date): Promise<Sample | Sample[] | null>;
  protected async onStart(): Promise<void> {}
  protected async onStop(): Promise<void> {}
  protected async onConnected(): Promise<void> {}
  protected async onMessage(_topic: string, _payload: Buffer): Promise<void> {}
  protected async onConfigChanged(_prev: DeviceConfig, _next: DeviceConfig): Promise<void> {}
  /** Validación adicional propia del dispositivo; devuelve un mensaje de error o null. */
  protected validateCustom(_action: Command['action'], _params: Record<string, unknown>): string | null {
    return null;
  }
  protected async handleCustomCommand(action: Command['action'], _params: Record<string, unknown>): Promise<void> {
    throw new Error(`Acción ${action} no implementada`);
  }

  protected param<T extends number | string | boolean>(key: string): T {
    return this.config.params[key] as T;
  }
}
