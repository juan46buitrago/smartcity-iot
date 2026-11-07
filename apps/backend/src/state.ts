/**
 * Estado vivo de los dispositivos: último estado, configuración y telemetría recibidos.
 * Se guarda una instantánea en SQLite para que la interfaz tenga datos tras un reinicio.
 */
import {
  DEVICE_CATALOG,
  DEVICE_IDS,
  type DeviceConfig,
  type DeviceId,
  type DeviceStatus,
  type Telemetry,
} from '@scbga/shared';
import type { Db } from './db.js';

export interface DeviceLive {
  status: (DeviceStatus & { received_at: string }) | null;
  config: DeviceConfig | null;
  telemetry: (Telemetry & { received_at: string }) | null;
}

export class LiveState {
  private readonly live = new Map<DeviceId, DeviceLive>();
  private readonly upsert;

  constructor(private readonly db: Db) {
    this.upsert = db.prepare(
      `INSERT INTO device_snapshot (device_id, status, config, telemetry, updated_at) VALUES (@id, @status, @config, @telemetry, @now)
       ON CONFLICT(device_id) DO UPDATE SET status=excluded.status, config=excluded.config, telemetry=excluded.telemetry, updated_at=excluded.updated_at`,
    );
    const rows = db.prepare('SELECT device_id, status, config, telemetry FROM device_snapshot').all() as {
      device_id: DeviceId;
      status: string | null;
      config: string | null;
      telemetry: string | null;
    }[];
    for (const id of DEVICE_IDS) this.live.set(id, { status: null, config: null, telemetry: null });
    for (const r of rows) {
      if (!this.live.has(r.device_id)) continue;
      this.live.set(r.device_id, {
        // Tras reiniciar el backend no sabemos si sigue conectado hasta recibir el estado retenido.
        status: r.status ? { ...JSON.parse(r.status), stale: true } : null,
        config: r.config ? JSON.parse(r.config) : null,
        telemetry: r.telemetry ? JSON.parse(r.telemetry) : null,
      });
    }
  }

  get(id: DeviceId): DeviceLive {
    return this.live.get(id)!;
  }

  private save(id: DeviceId) {
    const l = this.get(id);
    this.upsert.run({
      id,
      status: l.status ? JSON.stringify(l.status) : null,
      config: l.config ? JSON.stringify(l.config) : null,
      telemetry: l.telemetry ? JSON.stringify(l.telemetry) : null,
      now: new Date().toISOString(),
    });
  }

  setStatus(s: DeviceStatus) {
    this.get(s.device_id).status = { ...s, received_at: new Date().toISOString() };
    this.save(s.device_id);
  }

  setConfig(c: DeviceConfig) {
    this.get(c.device_id).config = c;
    this.save(c.device_id);
  }

  setTelemetry(t: Telemetry) {
    const l = this.get(t.device_id);
    // Las fuentes con retraso (IDEAM) pueden entregar varias observaciones; se conserva la más reciente.
    if (l.telemetry && Date.parse(l.telemetry.timestamp) > Date.parse(t.timestamp)) return;
    l.telemetry = { ...t, received_at: new Date().toISOString() };
    this.save(t.device_id);
  }

  isOnline(id: DeviceId): boolean {
    const s = this.get(id).status as (DeviceStatus & { stale?: boolean }) | null;
    return !!s && s.connection === 'online' && !s.stale;
  }

  /** Vista pública de un dispositivo: catálogo + estado vivo. */
  view(id: DeviceId) {
    const l = this.get(id);
    return { ...DEVICE_CATALOG[id], live: l };
  }

  all() {
    return DEVICE_IDS.map((id) => this.view(id));
  }
}
