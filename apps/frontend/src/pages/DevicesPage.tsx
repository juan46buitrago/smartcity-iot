import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltip } from '../components/ChartTooltip';
import { CATEGORY_LABEL, DeviceGlyph, DeviceIcon } from '../components/DeviceIcon';
import { DeviceControls } from '../components/DeviceControls';
import { Badge, Card, CardHeader, Empty, PageHeader, ProvenanceTag, STATE_LABEL, Segmented, StatusDot, cx } from '../components/ui';
import { api } from '../lib/api';
import { fmtDateTime, fmtNum, fmtTime, timeAgo } from '../lib/format';
import { useLive } from '../lib/live';
import { deviceState } from '../lib/state';
import type { CommandRecord, DeviceView } from '../lib/types';

const SOURCE_LABEL = { simulated: 'Simulado', digital_twin: 'Gemelo digital', api: 'API externa', dataset: 'Dataset abierto', real: 'Dispositivo físico (ESP32)' } as const;

function fmtVar(d: DeviceView, k: string) {
  const spec = d.variables.find((v) => v.key === k)!;
  const val = d.live.telemetry?.variables[k]?.value;
  return { text: typeof val === 'number' ? fmtNum(val, spec.decimals ?? 1) : val === undefined || val === null ? '—' : String(val).replace(/_/g, ' '), unit: typeof val === 'number' ? spec.unit : null, spec };
}

