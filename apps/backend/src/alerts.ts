/**
 * Motor de alertas.
 *  - threshold: compara cada lectura con los umbrales vigentes del dispositivo (su config retenida).
 *  - anomaly  : z-score sobre una ventana móvil (|z| > 4 con ≥ 30 muestras).
 *  - offline  : dispositivo sin conexión durante más de OFFLINE_ALERT_AFTER_S.
 *  - incident : incidentes sintéticos de gravedad alta o crítica (DEV04).
 * Una alerta abierta por (dispositivo, variable, tipo); se resuelve sola cuando la condición desaparece.
 */
import { DEVICE_CATALOG, type DeviceConfig, type DeviceId, type Incident, type Telemetry, type Threshold } from '@scbga/shared';
import type { Db } from './db.js';
import type { Hub } from './hub.js';

export type Severity = 'info' | 'warning' | 'critical';
export type AlertKind = 'threshold' | 'anomaly' | 'offline' | 'incident';

export interface AlertRow {
  id: number;
  device_id: string;
  variable: string | null;
  kind: AlertKind;
  severity: Severity;
  message: string;
  value: number | null;
  threshold: number | null;
  ref: string | null;
  status: 'abierta' | 'reconocida' | 'resuelta';
  created_at: string;
  updated_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  synthetic: number;
}

const ANOMALY_WINDOW = 120;
const ANOMALY_MIN = 30;
const ANOMALY_Z = 4;
const ANOMALY_COOLDOWN_MS = 30 * 60_000;
const ANOMALY_MIN_SD = 0.5;
/** Con |z| por debajo de esto la variable se considera de nuevo normal y se cierran sus atípicos. */
const ANOMALY_CLEAR_Z = 2;

/** Evalúa un valor contra un umbral; devuelve la peor violación o null. */
export function evaluateThreshold(value: number, t: Threshold | undefined): { severity: Severity; limit: number; dir: 'alto' | 'bajo' } | null {
  if (!t) return null;
  if (t.crit_high !== undefined && value >= t.crit_high) return { severity: 'critical', limit: t.crit_high, dir: 'alto' };
  if (t.crit_low !== undefined && value <= t.crit_low) return { severity: 'critical', limit: t.crit_low, dir: 'bajo' };
  if (t.warn_high !== undefined && value >= t.warn_high) return { severity: 'warning', limit: t.warn_high, dir: 'alto' };
  if (t.warn_low !== undefined && value <= t.warn_low) return { severity: 'warning', limit: t.warn_low, dir: 'bajo' };
  return null;
}

export class AlertEngine {
  private readonly windows = new Map<string, number[]>();
  private readonly lastAnomaly = new Map<string, number>();
  private readonly offlineTimers = new Map<DeviceId, NodeJS.Timeout>();

  constructor(
    private readonly db: Db,
    private readonly hub: Hub,
    private readonly offlineAfterS: number,
  ) {}

  private findOpen(device: string, variable: string | null, kind: AlertKind, ref?: string): AlertRow | undefined {
    if (ref) return this.db.prepare(`SELECT * FROM alerts WHERE kind=? AND ref=? AND status!='resuelta'`).get(kind, ref) as AlertRow | undefined;
    return this.db
      .prepare(`SELECT * FROM alerts WHERE device_id=? AND kind=? AND IFNULL(variable,'')=IFNULL(?, '') AND status!='resuelta' ORDER BY id DESC LIMIT 1`)
      .get(device, kind, variable) as AlertRow | undefined;
  }

  private get(id: number): AlertRow {
    return this.db.prepare('SELECT * FROM alerts WHERE id=?').get(id) as AlertRow;
  }

