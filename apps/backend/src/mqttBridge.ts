/**
 * Puente MQTT del backend: consume telemetría/estado/config/ack/eventos (validados con zod),
 * mantiene el estado vivo, alimenta alertas e incidentes y publica órdenes con confirmación.
 */
import { randomUUID } from 'node:crypto';
import mqtt, { type MqttClient } from 'mqtt';
import {
  AckSchema,
  CommandSchema,
  DeviceConfigSchema,
  IncidentEventSchema,
  StatusSchema,
  TelemetrySchema,
  isDeviceId,
  parseTopic,
  topic,
  validateCommand,
  type Ack,
  type Command,
  type DeviceId,
  type Incident,
} from '@scbga/shared';
import type { Logger } from 'pino';
import type { AlertEngine } from './alerts.js';
import type { Db } from './db.js';
import type { Hub } from './hub.js';
import type { LiveState } from './state.js';

export interface CommandRecord {
  command_id: string;
  device_id: string;
  action: string;
  params: Record<string, unknown>;
  issued_at: string;
  issued_by: string;
  origin: 'api' | 'external';
  status: 'pending' | 'confirmed' | 'rejected' | 'timeout';
  error: string | null;
  ack_at: string | null;
  config_version: number | null;
}

export class CommandError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

interface Pending {
  resolve: (r: CommandRecord) => void;
  timer: NodeJS.Timeout;
}

export class MqttBridge {
  private client: MqttClient | null = null;
  private readonly pending = new Map<string, Pending>();
  readonly stats = { received: 0, rejected: 0 };

  constructor(
    private readonly opts: { url: string; password: string; commandTimeoutMs: number },
    private readonly db: Db,
    private readonly live: LiveState,
    private readonly alerts: AlertEngine,
    private readonly hub: Hub,
    private readonly log: Logger,
  ) {}

  get connected(): boolean {
    return !!this.client?.connected;
  }

  start(): void {
    this.client = mqtt.connect(this.opts.url, {
      clientId: 'scbga-backend',
      username: 'backend',
      password: this.opts.password,
      clean: false, // sesión persistente: no perder acks/eventos QoS1 durante reinicios breves
      keepalive: 30,
      reconnectPeriod: 3000,
    });
    this.client.on('connect', () => {
      this.log.info('Backend conectado a MQTT');
      this.client!.subscribe(
        ['telemetry', 'status', 'config', 'ack', 'events', 'control'].map((c) => `smartcity/+/${c}`),
        { qos: 1 },
      );
    });
    this.client.on('error', (e) => this.log.error({ err: e.message }, 'Error MQTT'));
    this.client.on('offline', () => this.log.warn('Backend sin conexión MQTT'));
    this.client.on('message', (t, payload) => this.onMessage(t, payload));
  }

  async stop(): Promise<void> {
    await this.client?.endAsync();
  }

  private onMessage(t: string, payload: Buffer) {
    const parsedTopic = parseTopic(t);
    if (!parsedTopic || !isDeviceId(parsedTopic.deviceId)) return;
    const deviceId = parsedTopic.deviceId;
    let json: unknown;
    try {
      json = JSON.parse(payload.toString('utf8'));
    } catch {
      this.stats.rejected++;
      return;
    }
    this.stats.received++;
    const reject = (why: string) => {
      this.stats.rejected++;
      this.log.warn({ topic: t, why }, 'Mensaje MQTT rechazado');
    };

    switch (parsedTopic.channel) {
      case 'telemetry': {
        const r = TelemetrySchema.safeParse(json);
        if (!r.success || r.data.device_id !== deviceId) return reject('telemetría inválida');
        this.live.setTelemetry(r.data);
        this.alerts.onTelemetry(r.data, this.live.get(deviceId).config);
        this.hub.publish({ type: 'telemetry', data: r.data });
        break;
      }
      case 'status': {
        const r = StatusSchema.safeParse(json);
        if (!r.success || r.data.device_id !== deviceId) return reject('estado inválido');
        this.live.setStatus(r.data);
        this.alerts.onConnection(deviceId, r.data.connection === 'online', r.data.reason);
        this.hub.publish({ type: 'status', data: this.live.get(deviceId).status });
        break;
      }
      case 'config': {
        const r = DeviceConfigSchema.safeParse(json);
        if (!r.success || r.data.device_id !== deviceId) return reject('configuración inválida');
        this.live.setConfig(r.data);
        this.hub.publish({ type: 'config', data: r.data });
        break;
      }
      case 'ack': {
        const r = AckSchema.safeParse(json);
        if (!r.success || r.data.device_id !== deviceId) return reject('ack inválido');
        this.onAck(r.data);
        break;
      }
      case 'events': {
        const r = IncidentEventSchema.safeParse(json);
        if (!r.success) return reject('evento inválido');
        this.saveIncident(r.data.incident);
        this.alerts.onIncident(r.data.incident);
        this.hub.publish({ type: 'incident', data: r.data });
        break;
      }
      case 'control': {
        // Auditoría de órdenes emitidas por otros actores (p. ej. reglas de Node-RED).
        const r = CommandSchema.safeParse(json);
        if (!r.success) return;
        const exists = this.db.prepare('SELECT 1 FROM commands WHERE command_id=?').get(r.data.command_id);
        if (!exists) this.insertCommand(deviceId, r.data, 'external');
        break;
      }
    }
  }

