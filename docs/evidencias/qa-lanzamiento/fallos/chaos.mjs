// Fase 1 — inyección de fallos sobre producción, uno por vez, con restauración garantizada.
// Uso: node chaos.mjs <etiqueta> [F1,F2,...]   Credenciales por entorno (qa.env); nunca se escriben en la evidencia.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const run = promisify(execFile);
const label = process.argv[2] ?? 'antes';
const only = process.argv[3]?.split(',');
const out = join(here, 'chaos', label);
mkdirSync(out, { recursive: true });
const BASE = process.env.QA_BASE;
if (!/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(BASE ?? "")) { console.error("Este arnés solo actúa sobre la réplica local"); process.exit(2); }
const STACK = join(here, "stack");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => { const l = `[${new Date().toISOString()}] ${m}`; console.log(l); appendFileSync(join(out, 'bitacora.log'), l + '\n'); };

async function vm(cmd, timeout = 120_000) {
  try {
    const { stdout } = await run("bash", ["-c", cmd], { timeout, maxBuffer: 1 << 24 });
    return stdout.trim();
  } catch (e) { return `ERR ${String(e.stderr || e.message).slice(0, 300)}`; }
}

// Muestreo desde la propia VM: mide el servicio sin el ruido de la red del cliente.
const PROBES = {
  healthz: '/healthz', spa: '/', health: '/api/health', devices: '/api/devices', alerts: '/api/alerts/summary',
  history: '/api/history/DEV03/noise_db', grafana: '/grafana/api/health', nodered: '/nodered/',
};
async function sample(maxS = 75) {
  const cmds = Object.entries(PROBES).map(([k, p]) =>
    `(curl -s -o /tmp/qa_${k} -m ${maxS} -w '${k} %{http_code} %{time_total}\\n' ${BASE}${p}; echo "body_${k} $(head -c 160 /tmp/qa_${k} | tr '\\n' ' ')") &`).join('\n');
  const raw = await vm(`${cmds}\nwait`, (maxS + 20) * 1000);
  const r = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^(\w+) (\d{3}) ([\d.]+)$/);
    if (m) r[m[1]] = { code: +m[2], s: +(+m[3]).toFixed(2) };
    const b = line.match(/^body_(\w+) (.*)$/);
    if (b) (r[b[1]] ??= {}).body = b[2].slice(0, 150);
  }
  return r;
}

let token;
async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.QA_APP_PASS }) });
  token = (await res.json()).token;
}
const authHdr = () => `-H 'Authorization: Bearer ${token}' -H 'content-type: application/json'`;
async function vmPost(path, data, maxS = 40) {
  const raw = await vm(`curl -s -m ${maxS} ${authHdr()} -d '${JSON.stringify(data)}' -w '\\n%{http_code} %{time_total}' ${BASE}${path}`, (maxS + 15) * 1000);
  const lines = raw.split('\n'); const [code, s] = (lines.pop() ?? '').split(' ');
  return { code: +code, s: +(+s).toFixed(2), body: lines.join(' ').slice(0, 220) };
}
// Orden idempotente: reenvía el intervalo por defecto del DEV03 (no cambia nada en el dispositivo).
const command = () => vmPost('/api/devices/DEV03/commands', { action: 'set_interval', params: { interval_s: 10 } });
const onlineCount = async () => {
  const raw = await vm(`curl -s -m 20 ${BASE}/api/devices`);
  try { const d = JSON.parse(raw); return d.filter((x) => x.live?.status?.connection === 'online').length + '/' + d.length; } catch { return 'n/d'; }
};

async function waitHealthy(maxMs = 180_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const r = await vm(`curl -s -m 8 ${BASE}/api/health; echo; docker ps --filter name=smartcitybga --format '{{.Names}} {{.Status}}' | grep -c -E 'unhealthy|starting|Paused'; true`);
    if (r.includes('"status":"ok"') && r.trim().endsWith('0')) return ((Date.now() - t0) / 1000).toFixed(1);
    await sleep(2000);
  }
  return 'NO_RECUPERO';
}

