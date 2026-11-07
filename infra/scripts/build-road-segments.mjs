#!/usr/bin/env node
/**
 * Genera el catálogo de segmentos viales reales de Bucaramanga para el simulador de
 * incidentes (DEV04), el detector de vehículos (DEV05) y la ruta simulada del GPS (DEV06).
 *
 * Fuente: OpenStreetMap vía Overpass API. Datos © colaboradores de OpenStreetMap, licencia ODbL.
 * Uso:  node infra/scripts/build-road-segments.mjs [ruta-salida] [--from-file respuesta-overpass.json]
 * El JSON resultante se versiona para que la simulación no dependa de Overpass en ejecución.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from-file');
const FROM_FILE = fromIdx >= 0 ? args.splice(fromIdx, 2)[1] : null;
const OUT = resolve(args[0] ?? resolve(here, '../../apps/devices/src/data/bga-road-segments.json'));
const BBOX = [7.05, -73.16, 7.16, -73.07]; // S, W, N, E — Bucaramanga y Floridablanca norte

/** Corredores principales que se modelan (nombres tal como aparecen en OSM). */
const CORRIDORS = [
  'Autopista Floridablanca', 'Avenida Carrera 27', 'Avenida Calle 45', 'Avenida Quebrada Seca',
  'Avenida Carrera 33', 'Transversal Oriental', 'Avenida Carrera 15', 'Avenida Calle 36',
  'Transversal El Bosque', 'Diagonal 15', 'Avenida Calle 56', 'Avenida La Rosita',
  'Avenida Calle 61', 'Anillo Víal', 'Avenida González Valencia', 'Paralela Oriental',
  'Avenida Calle 105', 'Avenida Samanes', 'Boulevard Santander', 'Avenida Carrera 9',
];

const FREE_SPEED = { motorway: 70, trunk: 60, primary: 50, secondary: 40 };
const CLASS_RANK = { motorway: 4, trunk: 3, primary: 2, secondary: 1 };
const TARGET_SEG_M = 900;
const MIN_SEG_M = 250;
const DEDUP_M = 180;

const toRad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const r6 = (n) => Math.round(n * 1e6) / 1e6;
function slug(name) {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/Avenida /, 'AV-').replace(/Autopista /, 'AUT-').replace(/Transversal /, 'TV-')
    .replace(/Carrera /, 'CRA').replace(/Calle /, 'CL').replace(/Diagonal /, 'DG').replace(/Boulevard /, 'BLV-')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function fetchOverpass() {
  const q = `[out:json][timeout:90];way["highway"~"^(motorway|trunk|primary|secondary)$"]["name"](${BBOX.join(',')});out tags geom;`;
  for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SmartCityBGA-academic/0.1', Accept: 'application/json' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) return await res.json();
      console.error(`${ep} → HTTP ${res.status}`);
    } catch (e) {
      console.error(`${ep} → ${e.message}`);
    }
  }
  throw new Error('No fue posible consultar Overpass');
}

function splitWay(points) {
  const out = [];
  let cur = [points[0]];
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += dist(points[i - 1], points[i]);
    cur.push(points[i]);
    if (len >= TARGET_SEG_M) {
      out.push({ pts: cur, len });
      cur = [points[i]];
      len = 0;
    }
  }
  if (len >= MIN_SEG_M || out.length === 0) out.push({ pts: cur, len });
  else out[out.length - 1] = { pts: [...out[out.length - 1].pts, ...cur.slice(1)], len: out[out.length - 1].len + len };
  return out;
}

function thin(pts, minM = 60) {
  const res = [pts[0]];
  for (const p of pts.slice(1)) if (dist(res[res.length - 1], p) >= minM) res.push(p);
  if (res[res.length - 1] !== pts[pts.length - 1]) res.push(pts[pts.length - 1]);
  return res;
}

