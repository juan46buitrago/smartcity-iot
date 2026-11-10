/** Comprobaciones de datos que llegan de fuera del código (almacenamiento del navegador, entradas del usuario). */
import type { ChatMsg } from './assistant';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** Rango de fechas utilizable: ambas válidas, ordenadas y dentro de años razonables. */
export function validRange(from: Date, to: Date): boolean {
  const ok = (d: Date) => Number.isFinite(d.getTime()) && d.getUTCFullYear() >= MIN_YEAR && d.getUTCFullYear() <= MAX_YEAR;
  return ok(from) && ok(to) && from.getTime() < to.getTime();
}

function isChatMsg(m: unknown): m is ChatMsg {
  if (!isRecord(m) || typeof m.id !== 'number') return false;
  if (m.role === 'user') return typeof m.text === 'string' && typeof m.agent === 'string';
  if (m.role === 'error') return typeof m.text === 'string' && typeof m.question === 'string' && typeof m.agent === 'string';
  if (m.role === 'ai') {
    const r = m.res;
    return isRecord(r) && typeof r.text === 'string' && isRecord(r.usage) && isRecord(r.ms) && (r.chart === undefined || r.chart === null || isRecord(r.chart));
  }
  return false;
}

const EMPTY_CHAT = { msgs: [] as ChatMsg[], agent: 'general' };

/** Conversación guardada en sessionStorage: lo que no tiene la forma esperada se descarta en vez de romper la página. */
export function parseStoredChat(raw: string | null): { msgs: ChatMsg[]; agent: string } {
  if (!raw) return EMPTY_CHAT;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return EMPTY_CHAT;
  }
  if (!isRecord(v) || !Array.isArray(v.msgs) || typeof v.agent !== 'string') return EMPTY_CHAT;
  return { msgs: v.msgs.filter(isChatMsg), agent: v.agent };
}
