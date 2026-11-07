import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { svc: 'devices' },
  // Nunca registrar credenciales aunque aparezcan por error en un objeto.
  redact: { paths: ['*.password', '*.pass', '*.authorization', 'headers.authorization'], censor: '[oculto]' },
});
export type Logger = typeof logger;
