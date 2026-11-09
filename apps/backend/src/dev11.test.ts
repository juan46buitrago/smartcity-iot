import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Dev11Client } from './dev11.js';

let srv: Server | null = null;
afterEach(() => new Promise<void>((r) => (srv ? srv.close(() => r()) : r())));

function fake(): Promise<{ url: string; seen: string[] }> {
  const seen: string[] = [];
  return new Promise((resolve) => {
    srv = createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization !== 'Bearer secreto-secreto-1234') return void res.writeHead(401).end('{}');
      res.end(JSON.stringify({ running: req.url !== '/stop', lease_s: 150, max_s: 5400 }));
    }).listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(srv!.address() as { port: number }).port}`, seen }));
  });
}

describe('controlador de DEV11', () => {
  it('sin URL o token la función no está disponible y no hace peticiones', async () => {
    const c = new Dev11Client(undefined, undefined);
    expect(c.available).toBe(false);
    expect(await c.start()).toEqual({ available: false, running: false, lease_s: 0, max_s: 0 });
  });

  it('enciende, renueva y apaga con el token', async () => {
    const { url, seen } = await fake();
    const c = new Dev11Client(url, 'secreto-secreto-1234');
    expect((await c.start()).running).toBe(true);
    expect((await c.ping()).lease_s).toBe(150);
    expect((await c.stop()).running).toBe(false);
    expect(seen).toEqual(['POST /start Bearer secreto-secreto-1234', 'POST /ping Bearer secreto-secreto-1234', 'POST /stop Bearer secreto-secreto-1234']);
  });

  it('un token equivocado falla en vez de aparentar éxito', async () => {
    const { url } = await fake();
    await expect(new Dev11Client(url, 'otro-token-distinto-9').status()).rejects.toThrow(/401/);
  });
});
