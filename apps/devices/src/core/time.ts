/** Bucaramanga usa UTC−5 todo el año (sin horario de verano). */
export const BOGOTA_OFFSET_H = -5;

export interface LocalTime {
  hour: number; // hora decimal 0–24
  dow: number; // 0 = domingo
}

export function bogotaTime(d: Date): LocalTime {
  const local = new Date(d.getTime() + BOGOTA_OFFSET_H * 3600_000);
  return {
    hour: local.getUTCHours() + local.getUTCMinutes() / 60 + local.getUTCSeconds() / 3600,
    dow: local.getUTCDay(),
  };
}

/** Convierte una fecha local sin zona ("2026-11-05T23:00" o "...:00.000") de Bogotá a Date. */
export function fromBogotaLocal(isoLocal: string): Date {
  const clean = isoLocal.replace(/(\.\d+)?Z?$/, '');
  const withSec = clean.length === 16 ? `${clean}:00` : clean;
  return new Date(`${withSec}-05:00`);
}

/** Formato ISO con desplazamiento −05:00 (más legible en el informe). */
export function toBogotaIso(d: Date): string {
  const local = new Date(d.getTime() + BOGOTA_OFFSET_H * 3600_000);
  return local.toISOString().replace('Z', '-05:00');
}
