import { describe, expect, it } from 'vitest';
import { isLinkStale, parseLiveEvent, wellFormedDevices } from './liveData';

const device = (id: string) => ({ id, name: id, variables: [], live: { status: null, config: null, telemetry: null } });

describe('wellFormedDevices', () => {
  it('conserva los dispositivos completos', () => {
    expect(wellFormedDevices([device('DEV01'), device('DEV02')]).map((d) => d.id)).toEqual(['DEV01', 'DEV02']);
  });

  it('descarta los dispositivos sin estado en vivo o sin variables', () => {
    const list = [{ id: 'DEV01' }, { id: 'DEV02', live: {}, variables: 'x' }, null, 'DEV03', device('DEV04')];
    expect(wellFormedDevices(list).map((d) => d.id)).toEqual(['DEV04']);
  });
});

describe('parseLiveEvent', () => {
  it('acepta un evento con tipo y datos', () => {
    expect(parseLiveEvent('{"type":"telemetry","data":{"device_id":"DEV01"}}')).toEqual({ type: 'telemetry', data: { device_id: 'DEV01' } });
  });

  it.each([
    ['texto que no es JSON', 'hola'],
    ['JSON cortado', '{"type":"telemetry","data":{'],
    ['sin tipo', '{"data":{}}'],
    ['sin datos', '{"type":"status"}'],
    ['datos nulos', '{"type":"status","data":null}'],
    ['una lista', '[1,2]'],
  ])('descarta %s', (_name, raw) => {
    expect(parseLiveEvent(raw)).toBeNull();
  });
});

describe('isLinkStale', () => {
  it('el enlace sigue vivo mientras llegan mensajes', () => {
    expect(isLinkStale(10_000, 50_000, 45_000)).toBe(false);
  });

  it('el enlace está congelado si pasa el límite sin mensajes', () => {
    expect(isLinkStale(10_000, 56_000, 45_000)).toBe(true);
  });
});
