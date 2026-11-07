#!/usr/bin/env node
/**
 * Etapa 3 — Pruebas de integración contra el stack local en ejecución (docker compose).
 *
 *   node tests/integration/run.mjs            # todas (incluye reinicios y cortes de red)
 *   node tests/integration/run.mjs --safe     # solo las que no interrumpen servicios
 *
 * Lee secretos de .env y .local-credentials.txt SOLO en memoria; nunca los escribe en la evidencia
 * (al final se verifica que ningún secreto aparezca en el informe generado).
 * Evidencia: docs/evidencias/etapa3/integracion-<fecha>.{json,md}
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mqtt from 'mqtt';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAFE = process.argv.includes('--safe');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const WEB = 'http://127.0.0.1:8380';
const BROKER = 'mqtt://127.0.0.1:1883';
const INFLUX = 'http://127.0.0.1:8086';
const NET = 'smartcitybga_iot';
const DEVICES_CT = 'smartcitybga-devices-1';
const IDS = Array.from({ length: 10 }, (_, i) => `DEV${String(i + 1).padStart(2, '0')}`);

/* ------------------------------ entorno ------------------------------ */
function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const ENV = loadEnv('.env');
const OPERATOR = (() => {
  const line = readFileSync(join(ROOT, '.local-credentials.txt'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('OPERADOR_API'));
  const user = line.match(/usuario=(\S+)/)[1];
  const pass = line.match(/contraseña=\s*(\S+)/)[1];
  return { user, pass };
})();
const SECRETS = [...Object.entries(ENV).filter(([k, v]) => /PASS|TOKEN|SECRET|HASH/.test(k) && v.length >= 8).map(([, v]) => v), OPERATOR.pass];

/* ------------------------------ utilidades ------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const compose = (...args) => sh('docker', ['compose', ...args]);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Peticiones a la API. Si el limitador devuelve 429 en una orden, se respeta Retry-After y se reintenta
 *  (la batería envía más de 30 órdenes por minuto; el propio límite se verifica en SEC-08). */
async function http(path, opts = {}) {
  let r = await http1(path, opts);
  for (let i = 0; i < 3 && r.status === 429 && opts.method === 'POST' && path.includes('/commands') && !opts.noRetry; i++) {
    RATE_LIMITED++;
    await sleep((Number(r.headers.get('retry-after')) || 10) * 1000 + 500);
    r = await http1(path, opts);
  }
  return r;
}
let RATE_LIMITED = 0;

async function http1(path, { method = 'GET', token, body, base = WEB, headers = {} } = {}) {
  const t0 = performance.now();
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* no JSON */
  }
  return { status: res.status, headers: res.headers, json, text, ms: Math.round(performance.now() - t0) };
}

function connect(opts) {
  return new Promise((resolve) => {
    const c = mqtt.connect(BROKER, { protocolVersion: 5, reconnectPeriod: 0, connectTimeout: 5000, clean: true, clientId: `scbga-test-${randomUUID().slice(0, 8)}`, ...opts });
    const done = (r) => {
      c.removeAllListeners('connect');
      c.removeAllListeners('error');
      c.on('error', () => {});
      resolve(r);
    };
    c.once('connect', () => done({ ok: true, client: c }));
    c.once('error', (err) => {
      c.end(true);
      done({ ok: false, code: err.code, message: err.message });
    });
  });
}

/** Observador de solo lectura (credenciales de Node-RED: read smartcity/#). */
async function observer(topics) {
  const r = await connect({ username: 'nodered', password: ENV.MQTT_PASS_NODERED });
  assert(r.ok, `observador no conectó: ${r.message}`);
  const msgs = [];
  r.client.on('message', (topic, payload, packet) => {
    let json = null;
    try {
      json = JSON.parse(payload.toString());
    } catch {
      /* texto */
    }
    msgs.push({ topic, json, raw: payload.toString().slice(0, 200), retain: packet.retain, at: Date.now() });
  });
  await r.client.subscribeAsync(topics, { qos: 1 });
  return { client: r.client, msgs, until: (pred, ms) => waitFor(() => msgs.find(pred), ms), close: () => r.client.endAsync() };
}

async function waitFor(fn, ms, every = 250) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}

async function flux(query) {
  const res = await fetch(`${INFLUX}/api/v2/query?org=${encodeURIComponent(ENV.INFLUX_ORG)}`, {
    method: 'POST',
    headers: { authorization: `Token ${ENV.INFLUX_READ_TOKEN}`, 'content-type': 'application/vnd.flux', accept: 'application/csv' },
    body: query,
  });
  const text = await res.text();
  assert(res.ok, `Flux ${res.status}: ${text.slice(0, 200)}`);
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return [];
  const head = lines[0].split(',');
  return lines.slice(1).filter((l) => l !== lines[0]).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
}

async function telemetryTimes(device, field, startIso, stopIso = new Date(Date.now() + 1000).toISOString()) {
  const rows = await flux(
    `from(bucket:"${ENV.INFLUX_BUCKET_RAW}") |> range(start: ${startIso}, stop: ${stopIso}) |> filter(fn:(r)=> r._measurement=="telemetry" and r.device_id=="${device}" and r._field=="${field}") |> keep(columns:["_time"])`,
  );
  return rows.map((r) => Date.parse(r._time)).filter(Number.isFinite).sort((a, b) => a - b);
}
/** Hueco máximo (s) en [from, to] contando los bordes de la ventana: una pérdida al inicio o al final también cuenta. */
const maxGapS = (ts, from = ts[0], to = ts.at(-1)) => {
  const pts = [from, ...ts.filter((t) => t >= from && t <= to), to];
  return pts.length < 2 ? Infinity : Math.max(...pts.slice(1).map((t, i) => (t - pts[i]) / 1000));
};

async function waitHealthy(service, ms = 90_000) {
  return waitFor(() => {
    const id = compose('ps', '-q', service);
    if (!id) return false;
    const h = sh('docker', ['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', id]);
    return h === 'healthy' || h === 'running' ? h : false;
  }, ms, 1000);
}