  private open(a: Omit<AlertRow, 'id' | 'status' | 'created_at' | 'updated_at' | 'acknowledged_by' | 'acknowledged_at' | 'resolved_by' | 'resolved_at'>): AlertRow {
    const now = new Date().toISOString();
    const existing = this.findOpen(a.device_id, a.variable, a.kind, a.ref ?? undefined);
    if (existing) {
      // Actualiza valor y escala la gravedad si empeora (sin duplicar la alerta).
      const rank = { info: 0, warning: 1, critical: 2 };
      const severity = rank[a.severity] > rank[existing.severity] ? a.severity : existing.severity;
      this.db.prepare('UPDATE alerts SET value=?, threshold=?, severity=?, message=?, updated_at=? WHERE id=?').run(a.value, a.threshold, severity, a.message, now, existing.id);
      const row = this.get(existing.id);
      if (severity !== existing.severity) this.hub.publish({ type: 'alert', data: row });
      return row;
    }
    const info = this.db
      .prepare(
        `INSERT INTO alerts (device_id, variable, kind, severity, message, value, threshold, ref, status, created_at, updated_at, synthetic)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'abierta', ?, ?, ?)`,
      )
      .run(a.device_id, a.variable, a.kind, a.severity, a.message, a.value, a.threshold, a.ref, now, now, a.synthetic);
    const row = this.get(Number(info.lastInsertRowid));
    this.hub.publish({ type: 'alert', data: row });
    return row;
  }

