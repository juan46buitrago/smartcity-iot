/**
 * Reproducción de un dataset histórico horario (CSV) para DEV12.
 *
 * Modo "espejo": para el instante actual (hora de Bogotá) se toma la misma posición del mes en el
 * dataset —día del mes y hora— y se interpola linealmente entre las dos filas horarias vecinas.
 * Así, el 8 de noviembre de 2026 a las 15:30 se publica lo observado el 8 de noviembre de 2025
 * entre las 15:00 y las 16:00: una referencia "mismo día del año anterior" comparable con DEV01/DEV10.
 * Modo "acelerado": recorre el dataset fila a fila (N horas por lectura) para demostraciones.
 *
 * Los valores son datos reales del reanálisis; solo se cambia el momento de publicación, y la
 * marca de origen se informa en provenance.ref.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface DatasetRow {
  /** Marca local tal como viene en el CSV (AAAA-MM-DDTHH:mm, America/Bogota). */
  time: string;
  values: Record<string, number>;
}

export interface Dataset {
  columns: string[];
  rows: DatasetRow[];
  source: string;
}

/** Variables acumuladas por hora: no se interpolan (se publica el total de esa hora). */
const STEP_VARIABLES = new Set(['precipitation']);
const BOGOTA_OFFSET_MS = -5 * 3600_000;

export function parseDatasetCsv(text: string): Dataset {
  const lines = text.split(/\r?\n/);
  const comments = lines.filter((l) => l.startsWith('#')).map((l) => l.slice(1).trim());
  const data = lines.filter((l) => l.trim() && !l.startsWith('#'));
  const [header, ...body] = data;
  if (!header) throw new Error('Dataset vacío');
  const cols = header.split(',').map((c) => c.trim());
  if (cols[0] !== 'time') throw new Error('La primera columna del dataset debe ser "time"');
  const columns = cols.slice(1);
  const rows: DatasetRow[] = [];
  for (const line of body) {
    const cells = line.split(',');
    if (cells.length !== cols.length) throw new Error(`Fila con ${cells.length} columnas (se esperaban ${cols.length}): ${line}`);
    const values: Record<string, number> = {};
    columns.forEach((c, i) => {
      const v = Number(cells[i + 1]);
      if (cells[i + 1] !== '' && Number.isFinite(v)) values[c] = v;
    });
    rows.push({ time: cells[0]!.trim(), values });
  }
  if (!rows.length) throw new Error('El dataset no tiene filas');
  return { columns, rows, source: comments[0] ?? 'dataset' };
}

export function loadDataset(name = 'era5-bucaramanga-2025-11.csv'): Dataset {
  const file = fileURLToPath(new URL(`../data/${name}`, import.meta.url));
  return parseDatasetCsv(readFileSync(file, 'utf8'));
}

/** Posición fraccionaria (en filas horarias) que corresponde a `now` en modo espejo. */
export function mirrorPosition(now: Date, rowCount: number): number {
  const local = new Date(now.getTime() + BOGOTA_OFFSET_MS);
  const hours = (local.getUTCDate() - 1) * 24 + local.getUTCHours() + local.getUTCMinutes() / 60 + local.getUTCSeconds() / 3600;
  return ((hours % rowCount) + rowCount) % rowCount;
}

/** Valores en una posición fraccionaria: interpolación lineal (o escalón para acumulados), con vuelta al inicio. */
export function valuesAt(ds: Dataset, pos: number): { values: Record<string, number>; from: DatasetRow; to: DatasetRow } {
  const n = ds.rows.length;
  const i = Math.floor(pos) % n;
  const j = (i + 1) % n;
  const f = pos - Math.floor(pos);
  const a = ds.rows[i]!;
  const b = ds.rows[j]!;
  const values: Record<string, number> = {};
  for (const c of ds.columns) {
    const va = a.values[c];
    const vb = b.values[c];
    if (va === undefined) continue;
    values[c] = STEP_VARIABLES.has(c) || vb === undefined ? va : va + (vb - va) * f;
  }
  return { values, from: a, to: b };
}