// Vista de usuario real durante el fallo.
async function browserCheck(browser, tag, paths = ['/', '/dispositivos/DEV03', '/historico']) {
  const results = [];
  for (const p of paths) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { try { for (const k of ['scbga.bienvenida']) localStorage.setItem(k, '1'); } catch {} });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    let status = 'ok';
    try { await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 45_000 }); await sleep(tag === 'F4' ? 55000 : 9000); }
    catch (e) { status = 'NAV_FAIL ' + e.message.slice(0, 80); }
    const info = await page.evaluate(() => ({
      rootChildren: document.getElementById('root')?.children.length ?? -1,
      textLen: document.body.innerText.length,
      tail: document.body.innerText.replace(/\s+/g, ' ').match(/(error|no se|sin conexi|desconect|reconect|degrad|no disponible|intent|tard. demasiado|Esta pantalla)[^.]{0,70}/gi)?.slice(0, 6) ?? [],
    })).catch(() => ({ rootChildren: -1, textLen: 0, tail: [] }));
    const name = `${tag}${p.replace(/\//g, '_')}.png`;
    await page.screenshot({ path: join(out, name) }).catch(() => {});
    results.push({ path: p, status, ...info, pageerrors: errors.length, firstError: errors[0] });
    await ctx.close();
  }
  return results;
}

// Hueco máximo real de telemetría en los últimos minutos, leído de InfluxDB.
async function telemetryGap(device = 'DEV03', field = 'noise_db', minutes = 6) {
  const q = `from(bucket:"raw") |> range(start:-${minutes}m) |> filter(fn:(r)=>r._measurement=="telemetry" and r.device_id=="${device}" and r._field=="${field}") |> keep(columns:["_time"])`;
  const raw = await vm(`cd ${STACK} && docker compose exec -T influxdb sh -c 'influx query --raw --org "$DOCKER_INFLUXDB_INIT_ORG" --token "$DOCKER_INFLUXDB_INIT_ADMIN_TOKEN" '"'"'${q}'"'"'' 2>&1 | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z' | sort -u`, 60_000);
  const ts = raw.split('\n').filter(Boolean).map((x) => Date.parse(x)).filter((n) => !isNaN(n)).sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < ts.length; i++) gap = Math.max(gap, ts[i] - ts[i - 1]);
  return { puntos: ts.length, hueco_max_s: +(gap / 1000).toFixed(1) };
}

const C = (s) => `smartcitybga-${s}-1`;
const blockHosts = (svc, hosts) => vm(`docker exec -u 0 ${C(svc)} sh -c 'cp /etc/hosts /tmp/hosts.qa; ${hosts.map((h) => `echo "127.0.0.1 ${h}" >> /etc/hosts`).join('; ')}'`);
const unblockHosts = (svc) => vm(`docker exec -u 0 ${C(svc)} sh -c 'cat /tmp/hosts.qa > /etc/hosts && rm /tmp/hosts.qa'`);