  private saveIncident(i: Incident) {
    this.db
      .prepare(
        `INSERT INTO incidents (incident_id, type, severity, state, road_name, started_at, resolved_at, test, data, updated_at)
         VALUES (@incident_id, @type, @severity, @state, @road_name, @started_at, @resolved_at, @test, @data, @now)
         ON CONFLICT(incident_id) DO UPDATE SET state=excluded.state, resolved_at=excluded.resolved_at, data=excluded.data, updated_at=excluded.updated_at`,
      )
      .run({ ...i, test: i.test ? 1 : 0, data: JSON.stringify(i), now: new Date().toISOString() });
  }

  private insertCommand(deviceId: string, c: Command, origin: 'api' | 'external') {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO commands (command_id, device_id, action, params, issued_at, issued_by, origin, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(c.command_id, deviceId, c.action, JSON.stringify(c.params ?? {}), c.issued_at, c.issued_by ?? 'desconocido', origin);
    this.hub.publish({ type: 'command', data: this.getCommand(c.command_id) });
  }

  getCommand(id: string): CommandRecord | null {
    const row = this.db.prepare('SELECT * FROM commands WHERE command_id=?').get(id) as (Omit<CommandRecord, 'params'> & { params: string }) | undefined;
    return row ? { ...row, params: JSON.parse(row.params) } : null;
  }

  listCommands(deviceId: string | undefined, limit: number): CommandRecord[] {
    const rows = (deviceId
      ? this.db.prepare('SELECT * FROM commands WHERE device_id=? ORDER BY issued_at DESC LIMIT ?').all(deviceId, limit)
      : this.db.prepare('SELECT * FROM commands ORDER BY issued_at DESC LIMIT ?').all(limit)) as (Omit<CommandRecord, 'params'> & { params: string })[];
    return rows.map((r) => ({ ...r, params: JSON.parse(r.params) }));
  }

  private onAck(a: Ack) {
    const res = this.db
      .prepare(`UPDATE commands SET status=?, error=?, ack_at=?, config_version=? WHERE command_id=? AND status IN ('pending','timeout')`)
      .run(a.ok ? 'confirmed' : 'rejected', a.error ?? null, a.timestamp, a.config_version ?? null, a.command_id);
    if (res.changes === 0) return; // ack duplicado o desconocido
    const rec = this.getCommand(a.command_id)!;
    this.hub.publish({ type: 'command', data: rec });
    const p = this.pending.get(a.command_id);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(a.command_id);
      p.resolve(rec);
    }
  }

  /**
   * Envía una orden y espera la confirmación del dispositivo (o el tiempo límite).
   * Valida contra el catálogo antes de publicar: el dispositivo vuelve a validar (defensa en profundidad).
   */
  async sendCommand(deviceId: DeviceId, action: Command['action'], params: unknown, user: string): Promise<CommandRecord> {
    const v = validateCommand(deviceId, action, params);
    if (!v.ok) throw new CommandError(400, v.error);
    if (!this.connected) throw new CommandError(503, 'El backend no está conectado al broker MQTT');
    if (!this.live.isOnline(deviceId)) throw new CommandError(409, `${deviceId} está desconectado; la orden no se envió`);

    const cmd: Command = { command_id: randomUUID(), action, params: v.params, issued_at: new Date().toISOString(), issued_by: user };
    this.insertCommand(deviceId, cmd, 'api');
    const result = new Promise<CommandRecord>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmd.command_id);
        this.db.prepare(`UPDATE commands SET status='timeout', error='Sin confirmación del dispositivo' WHERE command_id=? AND status='pending'`).run(cmd.command_id);
        const rec = this.getCommand(cmd.command_id)!;
        this.hub.publish({ type: 'command', data: rec });
        resolve(rec);
      }, this.opts.commandTimeoutMs);
      this.pending.set(cmd.command_id, { resolve, timer });
    });
    await this.client!.publishAsync(topic(deviceId, 'control'), JSON.stringify(cmd), { qos: 1 });
    return result;
  }
}
