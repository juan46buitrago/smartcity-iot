import { pino } from 'pino';
import { OpenAiCompatClient } from './ai/client.js';
import { AiService } from './ai/service.js';
import { AlertEngine } from './alerts.js';
import { buildApp } from './app.js';
import { openDb } from './db.js';
import { loadEnv } from './env.js';
import { Hub } from './hub.js';
import { Dev11Client } from './dev11.js';
import { InfluxService } from './influx.js';
import { MqttBridge } from './mqttBridge.js';
import { LiveState } from './state.js';

const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL, base: { svc: 'backend' } });
const db = openDb(env.DB_FILE);
const hub = new Hub();
const live = new LiveState(db);
const alerts = new AlertEngine(db, hub, env.OFFLINE_ALERT_AFTER_S);
const influx = new InfluxService({
  url: env.INFLUX_URL,
  token: env.INFLUX_READ_TOKEN,
  org: env.INFLUX_ORG,
  bucketRaw: env.INFLUX_BUCKET_RAW,
  bucketAgg: env.INFLUX_BUCKET_AGG,
});
const bridge = new MqttBridge(
  { url: env.MQTT_URL, password: env.MQTT_PASS_BACKEND, commandTimeoutMs: env.COMMAND_TIMEOUT_MS },
  db,
  live,
  alerts,
  hub,
  log.child({ mod: 'mqtt' }),
);

const llm = env.AI_API_KEY
  ? new OpenAiCompatClient({ baseUrl: env.AI_BASE_URL, apiKey: env.AI_API_KEY, model: env.AI_MODEL, timeoutMs: env.AI_TIMEOUT_MS })
  : null;
if (!llm) log.warn('AI_API_KEY no definida: asistente IA deshabilitado');
const ai = new AiService(llm, { data: influx, live, alerts, db }, db, { dailyMaxCalls: env.AI_DAILY_MAX_CALLS });

const dev11 = new Dev11Client(env.DEV11_CTL_URL, env.DEV11_CTL_TOKEN);
const app = await buildApp({ env, db, live, alerts, bridge, influx, hub, ai, dev11: dev11.available ? dev11 : undefined });
bridge.start();
await app.listen({ port: env.PORT, host: env.HOST });

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  log.info({ signal }, 'Cerrando backend');
  await app.close();
  await bridge.stop();
  db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
