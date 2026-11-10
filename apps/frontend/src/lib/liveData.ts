/** Validaciones puras de los datos en vivo: lo que no tiene la forma esperada se descarta en vez de romper la interfaz. */
import type { DeviceView } from './types';

/** El backend envía un latido cada 20 s; sin ningún mensaje en este plazo el enlace se da por congelado. */
export const LINK_STALE_AFTER_MS = 45_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function wellFormedDevices(list: unknown[]): DeviceView[] {
  return list.filter((d): d is DeviceView => isRecord(d) && typeof d.id === 'string' && isRecord(d.live) && Array.isArray(d.variables));
}

export function parseLiveEvent(raw: string): { type: string; data: any } | null {
  let ev: unknown;
  try {
    ev = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(ev) || typeof ev.type !== 'string' || !isRecord(ev.data)) return null;
  return { type: ev.type, data: ev.data };
}

export function isLinkStale(lastMessageAt: number, now: number, limitMs = LINK_STALE_AFTER_MS): boolean {
  return now - lastMessageAt > limitMs;
}
