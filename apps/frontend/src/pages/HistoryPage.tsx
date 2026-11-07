import { DEVICE_CATALOG, DEVICE_IDS, type DeviceId } from '@scbga/shared';
import { Download, Plus, X } from 'lucide-react';
import { ChartTooltip } from '../components/ChartTooltip';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, Card, CardHeader, Empty, Field, PageHeader, ProvenanceTag, Segmented, Switch, inputCls } from '../components/ui';
import { api, qs } from '../lib/api';
import { fmtDateShort, fmtDateTime, fmtNum } from '../lib/format';

// Paleta categórica validada (skill dataviz): orden fijo, nunca cíclico; definida por tema en index.css.
const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
const PRESETS = [
  { value: '1', label: '1 h' },
  { value: '24', label: '24 h' },
  { value: '120', label: '5 días' },
  { value: '168', label: '7 días' },
  { value: 'custom', label: 'Personalizado' },
];

interface Serie {
  key: string;
  device_id: DeviceId;
  variable: string;
  label: string;
  unit: string | null;
  every: string;
  points: { t: string; v: number }[];
}
interface Stats {
  count: number;
  mean: number | null;
  min: number | null;
  min_at: string | null;
  max: number | null;
  max_at: string | null;
  stddev: number | null;
  synthetic: boolean;
}

const numericVars = (d: DeviceId) => DEVICE_CATALOG[d].variables.filter((v) => v.kind === 'number' && v.key !== 'lat' && v.key !== 'lon');

/** Fecha local (Bogotá) para inputs datetime-local. */
function toLocalInput(d: Date) {
  return new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 16);
}
function fromLocalInput(s: string) {
  return new Date(`${s}:00-05:00`);
}

