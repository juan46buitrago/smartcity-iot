/**
 * Consultas históricas a InfluxDB (token de SOLO LECTURA).
 * Todos los parámetros se interpolan con el etiquetado `flux` del cliente oficial (escapado seguro)
 * y además se validan contra el catálogo antes de llegar aquí.
 */
import { flux, fluxDateTime, fluxDuration, fluxString, InfluxDB, type QueryApi } from '@influxdata/influxdb-client';

export interface SeriesPoint {
  t: string;
  v: number;
}

export interface VariableStats {
  count: number;
  mean: number | null;
  min: number | null;
  min_at: string | null;
  max: number | null;
  max_at: string | null;
  stddev: number | null;
  first_at: string | null;
  last_at: string | null;
}

const RAW_RETENTION_MS = 30 * 24 * 3600_000;

/** Ventana de agregación para obtener ≈ maxPoints puntos. */
export function pickWindow(fromMs: number, toMs: number, maxPoints = 600): string {
  const seconds = Math.max(1, (toMs - fromMs) / 1000 / maxPoints);
  const steps = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400];
  const s = steps.find((x) => x >= seconds) ?? 86400;
  return `${s}s`;
}

export class InfluxService {
  private readonly q: QueryApi;

  constructor(private readonly cfg: { url: string; token: string; org: string; bucketRaw: string; bucketAgg: string }) {
    this.q = new InfluxDB({ url: cfg.url, token: cfg.token, timeout: 20_000 }).getQueryApi(cfg.org);
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.url}/ping`, { signal: AbortSignal.timeout(3000) });
      return res.status === 204;
    } catch {
      return false;
    }
  }

  /** Serie agregada (media) de una variable. Usa raw si el rango cabe en la retención; si no, agg_5m. */
  async series(device: string, field: string, from: Date, to: Date, maxPoints = 600): Promise<{ every: string; bucket: string; points: SeriesPoint[] }> {
    const every = pickWindow(from.getTime(), to.getTime(), maxPoints);
    const useRaw = Date.now() - from.getTime() <= RAW_RETENTION_MS;
    const query = useRaw
      ? flux`from(bucket: ${this.cfg.bucketRaw})
          |> range(start: ${fluxDateTime(from.toISOString())}, stop: ${fluxDateTime(to.toISOString())})
          |> filter(fn: (r) => r._measurement == "telemetry" and r.device_id == ${fluxString(device)} and r._field == ${fluxString(field)})
          |> aggregateWindow(every: ${fluxDuration(every)}, fn: mean, createEmpty: false)
          |> keep(columns: ["_time", "_value"])`
      : flux`from(bucket: ${this.cfg.bucketAgg})
          |> range(start: ${fluxDateTime(from.toISOString())}, stop: ${fluxDateTime(to.toISOString())})
          |> filter(fn: (r) => r._measurement == "telemetry" and r.device_id == ${fluxString(device)} and r._field == ${fluxString(field)} and r.stat == "mean")
          |> aggregateWindow(every: ${fluxDuration(every)}, fn: mean, createEmpty: false)
          |> keep(columns: ["_time", "_value"])`;
    const rows = await this.q.collectRows<{ _time: string; _value: number }>(query);
    return {
      every,
      bucket: useRaw ? this.cfg.bucketRaw : this.cfg.bucketAgg,
      points: rows.filter((r) => typeof r._value === 'number').map((r) => ({ t: r._time, v: r._value })),
    };
  }

  /** Estadísticas descriptivas sobre los datos crudos del rango. */
  async stats(device: string, field: string, from: Date, to: Date): Promise<VariableStats> {
    const base = flux`from(bucket: ${this.cfg.bucketRaw})
      |> range(start: ${fluxDateTime(from.toISOString())}, stop: ${fluxDateTime(to.toISOString())})
      |> filter(fn: (r) => r._measurement == "telemetry" and r.device_id == ${fluxString(device)} and r._field == ${fluxString(field)})
      |> filter(fn: (r) => exists r._value)`;
    const one = async (suffix: string) => {
      const rows = await this.q.collectRows<{ _time?: string; _value: number }>(`${base}\n${suffix}`);
      return rows[0];
    };
    const [count, mean, min, max, stddev, first, last] = await Promise.all([
      one('|> count()'),
      one('|> mean()'),
      one('|> min()'),
      one('|> max()'),
      one('|> stddev()'),
      one('|> first()'),
      one('|> last()'),
    ]);
    return {
      count: count?._value ?? 0,
      mean: mean?._value ?? null,
      min: min?._value ?? null,
      min_at: min?._time ?? null,
      max: max?._value ?? null,
      max_at: max?._time ?? null,
      stddev: stddev?._value ?? null,
      first_at: first?._time ?? null,
      last_at: last?._time ?? null,
    };
  }

  /** Disponibilidad: fracción de muestras de estado "online" por dispositivo en el rango. */
  async availability(from: Date, to: Date): Promise<Record<string, number>> {
    const rows = await this.q.collectRows<{ device_id: string; _value: number }>(flux`from(bucket: ${this.cfg.bucketRaw})
      |> range(start: ${fluxDateTime(from.toISOString())}, stop: ${fluxDateTime(to.toISOString())})
      |> filter(fn: (r) => r._measurement == "device_status" and r._field == "online")
      |> group(columns: ["device_id"])
      |> mean()`);
    return Object.fromEntries(rows.map((r) => [r.device_id, r._value]));
  }

  /** Número de lecturas por dispositivo (evidencia de captura). */
  async readingCounts(from: Date, to: Date): Promise<Record<string, number>> {
    const rows = await this.q.collectRows<{ device_id: string; _value: number }>(flux`from(bucket: ${this.cfg.bucketRaw})
      |> range(start: ${fluxDateTime(from.toISOString())}, stop: ${fluxDateTime(to.toISOString())})
      |> filter(fn: (r) => r._measurement == "telemetry" and r._field == "seq")
      |> group(columns: ["device_id"])
      |> count()`);
    return Object.fromEntries(rows.map((r) => [r.device_id, r._value]));
  }
}