export function DevicesPage() {
  const { list } = useLive();
  const [cat, setCat] = useState<string>('todas');
  const filtered = list.filter((d) => cat === 'todas' || d.category === cat);
  return (
    <div>
      <PageHeader
        code="02 · Red IoT"
        title="Dispositivos"
        subtitle="Once nodos identificables (10 virtuales y un ESP32 real). Cada uno es un cliente MQTT independiente con credencial propia, último testamento (LWT) y control remoto con confirmación."
        action={<Segmented ariaLabel="Categoría" value={cat} onChange={setCat} options={[{ value: 'todas', label: 'Todos' }, ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))]} />}
      />

      <Card className="overflow-hidden">
        {/* Encabezado de tabla (escritorio) */}
        <div className="hidden grid-cols-[72px_minmax(0,1.6fr)_130px_150px_minmax(0,1.6fr)_110px] gap-4 border-b border-line bg-surface-2/50 px-5 py-2.5 lg:grid">
          {['Nodo', 'Dispositivo', 'Estado', 'Fuente', 'Lecturas actuales', 'Actualizado'].map((h) => (
            <span key={h} className="label text-[11px]">
              {h}
            </span>
          ))}
        </div>
        <ul className="divide-y divide-line">
          {filtered.map((d, i) => {
            const st = deviceState(d);
            const t = d.live.telemetry;
            const vars = d.variables.filter((v) => v.key !== 'lat' && v.key !== 'lon').slice(0, 3);
            return (
              <li key={d.id} className="rise" style={{ ['--i' as string]: i }}>
                <Link
                  to={`/dispositivos/${d.id}`}
                  className="grid grid-cols-[56px_1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-surface-2 lg:grid-cols-[72px_minmax(0,1.6fr)_130px_150px_minmax(0,1.6fr)_110px]"
                >
                  <span className="display text-[40px] font-bold text-ink-3">{d.id.slice(3)}</span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-[16px] font-semibold">
                      <DeviceIcon id={d.id} className="size-4 shrink-0 text-ink-3" />
                      <span className="truncate">{d.name}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-ink-3">
                      <span className="code">{d.id}</span> · {CATEGORY_LABEL[d.category]} · {t?.location.name ?? d.location.name}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 justify-self-end text-[13px] font-semibold lg:justify-self-start">
                    <StatusDot state={st} />
                    <span className={cx(st === 'offline' && 'text-crit', st === 'degraded' && 'text-warn')}>{STATE_LABEL[st]}</span>
                  </span>
                  <span className="col-span-3 flex items-center gap-2 lg:col-span-1">
                    <ProvenanceTag synthetic={t?.provenance.synthetic ?? d.provenance.synthetic} compact />
                    <span className="text-[13px] text-ink-2">{SOURCE_LABEL[t?.source_type ?? d.source_type]}</span>
                  </span>
                  <span className="col-span-3 flex flex-wrap gap-x-5 gap-y-1 lg:col-span-1">
                    {vars.map((v) => {
                      const f = fmtVar(d, v.key);
                      return (
                        <span key={v.key} className="min-w-0">
                          <span className="block text-[11px] text-ink-3">{v.label}</span>
                          <span className="display text-[22px] font-semibold">
                            {f.text}
                            {f.unit && <span className="ml-1 text-[14px] text-ink-3">{f.unit}</span>}
                          </span>
                        </span>
                      );
                    })}
                  </span>
                  <span className="col-span-3 text-[13px] text-ink-3 lg:col-span-1">
                    {t ? timeAgo(t.timestamp) : 'sin lecturas'}
                    {d.live.config && <span className="block text-[11px]">cada {d.live.config.interval_s} s{d.modes.length > 1 ? ` · ${d.live.config.mode}` : ''}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

const RANGES = [
  { value: '1', label: '1 h' },
  { value: '6', label: '6 h' },
  { value: '24', label: '24 h' },
  { value: '120', label: '5 d' },
];

function MiniHistory({ d }: { d: DeviceView }) {
  const numeric = d.variables.filter((v) => v.kind === 'number' && v.key !== 'lat' && v.key !== 'lon');
  const [variable, setVariable] = useState(numeric[0]?.key ?? '');
  const [hours, setHours] = useState('6');
  const [data, setData] = useState<{ t: number; v: number }[] | null>(null);
  const spec = numeric.find((v) => v.key === variable);
  const lastTs = d.live.telemetry?.timestamp;

  useEffect(() => {
    if (!variable) return;
    const ctrl = new AbortController();
    const from = new Date(Date.now() - Number(hours) * 3600_000).toISOString();
    api<{ points: { t: string; v: number }[] }>(`/api/history/${d.id}/${variable}?from=${encodeURIComponent(from)}&points=300`, { signal: ctrl.signal })
      .then((r) => setData(r.points.map((p) => ({ t: Date.parse(p.t), v: p.v }))))
      .catch(() => {});
    return () => ctrl.abort();
  }, [d.id, variable, hours, lastTs]);

  if (!numeric.length) return null;
  return (
    <Card>
      <CardHeader eyebrow="Histórico" title={`${spec?.label ?? ''}${spec?.unit ? ` (${spec.unit})` : ''}`} action={<Segmented ariaLabel="Rango" value={hours} onChange={setHours} options={RANGES} />} />
      {numeric.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-5 pt-4">
          {numeric.map((v) => (
            <button
              key={v.key}
              onClick={() => setVariable(v.key)}
              className={cx('h-8 rounded-[4px] border px-3 text-[13px] font-semibold transition-colors', v.key === variable ? 'border-ink bg-ink text-bg' : 'border-line-strong text-ink-2 hover:text-ink')}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
      <div className="h-72 px-2 pt-4 pb-3">
        {data && data.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 20, bottom: 0, left: 4 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v) => fmtTime(new Date(v).toISOString())} stroke="var(--ink-3)" fontSize={12} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={48} />
              <YAxis stroke="var(--ink-3)" fontSize={12} tickLine={false} axisLine={false} width={52} domain={['auto', 'auto']} tickFormatter={(v) => fmtNum(v, spec?.decimals && spec.decimals > 1 ? 2 : 0)} />
              <Tooltip
                cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
                content={<ChartTooltip format={(v) => `${fmtNum(v, spec?.decimals ?? 1)} ${spec?.unit ?? ''}`} labels={{ v: spec?.label ?? '' }} />}
              />
              <Line type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Empty title={data ? 'Sin datos suficientes en este rango' : 'Cargando…'}>{d.source_type === 'api' || d.source_type === 'dataset' ? 'Las fuentes externas solo publican cuando hay una observación nueva.' : undefined}</Empty>
        )}
      </div>
    </Card>
  );
}

function CommandLog({ id }: { id: string }) {
  const { lastCommand } = useLive();
  const [rows, setRows] = useState<CommandRecord[]>([]);
  useEffect(() => {
    api<CommandRecord[]>(`/api/devices/${id}/commands?limit=15`).then(setRows).catch(() => {});
  }, [id, lastCommand?.command_id, lastCommand?.status]);
  const tone = { confirmed: 'ok', rejected: 'crit', timeout: 'warn', pending: 'info' } as const;
  const label = { confirmed: 'Confirmada', rejected: 'Rechazada', timeout: 'Sin respuesta', pending: 'Pendiente' };
  return (
    <Card>
      <CardHeader eyebrow="Auditoría" title="Órdenes recientes" />
      {rows.length === 0 ? (
        <Empty title="Sin órdenes registradas">Las órdenes enviadas desde la consola o por reglas de Node-RED quedan auditadas aquí con su confirmación.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line">
                {['Hora', 'Acción', 'Parámetros', 'Origen', 'Resultado'].map((h) => (
                  <th key={h} className="label px-5 py-2.5 text-[11px] font-semibold first:pl-5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.command_id}>
                  <td className="code px-5 py-2.5 whitespace-nowrap text-ink-2">{fmtDateTime(r.issued_at)}</td>
                  <td className="code px-5 py-2.5">{r.action}</td>
                  <td className="code max-w-56 truncate px-5 py-2.5 text-ink-2" title={JSON.stringify(r.params)}>
                    {JSON.stringify(r.params)}
                  </td>
                  <td className="px-5 py-2.5 text-ink-2">{r.issued_by}</td>
                  <td className="px-5 py-2.5">
                    <Badge tone={tone[r.status]}>{label[r.status]}</Badge>
                    {r.error && <span className="ml-2 text-crit">{r.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function DeviceDetail() {
  const { id = '' } = useParams();
  const { devices, loaded } = useLive();
  const d = devices[id.toUpperCase()];
  if (!d) return loaded ? <Empty title="Dispositivo no encontrado" /> : <p className="text-sm text-ink-3">Cargando…</p>;

  const st = deviceState(d);
  const t = d.live.telemetry;
  const vars = d.variables.filter((v) => !(d.id === 'DEV06' && (v.key === 'lat' || v.key === 'lon')));
  const synthetic = t?.provenance.synthetic ?? d.provenance.synthetic;

  return (
    <div className="space-y-5">
      <Link to="/dispositivos" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" /> Todos los dispositivos
      </Link>

      {/* Identidad */}
      <section className="rise grid gap-6 border-b border-line pb-6 lg:grid-cols-[auto_1fr_auto] lg:items-end">
        <span className="display text-[110px] font-extrabold leading-[0.8] text-ink-3 sm:text-[140px]">{d.id.slice(3)}</span>
        <div className="min-w-0">
          <p className="label">
            {d.id} · {CATEGORY_LABEL[d.category]} · {SOURCE_LABEL[t?.source_type ?? d.source_type]}
          </p>
          <h1 className="display mt-2 text-[44px] font-bold uppercase sm:text-[56px]">{d.name}</h1>
          <p className="mt-2 max-w-[72ch] text-[15px] text-ink-2">{d.description}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-[13px] lg:text-right">
          <div>
            <dt className="label text-[11px]">Estado</dt>
            <dd className="mt-1 flex items-center gap-2 font-semibold lg:justify-end">
              <StatusDot state={st} /> {STATE_LABEL[st]}
            </dd>
          </div>
          <div>
            <dt className="label text-[11px]">Procedencia</dt>
            <dd className="mt-1 lg:flex lg:justify-end">
              <ProvenanceTag synthetic={synthetic} />
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="label text-[11px]">Ubicación</dt>
            <dd className="mt-1 text-ink-2">
              {t?.location.name ?? d.location.name} · <span className="code">{fmtNum(t?.location.lat ?? d.location.lat, 4)}, {fmtNum(t?.location.lon ?? d.location.lon, 4)}</span>
            </dd>
          </div>
        </dl>
      </section>
      {d.live.status?.reason && <p className="rounded-[5px] border border-warn/40 bg-warn-soft px-4 py-2.5 text-[13px] text-warn">{d.live.status.reason}</p>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="space-y-5">
          {/* Lecturas */}
          <Card className="rise overflow-hidden" style={{ ['--i' as string]: 1 }}>
            <CardHeader eyebrow="Última lectura" title={t ? `${fmtDateTime(t.timestamp)} · ${timeAgo(t.timestamp)}` : 'Sin lecturas aún'} action={<DeviceGlyph device={d} size="sm" />} />
            <dl className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 [&>div]:border-r [&>div]:border-b [&>div]:border-line">
              {vars.map((v) => {
                const f = fmtVar(d, v.key);
                const cal = d.live.config?.calibration[v.key];
                return (
                  <div key={v.key} className="px-5 py-4">
                    <dt className="text-[13px] text-ink-3">{v.label}</dt>
                    <dd key={f.text} className="display tick mt-1 text-[40px] font-bold">
                      {f.text}
                      {f.unit && <span className="ml-1 text-[18px] font-semibold text-ink-3">{f.unit}</span>}
                    </dd>
                    {cal ? <dd className="code text-ink-3">calibración {cal > 0 ? '+' : ''}{cal}</dd> : null}
                  </div>
                );
              })}
            </dl>
            {t && (
              <p className="px-5 py-3 text-xs text-ink-3">
                {t.provenance.provider}
                {t.provenance.ref ? ` · ${t.provenance.ref}` : ''} · secuencia <span className="code">#{t.seq}</span> · recibido {fmtTime(t.ingested_at, true)}
              </p>
            )}
          </Card>
          <MiniHistory d={d} />
          <CommandLog id={d.id} />
        </div>

        <Card className="rise h-fit xl:sticky xl:top-24" style={{ ['--i' as string]: 2 }}>
          <CardHeader eyebrow="Control bidireccional" title="Órdenes al dispositivo" />
          <DeviceControls device={d} />
        </Card>
      </div>
    </div>
  );
}

