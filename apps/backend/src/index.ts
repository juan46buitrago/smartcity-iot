import { pino } from 'pino';
import { AlertEngine } from './alerts.js';
import { buildApp } from './app.js';
import { openDb } from './db.js';
import { loadEnv } from './env.js';
import { Hub } from './hub.js';
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

const app = await buildApp({ env, db, live, alerts, bridge, influx, hub });
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
