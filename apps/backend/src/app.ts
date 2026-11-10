/**
 * Construcción de la aplicación Fastify: rutas REST, WebSocket, autenticación y límites.
 * Lectura pública (dashboard de solo lectura); órdenes y gestión de alertas exigen JWT.
 */
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { COMMAND_ACTIONS, DEVICE_CATALOG, DEVICE_IDS, INCIDENT_SEVERITIES, INCIDENT_TYPES, isDeviceId, type DeviceId } from '@scbga/shared';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { registerAiRoutes } from './ai/routes.js';
import { registerDev11Routes, type Dev11Client } from './dev11.js';
import type { AiService } from './ai/service.js';
import type { AlertEngine } from './alerts.js';
import { safeEqual, verifyPassword } from './auth.js';
import type { Db } from './db.js';
import type { Env } from './env.js';
import type { Hub } from './hub.js';
import { HistoryUnavailableError, type InfluxService } from './influx.js';
import { CommandError, type MqttBridge } from './mqttBridge.js';
import type { LiveState } from './state.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: 'operator' };
    user: { sub: string; role: 'operator' };
  }
}

export interface AppDeps {
  env: Env;
  db: Db;
  live: LiveState;
  alerts: AlertEngine;
  bridge: MqttBridge;
  influx: InfluxService;
  hub: Hub;
  ai?: AiService;
  /** DEV11 bajo demanda (opcional: sin controlador la función no existe). */
  dev11?: Dev11Client;
}

const MAX_RANGE_MS = 90 * 24 * 3600_000;
const MAX_WS_CLIENTS = 200;
const WS_HEARTBEAT_MS = 20_000;
const HEARTBEAT = JSON.stringify({ type: 'heartbeat', data: {} });

const RangeQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  points: z.coerce.number().int().min(10).max(2000).default(600),
});

function parseRange(q: unknown) {
  const r = RangeQuery.safeParse(q);
  if (!r.success) throw new HttpError(400, 'Parámetros de rango inválidos (use ISO 8601)');
  const to = r.data.to ? new Date(r.data.to) : new Date();
  const from = r.data.from ? new Date(r.data.from) : new Date(to.getTime() - 24 * 3600_000);
  if (from >= to) throw new HttpError(400, '"from" debe ser anterior a "to"');
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new HttpError(400, 'El rango máximo es de 90 días');
  return { from, to, points: r.data.points };
}

/** Límite de filas de un listado: entero entre 1 y 200 (50 si falta o no es un número). */
function listLimit(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(200, n) : 50;
}

class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

function deviceParam(id: string): DeviceId {
  if (!isDeviceId(id)) throw new HttpError(404, 'Dispositivo no encontrado');
  return id;
}

function numericVariable(device: DeviceId, variable: string) {
  const v = DEVICE_CATALOG[device].variables.find((x) => x.key === variable);
  if (!v || v.kind !== 'number') throw new HttpError(404, `Variable no numérica o inexistente para ${device}`);
  return v;
}

