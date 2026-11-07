import { describe, expect, it } from 'vitest';
import { DEVICE_CATALOG, DEVICE_IDS } from './catalog.js';
import { defaultConfig, DeviceConfigSchema, validateCommand } from './schemas.js';
import { parseTopic, topic } from './topics.js';

describe('catálogo', () => {
  it('tiene 10 dispositivos con ids únicos y coherentes', () => {
    expect(DEVICE_IDS).toHaveLength(10);
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
