/**
 * Rutas del asistente IA.
 *   GET  /api/ai/status            consumo de tokens y estado (público)
 *   POST /api/ai/chat              pregunta en lenguaje natural → texto + gráfica (público, 12/min/IP)
 *   GET  /api/ai/analysis          último análisis por dispositivo (público)
 *   POST /api/ai/analysis/:id      genera el análisis de comportamiento (operador)
 */
import { isDeviceId } from '@scbga/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { LlmError } from './client.js';
import { RouterError } from './router.js';
import { AiBudgetError, AiUnavailableError, type AiService } from './service.js';

const ChatBody = z.object({ question: z.string().trim().min(2).max(300) });
const AnalysisBody = z.object({ hours: z.coerce.number().int().min(1).max(24 * 14).default(144) }).default({ hours: 144 });

function aiErrorStatus(err: unknown): { code: number; msg: string } | null {
  if (err instanceof AiUnavailableError) return { code: 503, msg: err.message };
  if (err instanceof AiBudgetError) return { code: 429, msg: err.message };
  if (err instanceof RouterError) return { code: 502, msg: 'No entendí la pregunta; intenta reformularla.' };
  if (err instanceof LlmError) return { code: 502, msg: 'El proveedor de IA no respondió; intenta de nuevo en unos segundos.' };
  return null;
}

export function registerAiRoutes(
  app: FastifyInstance,
  ai: AiService,
  requireOperator: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  const handle = async <T>(reply: FastifyReply, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      const e = aiErrorStatus(err);
      if (!e) throw err;
      reply.log.warn({ err: (err as Error).message }, 'Asistente IA');
      return reply.status(e.code).send({ error: e.msg });
    }
  };

  app.get('/api/ai/status', async () => ai.usageSummary());

  app.post('/api/ai/chat', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = ChatBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Escribe una pregunta de 2 a 300 caracteres' });
    return handle(reply, () => ai.chat(body.data.question));
  });

  app.get('/api/ai/analysis', async () => ai.latestAnalyses());

  app.post<{ Params: { id: string } }>(
    '/api/ai/analysis/:id',
    { preHandler: requireOperator, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!isDeviceId(req.params.id)) return reply.status(404).send({ error: 'Dispositivo no encontrado' });
      const body = AnalysisBody.safeParse(req.body ?? {});
      if (!body.success) return reply.status(400).send({ error: 'Ventana inválida (1 a 336 horas)' });
      const id = req.params.id;
      return handle(reply, () => ai.analyze(id, body.data.hours));
    },
  );
}
