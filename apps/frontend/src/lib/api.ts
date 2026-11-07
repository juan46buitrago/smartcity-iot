/** Cliente HTTP mínimo para la API del backend (mismo origen; en desarrollo, proxy de Vite). */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: unknown) {
    super(message);
  }
}

let tokenGetter: () => string | null = () => null;
let onUnauthorized: () => void = () => {};

export function configureApi(getToken: () => string | null, unauthorized: () => void) {
  tokenGetter = getToken;
  onUnauthorized = unauthorized;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenGetter();
  if (init.auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  // 422/504 en órdenes traen el registro de la orden: se devuelven como datos, no como error.
  if (res.ok || ((res.status === 422 || res.status === 504) && path.includes('/commands'))) return body as T;
  if (res.status === 401 && init.auth) onUnauthorized();
  const msg = (body as { error?: string } | null)?.error ?? `Error ${res.status}`;
  throw new ApiError(res.status, msg, body);
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
