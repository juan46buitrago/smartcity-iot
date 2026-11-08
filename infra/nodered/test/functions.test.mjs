/**
 * Pruebas unitarias del código de los nodos function de Node-RED.
 * Se ejecuta exactamente el mismo texto que build-flows.mjs inserta en flows.json
 * (prefijos lp-common.js / rule-common.js + archivo del nodo), con dobles de msg/flow/node/env.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, '..', 'src', f), 'utf8');

function makeNode(code, envVars = {}) {
  const store = new Map();
  const flow = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
  const log = { warn: [], error: [], status: null };
  const node = { warn: (m) => log.warn.push(m), error: (m) => log.error.push(m), status: (s) => (log.status = s) };
  const env = { get: (k) => envVars[k] };
  const fn = new Function('msg', 'flow', 'node', 'env', code);
  return { run: (msg) => fn(structuredClone(msg), flow, node, env), flow, log, store };
}

const telemetryNode = () => makeNode(src('lp-common.js') + '\n' + src('fn-telemetry.js'));
const tel = (over = {}) => ({
  topic: 'smartcity/DEV03/telemetry',
  payload: {
    device_id: 'DEV03',
    timestamp: new Date().toISOString(),
    source_type: 'simulated',
    provenance: { synthetic: true },
    variables: { noise_db: { value: 61.2 }, state: { value: 'normal' }, n: { value: 3 } },
    seq: 7,
    ...over,
  },
});

describe('Node-RED · telemetría → line protocol', () => {
  it('genera una fila ancha con tags, campos float/string y timestamp en ms', () => {
    const m = tel();
    const out = telemetryNode().run(m);
    const ts = Date.parse(m.payload.timestamp);
    expect(out.payload).toBe(`telemetry,device_id=DEV03,source_type=simulated,synthetic=true noise_db=61.2,state="normal",n=3.0,seq=7i ${ts}`);
  });

  it('rechaza suplantación: device_id distinto del tópico', () => {
    const n = telemetryNode();
    expect(n.run(tel({ device_id: 'DEV04' }))).toBeNull();
    expect(n.log.warn[0]).toMatch(/no coincide/);
    expect(n.store.get('stats')).toEqual({ ok: 0, rejected: 1 });
  });

  it('rechaza timestamps futuros o demasiado antiguos', () => {
    const n = telemetryNode();
    expect(n.run(tel({ timestamp: new Date(Date.now() + 3600_000).toISOString() }))).toBeNull();
    expect(n.run(tel({ timestamp: '2020-01-01T00:00:00Z' }))).toBeNull();
    expect(n.run(tel({ timestamp: 'ayer' }))).toBeNull();
  });

  it('acepta telemetría de DEV11 (ESP32 real) con source_type real', () => {
    const msg = tel({ device_id: 'DEV11', source_type: 'real', variables: { temperature: { value: 24.5 }, relay: { value: 0 } } });
    msg.topic = 'smartcity/DEV11/telemetry';
    const ok = telemetryNode().run(msg);
    expect(ok.payload).toContain('telemetry,device_id=DEV11,source_type=real,synthetic=true temperature=24.5,relay=0.0,seq=7i');
  });

  it('acepta datos de IDEAM con días de retraso (≤ 10 días)', () => {
    const out = telemetryNode().run(tel({ timestamp: new Date(Date.now() - 4 * 86400_000).toISOString() }));
    expect(out).not.toBeNull();
  });

  it('neutraliza intentos de inyección en line protocol', () => {
    const out = telemetryNode().run(
      tel({
        source_type: 'simulated,evil=1',
        variables: { 'noise_db value=1\nmalo': { value: 1 }, texto: { value: 'a"b\\c\nd=1 x' }, ok: { value: 2 } },
      }),
    );
    const line = out.payload;
    expect(line.split('\n')).toHaveLength(1);
    expect(line).toContain('source_type=unknown');
    expect(line).not.toContain('evil');
    expect(line).not.toContain('malo');
    expect(line).toContain('texto="a\\"b\\\\c');
  });

  it('descarta valores no finitos y mensajes sin variables válidas', () => {
    const n = telemetryNode();
    expect(n.run(tel({ variables: { a: { value: NaN }, b: { value: Infinity }, c: { value: null } } }))).toBeNull();
    expect(n.run({ topic: 'smartcity/DEV03/telemetry', payload: 'texto' })).toBeNull();
  });
});

describe('Node-RED · estado de conexión', () => {
  it('registra el LWT como offline con el motivo', () => {
    const n = makeNode(src('lp-common.js') + '\n' + src('fn-status.js'));
    const out = n.run({ topic: 'smartcity/DEV05/status', payload: { device_id: 'DEV05', connection: 'offline', reason: 'conexión perdida (LWT)' } });
    expect(out.payload).toMatch(/^device_status,device_id=DEV05,connection=offline,state=unknown online=0\.0,reason="conexión perdida \(LWT\)" \d+$/);
  });
});

describe('Node-RED · incidentes sintéticos', () => {
  const incNode = () => makeNode(src('lp-common.js') + '\n' + src('fn-incident.js'));
  const inc = (over = {}) => ({
    topic: 'smartcity/DEV04/events',
    payload: {
      device_id: 'DEV04',
      event: 'created',
      timestamp: new Date().toISOString(),
      incident: {
        incident_id: 'SIM-INC-20261107-0001AB', type: 'accidente', severity: 'alta', state: 'activo', road_class: 'trunk',
        road_name: 'Autopista Floridablanca', segment_id: 'w123', location: { lat: 7.09, lon: -73.1 }, speed_impact: 0.5, lanes_blocked: 1,
        synthetic: true, test: false, ...over,
      },
    },
  });

  it('escribe el evento con tags y campos válidos', () => {
    const out = incNode().run(inc());
    expect(out.payload).toMatch(/^incident_events,event=created,type=accidente,severity=alta,state=activo,road_class=trunk,test=false,synthetic=true incident_id="SIM-INC-20261107-0001AB",road_name="Autopista Floridablanca",segment_id="w123",lat=7\.09,lon=-73\.1,speed_impact=0\.5,lanes_blocked=1\.0 \d+$/);
  });

  it('rechaza incidentes no marcados como sintéticos', () => {
    expect(incNode().run(inc({ synthetic: false }))).toBeNull();
    expect(incNode().run(inc({ incident_id: 'INC-REAL-1' }))).toBeNull();
  });

  it('descarta solo el evento con números no válidos (no envenena el lote)', () => {
    const n = incNode();
    expect(n.run(inc({ location: {} }))).toBeNull();
    expect(n.run(inc({ speed_impact: 'mucho' }))).toBeNull();
    expect(n.store.get('stats').rejected).toBe(2);
  });

  it('tags vacíos o con saltos de línea no rompen la línea', () => {
    const out = incNode().run(inc({ road_class: '', type: 'accidente\nmalo,x=1' }));
    expect(out.payload.split('\n')).toHaveLength(1);
    expect(out.payload).toContain('road_class=unknown');
    expect(out.payload).toContain('type=accidente\\ malo\\,x\\=1');
  });
});

describe('Node-RED · cola persistente de escritura con reintento', () => {
  const env = { INFLUX_URL: 'http://influxdb:8086', INFLUX_ORG: 'smartcitybga', INFLUX_BUCKET_RAW: 'raw', INFLUX_WRITE_TOKEN: 't' };
  // Los tres nodos comparten el contexto de flujo, como en Node-RED.
  function pipeline() {
    const store = new Map();
    const flow = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
    const node = { warn() {}, error() {}, status() {} };
    const mk = (f) => (msg) => new Function('msg', 'flow', 'node', 'env', src(f))(msg, flow, node, { get: (k) => env[k] });
    return { store, enqueue: mk('fn-enqueue.js'), tick: mk('fn-build-request.js'), respond: mk('fn-check-response.js') };
  }

  it('encola, envía por lote y vacía la cola al confirmar InfluxDB (204)', () => {
    const p = pipeline();
    p.enqueue({ payload: 'a 1' });
    p.enqueue({ payload: 'b 2' });
    const req = p.tick({});
    expect(req.payload).toBe('a 1\nb 2');
    expect(req.url).toBe('http://influxdb:8086/api/v2/write?org=smartcitybga&bucket=raw&precision=ms');
    expect(p.tick({})).toBeNull(); // una sola petición en vuelo
    p.respond({ ...req, statusCode: 204 });
    expect(p.store.get('pending')).toEqual([]);
    expect(p.store.get('written')).toBe(2);
    expect(p.tick({})).toBeNull(); // nada pendiente
  });

  it('si InfluxDB no responde, las líneas vuelven al frente de la cola y se reenvían en orden', () => {
    const p = pipeline();
    p.enqueue({ payload: 'a 1' });
    const r1 = p.tick({});
    p.enqueue({ payload: 'b 2' }); // llega mientras la petición falla
    p.respond({ ...r1, statusCode: undefined, error: { code: 'ECONNREFUSED' } });
    expect(p.store.get('pending')).toEqual(['a 1', 'b 2']);
    p.respond({ ...p.tick({}), statusCode: 503 });
    const r3 = p.tick({});
    expect(r3.lines).toEqual(['a 1', 'b 2']);
    p.respond({ ...r3, statusCode: 204 });
    expect(p.store.get('written')).toBe(2);
  });

  it('una petición sin respuesta en 30 s se reintenta sin perder sus líneas', () => {
    const p = pipeline();
    p.enqueue({ payload: 'a 1' });
    p.tick({});
    p.store.get('inflight').at -= 31_000;
    p.enqueue({ payload: 'b 2' });
    expect(p.tick({}).lines).toEqual(['a 1', 'b 2']);
  });

  it('un 4xx descarta el lote (datos que nunca serían aceptados) sin bloquear la cola', () => {
    const p = pipeline();
    p.enqueue({ payload: 'malformada' });
    p.respond({ ...p.tick({}), statusCode: 400, payload: 'unable to parse' });
    expect(p.store.get('pending')).toEqual([]);
    expect(p.store.get('inflight')).toBeNull();
  });

  it('envía como máximo 5000 líneas por petición y limita la cola a 20 000', () => {
    const p = pipeline();
    for (let i = 0; i < 20_050; i++) p.enqueue({ payload: `l ${i}` });
    expect(p.store.get('pending')).toHaveLength(20_000);
    expect(p.store.get('pending')[0]).toBe('l 50'); // se descartan las más antiguas
    const r = p.tick({});
    expect(r.lines).toHaveLength(5000);
    expect(p.store.get('pending')).toHaveLength(15_000);
  });
});

const rule = (file) => makeNode(src('rule-common.js') + '\n' + src(file));
const aqi = (v) => ({ payload: { variables: { us_aqi: { value: v } } } });
const rain = (v) => ({ payload: { variables: { precipitation: { value: v } } } });

describe('Node-RED · regla 1: restricción por calidad del aire', () => {
  it('activa con AQI ≥ 150, no repite órdenes y libera con AQI < 100 (histéresis)', () => {
    const n = rule('rule-air.js');
    expect(n.run(aqi(120))).toBeNull();
    const on = n.run(aqi(155));
    expect(on.topic).toBe('smartcity/DEV05/control');
    expect(on.qos).toBe(1);
    expect(on.payload).toMatchObject({ action: 'set_params', params: { demand_factor: 0.7 }, issued_by: 'nodered:restriccion_aire' });
    expect(on.payload.command_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Math.abs(Date.parse(on.payload.issued_at) - Date.now())).toBeLessThan(1000);
    expect(n.run(aqi(170))).toBeNull(); // ya activa: no repite
    expect(n.run(aqi(120))).toBeNull(); // banda de histéresis
    const off = n.run(aqi(95));
    expect(off.payload.params).toEqual({ demand_factor: 1 });
    expect(n.run(aqi(90))).toBeNull();
  });

  it('ignora mensajes sin AQI numérico', () => {
    const n = rule('rule-air.js');
    expect(n.run({ payload: {} })).toBeNull();
    expect(n.run(aqi('200'))).toBeNull();
  });
});

describe('Node-RED · regla 2: alumbrado adaptativo con lluvia', () => {
  it('sube DEV07 al 100 % con lluvia ≥ 1 mm y vuelve al 60 % con < 0,2 mm', () => {
    const n = rule('rule-rain.js');
    expect(n.run(rain(0.5))).toBeNull();
    const on = n.run(rain(1.2));
    expect(on.topic).toBe('smartcity/DEV07/control');
    expect(on.payload.params).toEqual({ night_dim_pct: 100 });
    expect(n.run(rain(0.4))).toBeNull(); // histéresis
    expect(n.run(rain(0.1)).payload.params).toEqual({ night_dim_pct: 60 });
  });
});