const FAULTS = [
  { id: 'F1', name: 'InfluxDB colgado (timeout de base de datos, docker pause)', inject: () => vm(`docker pause ${C('influxdb')}`), restore: () => vm(`docker unpause ${C('influxdb')}`), hold: 30 },
  { id: 'F2', name: 'InfluxDB caído (conexión rechazada, docker stop)', inject: () => vm(`docker stop -t 5 ${C('influxdb')}`), restore: () => vm(`docker start ${C('influxdb')}`), hold: 20 },
  { id: 'F3', name: 'Backend caído (502 del gateway)', inject: () => vm(`docker stop -t 5 ${C('backend')}`), restore: () => vm(`docker start ${C('backend')}`), hold: 15, cmd: true },
  { id: 'F4', name: 'Backend colgado (504 del gateway, docker pause)', inject: () => vm(`docker pause ${C('backend')}`), restore: () => vm(`docker unpause ${C('backend')}`), hold: 10, cmd: false },
  { id: 'F5', name: 'Broker MQTT caído', inject: () => vm(`docker stop -t 5 ${C('mosquitto')}`), restore: () => vm(`docker start ${C('mosquitto')}`), hold: 30, cmd: true, gap: true },
  { id: 'F6', name: 'Node-RED caído (ingesta)', inject: () => vm(`docker stop -t 5 ${C('nodered')}`), restore: () => vm(`docker start ${C('nodered')}`), hold: 30, gap: true },
  { id: 'F7', name: 'Grafana caído', inject: () => vm(`docker stop -t 5 ${C('grafana')}`), restore: () => vm(`docker start ${C('grafana')}`), hold: 10 },
  { id: 'F8', name: 'Proveedor de IA no disponible (tercero)', inject: () => blockHosts('backend', ['api.b.ai']), restore: () => unblockHosts('backend'), hold: 2, ai: true },
  { id: 'F9', name: 'APIs externas no disponibles (Open-Meteo, datos.gov.co)', inject: () => blockHosts('devices', ['api.open-meteo.com', 'air-quality-api.open-meteo.com', 'www.datos.gov.co']), restore: () => unblockHosts('devices'), hold: 5, external: true },
  ];

// Fallos a nivel de red del navegador: 502/504 HTML, payload cortado, JSON con forma inesperada, red perdida, lentitud.
const ROUTE_FAULTS = [
  { id: 'R1', name: '502 HTML en toda la API', h: (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<html><h1>502 Bad Gateway</h1></html>' }) },
  { id: 'R2', name: '504 HTML en toda la API', h: (r) => r.fulfill({ status: 504, contentType: 'text/html', body: '<html><h1>504 Gateway Time-out</h1></html>' }) },
  { id: 'R3', name: 'Conexión abortada (payload perdido)', h: (r) => r.abort('connectionreset') },
  { id: 'R4', name: 'JSON truncado', h: (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"DEV03","live":{' }) },
  { id: 'R5', name: 'Cuerpo vacío / {}', h: (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) },
  { id: 'R6', name: 'null como respuesta', h: (r) => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }) },
  { id: 'R7', name: 'Respuesta lenta (12 s)', h: async (r) => { await sleep(12_000); await r.continue().catch(() => {}); } },
];
const ROUTE_PATHS = ['/', '/mapa', '/dispositivos', '/dispositivos/DEV03', '/historico', '/alertas', '/asistente', '/configuracion'];

async function routeFaults(browser) {
  const rows = [];
  for (const f of ROUTE_FAULTS) {
    for (const p of ROUTE_PATHS) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
      await page.route(/\/api\//, f.h);
      let nav = 'ok';
      try { await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 40_000 }); await sleep(f.id === 'R7' ? 15_000 : 5000); }
      catch (e) { nav = e.message.slice(0, 70); }
      const st = await page.evaluate(() => ({ root: document.getElementById('root')?.children.length ?? -1, len: document.body.innerText.length, msgs: document.body.innerText.replace(/\s+/g, ' ').match(/(Failed to fetch|Error \d{3}|Unexpected|undefined|NaN|no se pudo|sin conexi|no disponible|Sin datos)[^.]{0,40}/gi)?.slice(0, 4) ?? [] })).catch(() => ({ root: -1, len: 0, msgs: [] }));
      if (st.root === 0 || st.len < 40) await page.screenshot({ path: join(out, `${f.id}${p.replace(/\//g, '_')}.png`) }).catch(() => {});
      rows.push({ fallo: f.id, nombre: f.name, ruta: p, nav, pantalla_blanca: st.root === 0 || st.len < 40, largo_texto: st.len, errores_js: errs.length, primer_error: errs[0], mensajes: st.msgs });
      await ctx.close();
    }
    log(`${f.id} ${f.name}: blancas=${rows.filter((x) => x.fallo === f.id && x.pantalla_blanca).length}/${ROUTE_PATHS.length} errores_js=${rows.filter((x) => x.fallo === f.id).reduce((a, b) => a + b.errores_js, 0)}`);
  }
  return rows;
}

const pending = new Set();
async function restoreAll() { for (const f of pending) { log(`RESTAURACIÓN DE EMERGENCIA ${f.id}`); await f.restore(); } }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await restoreAll(); process.exit(130); });
process.on('uncaughtException', async (e) => { log('EXCEPCIÓN ' + e.stack); await restoreAll(); process.exit(1); });

