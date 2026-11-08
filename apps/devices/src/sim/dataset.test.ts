import { describe, expect, it } from 'vitest';
import { loadDataset, mirrorPosition, parseDatasetCsv, valuesAt } from './dataset.js';

const CSV = `# Fuente de prueba
time,temperature,precipitation
2025-11-01T00:00,20,0.5
2025-11-01T01:00,22,1.0
2025-11-01T02:00,24,0.0`;

describe('dataset (DEV12)', () => {
  it('lee el CSV con comentarios y cabecera', () => {
    const ds = parseDatasetCsv(CSV);
    expect(ds.columns).toEqual(['temperature', 'precipitation']);
    expect(ds.rows).toHaveLength(3);
    expect(ds.source).toBe('Fuente de prueba');
  });

  it('rechaza filas con columnas de más o de menos', () => {
    expect(() => parseDatasetCsv('time,a\n2025-11-01T00:00,1,2')).toThrow(/columnas/);
  });

  it('interpola linealmente, salvo la precipitación (acumulado horario)', () => {
    const v = valuesAt(parseDatasetCsv(CSV), 0.5);
    expect(v.values.temperature).toBe(21);
    expect(v.values.precipitation).toBe(0.5);
    expect(v.from.time).toBe('2025-11-01T00:00');
  });

  it('da la vuelta al final del dataset', () => {
    const v = valuesAt(parseDatasetCsv(CSV), 2.5);
    expect(v.values.temperature).toBe(22); // entre 24 (última) y 20 (primera)
  });

  it('modo espejo: mismo día del mes y hora de Bogotá', () => {
    // 8 nov 2026 15:30 en Bogotá = 20:30 UTC → día 8, hora 15.5 → (7*24 + 15.5) = 183.5
    expect(mirrorPosition(new Date('2026-11-08T20:30:00Z'), 720)).toBeCloseTo(183.5, 6);
    // Día 31 de otro mes envuelve sobre las 720 h del dataset
    expect(mirrorPosition(new Date('2026-12-31T05:00:00Z'), 720)).toBe(0);
  });

  it('el dataset versionado es válido: 720 horas de noviembre 2025 sin huecos', () => {
    const ds = loadDataset();
    expect(ds.rows).toHaveLength(720);
    expect(ds.rows[0]!.time).toBe('2025-11-01T00:00');
    expect(ds.rows.at(-1)!.time).toBe('2025-11-30T23:00');
    for (const r of ds.rows) expect(Object.keys(r.values)).toHaveLength(ds.columns.length);
    const temps = ds.rows.map((r) => r.values.temperature!);
    expect(Math.min(...temps)).toBeGreaterThan(10);
    expect(Math.max(...temps)).toBeLessThan(35);
  });
});
