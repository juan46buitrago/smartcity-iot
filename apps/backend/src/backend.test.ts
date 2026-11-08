import { randomBytes, scryptSync } from 'node:crypto';
import { defaultConfig, type Incident, type Telemetry } from '@scbga/shared';
import { describe, expect, it } from 'vitest';
import { AlertEngine, evaluateThreshold, type AlertRow } from './alerts.js';
import { safeEqual, verifyPassword } from './auth.js';
import { openDb } from './db.js';
import { Hub } from './hub.js';
import { pickWindow } from './influx.js';

function hash(pw: string) {
  const s = randomBytes(16);
  return ['scrypt', 16384, 8, 1, s.toString('base64url'), scryptSync(pw, s, 64, { N: 16384, r: 8, p: 1 }).toString('base64url')].join(':');
}

describe('autenticación', () => {
  const h = hash('clave-correcta');
  it('verifica la contraseña correcta y rechaza la incorrecta', () => {
    expect(verifyPassword('clave-correcta', h)).toBe(true);
    expect(verifyPassword('clave-incorrecta', h)).toBe(false);
    expect(verifyPassword('x', 'formato-invalido')).toBe(false);
  });
  it('compara usuarios en tiempo constante', () => {
    expect(safeEqual('operador', 'operador')).toBe(true);
    expect(safeEqual('operador', 'operadora')).toBe(false);
  });
});

describe('umbrales', () => {
  const t = { warn_high: 70, crit_high: 80, warn_low: 10 };
  it('clasifica por gravedad', () => {
    expect(evaluateThreshold(65, t)).toBeNull();
    expect(evaluateThreshold(72, t)?.severity).toBe('warning');
    expect(evaluateThreshold(85, t)?.severity).toBe('critical');
    expect(evaluateThreshold(5, t)).toMatchObject({ severity: 'warning', dir: 'bajo' });
  });
});

function telemetry(device: 'DEV03', value: number): Telemetry {
  const now = new Date().toISOString();
  return {
    device_id: device,
    timestamp: now,
    ingested_at: now,
    location: { lat: 7.12, lon: -73.12 },
    status: 'online',
    source_type: 'simulated',
    provenance: { provider: 'test', synthetic: true },
    variables: { noise_db: { value, unit: 'dB(A)' } },
    seq: 1,
  };
}