  private autoResolve(device: string, variable: string | null, kind: AlertKind, ref?: string) {
    const ex = this.findOpen(device, variable, kind, ref);
    if (!ex) return;
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE alerts SET status='resuelta', resolved_by='sistema', resolved_at=?, updated_at=? WHERE id=?`).run(now, now, ex.id);
    this.hub.publish({ type: 'alert', data: this.get(ex.id) });
  }

  private resolveAnomalies(device: string, variable: string) {
    const open = this.db
      .prepare(`SELECT id FROM alerts WHERE device_id=? AND variable=? AND kind='anomaly' AND status!='resuelta'`)
      .all(device, variable) as { id: number }[];
    if (!open.length) return;
    const now = new Date().toISOString();
    const upd = this.db.prepare(`UPDATE alerts SET status='resuelta', resolved_by='sistema', resolved_at=?, updated_at=? WHERE id=?`);
    for (const { id } of open) {
      upd.run(now, now, id);
      this.hub.publish({ type: 'alert', data: this.get(id) });
    }
  }

  onTelemetry(t: Telemetry, config: DeviceConfig | null) {
    const spec = DEVICE_CATALOG[t.device_id];
    const synthetic = t.provenance.synthetic ? 1 : 0;
    for (const v of spec.variables) {
      const val = t.variables[v.key]?.value;
      // Solo variables con umbral: coordenadas o acumulados (energía) no tienen sentido para z-score.
      if (typeof val !== 'number' || !v.thresholdable) continue;

      {
        const hit = evaluateThreshold(val, config?.thresholds[v.key] ?? spec.default_thresholds[v.key]);
        if (hit) {
          this.open({
            device_id: t.device_id,
            variable: v.key,
            kind: 'threshold',
            severity: hit.severity,
            message: `${v.label} ${hit.dir === 'alto' ? 'por encima' : 'por debajo'} del umbral: ${val.toFixed(v.decimals ?? 1)} ${v.unit ?? ''} (límite ${hit.limit})`.trim(),
            value: val,
            threshold: hit.limit,
            ref: null,
            synthetic,
          });
        } else this.autoResolve(t.device_id, v.key, 'threshold');
      }
      this.checkAnomaly(t.device_id, v.key, v.label, val, synthetic);
    }
  }

  private checkAnomaly(device: DeviceId, key: string, label: string, val: number, synthetic: number) {
    const k = `${device}:${key}`;
    const w = this.windows.get(k) ?? [];
    if (w.length >= ANOMALY_MIN) {
      const mean = w.reduce((a, b) => a + b, 0) / w.length;
      const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / (w.length - 1));
      // Piso de dispersión: evita falsos atípicos en series casi constantes (p. ej. congestión 1–2 %).
      const sdEff = Math.max(sd, 0.05 * Math.abs(mean), ANOMALY_MIN_SD);
      const z = (val - mean) / sdEff;
      const last = this.lastAnomaly.get(k) ?? 0;
      if (Math.abs(z) > ANOMALY_Z && Date.now() - last > ANOMALY_COOLDOWN_MS) {
        this.lastAnomaly.set(k, Date.now());
        this.open({
          device_id: device,
          variable: key,
          kind: 'anomaly',
          severity: 'info',
          message: `${label}: valor atípico ${val.toFixed(2)} (z = ${z.toFixed(1)}, media ${mean.toFixed(2)})`,
          value: val,
          threshold: null,
          ref: `${k}:${Date.now()}`,
          synthetic,
        });
      } else if (Math.abs(z) < ANOMALY_CLEAR_Z) {
        // El atípico es un evento puntual: al volver la variable a su rango normal se cierra
        // (antes cada atípico tenía ref única y quedaba abierto para siempre).
        this.resolveAnomalies(device, key);
      }
    }
    w.push(val);
    if (w.length > ANOMALY_WINDOW) w.shift();
    this.windows.set(k, w);
  }

  onConnection(device: DeviceId, online: boolean, reason?: string) {
    const timer = this.offlineTimers.get(device);
    if (online) {
      if (timer) clearTimeout(timer);
      this.offlineTimers.delete(device);
      this.autoResolve(device, null, 'offline');
      return;
    }
    if (timer) return;
    this.offlineTimers.set(
      device,
      setTimeout(() => {
        this.offlineTimers.delete(device);
        this.open({
          device_id: device,
          variable: null,
          kind: 'offline',
          severity: 'warning',
          message: `${DEVICE_CATALOG[device].name} sin conexión${reason ? ` (${reason})` : ''}`,
          value: null,
          threshold: null,
          ref: null,
          synthetic: 0,
        });
      }, this.offlineAfterS * 1000),
    );
  }

  onIncident(i: Incident) {
    const ref = i.incident_id;
    if (i.state === 'resuelto') return this.autoResolve('DEV04', null, 'incident', ref);
    if (i.severity !== 'alta' && i.severity !== 'critica') return;
    this.open({
      device_id: 'DEV04',
      variable: null,
      kind: 'incident',
      severity: i.severity === 'critica' ? 'critical' : 'warning',
      message: `[SIMULACIÓN] ${i.type.replace('_', ' ')} de gravedad ${i.severity} en ${i.road_name}`,
      value: i.speed_impact,
      threshold: null,
      ref,
      synthetic: 1,
    });
  }

  list(filter: { status?: string; device?: string; limit: number }): AlertRow[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.status === 'activas') where.push(`status!='resuelta'`);
    else if (filter.status) {
      where.push('status=?');
      args.push(filter.status);
    }
    if (filter.device) {
      where.push('device_id=?');
      args.push(filter.device);
    }
    const sql = `SELECT * FROM alerts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE status WHEN 'abierta' THEN 0 WHEN 'reconocida' THEN 1 ELSE 2 END, id DESC LIMIT ?`;
    return this.db.prepare(sql).all(...args, filter.limit) as AlertRow[];
  }

  counts() {
    return this.db
      .prepare(`SELECT severity, COUNT(*) AS n FROM alerts WHERE status!='resuelta' GROUP BY severity`)
      .all() as { severity: Severity; n: number }[];
  }

  transition(id: number, to: 'reconocida' | 'resuelta', user: string): AlertRow | null {
    const row = this.db.prepare('SELECT * FROM alerts WHERE id=?').get(id) as AlertRow | undefined;
    if (!row || row.status === 'resuelta') return null;
    const now = new Date().toISOString();
    if (to === 'reconocida') this.db.prepare(`UPDATE alerts SET status='reconocida', acknowledged_by=?, acknowledged_at=?, updated_at=? WHERE id=?`).run(user, now, now, id);
    else this.db.prepare(`UPDATE alerts SET status='resuelta', resolved_by=?, resolved_at=?, updated_at=? WHERE id=?`).run(user, now, now, id);
    const updated = this.get(id);
    this.hub.publish({ type: 'alert', data: updated });
    return updated;
  }
}
