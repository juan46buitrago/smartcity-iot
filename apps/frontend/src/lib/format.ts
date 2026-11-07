/** Formatos en español de Colombia y hora de Bucaramanga (America/Bogota). */
export const TZ = 'America/Bogota';
const LOCALE = 'es-CO';

export function fmtNum(v: unknown, decimals = 1): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return typeof v === 'string' ? v : '—';
  return v.toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtTime(iso: string | null | undefined, withSeconds = false): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(LOCALE, { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined, hour12: false });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(LOCALE, { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtDateShort(iso: string | number): string {
  return new Date(iso).toLocaleString(LOCALE, { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'sin datos';
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 5) return 'ahora';
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

/** Categoría US AQI (EPA). */
export function aqiCategory(aqi: number): { label: string; tone: 'ok' | 'warn' | 'crit' } {
  if (aqi <= 50) return { label: 'Buena', tone: 'ok' };
  if (aqi <= 100) return { label: 'Moderada', tone: 'ok' };
  if (aqi <= 150) return { label: 'Dañina para sensibles', tone: 'warn' };
  if (aqi <= 200) return { label: 'Dañina', tone: 'crit' };
  return { label: 'Muy dañina', tone: 'crit' };
}

export function windDir(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(((deg % 360) / 45)) % 8] ?? '—';
}