async function devicesOnlineViaApi() {
  const r = await http('/api/devices');
  return r.json.filter((d) => d.live?.status?.connection === 'online' && !d.live.status.stale).map((d) => d.id);
}

let TOKEN = null;
async function login() {
  let r = await http('/api/auth/login', { method: 'POST', body: { username: OPERATOR.user, password: OPERATOR.pass } });
  // Si una ejecución anterior acaba de probar la fuerza bruta (SEC-07), el login sigue limitado: se espera.
  for (let i = 0; i < 2 && r.status === 429; i++) {
    console.log(`  … login limitado (429); espero ${r.headers.get('retry-after') || 60} s`);
    await sleep((Number(r.headers.get('retry-after')) || 60) * 1000 + 1000);
    r = await http('/api/auth/login', { method: 'POST', body: { username: OPERATOR.user, password: OPERATOR.pass } });
  }
  assert(r.status === 200 && r.json?.token, `login ${r.status}`);
  TOKEN = r.json.token;
}

/* ------------------------------ pruebas ------------------------------ */
const T = [];
const test = (id, area, name, fn, { disruptive = false } = {}) => T.push({ id, area, name, fn, disruptive });

// ---------- A. Infraestructura y exposición ----------
test('INF-01', 'Infraestructura', 'Los 7 servicios están en ejecución y los que tienen healthcheck están sanos', async () => {
  const rows = compose('ps', '--format', 'json').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const view = rows.map((r) => ({ servicio: r.Service, estado: r.State, salud: r.Health || '(sin healthcheck)' }));
  assert(rows.length === 7, `se esperaban 7 contenedores, hay ${rows.length}`);
  assert(rows.every((r) => r.State === 'running' && (!r.Health || r.Health === 'healthy')), 'algún servicio no está sano');
  return view;
});

test('INF-02', 'Infraestructura', '/api/health informa MQTT, InfluxDB y SQLite operativos', async () => {
  const r = await http('/api/health');
  assert(r.status === 200 && r.json.status === 'ok' && r.json.mqtt && r.json.influxdb && r.json.sqlite, JSON.stringify(r.json));
  return { status: r.status, body: r.json };
});

test('SEC-01', 'Seguridad', 'En local todos los puertos publicados están ligados solo a 127.0.0.1', async () => {
  const rows = compose('ps', '--format', 'json').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const pubs = rows.flatMap((r) => (r.Publishers || []).filter((p) => p.PublishedPort).map((p) => ({ servicio: r.Service, ip: p.URL, puerto: p.PublishedPort, destino: p.TargetPort })));
  assert(pubs.length > 0 && pubs.every((p) => p.ip === '127.0.0.1'), 'hay puertos expuestos fuera de loopback');
  return pubs;
});

test('SEC-02', 'Seguridad', 'En la configuración de producción (sin override) solo nginx publica puertos', async () => {
  const cfg = JSON.parse(compose('-f', 'docker-compose.yml', 'config', '--format', 'json'));
  const withPorts = Object.entries(cfg.services).filter(([, s]) => s.ports?.length).map(([n, s]) => ({ servicio: n, puertos: s.ports.map((p) => `${p.host_ip || '*'}:${p.published}->${p.target}`) }));
  assert(withPorts.every((w) => w.servicio === 'web'), `servicios con puertos: ${withPorts.map((w) => w.servicio).join(', ')}`);
  return { 'servicios con puertos publicados en docker-compose.yml': withPorts.length ? withPorts : 'ninguno', nota: 'Los puertos 80/443 de nginx se añadirán en la Etapa 4 (override de producción); MQTT, InfluxDB, Node-RED, Grafana y backend quedan solo en la red interna.' };
});

