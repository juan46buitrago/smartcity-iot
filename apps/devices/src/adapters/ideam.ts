/**
 * Niveles de río del IDEAM publicados en datos.gov.co (Socrata, dataset bdmn-sqnh,
 * "Nivel Instantáneo del Río"). Las fechas se publican en hora local de Colombia.
 */
import { fetchJson } from '../core/http.js';
import { fromBogotaLocal } from '../core/time.js';

export const IDEAM_DATASET = 'bdmn-sqnh';

export interface LevelObservation {
  observed_at: Date;
  level_m: number;
  /** Fecha tal como la publica IDEAM (local, sin zona); se usa como cursor. */
  raw_time: string;
}

interface Row {
  fechaobservacion: string;
  valorobservado: string;
}

const LOCAL_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Observaciones posteriores a `afterLocal` en orden ascendente (máx. 200 por consulta). */
export async function levelsAfter(station: string, afterLocal: string | null, appToken?: string): Promise<LevelObservation[]> {
  if (!/^\d{8,10}$/.test(station)) throw new Error('Código de estación inválido');
  // Sin cursor: últimas 48 h (hora local de Colombia).
  const since = afterLocal ?? new Date(Date.now() - (48 + 5) * 3600_000).toISOString().slice(0, 19);
  if (!LOCAL_TS.test(since)) throw new Error('Fecha de corte inválida');
  const params = new URLSearchParams({
    $select: 'fechaobservacion,valorobservado',
    $where: `codigoestacion='${station}' AND fechaobservacion > '${since.slice(0, 19)}'`,
    $order: 'fechaobservacion ASC',
    $limit: '200',
  });
  const rows = await fetchJson<Row[]>(`https://www.datos.gov.co/resource/${IDEAM_DATASET}.json?${params}`, {
    headers: appToken ? { 'X-App-Token': appToken } : {},
    timeoutMs: 30_000,
  });
  return rows
    .filter((r) => typeof r.fechaobservacion === 'string' && LOCAL_TS.test(r.fechaobservacion))
    .map((r) => ({ raw_time: r.fechaobservacion, observed_at: fromBogotaLocal(r.fechaobservacion), level_m: Number(r.valorobservado) }))
    .filter((o) => Number.isFinite(o.level_m) && !Number.isNaN(o.observed_at.getTime()));
}
