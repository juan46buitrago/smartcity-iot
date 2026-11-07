import { bogotaTime } from '../core/time.js';

/**
 * Demanda relativa de tráfico (0–1) por hora local para Bucaramanga.
 * Perfil sintético inspirado en la forma típica de ciudades colombianas:
 * picos de mañana (6:30–8:30), mediodía (11:30–14:00) y tarde (17:00–19:30).
 */
const WEEKDAY = [0.12, 0.08, 0.06, 0.06, 0.12, 0.35, 0.75, 1.0, 0.85, 0.65, 0.62, 0.7, 0.85, 0.8, 0.68, 0.66, 0.72, 0.92, 1.0, 0.82, 0.6, 0.45, 0.32, 0.2];
const SATURDAY = [0.18, 0.12, 0.09, 0.07, 0.08, 0.18, 0.35, 0.5, 0.62, 0.7, 0.75, 0.8, 0.82, 0.78, 0.72, 0.7, 0.72, 0.75, 0.72, 0.62, 0.52, 0.42, 0.33, 0.25];
const SUNDAY = SATURDAY.map((v) => v * 0.7);

function interp(profile: number[], hour: number): number {
  const h0 = Math.floor(hour) % 24;
  const h1 = (h0 + 1) % 24;
  const t = hour - Math.floor(hour);
  return profile[h0]! * (1 - t) + profile[h1]! * t;
}

export function trafficDemand(d: Date): number {
  const { hour, dow } = bogotaTime(d);
  const profile = dow === 0 ? SUNDAY : dow === 6 ? SATURDAY : WEEKDAY;
  return interp(profile, hour);
}