function SeriesPicker({ value, onChange, onRemove, color }: { value: { d: DeviceId; v: string }; onChange: (x: { d: DeviceId; v: string }) => void; onRemove?: () => void; color: string }) {
  return (
    <div className="flex items-end gap-2">
      <span className="mb-[18px] h-[3px] w-5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <Field label="Dispositivo">
        <select className={inputCls} value={value.d} onChange={(e) => onChange({ d: e.target.value as DeviceId, v: numericVars(e.target.value as DeviceId)[0]!.key })}>
          {DEVICE_IDS.filter((id) => numericVars(id).length).map((id) => (
            <option key={id} value={id}>
              {id} · {DEVICE_CATALOG[id].name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Variable">
        <select className={inputCls} value={value.v} onChange={(e) => onChange({ ...value, v: e.target.value })}>
          {numericVars(value.d).map((v) => (
            <option key={v.key} value={v.key}>
              {v.label} {v.unit ? `(${v.unit})` : ''}
            </option>
          ))}
        </select>
      </Field>
      {onRemove && (
        <button onClick={onRemove} className="mb-1 grid size-9 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Quitar serie">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

function exportCsv(series: Serie[]) {
  const rows = ['serie,dispositivo,variable,unidad,tiempo_utc,valor,ventana'];
  for (const s of series) for (const p of s.points) rows.push([s.key, s.device_id, s.variable, s.unit ?? '', p.t, p.v, s.every].join(','));
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `smartcitybga-historico-${new Date().toISOString().slice(0, 16).replace(':', '')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function HistoryPage() {
  const [picks, setPicks] = useState<{ d: DeviceId; v: string }[]>([{ d: 'DEV01', v: 'temperature' }]);
  const [preset, setPreset] = useState('24');
  const [custom, setCustom] = useState({ from: toLocalInput(new Date(Date.now() - 5 * 86400_000)), to: toLocalInput(new Date()) });
  const [normalize, setNormalize] = useState(false);
  const [series, setSeries] = useState<Serie[] | null>(null);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const range = useMemo(() => {
    if (preset === 'custom') return { from: fromLocalInput(custom.from), to: fromLocalInput(custom.to) };
    const to = new Date();
    return { from: new Date(to.getTime() - Number(preset) * 3600_000), to };
  }, [preset, custom, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    const q = { from: range.from.toISOString(), to: range.to.toISOString() };
    api<{ series: Serie[] }>(`/api/compare${qs({ ...q, series: picks.map((p) => `${p.d}.${p.v}`).join(','), points: 500 })}`, { signal: ctrl.signal })
      .then((r) => setSeries(r.series))
      .catch((e) => !ctrl.signal.aborted && setError((e as Error).message));
    Promise.all(picks.map((p) => api<Stats>(`/api/stats/${p.d}/${p.v}${qs(q)}`, { signal: ctrl.signal }).then((s) => [`${p.d}.${p.v}`, s] as const)))
      .then((xs) => setStats(Object.fromEntries(xs)))
      .catch(() => {});
    return () => ctrl.abort();
  }, [picks, range]);

  // Datos combinados por instante para Recharts (opcionalmente normalizados 0–100 %).
  const chart = useMemo(() => {
    if (!series) return [];
    const map = new Map<number, Record<string, number>>();
    for (const s of series) {
      const vals = s.points.map((p) => p.v);
      const min = Math.min(...vals);
      const span = Math.max(...vals) - min || 1;
      for (const p of s.points) {
        const t = Date.parse(p.t);
        const row = map.get(t) ?? { t };
        row[s.key] = normalize ? ((p.v - min) / span) * 100 : p.v;
        map.set(t, row);
      }
    }
    return [...map.values()].sort((a, b) => a.t! - b.t!);
  }, [series, normalize]);

  const anySynthetic = picks.some((p) => DEVICE_CATALOG[p.d].provenance.synthetic || p.d === 'DEV06');

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <PageHeader code="04 · Series temporales" title="Histórico" subtitle="Datos almacenados en InfluxDB: compare variables, consulte promedio, mínimo y máximo por rango y exporte a CSV. No se generan datos retroactivos." />

      <Card className="rise p-5">
        <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            {picks.map((p, i) => (
              <SeriesPicker key={i} value={p} color={COLORS[i]!} onChange={(x) => setPicks((ps) => ps.map((y, j) => (j === i ? x : y)))} onRemove={picks.length > 1 ? () => setPicks((ps) => ps.filter((_, j) => j !== i)) : undefined} />
            ))}
            {picks.length < 4 && (
              <Button size="sm" variant="ghost" onClick={() => setPicks((ps) => [...ps, { d: 'DEV10', v: 'pressure' }])}>
                <Plus className="size-4" /> Comparar con otra variable
              </Button>
            )}
          </div>
          <div className="space-y-3 lg:w-[460px]">
            <Field label="Rango">
              <Segmented ariaLabel="Rango de fechas" value={preset} onChange={setPreset} options={PRESETS} />
            </Field>
            {preset === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Desde (hora local)">
                  <input type="datetime-local" className={inputCls} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                </Field>
                <Field label="Hasta">
                  <input type="datetime-local" className={inputCls} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
                </Field>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink-2">Normalizar (0–100 %) para comparar escalas</span>
              <Switch checked={normalize} onChange={setNormalize} label="Normalizar series" />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          eyebrow={`${fmtDateTime(range.from.toISOString())} → ${fmtDateTime(range.to.toISOString())}`}
          title="Series temporales"
          action={
            <div className="flex flex-wrap gap-2">
              <Segmented ariaLabel="Vista" value={view} onChange={setView} options={[{ value: 'chart', label: 'Gráfico' }, { value: 'table', label: 'Tabla' }]} />
              <Button size="sm" variant="ghost" onClick={() => setTick((t) => t + 1)}>
                Actualizar
              </Button>
              <Button size="sm" disabled={!series?.length} onClick={() => series && exportCsv(series)}>
                <Download className="size-4" /> CSV
              </Button>
            </div>
          }
        />
        {anySynthetic && (
          <p className="mx-5 mt-4 flex items-center gap-2 text-[13px] text-ink-2">
            <ProvenanceTag synthetic compact /> Incluye datos sintéticos (simulación o gemelo digital): no son mediciones reales.
          </p>
        )}
        <div className="h-[380px] px-2 pt-3 pb-4">
          {error ? (
            <Empty title="No se pudo consultar el histórico">{error}</Empty>
          ) : view === 'table' && series ? (
            <DataTable series={series} />
          ) : chart.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v) => fmtDateShort(v)} stroke="var(--ink-3)" fontSize={12} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={70} />
                <YAxis stroke="var(--ink-3)" fontSize={12} tickLine={false} axisLine={false} width={60} domain={['auto', 'auto']} tickFormatter={(v) => fmtNum(v, 1) + (normalize ? ' %' : '')} />
                <Tooltip
                  cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
                  content={
                    <ChartTooltip
                      format={(v, k) => {
                        const sr = series?.find((x) => x.key === k);
                        return normalize ? `${fmtNum(v, 1)} %` : `${fmtNum(v, 2)} ${sr?.unit ?? ''}`;
                      }}
                      labels={Object.fromEntries((series ?? []).map((sr) => [sr.key, sr.label]))}
                    />
                  }
                />
                {(series?.length ?? 0) > 1 && (
                  <Legend formatter={(k) => <span style={{ color: 'var(--ink-2)' }}>{series?.find((sr) => sr.key === k)?.label ?? k}</span>} iconType="plainline" wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                )}
                {series?.map((sr, i) => (
                  <Line key={sr.key} type="monotone" dataKey={sr.key} stroke={COLORS[i]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty title={series ? 'Sin datos en el rango seleccionado' : 'Cargando…'}>El histórico comienza cuando el sistema empezó a capturar; no se generan datos retroactivos.</Empty>
          )}
        </div>
        {series?.[0] && <p className="px-5 pb-4 text-[11px] text-ink-3">Agregación: media por ventana de {series[0].every}. Fuente: bucket «raw» de InfluxDB.</p>}
      </Card>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Estadísticas">
        {picks.map((p, i) => {
          const key = `${p.d}.${p.v}`;
          const s = stats[key];
          const v = DEVICE_CATALOG[p.d].variables.find((x) => x.key === p.v)!;
          const dec = v.decimals ?? 1;
          return (
            <Card key={key} className="rise p-5" style={{ ['--i' as string]: i }}>
              <div className="flex items-center gap-2">
                <span className="h-[3px] w-5 shrink-0 rounded-full" style={{ background: COLORS[i] }} aria-hidden />
                <p className="truncate text-[15px] font-semibold">
                  {DEVICE_CATALOG[p.d].name} · {v.label}
                </p>
              </div>
              {s && s.count > 0 ? (
                <dl className="mt-4 grid grid-cols-3 border-t border-line">
                  {[
                    ['Promedio', s.mean],
                    ['Mínimo', s.min],
                    ['Máximo', s.max],
                  ].map(([k, val]) => (
                    <div key={k as string} className="py-3">
                      <dt className="label text-[11px]">{k}</dt>
                      <dd className="display mt-1 text-[30px] font-bold">{fmtNum(val as number, dec)}</dd>
                    </div>
                  ))}
                  <div className="col-span-3 space-y-1 border-t border-line pt-3 text-left text-xs text-ink-3">
                    <p>
                      Desv. estándar <span className="num text-ink-2">{fmtNum(s.stddev, dec + 1)}</span> {v.unit} · <span className="num text-ink-2">{s.count.toLocaleString('es-CO')}</span> lecturas
                    </p>
                    <p>
                      Mín. {fmtDateTime(s.min_at)} · Máx. {fmtDateTime(s.max_at)}
                    </p>
                    <p>
                      <ProvenanceTag synthetic={s.synthetic} compact />
                    </p>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-ink-3">Sin lecturas en el rango.</p>
              )}
            </Card>
          );
        })}
      </section>

      <IncidentAnalysis from={range.from} to={range.to} />
      <CaptureEvidence from={range.from} to={range.to} />
    </div>
  );
}

function IncidentAnalysis({ from, to }: { from: Date; to: Date }) {
  const [d, setD] = useState<{ byType: { type: string; n: number }[]; bySeverity: { severity: string; n: number }[]; byHour: { hour: number; n: number }[]; duration: { type: string; avg_min: number }[] } | null>(null);
  useEffect(() => {
    api<typeof d>(`/api/incidents/stats${qs({ from: from.toISOString(), to: to.toISOString() })}`).then(setD).catch(() => {});
  }, [from, to]);
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, n: d?.byHour.find((x) => x.hour === h)?.n ?? 0 }));
  const total = d?.byType.reduce((a, b) => a + b.n, 0) ?? 0;
  const label: Record<string, string> = { accidente: 'Accidentes', vehiculo_averiado: 'Averiados', cierre_parcial: 'Cierres parciales', congestion: 'Congestión' };
  return (
    <Card>
      <CardHeader eyebrow="Movilidad · DEV04" title="Incidentes simulados en el rango" action={<ProvenanceTag synthetic />} />
      {total === 0 ? (
        <Empty title="Sin incidentes en el rango">El modelo probabilístico admite periodos prolongados sin eventos.</Empty>
      ) : (
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_2fr]">
          <dl className="grid grid-cols-2 gap-2">
            {d!.byType.map((t) => (
              <div key={t.type} className="border-b border-line py-2">
                <dt className="text-[13px] text-ink-3">{label[t.type] ?? t.type}</dt>
                <dd className="display text-[32px] font-bold">{t.n}</dd>
                <dd className="text-[11px] text-ink-3">dur. media {fmtNum(d!.duration.find((x) => x.type === t.type)?.avg_min ?? null, 0)} min</dd>
              </div>
            ))}
            <div className="col-span-2 text-xs text-ink-2">
              Gravedad: {d!.bySeverity.map((s) => `${s.severity} ${s.n}`).join(' · ')}
            </div>
          </dl>
          <div className="h-52">
            <p className="mb-1 text-xs text-ink-3">Incidentes por hora del día (hora local)</p>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hours} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="hour" stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} />
                <defs>
                  <pattern id="sim-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="5" height="5" fill="var(--surface-3)" />
                    <line x1="0" y1="0" x2="0" y2="5" stroke="var(--ink-2)" strokeWidth="2" />
                  </pattern>
                </defs>
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip format={(v) => `${v} incidentes`} labels={{ n: 'Simulados' }} labelFormat={(h) => `${h}:00 – ${h}:59`} />} />
                <Bar dataKey="n" fill="url(#sim-hatch)" stroke="var(--ink-2)" strokeWidth={1} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Card>
  );
}

function CaptureEvidence({ from, to }: { from: Date; to: Date }) {
  const [d, setD] = useState<{ readings: Record<string, number>; availability: Record<string, number> } | null>(null);
  useEffect(() => {
    api<typeof d>(`/api/capture${qs({ from: from.toISOString(), to: to.toISOString() })}`).then(setD).catch(() => {});
  }, [from, to]);
  return (
    <Card>
      <CardHeader eyebrow="Evidencia de captura" title="Lecturas almacenadas y disponibilidad por dispositivo" />
      <div className="mt-3 overflow-x-auto pb-2">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-ink-3">
            <tr className="border-b border-line">
              <th className="px-5 py-2 font-medium">Dispositivo</th>
              <th className="px-2 py-2 font-medium">Procedencia</th>
              <th className="px-2 py-2 text-right font-medium">Lecturas</th>
              <th className="px-5 py-2 text-right font-medium">Disponibilidad*</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {DEVICE_IDS.map((id) => (
              <tr key={id}>
                <td className="px-5 py-2">
                  <span className="num text-ink-3">{id}</span> {DEVICE_CATALOG[id].name}
                </td>
                <td className="px-2 py-2">
                  <ProvenanceTag synthetic={DEVICE_CATALOG[id].provenance.synthetic} compact />
                </td>
                <td className="num px-2 py-2 text-right">{(d?.readings[id] ?? 0).toLocaleString('es-CO')}</td>
                <td className="num px-5 py-2 text-right">{d?.availability[id] !== undefined ? `${fmtNum(d.availability[id]! * 100, 1)} %` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-5 pb-4 text-[11px] text-ink-3">* Proporción de mensajes de estado «en línea» registrados en el rango.</p>
    </Card>
  );
}

/** Vista de tabla de las series (accesibilidad y alivio de contraste exigido por la validación dataviz). */
function DataTable({ series }: { series: Serie[] }) {
  const times = [...new Set(series.flatMap((sr) => sr.points.map((p) => p.t)))].sort().reverse().slice(0, 300);
  const maps = series.map((sr) => new Map(sr.points.map((p) => [p.t, p.v])));
  return (
    <div className="h-full overflow-auto px-3">
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line">
            <th className="label px-2 py-2 text-[11px]">Hora</th>
            {series.map((sr, i) => (
              <th key={sr.key} className="label px-2 py-2 text-right text-[11px]">
                <span className="mr-1.5 inline-block h-[3px] w-3 rounded-full align-middle" style={{ background: COLORS[i] }} />
                {sr.label} {sr.unit ? `(${sr.unit})` : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {times.map((t) => (
            <tr key={t}>
              <td className="code px-2 py-1.5 text-ink-2">{fmtDateShort(t)}</td>
              {maps.map((m, i) => (
                <td key={i} className="num px-2 py-1.5 text-right">
                  {m.has(t) ? fmtNum(m.get(t)!, 2) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
