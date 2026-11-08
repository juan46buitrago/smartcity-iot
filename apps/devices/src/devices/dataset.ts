import type { DeviceDeps, Sample } from '../core/VirtualDevice.js';
import { VirtualDevice } from '../core/VirtualDevice.js';
import { loadDataset, mirrorPosition, valuesAt, type Dataset } from '../sim/dataset.js';

const round = (v: number, d: number) => Number(v.toFixed(d));

/**
 * DEV12 — Estación histórica: reproduce el dataset ERA5 de Bucaramanga (noviembre de 2025).
 * Modo "espejo" (por defecto): mismo día y hora del año anterior. Modo "acelerado": avanza
 * `speed_h` horas del dataset en cada lectura.
 */
export class HistoricalStation extends VirtualDevice {
  private readonly ds: Dataset;
  private cursor: number;

  constructor(deps: DeviceDeps, ds: Dataset = loadDataset()) {
    super('DEV12', deps);
    this.ds = ds;
    this.cursor = this.store.get<number>(this.id, 'cursor') ?? 0;
  }

  protected override async sample(now: Date): Promise<Sample> {
    let pos: number;
    if (this.config.mode === 'acelerado') {
      pos = this.cursor % this.ds.rows.length;
      this.cursor = (this.cursor + this.param<number>('speed_h')) % this.ds.rows.length;
      this.store.set(this.id, 'cursor', this.cursor);
    } else {
      pos = mirrorPosition(now, this.ds.rows.length);
    }
    const { values, from, to } = valuesAt(this.ds, pos);
    return {
      variables: {
        temperature: round(values.temperature ?? NaN, 1),
        humidity: round(values.humidity ?? NaN, 0),
        precipitation: round(values.precipitation ?? NaN, 2),
        pressure: round(values.pressure ?? NaN, 1),
        wind_speed: round(values.wind_speed ?? NaN, 1),
        solar_radiation: round(values.solar_radiation ?? NaN, 0),
      },
      provenance: {
        provider: 'Open-Meteo Historical Weather (ERA5, Copernicus) — dataset CSV',
        synthetic: false,
        ref: `era5-bucaramanga-2025-11.csv ${from.time}${this.config.mode === 'acelerado' ? '' : ` → ${to.time}`}`,
      },
    };
  }
}
