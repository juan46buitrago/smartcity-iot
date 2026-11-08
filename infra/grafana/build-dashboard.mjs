#!/usr/bin/env node
/**
 * Genera el tablero de Grafana "Smart City Bucaramanga — Análisis" (infra/grafana/dashboards).
 * Uso: node infra/grafana/build-dashboard.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DS = { type: 'influxdb', uid: 'influx-scbga' };
let id = 0;

const series = (device, fields) => `from(bucket: "raw")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r._measurement == "telemetry" and r.device_id == "${device}")
  |> filter(fn: (r) => ${fields.map((f) => `r._field == "${f}"`).join(' or ')})
  |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false)
  |> keep(columns: ["_time", "_value", "_field"])`;

function ts(title, device, fields, unit, gridPos, { synthetic = false, desc } = {}) {
  return {
    id: ++id,
    type: 'timeseries',
    title: `${title}${synthetic ? ' · sintético' : ''}`,
    description: desc ?? (synthetic ? 'Datos sintéticos (simulación o gemelo digital): no son mediciones reales.' : 'Datos de fuente externa real.'),
    datasource: DS,
    gridPos,
    targets: [{ refId: 'A', datasource: DS, query: series(device, fields) }],
    fieldConfig: { defaults: { unit, custom: { lineWidth: 2, fillOpacity: 12, showPoints: 'never', spanNulls: true } }, overrides: [] },
    options: { legend: { displayMode: 'list', placement: 'bottom' }, tooltip: { mode: 'multi' } },
  };
}

function stat(title, device, field, unit, gridPos, thresholds) {
  return {
    id: ++id,
    type: 'stat',
    title,
    datasource: DS,
    gridPos,
    targets: [{ refId: 'A', datasource: DS, query: `from(bucket: "raw")
  |> range(start: -6h)
  |> filter(fn: (r) => r._measurement == "telemetry" and r.device_id == "${device}" and r._field == "${field}")
  |> last()
  |> keep(columns: ["_value"])` }],
    fieldConfig: { defaults: { unit, decimals: 1, thresholds: { mode: 'absolute', steps: thresholds } }, overrides: [] },
    options: { colorMode: 'background', graphMode: 'none', reduceOptions: { calcs: ['lastNotNull'] } },
  };
}

const green = { color: 'green', value: null };
const panels = [
  stat('Temperatura (DEV01)', 'DEV01', 'temperature', 'celsius', { x: 0, y: 0, w: 4, h: 4 }, [green, { color: 'orange', value: 30 }, { color: 'red', value: 33 }]),
  stat('AQI (DEV02)', 'DEV02', 'us_aqi', 'none', { x: 4, y: 0, w: 4, h: 4 }, [green, { color: 'yellow', value: 51 }, { color: 'orange', value: 101 }, { color: 'red', value: 151 }]),
  stat('Congestión de red (DEV04, sim.)', 'DEV04', 'congestion_index', 'percent', { x: 8, y: 0, w: 4, h: 4 }, [green, { color: 'orange', value: 60 }, { color: 'red', value: 80 }]),
  stat('Ocupación parqueadero (DEV08)', 'DEV08', 'occupancy_pct', 'percent', { x: 12, y: 0, w: 4, h: 4 }, [green, { color: 'orange', value: 85 }, { color: 'red', value: 95 }]),
  stat('Nivel río MAJADAS (DEV09)', 'DEV09', 'water_level', 'lengthm', { x: 16, y: 0, w: 4, h: 4 }, [green, { color: 'orange', value: 2 }, { color: 'red', value: 3 }]),
  stat('Potencia alumbrado (DEV07)', 'DEV07', 'power_w', 'watt', { x: 20, y: 0, w: 4, h: 4 }, [green, { color: 'orange', value: 5000 }]),

  ts('Temperatura y humedad (gemelo digital)', 'DEV01', ['temperature', 'humidity'], 'none', { x: 0, y: 4, w: 12, h: 8 }, { synthetic: true }),
  ts('Temperatura de referencia Open-Meteo (DEV10)', 'DEV10', ['temperature'], 'celsius', { x: 12, y: 4, w: 12, h: 8 }),
  ts('Calidad del aire (Open-Meteo, modelo CAMS)', 'DEV02', ['us_aqi', 'pm2_5', 'pm10'], 'none', { x: 0, y: 12, w: 12, h: 8 }),
  ts('Ruido urbano', 'DEV03', ['noise_db'], 'dB', { x: 12, y: 12, w: 12, h: 8 }, { synthetic: true }),
  ts('Red vial: congestión y velocidad media', 'DEV04', ['congestion_index', 'network_speed_kmh', 'active_incidents'], 'none', { x: 0, y: 20, w: 12, h: 8 }, { synthetic: true }),
  ts('Detector Cra 27: flujo y velocidad', 'DEV05', ['vehicles_per_min', 'avg_speed_kmh'], 'none', { x: 12, y: 20, w: 12, h: 8 }, { synthetic: true }),
  ts('Alumbrado: nivel y luz ambiente', 'DEV07', ['light_level', 'ambient_lux'], 'none', { x: 0, y: 28, w: 12, h: 8 }, { synthetic: true }),
  ts('Parqueadero: ocupación', 'DEV08', ['occupied', 'free_spaces'], 'none', { x: 12, y: 28, w: 12, h: 8 }, { synthetic: true }),
  ts('Nivel del río (IDEAM MAJADAS)', 'DEV09', ['water_level'], 'lengthm', { x: 0, y: 36, w: 12, h: 8 }, { desc: 'Observaciones reales del IDEAM con su marca de tiempo original (publicación con ~1 día de retraso).' }),
  ts('Meteorología: viento, presión y lluvia', 'DEV10', ['wind_speed', 'pressure', 'precipitation'], 'none', { x: 12, y: 36, w: 12, h: 8 }),
  {
    id: ++id,
    type: 'barchart',
    title: 'Incidentes simulados creados por tipo · sintético',
    description: 'Eventos del simulador probabilístico de DEV04. No son reportes reales.',
    datasource: DS,
    gridPos: { x: 0, y: 44, w: 12, h: 8 },
    targets: [{ refId: 'A', datasource: DS, query: `from(bucket: "raw")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r._measurement == "incident_events" and r.event == "incident_created" and r.test == "false" and r._field == "speed_impact")
  |> group(columns: ["type"])
  |> count()
  |> group()
  |> keep(columns: ["type", "_value"])` }],
    options: { orientation: 'horizontal', xField: 'type', showValue: 'always', legend: { showLegend: false } },
    fieldConfig: { defaults: {}, overrides: [] },
  },
  {
    id: ++id,
    type: 'state-timeline',
    title: 'Conexión de dispositivos',
    datasource: DS,
    gridPos: { x: 12, y: 44, w: 12, h: 8 },
    targets: [{ refId: 'A', datasource: DS, query: `from(bucket: "raw")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r._measurement == "device_status" and r._field == "online")
  |> keep(columns: ["_time", "_value", "device_id"])
  |> group(columns: ["device_id"])` }],
    fieldConfig: {
      defaults: { mappings: [{ type: 'value', options: { 0: { text: 'desconectado', color: 'red' }, 1: { text: 'en línea', color: 'green' } } }], thresholds: { mode: 'absolute', steps: [{ color: 'red', value: null }, { color: 'green', value: 1 }] } },
      overrides: [],
    },
    options: { mergeValues: true, showValue: 'never' },
  },
];

// --- Procesamiento: promedio, mínimo y máximo según el rango elegido en el selector de tiempo ---
const STATS_SERIES = [
  'DEV01.temperature', 'DEV01.humidity', 'DEV02.us_aqi', 'DEV02.pm2_5', 'DEV03.noise_db', 'DEV04.congestion_index',
  'DEV05.vehicles_per_min', 'DEV05.avg_speed_kmh', 'DEV07.power_w', 'DEV08.occupancy_pct', 'DEV09.water_level',
  'DEV10.temperature', 'DEV10.precipitation', 'DEV11.temperature', 'DEV11.humidity', 'DEV11.light_pct',
  'DEV12.temperature', 'DEV12.humidity', 'DEV12.precipitation',
];
const statsQuery = `data = from(bucket: "raw")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r._measurement == "telemetry")
  |> filter(fn: (r) => contains(value: r.device_id + "." + r._field, set: ${JSON.stringify(STATS_SERIES)}))
  |> toFloat()
  |> keep(columns: ["device_id", "_field", "_value"])
tag = (tables=<-, name) => tables |> keep(columns: ["device_id", "_field", "_value"]) |> map(fn: (r) => ({r with stat: name}))
union(tables: [
  data |> mean() |> tag(name: "promedio"),
  data |> min() |> tag(name: "minimo"),
  data |> max() |> tag(name: "maximo"),
  data |> count() |> toFloat() |> tag(name: "lecturas"),
])
  |> group()
  |> pivot(rowKey: ["device_id", "_field"], columnKey: ["stat"], valueColumn: "_value")
  |> sort(columns: ["device_id", "_field"])`;

panels.push(
  {
    id: ++id,
    type: 'table',
    title: 'Resumen estadístico del rango seleccionado (promedio · mínimo · máximo)',
    description: 'Calculado por InfluxDB sobre los datos crudos del rango elegido arriba a la derecha (ajuste de tiempo).',
    datasource: DS,
    gridPos: { x: 0, y: 52, w: 24, h: 11 },
    targets: [{ refId: 'A', datasource: DS, query: statsQuery }],
    fieldConfig: {
      defaults: { decimals: 2 },
      overrides: [
        { matcher: { id: 'byName', options: 'device_id' }, properties: [{ id: 'displayName', value: 'Dispositivo' }] },
        { matcher: { id: 'byName', options: '_field' }, properties: [{ id: 'displayName', value: 'Variable' }] },
        { matcher: { id: 'byName', options: 'lecturas' }, properties: [{ id: 'decimals', value: 0 }] },
      ],
    },
    options: { showHeader: true, cellHeight: 'sm' },
    transformations: [{ id: 'organize', options: { indexByName: { device_id: 0, _field: 1, promedio: 2, minimo: 3, maximo: 4, lecturas: 5 } } }],
  },
  {
    id: ++id,
    type: 'timeseries',
    title: 'Temperatura: gemelo (DEV01) vs API (DEV10) vs mismo día de 2025 (DEV12, dataset)',
    description: 'DEV12 reproduce el reanálisis ERA5 del mismo día y hora del año anterior: referencia histórica real.',
    datasource: DS,
    gridPos: { x: 0, y: 63, w: 12, h: 8 },
    targets: [{ refId: 'A', datasource: DS, query: `from(bucket: "raw")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r._measurement == "telemetry" and r._field == "temperature" and (r.device_id == "DEV01" or r.device_id == "DEV10" or r.device_id == "DEV12"))
  |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false)
  |> keep(columns: ["_time", "_value", "device_id"])` }],
    fieldConfig: { defaults: { unit: 'celsius', custom: { lineWidth: 2, fillOpacity: 0, showPoints: 'never', spanNulls: true } }, overrides: [] },
    options: { legend: { displayMode: 'list', placement: 'bottom' }, tooltip: { mode: 'multi' } },
  },
  ts('Nodo ESP32 en Wokwi (DEV11): temperatura, humedad, luz y relé', 'DEV11', ['temperature', 'humidity', 'light_pct', 'relay'], 'none', { x: 12, y: 63, w: 12, h: 8 }, { desc: 'Firmware real por MQTT/TLS 8883; en Wokwi los sensores los ajusta una persona con los controles del simulador.' }),
  ts('Estación histórica ERA5 (DEV12): lluvia, radiación y viento', 'DEV12', ['precipitation', 'solar_radiation', 'wind_speed'], 'none', { x: 0, y: 71, w: 24, h: 8 }, { desc: 'Dataset CSV real (reanálisis ERA5, nov. 2025) reproducido en modo espejo.' }),
);

const dashboard = {
  uid: 'scbga-analisis',
  title: 'Smart City Bucaramanga — Análisis',
  tags: ['smartcitybga', 'iot'],
  timezone: 'America/Bogota',
  refresh: '30s',
  time: { from: 'now-24h', to: 'now' },
  schemaVersion: 39,
  version: 1,
  editable: false,
  panels,
};

const out = join(dirname(fileURLToPath(import.meta.url)), 'dashboards', 'smartcitybga.json');
writeFileSync(out, JSON.stringify(dashboard, null, 2) + '\n');
console.log(`Tablero con ${panels.length} paneles → ${out}`);