test('SEC-03', 'Seguridad', 'Nginx envía cabeceras de seguridad (CSP, anti-clickjacking, nosniff, referrer)', async () => {
  const r = await http('/');
  const h = Object.fromEntries(['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'server'].map((k) => [k, r.headers.get(k)]));
  assert(r.status === 200, `GET / ${r.status}`);
  assert(h['content-security-policy']?.includes("frame-ancestors 'none'") || h['x-frame-options'] === 'DENY', 'sin protección anti-clickjacking');
  assert(h['x-content-type-options'] === 'nosniff', 'sin nosniff');
  assert(h['content-security-policy'], 'sin CSP');
  return h;
});

test('SEC-04', 'Seguridad', 'Node-RED, Grafana e InfluxDB rechazan peticiones sin credenciales', async () => {
  const nr = await http('/nodered/flows');
  const gf = await http('/grafana/api/search');
  const ix = await http('/api/v2/buckets', { base: INFLUX });
  const out = { 'GET /nodered/flows': nr.status, 'GET /grafana/api/search': gf.status, 'GET influxdb /api/v2/buckets': ix.status };
  assert(nr.status === 401 && gf.status === 401 && ix.status === 401, JSON.stringify(out));
  return out;
});

test('SEC-05', 'Seguridad', 'El token de lectura de InfluxDB no puede escribir (mínimo privilegio)', async () => {
  const res = await fetch(`${INFLUX}/api/v2/write?org=${ENV.INFLUX_ORG}&bucket=${ENV.INFLUX_BUCKET_RAW}&precision=ms`, {
    method: 'POST',
    headers: { authorization: `Token ${ENV.INFLUX_READ_TOKEN}` },
    body: `prueba_minimo_privilegio,device_id=TEST v=1 ${Date.now()}`,
  });
  assert(res.status === 401 || res.status === 403 || res.status === 404, `escritura con token de lectura devolvió ${res.status}`);
  return { 'POST /api/v2/write con token de lectura': res.status };
});

test('SEC-06', 'Seguridad', 'Archivos con secretos ignorados por Git y ningún secreto en archivos versionables', async () => {
  const ignored = sh('git', ['check-ignore', '.env', '.local-credentials.txt']).split(/\r?\n/);
  const files = sh('git', ['ls-files', '--cached', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean);
  const leaks = [];
  for (const f of files) {
    if (!existsSync(join(ROOT, f))) continue;
    let content;
    try {
      content = readFileSync(join(ROOT, f), 'utf8');
    } catch {
      continue;
    }
    if (SECRETS.some((s) => content.includes(s))) leaks.push(f);
  }
  const postman = files.filter((f) => f.endsWith('.postman_collection.json'));
  assert(ignored.length === 2, 'algún archivo de secretos no está ignorado');
  assert(leaks.length === 0, `secretos encontrados en: ${leaks.join(', ')}`);
  assert(postman.length === 0, 'la colección Postman con claves antiguas sería versionada');
  return { ignorados: ignored, archivos_revisados: files.length, secretos_encontrados: leaks.length, coleccion_postman_versionada: false };
});

// ---------- B. API ----------
test('API-01', 'API', 'Login solo con contraseña: incorrecta → 401; correcta → JWT válido 30 días', async () => {
  const bad = await http('/api/auth/login', { method: 'POST', body: { password: 'incorrecta-' + randomUUID() } });
  const malformed = await http('/api/auth/login', { method: 'POST', body: {} });
  // La interfaz envía solo la contraseña (un único operador).
  const r = await http('/api/auth/login', { method: 'POST', body: { password: OPERATOR.pass } });
  assert(r.status === 200, `login ${r.status}`);
  TOKEN = r.json.token;
  const exp = JSON.parse(Buffer.from(TOKEN.split('.')[1], 'base64url')).exp * 1000;
  const days = (exp - Date.now()) / 86400_000;
  const me = await http('/api/auth/me', { token: TOKEN });
  assert(bad.status === 401 && malformed.status === 400 && me.status === 200 && days > 29.9 && days <= 30, `bad=${bad.status} malformed=${malformed.status} me=${me.status} días=${days}`);
  return { 'contraseña incorrecta': bad.status, 'sin contraseña': malformed.status, 'contraseña correcta': r.status, 'vigencia del token (días)': days.toFixed(2), 'GET /api/auth/me con JWT': me.status, usuario: me.json.user };
});

test('API-02', 'API', 'Endpoints de control protegidos: sin token, token falso o token alterado → 401', async () => {
  const body = { action: 'set_interval', params: { interval_s: 10 } };
  const none = await http('/api/devices/DEV03/commands', { method: 'POST', body });
  const fake = await http('/api/devices/DEV03/commands', { method: 'POST', body, token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.firma' });
  const [h, p, s] = TOKEN.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: 'atacante', role: 'admin' })).toString('base64url');
  const tampered = await http('/api/devices/DEV03/commands', { method: 'POST', body, token: `${h}.${forged}.${s}` });
  const ack = await http('/api/alerts/1/ack', { method: 'POST' });
  const out = { 'sin token': none.status, 'token inventado': fake.status, 'payload alterado': tampered.status, 'reconocer alerta sin token': ack.status };
  assert(Object.values(out).every((s) => s === 401), JSON.stringify(out));
  return out;
});

test('API-03', 'API', 'Validación de entradas: acción, parámetros, rango, dispositivo y variable', async () => {
  const cases = {
    'acción inexistente': await http('/api/devices/DEV03/commands', { method: 'POST', token: TOKEN, body: { action: 'rm_rf', params: {} } }),
    'intervalo fuera de rango (1 s)': await http('/api/devices/DEV03/commands', { method: 'POST', token: TOKEN, body: { action: 'set_interval', params: { interval_s: 1 } } }),
    'parámetro desconocido': await http('/api/devices/DEV03/commands', { method: 'POST', token: TOKEN, body: { action: 'set_params', params: { hack: 1 } } }),
    'acción no admitida por DEV09': await http('/api/devices/DEV09/commands', { method: 'POST', token: TOKEN, body: { action: 'set_mode', params: { mode: 'x' } } }),
    'dispositivo DEV99': await http('/api/devices/DEV99/commands', { method: 'POST', token: TOKEN, body: { action: 'power', params: { on: true } } }),
    'inyección Flux en variable': await http(`/api/history/DEV03/${encodeURIComponent('noise_db") |> drop(columns:["x"]')}`),
    'variable inexistente': await http('/api/history/DEV03/password'),
  };
  const out = Object.fromEntries(Object.entries(cases).map(([k, r]) => [k, `${r.status} ${r.json?.error ?? ''}`.trim()]));
  assert(Object.values(cases).every((r) => r.status >= 400 && r.status < 500), JSON.stringify(out));
  return out;
});

test('API-04', 'API', 'Histórico y estadísticas devuelven datos reales almacenados', async () => {
  const from = encodeURIComponent(new Date(Date.now() - 3600_000).toISOString());
  const h = await http(`/api/history/DEV03/noise_db?from=${from}`);
  const s = await http(`/api/stats/DEV03/noise_db?from=${from}`);
  const pts = Array.isArray(h.json) ? h.json : (h.json?.points ?? h.json?.data ?? []);
  assert(h.status === 200 && pts.length > 0, `histórico ${h.status} con ${pts.length} puntos`);
  assert(s.status === 200, `stats ${s.status}`);
  return { 'puntos última hora': pts.length, 'tiempo respuesta histórico (ms)': h.ms, estadisticas: s.json };
});

// ---------- C. Broker MQTT ----------
test('MQTT-01', 'MQTT', 'El broker rechaza conexiones anónimas y contraseñas incorrectas', async () => {
  const anon = await connect({});
  const wrong = await connect({ username: 'DEV01', password: 'incorrecta' });
  const ghost = await connect({ username: 'DEV99', password: 'x' });
  const out = { anonima: anon.ok ? 'ACEPTADA' : `rechazada (código ${anon.code})`, 'DEV01 contraseña incorrecta': wrong.ok ? 'ACEPTADA' : `rechazada (código ${wrong.code})`, 'usuario inexistente': ghost.ok ? 'ACEPTADA' : `rechazada (código ${ghost.code})` };
  for (const r of [anon, wrong, ghost]) if (r.ok) r.client.end(true);
  assert(!anon.ok && !wrong.ok && !ghost.ok, JSON.stringify(out));
  return out;
});

test('MQTT-02', 'MQTT', 'ACL: un dispositivo no puede escribir en tópicos de otro ni enviarse órdenes', async () => {
  const obs = await observer(['smartcity/DEV02/telemetry', 'smartcity/DEV01/control']);
  const dev = await connect({ username: 'DEV01', password: ENV.MQTT_PASS_DEV01 ?? loadDevPass('DEV01') });
  assert(dev.ok, `DEV01 no conectó: ${dev.message}`);
  const marker = `ACL-TEST-${randomUUID()}`; // texto no-JSON: aunque pasara, Node-RED lo descartaría
  const tryPub = async (topic) => {
    try {
      const p = await dev.client.publishAsync(topic, marker, { qos: 1 });
      return p?.reasonCode ?? 0;
    } catch (e) {
      return e.code ?? e.message;
    }
  };
  const rc1 = await tryPub('smartcity/DEV02/telemetry');
  const rc2 = await tryPub('smartcity/DEV01/control');
  await sleep(2500);
  const leaked = obs.msgs.filter((m) => m.raw.includes(marker));
  await dev.client.endAsync();
  await obs.close();
  const out = { 'DEV01 → smartcity/DEV02/telemetry (PUBACK)': rc1, 'DEV01 → smartcity/DEV01/control (PUBACK)': rc2, 'mensajes que llegaron a suscriptores': leaked.length };
  assert(leaked.length === 0, 'el broker entregó un mensaje no autorizado');
  return { ...out, nota: 'Código 135 = Not authorized (MQTT 5)' };
});

test('MQTT-03', 'MQTT', 'ACL: un dispositivo no puede leer la telemetría ni las órdenes de otros', async () => {
  const dev = await connect({ username: 'DEV01', password: loadDevPass('DEV01') });
  assert(dev.ok, `DEV01 no conectó: ${dev.message}`);
  const got = [];
  dev.client.on('message', (t) => got.push(t));
  const sub = await dev.client.subscribeAsync(['smartcity/+/telemetry', 'smartcity/DEV05/control', '#'], { qos: 1 });
  await sleep(12_000); // DEV03, DEV05, DEV07… publican cada ≤10 s
  await dev.client.endAsync();
  const foreign = got.filter((t) => !t.startsWith('smartcity/DEV01/'));
  assert(foreign.length === 0, `DEV01 recibió ${foreign.length} mensajes ajenos`);
  return { 'suscripciones solicitadas': ['smartcity/+/telemetry', 'smartcity/DEV05/control', '#'], 'SUBACK': sub.map((s) => s.qos), 'mensajes ajenos recibidos en 12 s': foreign.length };
});

function loadDevPass(id) {
  if (ENV[`MQTT_PASS_${id}`]) return ENV[`MQTT_PASS_${id}`];
  throw new Error(`MQTT_PASS_${id} no está en .env`);
}

// ---------- D. Control bidireccional ----------
test('CTL-01', 'Control', 'Orden → ack → config retenida en los 10 dispositivos (vía API)', async () => {
  const obs = await observer(IDS.map((d) => `smartcity/${d}/config`));
  await sleep(1500); // configs retenidas
  const rows = [];
  for (const id of IDS) {
    const dev = (await http(`/api/devices/${id}`)).json;
    const interval = dev.live.config.interval_s;
    const before = dev.live.config.version;
    const target = interval + 1 <= dev.interval.max ? interval + 1 : interval - 1;
    const t0 = Date.now();
    const r = await http(`/api/devices/${id}/commands`, { method: 'POST', token: TOKEN, body: { action: 'set_interval', params: { interval_s: target } } });
    const cfg = await obs.until((m) => m.topic === `smartcity/${id}/config` && m.at >= t0 && m.json?.version === r.json?.config_version && m.json?.interval_s === target, 5000);
    const back = await http(`/api/devices/${id}/commands`, { method: 'POST', token: TOKEN, body: { action: 'set_interval', params: { interval_s: interval } } });
    rows.push({
      dispositivo: id,
      http: r.status,
      estado: r.json?.status,
      'ida y vuelta (ms)': r.ms,
      'intervalo s': `${interval}→${target}→${interval}`,
      'versión config': `${before}→${r.json?.config_version}→${back.json?.config_version}`,
      'config retenida publicada': !!cfg && cfg.json.interval_s === target,
      'reversión confirmada': back.json?.status === 'confirmed',
    });
  }
  await obs.close();
  assert(rows.every((r) => r.http === 200 && r.estado === 'confirmed' && r['config retenida publicada'] && r['reversión confirmada']), 'alguna orden no se confirmó: ' + JSON.stringify(rows.filter((r) => !(r.http === 200 && r.estado === 'confirmed' && r['config retenida publicada']))));
  const ms = rows.map((r) => r['ida y vuelta (ms)']).sort((a, b) => a - b);
  return { filas: rows, 'mediana (ms)': ms[Math.floor(ms.length / 2)], 'máximo (ms)': ms.at(-1) };
});

test('CTL-02', 'Control', 'Apagar/encender DEV03 detiene y reanuda realmente la telemetría', async () => {
  const obs = await observer(['smartcity/DEV03/telemetry', 'smartcity/DEV03/status']);
  try {
    const off = await http('/api/devices/DEV03/commands', { method: 'POST', token: TOKEN, body: { action: 'power', params: { on: false } } });
    assert(off.status === 200, `apagar → ${off.status}`);
    const tOff = Date.now();
    const st = await obs.until((m) => m.topic.endsWith('/status') && m.at >= tOff - 500 && m.json?.state === 'stopped', 5000);
    await sleep(25_000); // 2,5 × intervalo
    const during = obs.msgs.filter((m) => m.topic.endsWith('/telemetry') && m.at > tOff + 1000).length;
    const on = await http('/api/devices/DEV03/commands', { method: 'POST', token: TOKEN, body: { action: 'power', params: { on: true } } });
    const tOn = Date.now();
    const back = await obs.until((m) => m.topic.endsWith('/telemetry') && m.at >= tOn, 15_000);
    assert(st && during === 0 && on.status === 200 && back, `estado=${st?.json?.state} durante=${during} on=${on.status} reanudó=${!!back}`);
    return { 'apagar (HTTP)': off.status, 'estado publicado': st.json.state, 'telemetrías en 25 s apagado': during, 'encender (HTTP)': on.status, 'primera telemetría tras encender (s)': ((back.at - tOn) / 1000).toFixed(1) };
  } finally {
    await http('/api/devices/DEV03/commands', { method: 'POST', token: TOKEN, body: { action: 'power', params: { on: true } } }).catch(() => {});
    await obs.close();
  }
});

/** Cliente con credenciales del backend para publicar órdenes "a mano" (otro clientId). */
async function controlClient() {
  const r = await connect({ username: 'backend', password: ENV.MQTT_PASS_BACKEND });
  assert(r.ok, `backend-test no conectó: ${r.message}`);
  return r.client;
}

test('CTL-03', 'Control', 'El dispositivo rechaza órdenes caducadas (> 60 s) y con parámetros inválidos', async () => {
  const obs = await observer(['smartcity/DEV03/ack']);
  const c = await controlClient();
  const old = { command_id: randomUUID(), action: 'set_mode', params: { mode: 'normal' }, issued_at: new Date(Date.now() - 120_000).toISOString(), issued_by: 'prueba-etapa3' };
  const bad = { command_id: randomUUID(), action: 'set_interval', params: { interval_s: 99999 }, issued_at: now(), issued_by: 'prueba-etapa3' };
  await c.publishAsync('smartcity/DEV03/control', JSON.stringify(old), { qos: 1 });
  await c.publishAsync('smartcity/DEV03/control', JSON.stringify(bad), { qos: 1 });
  const a1 = await obs.until((m) => m.json?.command_id === old.command_id, 5000);
  const a2 = await obs.until((m) => m.json?.command_id === bad.command_id, 5000);
  await c.endAsync();
  await obs.close();
  assert(a1 && a1.json.ok === false && a2 && a2.json.ok === false, 'el dispositivo aceptó una orden inválida');
  return { 'orden emitida hace 120 s': { ok: a1.json.ok, error: a1.json.error }, 'interval_s = 99999': { ok: a2.json.ok, error: a2.json.error } };
});

test('CTL-04', 'Control', 'Idempotencia: la misma orden entregada dos veces se aplica una sola vez', async () => {
  const obs = await observer(['smartcity/DEV03/ack']);
  const c = await controlClient();
  const cfg0 = (await http('/api/devices/DEV03')).json.live.config;
  const cmd = { command_id: randomUUID(), action: 'set_interval', params: { interval_s: cfg0.interval_s + 1 }, issued_at: now(), issued_by: 'prueba-etapa3' };
  await c.publishAsync('smartcity/DEV03/control', JSON.stringify(cmd), { qos: 1 });
  await obs.until((m) => m.json?.command_id === cmd.command_id, 5000);
  await c.publishAsync('smartcity/DEV03/control', JSON.stringify(cmd), { qos: 1 });
  await waitFor(() => obs.msgs.filter((m) => m.json?.command_id === cmd.command_id).length >= 2, 5000);
  const acks = obs.msgs.filter((m) => m.json?.command_id === cmd.command_id).map((m) => m.json);
  await c.endAsync();
  await obs.close();
  await sleep(500);
  const cfg1 = (await http('/api/devices/DEV03')).json.live.config;
  await http('/api/devices/DEV03/commands', { method: 'POST', token: TOKEN, body: { action: 'set_interval', params: { interval_s: cfg0.interval_s } } });
  assert(acks.length === 2 && acks[0].ok && acks[0].config_version === acks[1].config_version && acks[0].timestamp === acks[1].timestamp && cfg1.version === cfg0.version + 1, JSON.stringify({ acks, v0: cfg0.version, v1: cfg1.version }));
  return { 'orden': `set_interval ${cfg0.interval_s}→${cfg0.interval_s + 1} (entregada 2 veces con el mismo command_id)`, 'acks recibidos': acks.length, 'versión de config en ambos acks': acks.map((a) => a.config_version), 'versión antes→después': `${cfg0.version}→${cfg1.version}`, 'mismo ack reenviado': acks[0].timestamp === acks[1].timestamp, 'revertido': true };
});

test('CTL-05', 'Control', 'Mensajes malformados en /control se descartan sin tumbar el dispositivo', async () => {
  const obs = await observer(['smartcity/DEV03/ack', 'smartcity/DEV03/status']);
  const c = await controlClient();
  for (const p of ['no es json', '{"action":"power"}', JSON.stringify({ command_id: 'x', action: 'power', params: { on: false }, issued_at: now() }), 'A'.repeat(60_000)])
    await c.publishAsync('smartcity/DEV03/control', p, { qos: 1 });
  await sleep(2000);
  const spuriousAcks = obs.msgs.filter((m) => m.topic.endsWith('/ack')).length;
  await c.endAsync();
  await obs.close();
  const r = await http('/api/devices/DEV03/commands', { method: 'POST', token: TOKEN, body: { action: 'set_mode', params: { mode: 'normal' } } });
  const dev = (await http('/api/devices/DEV03')).json;
  assert(spuriousAcks === 0 && r.status === 200 && dev.live.config.enabled === true, `acks=${spuriousAcks} orden=${r.status}`);
  return { 'mensajes malformados enviados': 4, 'acks generados': spuriousAcks, 'orden válida posterior': r.json.status, 'DEV03 sigue encendido': dev.live.config.enabled };
});

test('PER-01', 'Persistencia', 'La telemetría publicada en MQTT llega a InfluxDB con el mismo timestamp y valor', async () => {
  const obs = await observer(['smartcity/DEV03/telemetry']);
  const m = await obs.until((x) => x.json?.variables?.noise_db, 15_000);
  await obs.close();
  assert(m, 'sin telemetría de DEV03');
  const ts = Date.parse(m.json.timestamp);
  const found = await waitFor(async () => {
    const rows = await flux(
      `from(bucket:"${ENV.INFLUX_BUCKET_RAW}") |> range(start: ${new Date(ts - 1000).toISOString()}, stop: ${new Date(ts + 1000).toISOString()}) |> filter(fn:(r)=> r._measurement=="telemetry" and r.device_id=="DEV03" and r._field=="noise_db")`,
    );
    return rows.find((r) => Date.parse(r._time) === ts);
  }, 15_000, 1000);
  assert(found && Math.abs(Number(found._value) - m.json.variables.noise_db.value) < 1e-9, 'el punto no está en InfluxDB o difiere');
  return { 'timestamp MQTT': m.json.timestamp, 'valor MQTT': m.json.variables.noise_db.value, 'timestamp InfluxDB': found._time, 'valor InfluxDB': Number(found._value), 'etiqueta synthetic': found.synthetic, 'latencia hasta consultar (s)': ((Date.now() - m.at) / 1000).toFixed(1) };
});

// ---------- E. Fallos y recuperación (interrumpen servicios) ----------
test('LWT-01', 'LWT', 'Corte de red: LWT de los 10, órdenes bloqueadas y sin pérdida de lecturas (almacenar y reenviar)', async () => {
  await sleep(15_000); // estabiliza tras la prueba anterior (CTL-04 reprograma el muestreo)
  const obs = await observer(IDS.map((d) => `smartcity/${d}/status`));
  await sleep(1500);
  const t0 = Date.now();
  sh('docker', ['network', 'disconnect', NET, DEVICES_CT]);
  let reconnected = false;
  try {
    const all = await waitFor(() => {
      const off = new Set(obs.msgs.filter((m) => m.at >= t0 && m.json?.connection === 'offline' && m.json.reason?.includes('LWT')).map((m) => m.json.device_id));
      return off.size === 10 ? off : null;
    }, 120_000, 500);
    const tLwt = (Date.now() - t0) / 1000;
    const blocked = await http('/api/devices/DEV03/commands', { method: 'POST', token: TOKEN, body: { action: 'set_mode', params: { mode: 'normal' } } });
    sh('docker', ['network', 'connect', NET, DEVICES_CT]);
    reconnected = true;
    const t1 = Date.now();
    const back = await waitFor(async () => ((await devicesOnlineViaApi()).length === 10 ? true : null), 60_000, 1000);
    const tBack = (Date.now() - t1) / 1000;
    // Continuidad: las lecturas tomadas durante el corte deben llegar a InfluxDB con su timestamp original.
    await sleep(15_000);
    const ts = await telemetryTimes('DEV03', 'noise_db', new Date(t0 - 12_000).toISOString());
    const inOutage = ts.filter((t) => t > t0 && t < t1).length;
    const expected = Math.floor((t1 - t0) / 10_000);
    const gap = maxGapS(ts, t0 - 12_000, Date.now() - 12_000);
    assert(all && blocked.status === 409 && back, `lwt=${all?.size} orden=${blocked.status} recuperados=${!!back}`);
    assert(inOutage >= expected - 1 && gap <= 15, `lecturas DEV03 durante el corte: ${inOutage} de ~${expected}; hueco máximo ${gap.toFixed(1)} s`);
    return {
      'LWT recibidos': all.size,
      'tiempo hasta el último LWT (s)': tLwt.toFixed(1),
      'esperado (1,5 × keepalive 30 s)': '≤ 45 s + ciclo de revisión del broker',
      'ejemplo de LWT': obs.msgs.find((m) => m.json?.reason?.includes('LWT')).json,
      'orden a DEV03 desconectado': `${blocked.status} ${blocked.json?.error}`,
      'tiempo hasta 10/10 en línea (s)': tBack.toFixed(1),
      'duración del corte (s)': ((t1 - t0) / 1000).toFixed(1),
      'lecturas DEV03 tomadas durante el corte y guardadas en InfluxDB': `${inOutage} (esperadas ≈ ${expected})`,
      'hueco máximo DEV03 (s)': gap.toFixed(1),
    };
  } finally {
    if (!reconnected) sh('docker', ['network', 'connect', NET, DEVICES_CT]);
    await obs.close();
  }
}, { disruptive: true });

test('LWT-02', 'LWT', 'Caída abrupta del proceso (SIGKILL): LWT inmediato y la configuración sobrevive al reinicio', async () => {
  const before = Object.fromEntries((await http('/api/devices')).json.map((d) => [d.id, d.live.config.version]));
  const obs = await observer(IDS.map((d) => `smartcity/${d}/status`));
  await sleep(1500);
  const t0 = Date.now();
  sh('docker', ['kill', '--signal', 'KILL', DEVICES_CT]);
  try {
    const all = await waitFor(() => {
      const off = new Set(obs.msgs.filter((m) => m.at >= t0 && m.json?.reason?.includes('LWT')).map((m) => m.json.device_id));
      return off.size === 10 ? off : null;
    }, 30_000, 200);
    const tLwt = (Date.now() - t0) / 1000;
    compose('start', 'devices');
    const back = await waitFor(async () => ((await devicesOnlineViaApi()).length === 10 ? true : null), 60_000, 1000);
    const after = Object.fromEntries((await http('/api/devices')).json.map((d) => [d.id, d.live.config.version]));
    const same = IDS.every((id) => after[id] >= before[id]);
    assert(all && back && same, `lwt=${all?.size} recuperados=${!!back} config=${same}`);
    return { 'LWT recibidos': all.size, 'tiempo hasta el último LWT (s)': tLwt.toFixed(2), 'recuperados 10/10': true, 'versión de config antes': before, 'versión de config después': after };
  } finally {
    try {
      compose('start', 'devices');
    } catch {
      /* ya iniciado */
    }
    await obs.close();
  }
}, { disruptive: true });

async function restartAndMeasureGap(service, label) {
  await sleep(15_000); // estabiliza tras la prueba anterior
  const t0 = Date.now();
  const start = new Date(t0 - 12_000).toISOString();
  compose('restart', service);
  const health = await waitHealthy(service);
  const tUp = (Date.now() - t0) / 1000;
  await sleep(35_000); // margen para reintentos de la cola y nuevas muestras
  const ts = await telemetryTimes('DEV03', 'noise_db', start);
  const winEnd = Date.now() - 12_000; // margen para la latencia del lote
  const tsDuring = ts.filter((t) => t >= t0 && t <= t0 + tUp * 1000);
  return { servicio: label, 'reinicio hasta sano (s)': tUp.toFixed(1), salud: health, 'puntos DEV03 en ventana': ts.length, 'puntos durante el reinicio': tsDuring.length, 'hueco máximo DEV03 (s)': maxGapS(ts, Date.parse(start), winEnd).toFixed(1), ts };
}

test('PER-02', 'Persistencia', 'Reinicio de InfluxDB: no se pierde histórico y la cola de Node-RED reintenta sin huecos', async () => {
  const s = new Date(Date.now() - 24 * 3600_000).toISOString();
  const before = (await telemetryTimes('DEV03', 'noise_db', s)).length;
  const r = await restartAndMeasureGap('influxdb', 'InfluxDB');
  const after = (await telemetryTimes('DEV03', 'noise_db', s)).length;
  delete r.ts;
  assert(after >= before && Number(r['hueco máximo DEV03 (s)']) <= 15, JSON.stringify(r));
  return { ...r, 'puntos DEV03 últimas 24 h antes': before, 'después': after };
}, { disruptive: true });

test('PER-03', 'Persistencia', 'Reinicio de Node-RED: la sesión persistente MQTT entrega lo publicado mientras estaba caído', async () => {
  const r = await restartAndMeasureGap('nodered', 'Node-RED');
  delete r.ts;
  assert(Number(r['hueco máximo DEV03 (s)']) <= 15, JSON.stringify(r));
  return r;
}, { disruptive: true });

test('PER-06', 'Persistencia', 'Caída de InfluxDB de 60 s con reinicio de Node-RED en medio: la cola persistente no pierde datos', async () => {
  await sleep(10_000);
  const t0 = Date.now();
  const start = new Date(t0 - 12_000).toISOString();
  compose('stop', 'influxdb');
  let restarted = false;
  try {
    await sleep(25_000); // la cola acumula líneas que no puede escribir
    compose('restart', 'nodered'); // reinicio con la cola llena: debe sobrevivir en /data/context
    await waitHealthy('nodered');
    await sleep(25_000);
    compose('start', 'influxdb');
    restarted = true;
    await waitHealthy('influxdb');
    const tOutage = (Date.now() - t0) / 1000;
    await sleep(25_000); // vaciado de la cola
    const ts = await telemetryTimes('DEV03', 'noise_db', start);
    const winEnd = Date.now() - 12_000;
    const during = ts.filter((t) => t > t0 && t < t0 + tOutage * 1000).length;
    const gap = maxGapS(ts, Date.parse(start), winEnd);
    const log = compose('logs', '--since', '3m', 'nodered').split(/\r?\n/).filter((l) => /reencoladas/.test(l)).length;
    assert(gap <= 15 && during >= Math.floor(tOutage / 10) - 1, `hueco ${gap.toFixed(1)} s; puntos durante la caída ${during}`);
    return { 'InfluxDB fuera de servicio (s)': tOutage.toFixed(1), 'Node-RED reiniciado durante la caída': true, 'reintentos registrados por Node-RED': log, 'lecturas DEV03 de ese periodo guardadas': `${during} (esperadas ≈ ${Math.floor(tOutage / 10)})`, 'hueco máximo DEV03 (s)': gap.toFixed(1) };
  } finally {
    if (!restarted) compose('start', 'influxdb');
  }
}, { disruptive: true });

test('PER-04', 'Persistencia', 'Reinicio del broker: mensajes retenidos persisten y todos se reconectan', async () => {
  const t0 = Date.now();
  compose('restart', 'mosquitto');
  await waitHealthy('mosquitto');
  const obs = await observer(IDS.flatMap((d) => [`smartcity/${d}/config`]));
  const retained = await waitFor(() => (new Set(obs.msgs.filter((m) => m.retain).map((m) => m.topic)).size === 10 ? true : null), 10_000);
  await obs.close();
  const back = await waitFor(async () => ((await devicesOnlineViaApi()).length === 10 ? true : null), 90_000, 1000);
  const tBack = (Date.now() - t0) / 1000;
  const health = (await http('/api/health')).json;
  assert(retained && back && health.mqtt, `retenidos=${!!retained} recuperados=${!!back} backend.mqtt=${health.mqtt}`);
  return { 'configs retenidas tras reinicio': 10, 'tiempo hasta 10/10 en línea (s)': tBack.toFixed(1), 'backend reconectado': health.mqtt };
}, { disruptive: true });

test('PER-05', 'Persistencia', 'Reinicio del backend: órdenes y alertas en SQLite se conservan', async () => {
  const cmds = (await http('/api/commands?limit=200')).json.length;
  const alerts = (await http('/api/alerts?limit=500')).json;
  const nAlerts = (Array.isArray(alerts) ? alerts : alerts.items ?? []).length;
  const lastCmd = (await http('/api/commands?limit=1')).json[0]?.command_id;
  compose('restart', 'backend');
  await waitHealthy('backend');
  await waitFor(async () => (await http('/api/health').catch(() => ({ json: {} }))).json?.status === 'ok', 30_000, 1000);
  const cmds2 = (await http('/api/commands?limit=200')).json.length;
  const alerts2 = (await http('/api/alerts?limit=500')).json;
  const nAlerts2 = (Array.isArray(alerts2) ? alerts2 : alerts2.items ?? []).length;
  const still = (await http('/api/commands?limit=200')).json.some((c) => c.command_id === lastCmd);
  await login(); // el JWT sigue siendo válido (misma clave), pero renovamos por limpieza
  const back = await waitFor(async () => ((await devicesOnlineViaApi()).length === 10 ? true : null), 30_000, 1000);
  assert(cmds2 >= cmds && nAlerts2 >= nAlerts && still && back, `órdenes ${cmds}→${cmds2} alertas ${nAlerts}→${nAlerts2}`);
  return { 'órdenes antes→después': `${cmds}→${cmds2}`, 'alertas antes→después': `${nAlerts}→${nAlerts2}`, 'última orden conservada': still, 'estado vivo recuperado (10/10)': !!back };
}, { disruptive: true });

// ---------- F. Límites de tasa (al final: bloquean la API de órdenes / el login durante 1 minuto) ----------
test('SEC-08', 'Seguridad', 'Límite de órdenes: más de 30 por minuto por cliente → 429 con Retry-After', async () => {
  const codes = [];
  let retryAfter = null;
  for (let i = 0; i < 35; i++) {
    // acción inexistente: cuenta para el límite pero nunca llega a un dispositivo
    const r = await http('/api/devices/DEV03/commands', { method: 'POST', token: TOKEN, body: { action: 'limite', params: {} }, noRetry: true });
    codes.push(r.status);
    if (r.status === 429) retryAfter ??= r.headers.get('retry-after');
  }
  const n429 = codes.filter((c) => c === 429).length;
  assert(n429 > 0 && retryAfter, codes.join(','));
  return { 'peticiones': 35, 'rechazadas por validación (400)': codes.filter((c) => c === 400).length, 'limitadas (429)': n429, 'Retry-After (s)': retryAfter, 'reintentos por 429 en el resto de la batería': RATE_LIMITED };
});

test('SEC-09', 'Seguridad', 'Falsificar X-Forwarded-For no permite esquivar el límite de intentos de login', async () => {
  const rows = [];
  for (let i = 0; i < 6; i++) {
    const r = await http('/api/auth/login', { method: 'POST', body: { username: `spoof-${i}`, password: 'x' }, headers: { 'x-forwarded-for': `203.0.113.${i + 1}` } });
    rows.push({ intento: i + 1, 'X-Forwarded-For enviado': `203.0.113.${i + 1}`, http: r.status, origen: r.status === 429 ? (r.json ? 'backend (JSON)' : 'nginx') : 'backend' });
  }
  assert(rows.some((r) => r.http === 429), 'el límite se esquivó cambiando X-Forwarded-For');
  return rows;
});

test('SEC-07', 'Seguridad', 'Límite de intentos de login: el 6.º intento en un minuto → 429', async () => {
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await http('/api/auth/login', { method: 'POST', body: { username: 'fuerza-bruta', password: 'x' + i } })).status);
  assert(codes.includes(429), codes.join(','));
  return { 'códigos de 7 intentos seguidos': codes.join(', '), nota: 'incluye el intento de API-01 en el mismo minuto si coincide' };
});

