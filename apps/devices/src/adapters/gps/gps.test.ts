import { describe, expect, it } from 'vitest';
import { seededRng } from '../../core/random.js';
import { loadRoadNetwork } from '../../sim/roads.js';
import { extractFix, parseProviderDate } from './gpsMobile.js';
import { SimulatedRouteSource } from './simulatedRoute.js';

/** Respuesta con la MISMA forma que el proveedor, con datos personales ficticios. */
const providerBody = {
  sucess: true,
  message: '',
  response: {
    iUrl: 'http://example.invalid/iconos/',
    veh: {
      FdE: '06/11/2026 10:23:35 PM',
      FdS: '06/11/2026 10:37:31 PM',
      Lt: 7.112275,
      Lg: -73.1051316,
      Vel: 27,
      Std: 0,
      Info: 'Bucaramanga, BARRIO FICTICIO. Carrera 0 con Calle 0',
      Zona: 'ZONA-X',
      Pl: 'ABC123',
      NI: '999',
      TV: 'CAMIONETA',
      Cond: 'Conductor Ficticio',
      NEv: 1,
      Clnt: 'Cliente Ficticio SAS',
      Sim: '3000000000',
      Mac: 'AA:BB:CC:DD:EE:FF',
      Bluet: null,
      ApRem: null,
      kilTotal: 12345,
      Odometro: 67890,
      BateriaExterna: 12.6,
      Alarma: null,
      Estado: null,
      Conexion: null,
      BateriaInterna: 4.1,
      Bloqueo: null,
      Remolque: null,
    },
  },
};

describe('adaptador gpsmobile — minimización de datos', () => {
  const now = new Date('2026-11-07T03:30:00Z'); // 22:30 local
  const fix = extractFix(providerBody, now);

  it('extrae solo posición, velocidad, estado y fechas', () => {
    expect(Object.keys(fix).sort()).toEqual(['lat', 'lon', 'observed_at', 'reported_at', 'speed_kmh', 'state', 'status_code']);
    expect(fix).toMatchObject({ lat: 7.112275, lon: -73.1051316, speed_kmh: 27, state: 'en_movimiento', status_code: 0 });
  });

  it('no filtra ningún dato personal', () => {
    const serialized = JSON.stringify(fix);
    for (const pii of ['ABC123', 'Conductor', 'Cliente', '3000000000', 'AA:BB', '12345', '67890', 'FICTICIO', 'CAMIONETA']) {
      expect(serialized).not.toContain(pii);
    }
  });

  it('interpreta la fecha del proveedor en hora de Colombia', () => {
    expect(parseProviderDate('06/11/2026 10:23:35 PM')!.toISOString()).toBe('2026-11-07T03:23:35.000Z');
    expect(parseProviderDate('06/11/2026 12:05:00 AM')!.toISOString()).toBe('2026-11-06T05:05:00.000Z');
    expect(parseProviderDate('no es fecha')).toBeNull();
  });

  it('marca sin_reporte cuando el dato es antiguo', () => {
    expect(extractFix(providerBody, new Date('2026-11-07T05:00:00Z')).state).toBe('sin_reporte');
  });

  it('rechaza coordenadas inválidas', () => {
    const bad = structuredClone(providerBody);
    bad.response.veh.Lt = 0;
    bad.response.veh.Lg = 0;
    expect(() => extractFix(bad, now)).toThrow();
    expect(() => extractFix({}, now)).toThrow();
  });
});

describe('ruta simulada', () => {
  it('avanza sobre la ruta real y se mantiene dentro de Bucaramanga', async () => {
    const route = loadRoadNetwork().gps_route;
    const src = new SimulatedRouteSource(route, seededRng(1));
    let t = Date.parse('2026-11-03T15:00:00Z');
    const positions = [];
    for (let i = 0; i < 120; i++) {
      positions.push(await src.fetchPosition(new Date(t)));
      t += 60_000;
    }
    for (const p of positions) {
      expect(p.lat).toBeGreaterThan(7.04);
      expect(p.lat).toBeLessThan(7.17);
      expect(p.speed_kmh).toBeGreaterThanOrEqual(0);
      expect(p.speed_kmh).toBeLessThanOrEqual(70);
    }
    expect(new Set(positions.map((p) => p.state))).toContain('en_movimiento');
    expect(src.state.pos).toBeGreaterThan(0);
  });
});
