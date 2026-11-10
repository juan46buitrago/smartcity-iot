import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  DB_FILE: z.string().default('./data/smartcity.sqlite'),

  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  MQTT_PASS_BACKEND: z.string().min(8, 'MQTT_PASS_BACKEND es obligatoria'),

  INFLUX_URL: z.string().default('http://localhost:8086'),
  INFLUX_ORG: z.string().default('smartcitybga'),
  INFLUX_BUCKET_RAW: z.string().default('raw'),
  INFLUX_BUCKET_AGG: z.string().default('agg_5m'),
  INFLUX_READ_TOKEN: z.string().min(10, 'INFLUX_READ_TOKEN es obligatorio'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  // Sesión de operador corta: si un token se filtra, deja de servir en horas (además se revoca al cerrar sesión).
  JWT_TTL: z.string().default('12h'),
  ADMIN_USER: z.string().min(3).default('operador'),
  ADMIN_PASSWORD_HASH: z.string().regex(/^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/, 'ADMIN_PASSWORD_HASH con formato inválido'),
  CORS_ORIGIN: z.string().optional(),

  COMMAND_TIMEOUT_MS: z.coerce.number().int().default(10_000),
  OFFLINE_ALERT_AFTER_S: z.coerce.number().int().default(120),

  // Asistente IA (API compatible con OpenAI). Sin AI_API_KEY el asistente queda deshabilitado.
  AI_BASE_URL: z.string().url().default('https://api.b.ai/v1'),
  AI_API_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  AI_MODEL: z.string().default('qwen3.8-flash'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),
  AI_DAILY_MAX_CALLS: z.coerce.number().int().min(1).default(2000),

  // DEV11 bajo demanda: controlador en la VM (firmware/dev11-esp32/vm/controller.py). Ambos o ninguno.
  DEV11_CTL_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  DEV11_CTL_TOKEN: z.string().min(16).optional().or(z.literal('').transform(() => undefined)),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(src: NodeJS.ProcessEnv = process.env): Env {
  const res = EnvSchema.safeParse(src);
  if (!res.success) {
    const msg = res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuración inválida:\n  ${msg}`);
  }
  return res.data;
}
