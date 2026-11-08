import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEVICE_CATALOG, DEVICE_IDS, EXTERNAL_DEVICE_IDS, VIRTUAL_DEVICE_IDS } from './catalog.js';
import { AckSchema, defaultConfig, DeviceConfigSchema, StatusSchema, TelemetrySchema, validateCommand } from './schemas.js';
import { parseTopic, topic } from './topics.js';

describe('catálogo', () => {
  it('tiene 11 dispositivos (10 virtuales + DEV11 externo) con ids únicos y coherentes', () => {
    expect(DEVICE_IDS).toHaveLength(11);
    expect(VIRTUAL_DEVICE_IDS).toHaveLength(10);
    expect(EXTERNAL_DEVICE_IDS).toEqual(['DEV11']);
    for (const id of DEVICE_IDS) expect(DEVICE_CATALOG[id].id).toBe(id);
  });

  it('cada dispositivo tiene ubicación en el área de Bucaramanga', () => {
    for (const id of DEVICE_IDS) {
      const { lat, lon } = DEVICE_CATALOG[id].location;
      expect(lat).toBeGreaterThan(7.0);
      expect(lat).toBeLessThan(7.2);
      expect(lon).toBeGreaterThan(-73.2);
      expect(lon).toBeLessThan(-73.0);
    }
  });

  it('genera configuraciones por defecto válidas', () => {
    for (const id of DEVICE_IDS) expect(DeviceConfigSchema.safeParse(defaultConfig(id)).success).toBe(true);
  });
});

describe('validación de órdenes', () => {
  it('acepta un intervalo dentro de los límites', () => {
    expect(validateCommand('DEV01', 'set_interval', { interval_s: 30 })).toEqual({ ok: true, params: { interval_s: 30 } });
  });
  it('rechaza un intervalo de API demasiado corto (protege el límite de la API)', () => {
    expect(validateCommand('DEV10', 'set_interval', { interval_s: 10 }).ok).toBe(false);
  });
  it('rechaza acciones no soportadas', () => {
    expect(validateCommand('DEV09', 'set_mode', { mode: 'normal' }).ok).toBe(false);
    expect(validateCommand('DEV01', 'inject_test_incident', {}).ok).toBe(false);
  });
  it('rechaza parámetros desconocidos o fuera de rango', () => {
    expect(validateCommand('DEV04', 'set_params', { intensity: 9 }).ok).toBe(false);
    expect(validateCommand('DEV04', 'set_params', { hack: 1 }).ok).toBe(false);
    expect(validateCommand('DEV04', 'set_params', {}).ok).toBe(false);
    expect(validateCommand('DEV04', 'set_params', { intensity: 2 }).ok).toBe(true);
  });
  it('valida coherencia de umbrales', () => {
    expect(validateCommand('DEV03', 'set_thresholds', { variable: 'noise_db', threshold: { warn_high: 90, crit_high: 80 } }).ok).toBe(false);
    expect(validateCommand('DEV03', 'set_thresholds', { variable: 'noise_db', threshold: { warn_high: 70, crit_high: 80 } }).ok).toBe(true);
  });
  it('limita la calibración a variables calibrables', () => {
    expect(validateCommand('DEV01', 'calibrate', { variable: 'temperature', offset: -0.5 }).ok).toBe(true);
    expect(validateCommand('DEV01', 'calibrate', { variable: 'pressure', offset: 1 }).ok).toBe(false);
  });
  it('restringe la fuente GPS a valores permitidos', () => {
    expect(validateCommand('DEV06', 'set_params', { source: 'gpsmobile' }).ok).toBe(true);
    expect(validateCommand('DEV06', 'set_params', { source: 'http://evil' }).ok).toBe(false);
  });
});

describe('tópicos', () => {
  it('construye y analiza tópicos', () => {
    expect(topic('DEV05', 'control')).toBe('smartcity/DEV05/control');
    expect(parseTopic('smartcity/DEV05/ack')).toEqual({ deviceId: 'DEV05', channel: 'ack' });
    expect(parseTopic('other/DEV05/ack')).toBeNull();
    expect(parseTopic('smartcity/DEV05/foo')).toBeNull();
  });
});

