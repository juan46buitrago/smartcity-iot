import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch();
for (let run = 1; run <= 3; run++) {
  const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('scbga.bienvenida', '1'); } catch {} });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push('console ' + m.text().slice(0, 300)));
  await page.goto('http://127.0.0.1:8380/', { waitUntil: 'domcontentloaded' });
  await sleep(8000);
  await ctx.setOffline(true);
  await sleep(4000);
  const notice = await page.getByText('Sin conexión con el servidor').count();
  await sleep(56000);
  await ctx.setOffline(false);
  await sleep(15000);
  const boundary = await page.getByText('Esta pantalla no se pudo mostrar').count();
  console.log(JSON.stringify({ run, aviso_a_4s: notice, pantalla_error: boundary, errores: errs.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource|WebSocket/.test(e)).slice(0, 5) }));
  await ctx.close();
}
await b.close();
