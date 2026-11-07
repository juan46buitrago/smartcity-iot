/** Posición mínima necesaria del vehículo. Ningún otro dato del proveedor entra al sistema. */
export interface GpsFix {
  lat: number;
  lon: number;
  speed_kmh: number;
  state: 'en_movimiento' | 'detenido' | 'sin_reporte';
  /** Código de estado del proveedor (semántica no documentada); se guarda sin interpretar. */
  status_code: number | null;
  observed_at: Date;
  reported_at: Date | null;
}

/** Fuente de posición intercambiable (API real o ruta simulada). */
export interface GpsSource {
  readonly kind: 'gpsmobile' | 'simulated_route';
  readonly synthetic: boolean;
  readonly provider: string;
  fetchPosition(now: Date): Promise<GpsFix>;
}

export const MOVING_THRESHOLD_KMH = 3;
export const STALE_AFTER_MS = 15 * 60_000;

export function deriveState(speed: number, observedAt: Date, now: Date): GpsFix['state'] {
  if (now.getTime() - observedAt.getTime() > STALE_AFTER_MS) return 'sin_reporte';
  return speed > MOVING_THRESHOLD_KMH ? 'en_movimiento' : 'detenido';
}
