import { describe, expect, it } from 'vitest';
import { parseStoredChat, validRange } from './guards';

describe('validRange', () => {
  const d = (s: string) => new Date(s);

  it('acepta un rango ordenado dentro de años razonables', () => {
    expect(validRange(d('2026-11-01T00:00:00-05:00'), d('2026-11-02T00:00:00-05:00'))).toBe(true);
  });

  it.each([
    ['fecha inválida', d('x'), d('2026-11-02T00:00:00Z')],
    ['año 275760', d('2026-11-01T00:00:00Z'), new Date(8.64e15)],
    ['desde posterior a hasta', d('2026-11-03T00:00:00Z'), d('2026-11-02T00:00:00Z')],
    ['año 1900', d('1900-01-01T00:00:00Z'), d('2026-11-02T00:00:00Z')],
  ])('rechaza %s', (_n, from, to) => {
    expect(validRange(from, to)).toBe(false);
  });
});

describe('parseStoredChat', () => {
  const ok = { msgs: [{ id: 1, role: 'user', text: 'hola', agent: 'general' }], agent: 'clima' };

  it('recupera una conversación guardada correctamente', () => {
    expect(parseStoredChat(JSON.stringify(ok))).toEqual(ok);
  });

  it.each([
    ['vacía', null],
    ['JSON roto', '{"msgs":['],
    ['msgs no es lista', '{"msgs":"x","agent":"general"}'],
    ['agente no es texto', '{"msgs":[],"agent":7}'],
  ])('ante una conversación %s empieza de cero', (_n, raw) => {
    expect(parseStoredChat(raw)).toEqual({ msgs: [], agent: 'general' });
  });

  it('descarta los mensajes con forma inesperada y conserva los demás', () => {
    const raw = JSON.stringify({
      msgs: [
        { id: 1, role: 'user', text: 'hola', agent: 'general' },
        { id: 2, role: 'ai' },
        { id: 3, role: 'ai', res: { text: 'x' } },
        { id: 4, role: 'error', text: 'falló', question: 'hola', agent: 'general' },
        'basura',
      ],
      agent: 'general',
    });
    expect(parseStoredChat(raw).msgs.map((m) => m.id)).toEqual([1, 4]);
  });
});
