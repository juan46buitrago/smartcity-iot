/**
 * Adaptador de gpsmobile.co.
 *
 * MINIMIZACIÓN DE DATOS: la respuesta del proveedor contiene datos personales (placa, conductor,
 * cliente, SIM, MAC, odómetro, dirección…). `extractFix` aplica una lista blanca y descarta todo
 * lo demás en el propio límite del adaptador. La respuesta cruda nunca se registra ni se reenvía.
 */
import { fetchJson } from '../../core/http.js';
import { deriveState, type GpsFix, type GpsSource } from './types.js';

export interface GpsMobileSettings {
  baseUrl: string; // p. ej. http://gpsmobile.co:4000
  vehiclePath: string; // p. ej. /api/DetalleVehiculo/<id>/<id>
  user?: string;
  pass?: string;
}

/** "06/11/2026 10:23:35 PM" (hora de Colombia, UTC−5) → Date. */
export function parseProviderDate(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ?([AP]M)$/i.exec(s.trim());
  if (!m) return null;
  const [, dd, MM, yyyy, hh, mi, ss, ap] = m as unknown as string[];
  let h = Number(hh) % 12;
  if (ap!.toUpperCase() === 'PM') h += 12;
  const d = new Date(Date.UTC(Number(yyyy), Number(MM) - 1, Number(dd), h + 5, Number(mi), Number(ss)));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Lista blanca: solo Lt, Lg, Vel, Std, FdE y FdS. */
export function extractFix(body: unknown, now: Date): GpsFix {
  const veh = (body as { response?: { veh?: Record<string, unknown> } } | null)?.response?.veh;
  if (!veh || typeof veh !== 'object') throw new Error('Respuesta GPS sin bloque de vehículo');
  const lat = Number(veh.Lt);
  const lon = Number(veh.Lg);
  const speed = Number(veh.Vel);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) {
    throw new Error('Coordenadas GPS inválidas');
  }
  const observed = parseProviderDate(veh.FdE);
  if (!observed) throw new Error('Fecha GPS inválida');
  const speedKmh = Number.isFinite(speed) && speed >= 0 && speed < 250 ? speed : 0;
  const code = Number(veh.Std);
  return {
    lat,
    lon,
    speed_kmh: speedKmh,
    state: deriveState(speedKmh, observed, now),
    status_code: veh.Std !== null && Number.isInteger(code) ? code : null,
    observed_at: observed,
    reported_at: parseProviderDate(veh.FdS),
  };
}

export class GpsMobileSource implements GpsSource {
  readonly kind = 'gpsmobile' as const;
  readonly synthetic = false;
  readonly provider = 'gpsmobile.co';

  constructor(private readonly s: GpsMobileSettings) {
    if (!/^https?:\/\/[^\s/]+$/.test(s.baseUrl)) throw new Error('GPS_API_BASE_URL inválida');
    if (!/^\/api\/[A-Za-z0-9/_-]+$/.test(s.vehiclePath)) throw new Error('GPS_VEHICLE_PATH inválida');
  }

  async fetchPosition(now: Date): Promise<GpsFix> {
    const headers: Record<string, string> = {};
    if (this.s.user && this.s.pass) headers.Authorization = 'Basic ' + Buffer.from(`${this.s.user}:${this.s.pass}`).toString('base64');
    const body = await fetchJson<unknown>(this.s.baseUrl + this.s.vehiclePath, { headers, timeoutMs: 15_000 });
    return extractFix(body, now);
  }
}
