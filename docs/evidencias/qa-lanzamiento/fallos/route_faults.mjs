// Fallos simulados SOLO en el navegador de pruebas (intercepta /api/*). No envía tráfico anómalo al servidor ni lo modifica.
// Uso: QA_BASE=https://... node route_faults.mjs <etiqueta>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.QA_BASE;
const label = process.argv[2] ?? 'prod-antes';
const out = join(here, 'routes', label);
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAULTS = [
  ['R1', '502 HTML en toda la API', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<html><h1>502 Bad Gateway</h1></html>' })],
  ['R2', '504 HTML en toda la API', (r) => r.fulfill({ status: 504, contentType: 'text/html', body: '<html><h1>504 Gateway Time-out</h1></html>' })],
  ['R3', 'Conexión abortada (payload perdido)', (r) => r.abort('connectionreset')],
  ['R4', 'JSON truncado', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"DEV03","live":{' })],
  ['R5', 'Cuerpo {} inesperado', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })],
  ['R6', 'null como respuesta', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' })],
  ['R7', 'Respuesta lenta (12 s)', async (r) => { await sleep(12_000); await r.continue().catch(() => {}); }],
  ['R8', 'Lista de dispositivos con objetos incompletos', (r) => /\/api\/devices(\?|$)/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'application/json', body: '[{"id":"DEV01"}]' }) : r.continue()],
];
const PATHS = ['/', '/mapa', '/dispositivos', '/dispositivos/DEV03', '/historico', '/alertas', '/asistente', '/configuracion'];

const only = process.argv[3]?.split(',');
const browser = await chromium.launch();
const rows = [];
for (const [id, name, handler] of FAULTS.filter(([id]) => !only || only.includes(id))) {
  for (const p of PATHS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
    await page.route(/\/api\//, handler);
    let nav = 'ok';
    try { await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 45_000 }); await sleep(id === 'R7' ? 15_000 : 5000); }
    catch (e) { nav = e.message.slice(0, 70); }
    const st = await page.evaluate(() => ({
      root: document.getElementById('root')?.children.length ?? -1,
      len: document.body.innerText.length,
      msgs: document.body.innerText.replace(/\s+/g, ' ').match(/(Failed to fetch|Error \d{3}|Unexpected|undefined|NaN|no se pudo|sin conexi|no disponible|Sin datos|Esta pantalla)[^.]{0,40}/gi)?.slice(0, 4) ?? [],
    })).catch(() => ({ root: -1, len: 0, msgs: [] }));
    const blank = st.root === 0 || st.len < 40;
    if (blank) await page.screenshot({ path: join(out, `${id}${p.replace(/\//g, '_')}.png`) }).catch(() => {});
    rows.push({ fallo: id, nombre: name, ruta: p, nav, pantalla_blanca: blank, largo_texto: st.len, errores_js: errs.length, primer_error: errs[0], mensajes: st.msgs });
    await ctx.close();
  }
  const mine = rows.filter((x) => x.fallo === id);
  console.log(`${id} ${name}: blancas=${mine.filter((x) => x.pantalla_blanca).length}/${PATHS.length} errores_js=${mine.reduce((a, b) => a + b.errores_js, 0)} fallos_nav=${mine.filter((x) => x.nav !== 'ok').length}`);
  writeFileSync(join(out, 'resultados.json'), JSON.stringify(rows, null, 2));
}
await browser.close();
console.log('FIN');
