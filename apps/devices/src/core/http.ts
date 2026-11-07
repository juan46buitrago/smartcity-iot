/** fetch con tiempo de espera y agente identificable; nunca incluye el cuerpo en los errores. */
export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 15_000, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { 'User-Agent': 'SmartCityBGA/0.1 (proyecto academico)', Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${new URL(url).host}`);
  return (await res.json()) as T;
}