/** Une los "ways" de una vía en cadenas continuas (por nodos extremos coincidentes). */
function chain(ways) {
  const chains = [];
  const pool = ways.map((w) => w.geometry.map((g) => ({ lat: g.lat, lon: g.lon })));
  while (pool.length) {
    let c = pool.shift();
    let grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        const [cs, ce, ws, we] = [c[0], c[c.length - 1], w[0], w[w.length - 1]];
        if (dist(ce, ws) < 5) c = [...c, ...w.slice(1)];
        else if (dist(ce, we) < 5) c = [...c, ...[...w].reverse().slice(1)];
        else if (dist(cs, we) < 5) c = [...w, ...c.slice(1)];
        else if (dist(cs, ws) < 5) c = [...[...w].reverse(), ...c.slice(1)];
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    chains.push(c);
  }
  return chains.sort((a, b) => b.length - a.length);
}

function buildRoute(byName, names) {
  // Ruta de vehículo: cadena más larga de cada corredor, orientada norte → sur.
  const route = [];
  for (const n of names) {
    const c = chain(byName.get(n) ?? [])[0];
    if (!c) continue;
    const oriented = c[0].lat >= c[c.length - 1].lat ? c : [...c].reverse();
    route.push(...thin(oriented, 40));
  }
  return route.map((p) => [r6(p.lat), r6(p.lon)]);
}

const data = FROM_FILE ? JSON.parse(readFileSync(FROM_FILE, 'utf8')) : await fetchOverpass();
const byName = new Map();
for (const w of data.elements) {
  if (!CORRIDORS.includes(w.tags.name)) continue;
  if (!byName.has(w.tags.name)) byName.set(w.tags.name, []);
  byName.get(w.tags.name).push(w);
}

const segments = [];
for (const name of CORRIDORS) {
  const ways = byName.get(name) ?? [];
  if (!ways.length) {
    console.warn(`Sin datos para ${name}`);
    continue;
  }
  let n = 0;
  for (const w of ways) {
    const cls = w.tags.highway;
    const lanes = Number.parseInt(w.tags.lanes ?? '', 10) || (cls === 'secondary' ? 2 : 3);
    const maxspeed = Number.parseInt(w.tags.maxspeed ?? '', 10);
    for (const part of splitWay(w.geometry)) {
      const mid = part.pts[Math.floor(part.pts.length / 2)];
      // Evitar duplicados por calzadas dobles: mismo corredor y punto medio cercano.
      const dup = segments.find((s) => s.road_name === name && dist({ lat: s.mid[0], lon: s.mid[1] }, mid) < DEDUP_M);
      if (dup) {
        if (CLASS_RANK[cls] > CLASS_RANK[dup.road_class]) dup.road_class = cls;
        continue;
      }
      n++;
      segments.push({
        id: `SEG-${slug(name)}-${String(n).padStart(2, '0')}`,
        road_name: name,
        road_class: cls,
        lanes: Math.min(lanes, 5),
        free_speed_kmh: maxspeed >= 20 && maxspeed <= 90 ? maxspeed : FREE_SPEED[cls],
        length_m: Math.round(part.len),
        mid: [r6(mid.lat), r6(mid.lon)],
        geometry: thin(part.pts).map((p) => [r6(p.lat), r6(p.lon)]),
        osm_way: w.id,
      });
    }
  }
}

const out = {
  generated_at: new Date().toISOString(),
  source: 'OpenStreetMap (Overpass API)',
  license: 'ODbL 1.0 — © colaboradores de OpenStreetMap',
  bbox: BBOX,
  segments,
  gps_route: buildRoute(byName, ['Avenida Carrera 27', 'Autopista Floridablanca']),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const km = segments.reduce((a, s) => a + s.length_m, 0) / 1000;
console.log(`${segments.length} segmentos, ${km.toFixed(1)} km, ruta GPS ${out.gps_route.length} puntos → ${OUT}`);
const byClass = {};
for (const s of segments) byClass[s.road_class] = (byClass[s.road_class] ?? 0) + 1;
console.log(byClass);