describe('DEV11 (ESP32 real)', () => {
  it('es un dispositivo de tipo real con sus acciones', () => {
    const d = DEVICE_CATALOG.DEV11;
    expect(d.source_type).toBe('real');
    expect(d.actions).toEqual(expect.arrayContaining(['power', 'set_interval', 'set_mode', 'set_params', 'set_thresholds', 'calibrate', 'restart']));
  });
  it('acepta telemetría con source_type real', () => {
    const t = {
      device_id: 'DEV11', timestamp: '2026-11-08T15:00:00.000Z', ingested_at: '2026-11-08T15:00:00.000Z',
      location: { lat: 7.1166, lon: -73.1056, name: 'Campus UNAB (aprox.)' }, status: 'online', source_type: 'real',
      provenance: { provider: 'ESP32 DevKit + DHT22 + LDR (simulado en Wokwi)', synthetic: true, ref: 'wokwi' },
      variables: { temperature: { value: 24.5, unit: '°C' }, relay: { value: 0, unit: null } }, seq: 1,
    };
    expect(TelemetrySchema.safeParse(t).success).toBe(true);
  });
  it('valida set_params del relé y el umbral de luz', () => {
    expect(validateCommand('DEV11', 'set_params', { relay: true }).ok).toBe(true);
    expect(validateCommand('DEV11', 'set_params', { light_threshold_pct: 45 }).ok).toBe(true);
    expect(validateCommand('DEV11', 'set_params', { light_threshold_pct: 130 }).ok).toBe(false);
    expect(validateCommand('DEV11', 'set_params', { relay: 'si' }).ok).toBe(false);
  });
  it('permite calibrar temperatura y humedad pero no la luz', () => {
    expect(validateCommand('DEV11', 'calibrate', { variable: 'temperature', offset: -1.5 }).ok).toBe(true);
    expect(validateCommand('DEV11', 'calibrate', { variable: 'humidity', offset: 2 }).ok).toBe(true);
    expect(validateCommand('DEV11', 'calibrate', { variable: 'light_pct', offset: 2 }).ok).toBe(false);
  });
  it('rechaza acciones no soportadas', () => {
    expect(validateCommand('DEV11', 'inject_test_incident', {}).ok).toBe(false);
  });
});

/** Las muestras de firmware/dev11-esp32/samples son exactamente lo que construye el sketch. */
describe('contrato del firmware DEV11', () => {
  const dir = fileURLToPath(new URL('../../../firmware/dev11-esp32/samples/', import.meta.url));
  const load = (f: string) => JSON.parse(readFileSync(dir + f, 'utf8'));
  it('telemetry.json cumple TelemetrySchema', () => {
    const r = TelemetrySchema.safeParse(load('telemetry.json'));
    expect(r.success).toBe(true);
  });
  it('status-online.json y status-offline.json cumplen StatusSchema', () => {
    expect(StatusSchema.safeParse(load('status-online.json')).success).toBe(true);
    expect(StatusSchema.safeParse(load('status-offline.json')).success).toBe(true);
  });
  it('config.json cumple DeviceConfigSchema', () => {
    expect(DeviceConfigSchema.safeParse(load('config.json')).success).toBe(true);
  });
  it('ack-ok.json y ack-error.json cumplen AckSchema', () => {
    expect(AckSchema.safeParse(load('ack-ok.json')).success).toBe(true);
    expect(AckSchema.safeParse(load('ack-error.json')).success).toBe(true);
  });
  it('los comandos de ejemplo se validan contra el catálogo', () => {
    const cmds = load('commands.json') as { action: never; params: unknown; valid: boolean }[];
    for (const c of cmds) expect(validateCommand('DEV11', c.action, c.params).ok).toBe(c.valid);
  });
});