/* ------------------------------ ejecución ------------------------------ */
const results = [];
const started = now();
console.log(`SmartCityBGA — pruebas de integración (${SAFE ? 'modo seguro' : 'completo'})\n`);
for (const t of T) {
  if (ONLY.length && !ONLY.includes(t.id)) continue;
  if (SAFE && t.disruptive) {
    results.push({ id: t.id, area: t.area, nombre: t.name, resultado: 'OMITIDA' });
    continue;
  }
  const t0 = performance.now();
  try {
    if (!TOKEN && t.id !== 'API-01' && t.area !== 'Infraestructura' && t.area !== 'Seguridad') await login();
    const evidence = await t.fn();
    results.push({ id: t.id, area: t.area, nombre: t.name, resultado: 'PASA', duracion_s: +((performance.now() - t0) / 1000).toFixed(1), evidencia: evidence });
    console.log(`  ✔ ${t.id}  ${t.name}`);
  } catch (e) {
    results.push({ id: t.id, area: t.area, nombre: t.name, resultado: 'FALLA', duracion_s: +((performance.now() - t0) / 1000).toFixed(1), error: e.message });
    console.log(`  ✘ ${t.id}  ${t.name}\n      ${e.message}`);
  }
}

const summary = { pasan: results.filter((r) => r.resultado === 'PASA').length, fallan: results.filter((r) => r.resultado === 'FALLA').length, omitidas: results.filter((r) => r.resultado === 'OMITIDA').length };
let stats = '';
try {
  stats = sh('docker', ['stats', '--no-stream', '--format', '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}']).split(/\r?\n/).filter((l) => l.startsWith('smartcitybga-')).join('\n');
} catch {
  /* sin stats */
}
const report = { proyecto: 'SmartCityBGA', etapa: 3, tipo: 'integración', inicio: started, fin: now(), entorno: 'docker compose local (Windows 11, Docker Desktop)', resumen: summary, recursos_al_final: stats.split(/\r?\n/), pruebas: results };