async function main() {
  await login();
  const browser = await chromium.launch();
  const results = { etiqueta: label, inicio: new Date().toISOString(), linea_base: await sample(20), online_base: await onlineCount(), fallos: [] };
  log(`Línea base: dispositivos en línea ${results.online_base}`);
  for (const f of FAULTS) {
    if (only && !only.includes(f.id)) continue;
    const initial = await waitHealthy(60_000);
    log(`▶ ${f.id} ${f.name} (sano antes: ${initial}s)`);
    const r = { id: f.id, nombre: f.name, inyectado: new Date().toISOString() };
    pending.add(f);
    r.inyeccion = (await f.inject()).slice(0, 120);
    await sleep(f.hold * 1000);
    try {
      r.durante = await sample(f.id === 'F4' ? 70 : f.id === 'F1' ? 35 : 20);
      r.online_durante = await onlineCount();
      if (f.cmd !== undefined || ['F1', 'F2'].includes(f.id)) r.orden = await command();
      if (f.ai) {
        r.ia_chat = await vmPost('/api/ai/chat', { question: 'cuantos dispositivos hay en linea' }, 40);
        r.ia_estado = (await vm(`curl -s -m 15 ${BASE}/api/ai/status`)).slice(0, 200);
      }
      if (f.external) {
        r.reinicio = [await vmPost('/api/devices/DEV02/commands', { action: 'restart', params: {} }, 25), await vmPost('/api/devices/DEV10/commands', { action: 'restart', params: {} }, 25)];
        await sleep(25_000);
        r.logs = (await vm(`docker logs --since 40s ${C('devices')} 2>&1 | tail -12 | cut -c1-200`)).split('\n');
        r.vistas = (await vm(`curl -s -m 15 ${BASE}/api/devices/DEV10 | head -c 700`));
        r.online_durante = await onlineCount();
      }
      if (f.dev11) {
        r.dev11 = (await vm(`curl -s -m 15 -w ' [%{http_code} %{time_total}]' ${BASE}/api/dev11`)).slice(0, 200);
      }
      r.navegador = await browserCheck(browser, f.id, f.ai ? ['/asistente'] : f.dev11 ? ['/dispositivos/DEV11'] : undefined);
    } finally {
      log(`  restaurando ${f.id}`);
      r.restauracion = (await f.restore()).slice(0, 120);
      pending.delete(f);
    }
    r.recuperacion_s = await waitHealthy();
    r.online_tras = await onlineCount();
    if (f.external) { await vmPost('/api/devices/DEV02/commands', { action: 'restart', params: {} }, 25); await vmPost('/api/devices/DEV10/commands', { action: 'restart', params: {} }, 25); }
    if (f.gap) { await sleep(20_000); r.hueco_telemetria = await telemetryGap(); r.online_tras = await onlineCount(); }
    log(`  ${f.id} recuperado en ${r.recuperacion_s}s; en línea ${r.online_tras}`);
    results.fallos.push(r);
    writeFileSync(join(out, 'resultados.json'), JSON.stringify(results, null, 2));
    await sleep(8000);
  }
  if (!only || only.includes('R')) {
    results.fallos_red = await routeFaults(browser);
    writeFileSync(join(out, 'resultados.json'), JSON.stringify(results, null, 2));
  }
  await browser.close();
  results.fin = new Date().toISOString();
  results.estado_final = await vm(`docker ps --filter name=smartcitybga --format '{{.Names}} {{.Status}}'; curl -s -m 8 ${BASE}/api/health`);
  writeFileSync(join(out, 'resultados.json'), JSON.stringify(results, null, 2));
  log('FIN. Estado final:\n' + results.estado_final);
}
main().catch(async (e) => { log('ERROR ' + e.stack); await restoreAll(); process.exit(1); });
