import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

const respond = (status: number, body: string, contentType = 'application/json') =>
  vi.fn(async () => new Response(body, { status, headers: { 'content-type': contentType } }));

const stub = (impl: ReturnType<typeof vi.fn>) => vi.stubGlobal('fetch', impl);
const failure = (p: Promise<unknown>) => p.then(() => { throw new Error('se esperaba un error'); }, (e: unknown) => e as ApiError);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('api: respuestas correctas', () => {
  it('devuelve el JSON recibido', async () => {
    stub(respond(200, '[{"id":"DEV01"}]'));
    await expect(api('/api/devices')).resolves.toEqual([{ id: 'DEV01' }]);
  });

  it('una respuesta vacía se entrega como null', async () => {
    stub(respond(200, ''));
    await expect(api('/api/x')).resolves.toBeNull();
  });
});

describe('api: errores del servidor en lenguaje claro', () => {
  it('un 200 con JSON cortado es un error, no un dato', async () => {
    stub(respond(200, '{"id":"DEV03","live":{'));
    const e = await failure(api('/api/devices/DEV03'));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toMatch(/no se pudo leer/i);
  });

  it.each([502, 503, 504])('un %i HTML del gateway explica que el servicio no está disponible', async (status) => {
    stub(respond(status, '<html><h1>Bad Gateway</h1></html>', 'text/html'));
    const e = await failure(api('/api/devices'));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(status);
    expect(e.message).toMatch(/no está disponible/i);
    expect(e.message).not.toMatch(/\d{3}/);
  });

  it('conserva el mensaje que envía el backend en JSON', async () => {
    stub(respond(409, '{"error":"DEV03 está desconectado; la orden no se envió"}'));
    const e = await failure(api('/api/devices/DEV03/commands', { body: {}, auth: true }));
    expect(e.message).toBe('DEV03 está desconectado; la orden no se envió');
  });

  it('un error sin mensaje no enseña el código técnico como única explicación', async () => {
    stub(respond(500, '', 'text/plain'));
    const e = await failure(api('/api/x'));
    expect(e.message).not.toBe('Error 500');
    expect(e.message).toMatch(/no se pudo completar/i);
  });
});

describe('api: órdenes a dispositivos', () => {
  const record = '{"command_id":"c1","status":"timeout"}';

  it('un 504 JSON del backend es el registro de la orden', async () => {
    stub(respond(504, record));
    await expect(api('/api/devices/DEV03/commands', { body: {}, auth: true })).resolves.toEqual({ command_id: 'c1', status: 'timeout' });
  });

  it('un 504 JSON del gateway en una orden es un error', async () => {
    stub(respond(504, '{"error":"El servidor tardó demasiado en responder."}'));
    const e = await failure(api('/api/devices/DEV03/commands', { body: {}, auth: true }));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toBe('El servidor tardó demasiado en responder.');
  });

  it('un 504 HTML del gateway en una orden es un error', async () => {
    stub(respond(504, '<html>504</html>', 'text/html'));
    const e = await failure(api('/api/devices/DEV03/commands', { body: {}, auth: true }));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toMatch(/no está disponible/i);
  });
});

describe('api: red', () => {
  it('un corte de red dice que no hay conexión, sin texto del navegador', async () => {
    stub(vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const e = await failure(api('/api/devices'));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(0);
    expect(e.message).toMatch(/conexión/i);
    expect(e.message).not.toMatch(/failed to fetch/i);
  });

  it('corta la petición al superar el tiempo límite', async () => {
    vi.useFakeTimers();
    stub(vi.fn((_u: string, init: RequestInit) => new Promise((_ok, ko) => {
      init.signal!.addEventListener('abort', () => ko(new DOMException('Aborted', 'AbortError')));
    })));
    const pending = failure(api('/api/devices', { timeoutMs: 1000 }));
    await vi.advanceTimersByTimeAsync(1001);
    const e = await pending;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toMatch(/tardó demasiado/i);
  });

  it('la cancelación del llamador sigue siendo un AbortError', async () => {
    const ctrl = new AbortController();
    stub(vi.fn((_u: string, init: RequestInit) => new Promise((_ok, ko) => {
      init.signal!.addEventListener('abort', () => ko(new DOMException('Aborted', 'AbortError')));
    })));
    const pending = failure(api('/api/devices', { signal: ctrl.signal }));
    ctrl.abort();
    expect(((await pending) as unknown as Error).name).toBe('AbortError');
  });
});

describe('api: reintento automático', () => {
  const sequence = (...responses: Array<() => Response | never>) => {
    let i = 0;
    return vi.fn(async () => responses[Math.min(i++, responses.length - 1)]!());
  };
  const gateway = () => new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } });
  const good = () => new Response('[1]', { status: 200, headers: { 'content-type': 'application/json' } });
  const settle = async <T,>(p: Promise<T>) => {
    const outcome = p.then((value) => ({ value }), (error: unknown) => ({ error }));
    await vi.runAllTimersAsync();
    return outcome;
  };

  it('una lectura con 502 se repite una vez y entrega el dato', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = sequence(gateway, good);
    stub(f);
    await expect(settle(api('/api/devices'))).resolves.toEqual({ value: [1] });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('una lectura con corte de red se repite una vez', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = sequence(() => { throw new TypeError('Failed to fetch'); }, good);
    stub(f);
    await expect(settle(api('/api/devices'))).resolves.toEqual({ value: [1] });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('solo se repite una vez', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = sequence(gateway);
    stub(f);
    await settle(api('/api/devices'));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('una escritura nunca se repite', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = sequence(gateway, good);
    stub(f);
    await settle(api('/api/devices/DEV03/commands', { body: {}, auth: true }));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('un 503 deliberado del backend no se repite', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = sequence(() => new Response('{"error":"El histórico no está disponible"}', { status: 503 }));
    stub(f);
    await settle(api('/api/history/DEV03/noise_db'));
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('api: límite de solicitudes', () => {
  it('un 429 HTML de Nginx pide esperar', async () => {
    stub(respond(429, '<html>429</html>', 'text/html'));
    const e = await failure(api('/api/auth/login', { body: {} }));
    expect(e.status).toBe(429);
    expect(e.message).toMatch(/espera/i);
  });
});

describe('api: forma de la respuesta', () => {
  it('rechaza un objeto cuando se espera una lista', async () => {
    stub(respond(200, '{}'));
    const e = await failure(api('/api/alerts', { expect: 'array' }));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toMatch(/no se pudo leer/i);
  });

  it('rechaza null cuando se espera un objeto', async () => {
    stub(respond(200, 'null'));
    await expect(api('/api/health', { expect: 'object' })).rejects.toBeInstanceOf(ApiError);
  });

  it('rechaza un objeto al que le falta un campo requerido', async () => {
    stub(respond(200, '{"status":"ok"}'));
    await expect(api('/api/health', { expect: ['mqtt_messages'] })).rejects.toBeInstanceOf(ApiError);
  });

  it('acepta un objeto con los campos requeridos', async () => {
    stub(respond(200, '{"mqtt_messages":{"received":1}}'));
    await expect(api('/api/health', { expect: ['mqtt_messages'] })).resolves.toEqual({ mqtt_messages: { received: 1 } });
  });

  it('acepta la forma esperada', async () => {
    stub(respond(200, '[]'));
    await expect(api('/api/alerts', { expect: 'array' })).resolves.toEqual([]);
  });
});