const stamp = started.replace(/[:.]/g, '-').slice(0, 19);
const dir = join(ROOT, 'docs', 'evidencias', 'etapa3');
mkdirSync(dir, { recursive: true });
const json = JSON.stringify(report, null, 2);
const md = [
  `# Evidencia de pruebas de integración — ${started}`,
  '',
  `Entorno: ${report.entorno}. Modo: ${SAFE ? 'seguro' : 'completo'}.`,
  '',
  `**Resultado: ${summary.pasan} pasan · ${summary.fallan} fallan · ${summary.omitidas} omitidas**`,
  '',
  '| ID | Área | Prueba | Resultado | s |',
  '|---|---|---|---|---|',
  ...results.map((r) => `| ${r.id} | ${r.area} | ${r.nombre} | ${r.resultado} | ${r.duracion_s ?? ''} |`),
  '',
  '## Evidencia por prueba',
  '',
  ...results.flatMap((r) => [`### ${r.id} — ${r.nombre}`, '', `Resultado: **${r.resultado}**`, '', '```json', JSON.stringify(r.evidencia ?? r.error ?? null, null, 2), '```', '']),
  '## Recursos al terminar (docker stats)',
  '',
  '```',
  stats,
  '```',
].join('\n');

// Garantía: ningún secreto en la evidencia.
const leaked = SECRETS.filter((s) => json.includes(s) || md.includes(s));
if (leaked.length) {
  console.error('ABORTADO: la evidencia contiene secretos; no se escribe.');
  process.exit(2);
}
writeFileSync(join(dir, `integracion-${stamp}.json`), json);
writeFileSync(join(dir, `integracion-${stamp}.md`), md);
console.log(`\n${summary.pasan} pasan · ${summary.fallan} fallan · ${summary.omitidas} omitidas`);
console.log(`Evidencia: docs/evidencias/etapa3/integracion-${stamp}.md`);
process.exit(summary.fallan ? 1 : 0);
