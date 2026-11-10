/** Cliente HTTP mínimo para la API del backend (mismo origen; en desarrollo, proxy de Vite). */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: unknown) {
    super(message);
  }
}

/** 'array', 'object' o la lista de campos que el objeto debe traer. */
type ExpectedShape = 'array' | 'object' | readonly string[];

interface ApiInit {
  method?: string;
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
  /** Tiempo máximo de la petición completa, incluida la lectura del cuerpo. */
  timeoutMs?: number;
  /** Forma obligatoria de una respuesta correcta: lo que no coincide se trata como error, no como dato. */
  expect?: ExpectedShape;
}

/** Algo mayor que el límite del backend para InfluxDB (20 s): si el backend contesta, llega su propio mensaje. */
const DEFAULT_TIMEOUT_MS = 25_000;

const MESSAGES = {
  offline: 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.',
  timeout: 'El servidor tardó demasiado en responder. Inténtalo de nuevo en unos segundos.',
  unavailable: 'El servicio no está disponible en este momento. Inténtalo de nuevo en unos segundos.',
  unreadable: 'El servidor envió una respuesta que no se pudo leer. Inténtalo de nuevo en unos segundos.',
  tooMany: 'Demasiadas solicitudes seguidas. Espera un momento e inténtalo de nuevo.',
  generic: 'No se pudo completar la operación. Inténtalo de nuevo en unos segundos.',
};
const GATEWAY_STATUSES = new Set([502, 503, 504]);
/** 503 queda fuera: lo envía el backend a propósito cuando una dependencia está caída, y repetir no ayuda. */
const RETRIABLE_STATUSES = new Set([502, 504]);
const RETRY_DELAY_MS = 700;
const TIMEOUT_STATUS = 408;

let tokenGetter: () => string | null = () => null;
let onUnauthorized: () => void = () => {};

export function configureApi(getToken: () => string | null, unauthorized: () => void) {
  tokenGetter = getToken;
  onUnauthorized = unauthorized;
}

/** Lanza la petición con tiempo límite. La cancelación del llamador se propaga tal cual (AbortError). */
async function send(path: string, request: RequestInit, timeoutMs: number, callerSignal?: AbortSignal): Promise<{ res: Response; text: string }> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const forwardAbort = () => ctrl.abort();
  if (callerSignal?.aborted) ctrl.abort();
  callerSignal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const res = await fetch(path, { ...request, signal: ctrl.signal });
    return { res, text: await res.text() };
  } catch (err) {
    if (callerSignal?.aborted) throw err;
    throw timedOut ? new ApiError(TIMEOUT_STATUS, MESSAGES.timeout) : new ApiError(0, MESSAGES.offline);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', forwardAbort);
  }
}

/** Una lectura se repite una vez ante un fallo transitorio de red o del gateway. Las escrituras nunca se repiten. */
async function sendWithRetry(path: string, request: RequestInit, timeoutMs: number, callerSignal?: AbortSignal): Promise<{ res: Response; text: string }> {
  if (request.method !== 'GET') return send(path, request, timeoutMs, callerSignal);
  try {
    const first = await send(path, request, timeoutMs, callerSignal);
    if (!RETRIABLE_STATUSES.has(first.res.status)) return first;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 0) throw err;
  }
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return send(path, request, timeoutMs, callerSignal);
}

function parseBody(text: string): { valid: boolean; value: unknown } {
  if (!text) return { valid: true, value: null };
  try {
    return { valid: true, value: JSON.parse(text) };
  } catch {
    return { valid: false, value: text };
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function hasShape(value: unknown, shape?: ExpectedShape): boolean {
  if (shape === undefined) return true;
  if (shape === 'array') return Array.isArray(value);
  if (!isRecord(value)) return false;
  return shape === 'object' || shape.every((key) => key in value);
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenGetter();
  if (init.auth && token) headers.Authorization = `Bearer ${token}`;
  const { res, text } = await sendWithRetry(
    path,
    { method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined },
    init.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    init.signal,
  );
  const parsed = parseBody(text);

  // 422/504 en órdenes traen el registro de la orden en JSON: se devuelven como datos, no como error.
  // Un 504 del gateway no es un registro y sigue su camino como error.
  const isCommandRecord = (res.status === 422 || res.status === 504) && path.includes('/commands') && isRecord(parsed.value) && 'command_id' in parsed.value;
  if (res.ok || isCommandRecord) {
    if (!parsed.valid || !hasShape(parsed.value, init.expect)) throw new ApiError(res.status, MESSAGES.unreadable, parsed.value);
    return parsed.value as T;
  }

  if (res.status === 401 && init.auth) onUnauthorized();
  const backendMessage = isRecord(parsed.value) && typeof parsed.value.error === 'string' ? parsed.value.error : undefined;
  const fallback = res.status === 429 ? MESSAGES.tooMany : GATEWAY_STATUSES.has(res.status) ? MESSAGES.unavailable : MESSAGES.generic;
  throw new ApiError(res.status, backendMessage ?? fallback, parsed.value);
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
