/**
 * DEV11 bajo demanda: puente entre la web y el controlador de la VM (firmware/dev11-esp32/vm/controller.py).
 *   GET  /api/dev11         estado (público)
 *   POST /api/dev11/start   enciende el simulador (operador)
 *   POST /api/dev11/stop    lo apaga (operador)
 *   POST /api/dev11/ping    «hay alguien mirando»: renueva el arriendo (público, limitado por IP)
 * Sin DEV11_CTL_URL la función no existe (`available: false`) y el resto de la app no cambia.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface Dev11Status {
  available: boolean;
  running: boolean;
  lease_s: number;
  max_s: number;
}

export class Dev11Client {
  constructor(
    private readonly url: string | undefined,
    private readonly token: string | undefined,
    private readonly timeoutMs = 4000,
  ) {}

  get available() {
    return !!this.url && !!this.token;
  }

  private async call(method: 'GET' | 'POST', path: string): Promise<Dev11Status> {
    if (!this.available) return { available: false, running: false, lease_s: 0, max_s: 0 };
    const res = await fetch(new URL(path, this.url), { method, headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`controlador DEV11: HTTP ${res.status}`);
    const b = (await res.json()) as { running: boolean; lease_s: number; max_s: number };
    return { available: true, running: !!b.running, lease_s: b.lease_s ?? 0, max_s: b.max_s ?? 0 };
  }

  status = () => this.call('GET', '/status');
  start = () => this.call('POST', '/start');
  stop = () => this.call('POST', '/stop');
  ping = () => this.call('POST', '/ping');
}

export function registerDev11Routes(app: FastifyInstance, dev: Dev11Client, requireOperator: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  const safe = async (reply: FastifyReply, fn: () => Promise<Dev11Status>) => {
    try {
      return await fn();
    } catch (err) {
      reply.log.warn({ err: (err as Error).message }, 'Controlador DEV11');
      return reply.status(502).send({ error: 'El controlador de DEV11 no responde' });
    }
  };
  app.get('/api/dev11', async (_req, reply) => safe(reply, dev.status));
  app.post('/api/dev11/start', { preHandler: requireOperator, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (_req, reply) => safe(reply, dev.start));
  app.post('/api/dev11/stop', { preHandler: requireOperator, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (_req, reply) => safe(reply, dev.stop));
  app.post('/api/dev11/ping', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (_req, reply) => safe(reply, dev.ping));
}