describe('motor de alertas', () => {
  it('abre una sola alerta por condición, escala gravedad y se resuelve sola', () => {
    const db = openDb(':memory:');
    const events: unknown[] = [];
    const hub = new Hub();
    hub.subscribe((e) => events.push(e));
    const engine = new AlertEngine(db, hub, 120);
    const cfg = defaultConfig('DEV03'); // warn 70, crit 80
    engine.onTelemetry(telemetry('DEV03', 72), cfg);
    engine.onTelemetry(telemetry('DEV03', 74), cfg);
    let open = engine.list({ status: 'activas', limit: 10 }) as AlertRow[];
    expect(open).toHaveLength(1);
    expect(open[0]!.severity).toBe('warning');
    engine.onTelemetry(telemetry('DEV03', 83), cfg);
    open = engine.list({ status: 'activas', limit: 10 });
    expect(open).toHaveLength(1);
    expect(open[0]!.severity).toBe('critical');
    engine.onTelemetry(telemetry('DEV03', 60), cfg);
    expect(engine.list({ status: 'activas', limit: 10 })).toHaveLength(0);
    expect(engine.list({ status: 'resuelta', limit: 10 })[0]!.resolved_by).toBe('sistema');
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it('usa los umbrales modificados por el operador', () => {
    const db = openDb(':memory:');
    const engine = new AlertEngine(db, new Hub(), 120);
    const cfg = defaultConfig('DEV03');
    cfg.thresholds.noise_db = { warn_high: 50 };
    engine.onTelemetry(telemetry('DEV03', 55), cfg);
    expect(engine.list({ status: 'abierta', limit: 10 })).toHaveLength(1);
  });

  it('permite reconocer y resolver manualmente', () => {
    const db = openDb(':memory:');
    const engine = new AlertEngine(db, new Hub(), 120);
    engine.onTelemetry(telemetry('DEV03', 90), defaultConfig('DEV03'));
    const id = engine.list({ limit: 1 })[0]!.id;
    expect(engine.transition(id, 'reconocida', 'operador')?.acknowledged_by).toBe('operador');
    expect(engine.transition(id, 'resuelta', 'operador')?.status).toBe('resuelta');
    expect(engine.transition(id, 'resuelta', 'operador')).toBeNull();
  });

  it('marca como sintéticas las alertas de incidentes simulados y las resuelve con el incidente', () => {
    const db = openDb(':memory:');
    const engine = new AlertEngine(db, new Hub(), 120);
    const inc: Incident = {
      incident_id: 'SIM-INC-20261106-0001ABC', type: 'accidente', severity: 'critica', state: 'activo', segment_id: 'S', road_name: 'Avenida Carrera 27',
      road_class: 'trunk', location: { lat: 7.12, lon: -73.11 }, lanes_blocked: 2, speed_impact: 0.6, started_at: new Date().toISOString(),
      attended_at: null, resolved_at: null, expected_end_at: new Date().toISOString(), cause: 'x', synthetic: true, test: false,
    };
    engine.onIncident(inc);
    const a = engine.list({ status: 'abierta', limit: 5 })[0]!;
    expect(a.synthetic).toBe(1);
    expect(a.message).toContain('SIMULACIÓN');
    engine.onIncident({ ...inc, state: 'resuelto' });
    expect(engine.list({ status: 'activas', limit: 5 })).toHaveLength(0);
  });
});

describe('detección de atípicos', () => {
  it('no alerta por cambios mínimos en series casi constantes', () => {
    const db = openDb(':memory:');
    const engine = new AlertEngine(db, new Hub(), 120);
    const cfg = defaultConfig('DEV03');
    cfg.thresholds.noise_db = {};
    for (let i = 0; i < 40; i++) engine.onTelemetry(telemetry('DEV03', 50 + (i % 2) * 0.1), cfg);
    engine.onTelemetry(telemetry('DEV03', 51), cfg);
    expect(engine.list({ limit: 10 }).filter((a) => a.kind === 'anomaly')).toHaveLength(0);
    engine.onTelemetry(telemetry('DEV03', 75), cfg);
    expect(engine.list({ limit: 10 }).filter((a) => a.kind === 'anomaly')).toHaveLength(1);
  });

  it('el atípico se resuelve solo cuando la variable vuelve a lo normal', () => {
    const db = openDb(':memory:');
    const engine = new AlertEngine(db, new Hub(), 120);
    const cfg = defaultConfig('DEV03');
    cfg.thresholds.noise_db = {};
    for (let i = 0; i < 40; i++) engine.onTelemetry(telemetry('DEV03', 50 + (i % 2) * 0.1), cfg);
    engine.onTelemetry(telemetry('DEV03', 75), cfg);
    expect(engine.list({ status: 'activas', limit: 10 }).filter((a) => a.kind === 'anomaly')).toHaveLength(1);
    engine.onTelemetry(telemetry('DEV03', 50.1), cfg);
    expect(engine.list({ status: 'activas', limit: 10 }).filter((a) => a.kind === 'anomaly')).toHaveLength(0);
    const all = engine.list({ limit: 10 }).filter((a) => a.kind === 'anomaly');
    expect(all).toHaveLength(1);
    expect(all[0]!.resolved_by).toBe('sistema');
  });
});

describe('ventana de agregación', () => {
  it('elige ventanas razonables según el rango', () => {
    const h = 3600_000;
    expect(pickWindow(0, h)).toBe('10s');
    expect(pickWindow(0, 24 * h)).toBe('300s');
    expect(pickWindow(0, 5 * 24 * h)).toBe('900s');
  });
});
