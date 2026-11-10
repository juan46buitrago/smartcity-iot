import { randomBytes, scryptSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type AppDeps } from './app.js';
import { CircuitBreaker, CircuitOpenError } from './circuitBreaker.js';
import { openDb } from './db.js';
import { loadEnv } from './env.js';
import { HistoryUnavailableError, InfluxService } from './influx.js';
import { CommandError } from './mqttBridge.js';

const outage = () => Promise.reject(new Error('conexión rechazada'));

describe('cortacircuitos', () => {
  function breaker(clock = { t: 0 }) {
    return new CircuitBreaker({ failureThreshold: 2, openMs: 1000, now: () => clock.t });
  }

  it('deja pasar resultados y errores mientras está cerrado', async () => {
    const b = breaker();
    await expect(b.run(async () => 7)).resolves.toBe(7);
    await expect(b.run(outage)).rejects.toThrow('conexión rechazada');
  });

  it('se abre tras los fallos consecutivos y deja de llamar a la dependencia', async () => {
    const b = breaker();
    await b.run(outage).catch(() => {});
    await b.run(outage).catch(() => {});
    const call = vi.fn(async () => 1);
    await expect(b.run(call)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(call).not.toHaveBeenCalled();
  });

  it('un éxito reinicia la cuenta de fallos', async () => {
    const b = breaker();
    await b.run(outage).catch(() => {});
    await b.run(async () => 1);
    await b.run(outage).catch(() => {});
    await expect(b.run(async () => 2)).resolves.toBe(2);
  });

  it('pasado el tiempo prueba de nuevo y se cierra si la dependencia volvió', async () => {
    const clock = { t: 0 };
    const b = breaker(clock);
    await b.run(outage).catch(() => {});
    await b.run(outage).catch(() => {});
    clock.t = 1001;
    await expect(b.run(async () => 'ok')).resolves.toBe('ok');
    await expect(b.run(async () => 'sigue')).resolves.toBe('sigue');
  });

  it('si la prueba falla vuelve a abrirse', async () => {
    const clock = { t: 0 };
    const b = breaker(clock);
    await b.run(outage).catch(() => {});
    await b.run(outage).catch(() => {});
    clock.t = 1001;
    await b.run(outage).catch(() => {});
    await expect(b.run(async () => 1)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('durante la prueba solo pasa una petición', async () => {
    const clock = { t: 0 };
    const b = breaker(clock);
    await b.run(outage).catch(() => {});
    await b.run(outage).catch(() => {});
    clock.t = 1001;
    let release!: (v: string) => void;
    const trial = b.run(() => new Promise<string>((r) => (release = r)));
    await expect(b.run(async () => 'segunda')).rejects.toBeInstanceOf(CircuitOpenError);
    release('primera');
    await expect(trial).resolves.toBe('primera');
  });

  it('no cuenta los errores que no indican caída', async () => {
    const b = new CircuitBreaker({ failureThreshold: 1, openMs: 1000, isFailure: () => false });
    await b.run(outage).catch(() => {});
    await expect(b.run(async () => 1)).resolves.toBe(1);
  });
});

describe('InfluxService ante caídas', () => {
  const cfg = { url: 'http://influx', token: 't', org: 'o', bucketRaw: 'raw', bucketAgg: 'agg' };
  const period = [new Date(Date.now() - 3600_000), new Date()] as const;

  it('una caída de InfluxDB se informa como histórico no disponible', async () => {
    const query = { collectRows: vi.fn(outage) };
    const influx = new InfluxService(cfg, { query: query as never });
    await expect(influx.series('DEV03', 'noise_db', ...period)).rejects.toBeInstanceOf(HistoryUnavailableError);
  });

  it('tras varias caídas responde al instante sin consultar', async () => {
    const query = { collectRows: vi.fn(outage) };
    const influx = new InfluxService(cfg, { query: query as never, breaker: { failureThreshold: 2, openMs: 60_000 } });
    for (let i = 0; i < 2; i++) await influx.series('DEV03', 'noise_db', ...period).catch(() => {});
    expect(query.collectRows).toHaveBeenCalledTimes(2);
    await expect(influx.series('DEV03', 'noise_db', ...period)).rejects.toBeInstanceOf(HistoryUnavailableError);
    expect(query.collectRows).toHaveBeenCalledTimes(2);
  });

  it('un error 4xx de la consulta no se confunde con una caída', async () => {
    const query = { collectRows: vi.fn(() => Promise.reject(Object.assign(new Error('flux inválido'), { statusCode: 400 }))) };
    const influx = new InfluxService(cfg, { query: query as never, breaker: { failureThreshold: 1, openMs: 60_000 } });
    await expect(influx.series('DEV03', 'noise_db', ...period)).rejects.toThrow('flux inválido');
    await expect(influx.series('DEV03', 'noise_db', ...period)).rejects.toThrow('flux inválido');
    expect(query.collectRows).toHaveBeenCalledTimes(2);
  });
});

// Cada caso arma la aplicación completa: en contenedores lentos tarda más que el límite por defecto (5 s).
describe('errores de la API', { timeout: 30_000 }, () => {
  const salt = randomBytes(16);
  const env = loadEnv({
    MQTT_PASS_BACKEND: 'x'.repeat(16),
    INFLUX_READ_TOKEN: 'y'.repeat(16),
    JWT_SECRET: 'z'.repeat(40),
    ADMIN_PASSWORD_HASH: ['scrypt', 16384, 8, 1, salt.toString('base64url'), scryptSync('pw', salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64url')].join(':'),
    LOG_LEVEL: 'silent',
  });
  const stub = {} as never;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  const build = async (deps: Partial<AppDeps>) => (app = await buildApp({ env, db: openDb(':memory:'), live: stub, alerts: stub, bridge: stub, influx: stub, hub: stub, ...deps } as AppDeps));

  it('el histórico caído responde 503 con un mensaje útil', async () => {
    const a = await build({ influx: { series: () => Promise.reject(new HistoryUnavailableError()) } as never });
    const res = await a.inject({ url: '/api/history/DEV03/noise_db' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/histórico no está disponible/i);
  });

  it('un 503 deliberado conserva su mensaje', async () => {
    const a = await build({
      bridge: { sendCommand: () => Promise.reject(new CommandError(503, 'El backend no está conectado al broker MQTT')) } as never,
    });
    const res = await a.inject({
      method: 'POST',
      url: '/api/devices/DEV03/commands',
      headers: { authorization: `Bearer ${a.jwt.sign({ sub: 'operador', role: 'operator', jti: 'prueba' })}` },
      payload: { action: 'set_interval', params: { interval_s: 10 } },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('El backend no está conectado al broker MQTT');
  });

  it('un fallo inesperado no revela detalles internos', async () => {
    const a = await build({ influx: { series: () => Promise.reject(new Error('detalle secreto de la base')) } as never });
    const res = await a.inject({ url: '/api/history/DEV03/noise_db' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('Error interno del servidor');
  });

  it.each(['1.5', '0.5', '1e-7', '-3', 'abc', '99999'])('limit=%s en órdenes se convierte en un entero válido', async (limit) => {
    const seen: number[] = [];
    const a = await build({ bridge: { listCommands: (_d: unknown, n: number) => (seen.push(n), []) } as never });
    const res = await a.inject({ url: `/api/commands?limit=${limit}` });
    expect(res.statusCode).toBe(200);
    expect(Number.isInteger(seen[0])).toBe(true);
    expect(seen[0]).toBeGreaterThanOrEqual(1);
    expect(seen[0]).toBeLessThanOrEqual(200);
  });

  it('series repetida en /api/compare responde 400, no 500', async () => {
    const a = await build({ influx: { series: async () => ({ every: '60s', bucket: 'raw', points: [] }) } as never });
    const res = await a.inject({ url: '/api/compare?series=DEV01.temperature&series=DEV01.humidity' });
    expect(res.statusCode).toBeLessThan(500);
  });

  it('el límite de intentos se explica en español', async () => {
    const a = await build({});
    let last = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'mal' } });
    for (let i = 0; i < 5; i++) last = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'mal' } });
    expect(last.statusCode).toBe(429);
    expect(last.json().error).toMatch(/demasiad/i);
    expect(last.json().error).not.toMatch(/rate limit/i);
  });
});