export async function buildApp(deps: AppDeps) {
  const { env, db, live, alerts, bridge, influx, hub } = deps;
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.body.password'],
    },
    // Solo un salto de confianza (nginx). Con `true` se tomaría la IP más a la izquierda de
    // X-Forwarded-For, que la controla el cliente, y el límite de intentos de login se podría esquivar.
    trustProxy: (_address: string, hop: number) => hop === 0,
    bodyLimit: 16 * 1024,
  });

  if (env.CORS_ORIGIN) await app.register(cors, { origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: false });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => new HttpError(ctx.statusCode, `Demasiadas solicitudes seguidas. Espera ${Math.ceil(ctx.ttl / 1000)} s e inténtalo de nuevo.`),
  });
  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: env.JWT_TTL } });
  await app.register(websocket, { options: { maxPayload: 1024 } });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    // Estos errores llevan un mensaje escrito para el usuario, también cuando son 5xx (dependencia caída).
    const deliberate = err instanceof HttpError || err instanceof CommandError || err instanceof HistoryUnavailableError;
    const status = err.statusCode ?? 500;
    if (status >= 500 && !deliberate) req.log.error({ err }, 'Error interno');
    else if (status >= 500) req.log.warn({ msg: err.message }, 'Dependencia no disponible');
    reply.status(status).send({ error: deliberate || status < 500 ? err.message : 'Error interno del servidor' });
  });

  const requireOperator = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Se requiere iniciar sesión como operador' });
    }
  };

  /* ------------------------------ salud y autenticación ------------------------------ */

  app.get('/api/health', async () => {
    const influxOk = await influx.ping();
    let dbOk = true;
    try {
      db.prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    return {
      status: bridge.connected && influxOk && dbOk ? 'ok' : 'degraded',
      mqtt: bridge.connected,
      influxdb: influxOk,
      sqlite: dbOk,
      uptime_s: Math.round(process.uptime()),
      mqtt_messages: bridge.stats,
    };
  });

  // Un único operador: el usuario es opcional (por defecto ADMIN_USER); la contraseña es obligatoria.
  const LoginBody = z.object({ username: z.string().min(1).max(64).optional(), password: z.string().min(1).max(256) });
  app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Contraseña requerida' });
    const body = { data: { username: parsed.data.username ?? env.ADMIN_USER, password: parsed.data.password } };
    const userOk = safeEqual(body.data.username, env.ADMIN_USER);
    const passOk = verifyPassword(body.data.password, env.ADMIN_PASSWORD_HASH);
    if (!userOk || !passOk) {
      req.log.warn({ user: body.data.username }, 'Inicio de sesión fallido');
      return reply.status(401).send({ error: 'Credenciales inválidas' });
    }
    const token = app.jwt.sign({ sub: env.ADMIN_USER, role: 'operator' });
    return { token, user: env.ADMIN_USER, expires_in: env.JWT_TTL };
  });

  app.get('/api/auth/me', { preHandler: requireOperator }, async (req) => ({ user: req.user.sub, role: req.user.role }));

  /* ------------------------------ dispositivos ------------------------------ */

  app.get('/api/catalog', async () => DEVICE_IDS.map((id) => DEVICE_CATALOG[id]));
  app.get('/api/devices', async () => live.all());
  app.get<{ Params: { id: string } }>('/api/devices/:id', async (req) => live.view(deviceParam(req.params.id)));

  const CommandBody = z.object({ action: z.enum(COMMAND_ACTIONS), params: z.record(z.string(), z.unknown()).default({}) });
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/commands',
    { preHandler: requireOperator, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const id = deviceParam(req.params.id);
      const body = CommandBody.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: 'Orden inválida: se requiere "action" y "params"' });
      const rec = await bridge.sendCommand(id, body.data.action, body.data.params, req.user.sub);
      const code = rec.status === 'confirmed' ? 200 : rec.status === 'rejected' ? 422 : 504;
      return reply.status(code).send(rec);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/devices/:id/commands', async (req) =>
    bridge.listCommands(deviceParam(req.params.id), listLimit(req.query.limit)),
  );
  app.get<{ Querystring: { limit?: string } }>('/api/commands', async (req) => bridge.listCommands(undefined, listLimit(req.query.limit)));

  /* ------------------------------ histórico ------------------------------ */

  app.get<{ Params: { id: string; variable: string } }>('/api/history/:id/:variable', async (req) => {
    const id = deviceParam(req.params.id);
    const v = numericVariable(id, req.params.variable);
    const { from, to, points } = parseRange(req.query);
    const s = await influx.series(id, v.key, from, to, points);
    return { device_id: id, variable: v.key, unit: v.unit, from, to, ...s };
  });

  app.get<{ Params: { id: string; variable: string } }>('/api/stats/:id/:variable', async (req) => {
    const id = deviceParam(req.params.id);
    const v = numericVariable(id, req.params.variable);
    const { from, to } = parseRange(req.query);
    return { device_id: id, variable: v.key, unit: v.unit, from, to, synthetic: live.view(id).live?.telemetry?.provenance.synthetic ?? DEVICE_CATALOG[id].provenance.synthetic, ...(await influx.stats(id, v.key, from, to)) };
  });

  app.get<{ Querystring: { series?: string } }>('/api/compare', async (req) => {
    if (typeof req.query.series !== 'undefined' && typeof req.query.series !== 'string') throw new HttpError(400, 'Indique las series en un solo parámetro, separadas por comas');
    const list = (req.query.series ?? '').split(',').filter(Boolean);
    if (list.length < 1 || list.length > 4) throw new HttpError(400, 'Indique entre 1 y 4 series con el formato DEV01.temperature');
    const { from, to, points } = parseRange(req.query);
    const out = await Promise.all(
      list.map(async (s) => {
        const [dev, variable] = s.split('.');
        const id = deviceParam(dev ?? '');
        const v = numericVariable(id, variable ?? '');
        const series = await influx.series(id, v.key, from, to, points);
        return { key: `${id}.${v.key}`, device_id: id, variable: v.key, label: `${DEVICE_CATALOG[id].name} · ${v.label}`, unit: v.unit, ...series };
      }),
    );
    return { from, to, series: out };
  });

  app.get('/api/capture', async (req) => {
    const { from, to } = parseRange(req.query);
    const [readings, availability] = await Promise.all([influx.readingCounts(from, to), influx.availability(from, to)]);
    return { from, to, readings, availability };
  });

  /* ------------------------------ alertas ------------------------------ */

  const AlertQuery = z.object({
    status: z.enum(['abierta', 'reconocida', 'resuelta', 'activas']).optional(),
    device: z.enum(DEVICE_IDS).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  });
  app.get('/api/alerts', async (req) => {
    const q = AlertQuery.safeParse(req.query);
    if (!q.success) throw new HttpError(400, 'Filtro de alertas inválido');
    return alerts.list(q.data);
  });
  app.get('/api/alerts/summary', async () => alerts.counts());

  for (const [path, to] of [['ack', 'reconocida'], ['resolve', 'resuelta']] as const) {
    app.post<{ Params: { id: string } }>(`/api/alerts/:id/${path}`, { preHandler: requireOperator }, async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Identificador inválido' });
      const row = alerts.transition(id, to, req.user.sub);
      if (!row) return reply.status(404).send({ error: 'Alerta no encontrada o ya resuelta' });
      return row;
    });
  }

  /* ------------------------------ incidentes sintéticos ------------------------------ */

  const IncQuery = z.object({ scope: z.enum(['active', 'recent']).default('active'), limit: z.coerce.number().int().min(1).max(500).default(50) });
  app.get('/api/incidents', async (req) => {
    const q = IncQuery.safeParse(req.query);
    if (!q.success) throw new HttpError(400, 'Filtro inválido');
    const rows = (q.data.scope === 'active'
      ? db.prepare(`SELECT data FROM incidents WHERE state!='resuelto' ORDER BY started_at DESC LIMIT ?`).all(q.data.limit)
      : db.prepare('SELECT data FROM incidents ORDER BY started_at DESC LIMIT ?').all(q.data.limit)) as { data: string }[];
    return { synthetic: true, notice: 'Incidentes simulados: no son reportes reales', items: rows.map((r) => JSON.parse(r.data)) };
  });

  app.get('/api/incidents/stats', async (req) => {
    const { from, to } = parseRange(req.query);
    const args = [from.toISOString(), to.toISOString()];
    const where = 'started_at >= ? AND started_at < ? AND test = 0';
    const byType = db.prepare(`SELECT type, COUNT(*) n FROM incidents WHERE ${where} GROUP BY type`).all(...args);
    const bySeverity = db.prepare(`SELECT severity, COUNT(*) n FROM incidents WHERE ${where} GROUP BY severity`).all(...args);
    // Hora local de Bogotá (UTC−5) para el perfil horario.
    const byHour = db
      .prepare(`SELECT CAST(strftime('%H', datetime(started_at, '-5 hours')) AS INTEGER) hour, COUNT(*) n FROM incidents WHERE ${where} GROUP BY hour ORDER BY hour`)
      .all(...args);
    const duration = db
      .prepare(`SELECT type, AVG((julianday(resolved_at) - julianday(started_at)) * 1440) avg_min FROM incidents WHERE ${where} AND resolved_at IS NOT NULL GROUP BY type`)
      .all(...args);
    return { from, to, synthetic: true, types: INCIDENT_TYPES, severities: INCIDENT_SEVERITIES, byType, bySeverity, byHour, duration };
  });

  /* ------------------------------ asistente IA ------------------------------ */

  if (deps.ai) registerAiRoutes(app, deps.ai, requireOperator);
  if (deps.dev11) registerDev11Routes(app, deps.dev11, requireOperator);

  /* ------------------------------ WebSocket (solo lectura) ------------------------------ */

  let wsClients = 0;
  app.get('/ws', { websocket: true }, (socket) => {
    if (wsClients >= MAX_WS_CLIENTS) {
      socket.close(1013, 'Demasiadas conexiones');
      return;
    }
    wsClients++;
    const unsubscribe = hub.subscribe((ev) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(ev));
    });
    // Ping de protocolo (mantiene vivos los proxies) y latido de aplicación (el navegador no ve los pings:
    // con el latido detecta un servidor colgado que deja la conexión abierta sin enviar nada).
    const ping = setInterval(() => {
      if (socket.readyState !== socket.OPEN) return;
      socket.ping();
      socket.send(HEARTBEAT);
    }, WS_HEARTBEAT_MS);
    socket.on('message', () => {}); // canal de solo lectura: se ignoran mensajes entrantes
    socket.on('close', () => {
      wsClients--;
      clearInterval(ping);
      unsubscribe();
    });
  });

  return app;
}
