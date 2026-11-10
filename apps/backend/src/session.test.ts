import { randomBytes, scryptSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type AppDeps } from './app.js';
import { openDb } from './db.js';
import { loadEnv } from './env.js';

const salt = randomBytes(16);
const baseEnv = {
  MQTT_PASS_BACKEND: 'x'.repeat(16),
  INFLUX_READ_TOKEN: 'y'.repeat(16),
  JWT_SECRET: 'z'.repeat(40),
  ADMIN_PASSWORD_HASH: ['scrypt', 16384, 8, 1, salt.toString('base64url'), scryptSync('clave', salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64url')].join(':'),
  LOG_LEVEL: 'silent',
};

let app: Awaited<ReturnType<typeof buildApp>> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function build(env = loadEnv(baseEnv)) {
  const stub = {} as never;
  app = await buildApp({ env, db: openDb(':memory:'), live: stub, alerts: stub, bridge: stub, influx: stub, hub: stub } as AppDeps);
  return app;
}

async function login(a: Awaited<ReturnType<typeof build>>) {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'clave' } });
  return res.json() as { token: string; expires_in: string };
}

describe('sesión de operador', { timeout: 30_000 }, () => {
  it('por defecto la sesión dura 12 horas', async () => {
    const a = await build();
    const { token, expires_in } = await login(a);
    expect(expires_in).toBe('12h');
    const payload = a.jwt.decode<{ iat: number; exp: number }>(token)!;
    expect(payload.exp - payload.iat).toBe(12 * 3600);
  });

  it('cerrar sesión anula el token en el servidor', async () => {
    const a = await build();
    const { token } = await login(a);
    const auth = { authorization: `Bearer ${token}` };
    expect((await a.inject({ url: '/api/auth/me', headers: auth })).statusCode).toBe(200);
    expect((await a.inject({ method: 'POST', url: '/api/auth/logout', headers: auth })).statusCode).toBe(204);
    expect((await a.inject({ url: '/api/auth/me', headers: auth })).statusCode).toBe(401);
  });

  it('cerrar una sesión no anula las demás', async () => {
    const a = await build();
    const first = await login(a);
    const second = await login(a);
    await a.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${first.token}` } });
    expect((await a.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${second.token}` } })).statusCode).toBe(200);
  });

  it('un token firmado sin identificador (emitido antes de este cambio) ya no vale', async () => {
    const a = await build();
    const legacy = a.jwt.sign({ sub: 'operador', role: 'operator' });
    expect((await a.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${legacy}` } })).statusCode).toBe(401);
  });

  it('cerrar sesión sin token responde 401', async () => {
    const a = await build();
    expect((await a.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(401);
  });
});
