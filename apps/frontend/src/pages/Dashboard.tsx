import { DEVICE_IDS, type DeviceId } from '@scbga/shared';
import { ArrowUpRight, Navigation } from 'lucide-react';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Nodo } from '../components/Nodo';
import { Sparkline } from '../components/Sparkline';
import { Card, ProvenanceTag, STATE_LABEL, StatusDot, cx } from '../components/ui';
import { aqiCategory, fmtNum, fmtTime, greetingCO, timeAgo, windDir } from '../lib/format';
import { useAssistant } from '../lib/assistant';
import { isOnline, useLive } from '../lib/live';
import { deviceState } from '../lib/state';
import type { DeviceView } from '../lib/types';

export { deviceState };

const CityMap = lazy(() => import('../components/CityMap').then((m) => ({ default: m.CityMap })));
const MapLegend = lazy(() => import('../components/CityMap').then((m) => ({ default: m.MapLegend })));

const INCIDENT_LABEL: Record<string, string> = { accidente: 'Accidente', vehiculo_averiado: 'Vehículo averiado', cierre_parcial: 'Cierre parcial', congestion: 'Congestión' };

function useNow(ms = 10000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

function num(d: DeviceView | undefined, k: string): number | null {
  const v = d?.live.telemetry?.variables[k]?.value;
  return typeof v === 'number' ? v : null;
}

/* ------------------------------------------------------------------ */
/* Lectura de instrumento                                              */
/* ------------------------------------------------------------------ */

interface ReadoutProps {
  device: DeviceId;
  variable: string;
  label: string;
  decimals?: number;
  children?: ReactNode;
  index: number;
}

function Readout({ device, variable, label, decimals = 1, children, index }: ReadoutProps) {
  const { devices, spark, loaded } = useLive();
  const now = useNow();
  const d = devices[device];
  const t = d?.live.telemetry;
  const value = num(d, variable);
  const unit = d?.variables.find((v) => v.key === variable)?.unit ?? '';
  const series = spark(device, variable);
  const lo = series.length ? Math.min(...series) : null;
  const hi = series.length ? Math.max(...series) : null;
  const st = deviceState(d);

  return (
    <Link to={`/dispositivos/${device}`} className="group rise block px-5 py-4 transition-colors hover:bg-surface-2" style={{ ['--i' as string]: index }}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[14px] font-semibold text-ink-2">
          <StatusDot state={st} />
          {label}
        </p>
        <span className="flex items-center gap-2">
          {t && <ProvenanceTag synthetic={t.provenance.synthetic} compact />}
          <span className="code text-ink-3">{device}</span>
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-4">
        <p className="flex items-baseline gap-1.5">
          <span key={value ?? 'x'} className="display tick text-[52px] font-bold">
            {value === null ? '—' : fmtNum(value, decimals)}
          </span>
          <span className="display text-[20px] font-semibold text-ink-3">{unit}</span>
        </p>
        <div className="w-[42%] max-w-44 pb-1.5">
          <Sparkline data={series} />
          {lo !== null && hi !== null && series.length > 2 && (
            <p className="mt-1 flex justify-between text-[11px] text-ink-3">
              <span className="num">
                {fmtNum(lo, decimals)}–{fmtNum(hi, decimals)}
              </span>
              <span>6 h</span>
            </p>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-[13px] text-ink-2">
        <div className="min-w-0 flex-1">{children}</div>
        <span className="shrink-0 text-xs text-ink-3">{t ? timeAgo(t.timestamp, now) : loaded ? 'sin datos' : 'cargando…'}</span>
      </div>
    </Link>
  );
}

function Group({ code, title, children }: { code: string; title: string; children: ReactNode }) {
  return (
    <section>
      <header className="flex items-baseline gap-3 border-b border-line bg-surface-2/50 px-5 py-2">
        <span className="display text-[15px] font-bold text-accent">{code}</span>
        <h2 className="label text-ink-2">{title}</h2>
      </header>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

const AQI_HELP =
  'AQI: índice de calidad del aire (escala de la EPA, 0 a 500; más alto es peor). 0–50 buena · 51–100 moderada: aceptable, las personas muy sensibles deberían limitar el esfuerzo prolongado al aire libre · 101–150 dañina para grupos sensibles · más de 150 dañina para todos.';

/** Escala AQI (EPA) con marcador: da contexto real a la cifra. */
function AqiScale({ value }: { value: number }) {
  const max = 300;
  const stops = [50, 100, 150, 200];
  const c = aqiCategory(value);
  const color = c.tone === 'ok' ? 'var(--accent)' : c.tone === 'warn' ? 'var(--warn)' : 'var(--crit)';
  return (
    <div className="flex items-center gap-3" title={AQI_HELP}>
      <span className="font-semibold" style={{ color }}>
        {c.label}
        <span className="sr-only">. {AQI_HELP}</span>
      </span>
      <span className="relative h-1.5 min-w-24 flex-1 rounded-full bg-surface-3" aria-hidden>
        {stops.map((s) => (
          <span key={s} className="absolute top-0 h-full w-px bg-line-strong" style={{ left: `${(s / max) * 100}%` }} />
        ))}
        <span className="sweep absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
      </span>
    </div>
  );
}

function Bar({ pct, warnAt = 85, critAt = 95 }: { pct: number; warnAt?: number; critAt?: number }) {
  const color = pct >= critAt ? 'var(--crit)' : pct >= warnAt ? 'var(--warn)' : 'var(--accent)';
  return (
    <span className="relative block h-1.5 w-28 rounded-full bg-surface-3" aria-hidden>
      <span className="sweep absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

function greeting() {
  return greetingCO();
}

export function Dashboard() {
  const assistant = useAssistant();
  const { list, alerts, incidents, feed, devices, loaded } = useLive();
  const now = useNow(5000);
  const online = list.filter((d) => isOnline(d)).length;
  const open = alerts.filter((a) => a.status !== 'resuelta');
  const critical = open.filter((a) => a.severity === 'critical').length;
  const lastUpdate = list.reduce<string | null>((m, d) => {
    const t = d.live.telemetry?.received_at ?? d.live.telemetry?.ingested_at;
    return t && (!m || t > m) ? t : m;
  }, null);
  const d = (id: DeviceId) => devices[id];

  const strip = [
    { k: 'Nodos en línea', v: loaded ? `${online}/${list.length || DEVICE_IDS.length}` : '…', tone: online === list.length && list.length ? 'text-accent' : 'text-warn' },
    { k: 'Alertas abiertas', v: loaded ? String(open.length) : '…', tone: critical ? 'text-crit' : open.length ? 'text-warn' : 'text-ink', sub: critical ? `${critical} críticas` : undefined },
    { k: 'Incidentes simulados', v: loaded ? String(incidents.length) : '…', tone: 'text-ink', sub: 'activos' },
    { k: 'Última lectura', v: lastUpdate ? fmtTime(lastUpdate, true) : '—', tone: 'text-ink', sub: lastUpdate ? timeAgo(lastUpdate, now) : undefined },
  ];

  return (
    <div className="space-y-5">
      {/* Franja de estado */}
      <section className="rise flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b border-line pb-5">
        <div className="flex min-w-0 items-end gap-4">
          <button onClick={() => assistant.setOpen(true)} className="group hidden shrink-0 items-end gap-2 text-left sm:flex" aria-label="Hablar con Nodo">
            <Nodo mood={assistant.busy ? 'thinking' : 'idle'} size={76} />
          </button>
          <div className="min-w-0">
          <p className="label">Santander, Colombia · 7°07′ N 73°07′ O · 959 m s. n. m.</p>
          <h1 className="display mt-2 text-[56px] font-extrabold uppercase sm:text-[68px]">
            La ciudad, <span className="text-accent">ahora</span>
          </h1>
          <button onClick={() => assistant.setOpen(true)} className="mt-2 text-[13.5px] text-ink-3 hover:text-ink">
            <span className="font-semibold text-ai">Nodo:</span> {greeting()}. Toca aquí y pregúntame lo que quieras.
          </button>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          {strip.map((s) => (
            <div key={s.k} className="min-w-28 border-l border-line pl-4">
              <dt className="label text-[11px]">{s.k}</dt>
              <dd className={cx('display mt-1 text-[34px] font-bold', s.tone)}>{s.v}</dd>
              {s.sub && <dd className="text-xs text-ink-3">{s.sub}</dd>}
            </div>
          ))}
        </dl>
      </section>

      {/* Consola: lecturas · mapa · bitácora */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <Group code="01" title="Ambiente">
            <Readout index={1} device="DEV01" variable="temperature" label="Temperatura">
              {num(d('DEV01'), 'humidity') !== null && <span>Humedad relativa {fmtNum(num(d('DEV01'), 'humidity'), 0)} %</span>}
            </Readout>
            <Readout index={2} device="DEV02" variable="us_aqi" label="Calidad del aire · AQI" decimals={0}>
              {num(d('DEV02'), 'us_aqi') !== null && <AqiScale value={num(d('DEV02'), 'us_aqi')!} />}
            </Readout>
            <Readout index={3} device="DEV03" variable="noise_db" label="Ruido urbano">
              <span>Av. Quebrada Seca con Cra 15</span>
            </Readout>
          </Group>
          <Group code="02" title="Movilidad">
            <Readout index={4} device="DEV04" variable="congestion_index" label="Congestión de la red" decimals={0}>
              {num(d('DEV04'), 'network_speed_kmh') !== null && <span>Velocidad media {fmtNum(num(d('DEV04'), 'network_speed_kmh'), 0)} km/h · 67 km de vías</span>}
            </Readout>
            <Readout index={5} device="DEV05" variable="vehicles_per_min" label="Flujo · Carrera 27" decimals={0}>
              {num(d('DEV05'), 'avg_speed_kmh') !== null && <span>{fmtNum(num(d('DEV05'), 'avg_speed_kmh'), 0)} km/h promedio en el lazo</span>}
            </Readout>
            <Readout index={6} device="DEV08" variable="free_spaces" label="Parqueadero · cupos libres" decimals={0}>
              {num(d('DEV08'), 'occupancy_pct') !== null && (
                <span className="flex items-center gap-2">
                  <Bar pct={num(d('DEV08'), 'occupancy_pct')!} /> {fmtNum(num(d('DEV08'), 'occupancy_pct'), 0)} % ocupado
                </span>
              )}
            </Readout>
          </Group>
          <Group code="03" title="Energía, agua y clima">
            <Readout index={7} device="DEV07" variable="power_w" label="Alumbrado · potencia" decimals={0}>
              {num(d('DEV07'), 'light_level') !== null && (
                <span>
                  Nivel {fmtNum(num(d('DEV07'), 'light_level'), 0)} % · {fmtNum(num(d('DEV07'), 'energy_kwh'), 2)} kWh acumulados
                </span>
              )}
            </Readout>
            <Readout index={8} device="DEV09" variable="water_level" label="Nivel del río · MAJADAS" decimals={2}>
              {(() => {
                const r = d('DEV09')?.live.telemetry?.variables.risk?.value;
                return typeof r === 'string' ? (
                  <span>
                    Riesgo <b className={r === 'alto' ? 'text-crit' : r === 'medio' ? 'text-warn' : 'text-accent'}>{r}</b> · IDEAM publica con ~1 día de retraso
                  </span>
                ) : null;
              })()}
            </Readout>
            <Readout index={9} device="DEV10" variable="wind_speed" label="Viento">
              {(() => {
                const dir = num(d('DEV10'), 'wind_direction');
                const p = num(d('DEV10'), 'pressure');
                const r = num(d('DEV10'), 'precipitation');
                return (
                  <span className="flex items-center gap-2">
                    {dir !== null && (
                      <>
                        <Navigation className="size-3.5 text-ink" style={{ transform: `rotate(${dir + 180}deg)` }} aria-label={`Viento del ${windDir(dir)}`} />
                        {windDir(dir)}
                      </>
                    )}
                    {p !== null && <span>· {fmtNum(p, 0)} hPa</span>}
                    {r !== null && <span>· lluvia {fmtNum(r, 1)} mm</span>}
                  </span>
                );
              })()}
            </Readout>
          </Group>
        </Card>

        <div className="flex min-w-0 flex-col gap-5">
        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Mapa operativo */}
        <Card className="rise flex h-[520px] flex-col overflow-hidden xl:h-[600px]" style={{ ['--i' as string]: 2 }}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="flex items-baseline gap-3">
              <span className="display text-[15px] font-bold text-accent">MAPA</span>
              <h2 className="label text-ink-2">Área metropolitana de Bucaramanga</h2>
            </div>
            <Suspense fallback={null}>
              <MapLegend />
            </Suspense>
          </div>
          <div className="relative flex-1">
            <Suspense fallback={<div className="grid h-full place-items-center text-sm text-ink-3">Cargando cartografía…</div>}>
              <CityMap className="absolute inset-0 h-full w-full" wheelZoom={false} />
            </Suspense>
          </div>
        </Card>

        {/* Alertas junto al mapa */}
          <Card className="rise flex max-h-[600px] min-h-40 flex-col overflow-hidden" style={{ ['--i' as string]: 3 }}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="label text-ink-2">Alertas abiertas</h2>
              <Link to="/alertas" className="flex items-center gap-1 text-[13px] font-semibold text-ink-2 hover:text-ink">
                Gestionar <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
            {open.length === 0 ? (
              <div className="px-5 py-5">
                <p className="display text-[26px] font-bold text-accent">SIN ALERTAS</p>
                <p className="mt-1 text-[13px] text-ink-3">Todas las variables están dentro de sus umbrales.</p>
              </div>
            ) : (
              <ul className="flex-1 divide-y divide-line overflow-y-auto">
                {open.slice(0, 12).map((a) => {
                  const color = a.severity === 'critical' ? 'var(--crit)' : a.severity === 'warning' ? 'var(--warn)' : 'var(--info)';
                  return (
                    <li key={a.id} className="flex gap-3 px-5 py-3">
                      <span className="mt-1.5 size-2.5 shrink-0 rotate-45" style={{ background: color }} aria-hidden />
                      <div className="min-w-0">
                        <p className="text-[13px] leading-snug">{a.message}</p>
                        <p className="mt-1 text-[11px] text-ink-3">
                          <span className="code">{a.device_id}</span> · {fmtTime(a.created_at)} · {a.severity === 'critical' ? 'crítica' : a.severity === 'warning' ? 'advertencia' : 'informativa'}
                          {a.status === 'reconocida' && ' · reconocida'}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

        </div>

        {/* Riel de nodos */}
        <Card className="rise overflow-hidden" style={{ ['--i' as string]: 5 }}>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="label text-ink-2">Red de {list.length || DEVICE_IDS.length} nodos IoT</h2>
            <Link to="/dispositivos" className="flex items-center gap-1 text-[13px] font-semibold text-ink-2 hover:text-ink">
              Consola de dispositivos <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <ul className="grid grid-cols-2 divide-line sm:grid-cols-5 [&>li]:border-b [&>li]:border-r [&>li]:border-line">
            {list.map((dev) => {
              const st = deviceState(dev);
              const t = dev.live.telemetry;
              return (
                <li key={dev.id}>
                  <Link to={`/dispositivos/${dev.id}`} className="group block h-full px-4 py-3 transition-colors hover:bg-surface-2">
                    <div className="flex items-center justify-between">
                      <span className="display text-[30px] font-bold text-ink-3 group-hover:text-ink">{dev.id.slice(3)}</span>
                      <StatusDot state={st} />
                    </div>
                    <p className="truncate text-[13px] font-semibold">{dev.name}</p>
                    <p className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-ink-3">
                      <span className={cx(st === 'offline' && 'text-crit', st === 'degraded' && 'text-warn')}>{STATE_LABEL[st]}</span>
                      <span>{t ? timeAgo(t.timestamp, now) : '—'}</span>
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-2">
          <Card className="rise flex min-h-64 flex-col overflow-hidden" style={{ ['--i' as string]: 4 }}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="label text-ink-2">Bitácora en vivo</h2>
              <span className="text-[11px] text-ink-3">MQTT → WebSocket</span>
            </div>
            {feed.length === 0 ? (
              <p className="px-5 py-5 text-[13px] text-ink-3">Esperando eventos. Cada lectura, orden, alerta e incidente aparecerá aquí al instante.</p>
            ) : (
              <ol className="flex-1 overflow-y-auto px-5 py-2">
                {feed.slice(0, 40).map((f) => {
                  const c = { ok: 'var(--accent)', warn: 'var(--warn)', crit: 'var(--crit)', info: 'var(--ink-3)', synth: 'var(--ink-3)' }[f.tone ?? 'info'];
                  return (
                    <li key={f.id} className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-3 py-1.5 text-[13px]">
                      <span className="code text-ink-3">{fmtTime(f.at, true)}</span>
                      <span className="code font-semibold" style={{ color: c }}>
                        {f.device}
                      </span>
                      <span className="min-w-0 truncate text-ink-2" title={f.text}>
                        {f.text}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          <Card className="rise flex min-h-64 flex-col overflow-hidden" style={{ ['--i' as string]: 6 }}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="label text-ink-2">Incidentes viales activos</h2>
            </div>
            {incidents.length === 0 ? (
              <div className="px-5 py-5">
                <p className="display text-[26px] font-bold text-ink-2">VÍAS DESPEJADAS</p>
                <p className="mt-1 max-w-[46ch] text-[13px] text-ink-3">El simulador admite periodos prolongados sin incidentes, sobre todo de noche y en horas valle.</p>
              </div>
            ) : (
              <ul className="flex-1 divide-y divide-line overflow-y-auto">
                {incidents.map((i) => (
                  <li key={i.incident_id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-3">
                    <span className="size-3 rotate-45" style={{ background: `var(--sev-${i.severity})` }} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold">
                        {INCIDENT_LABEL[i.type]} <span className="font-normal text-ink-3">· {i.severity}</span>
                      </span>
                      <span className="block truncate text-xs text-ink-3">
                        {i.road_name} · −{Math.round(i.speed_impact * 100)} % velocidad · hasta {fmtTime(i.expected_end_at)}
                      </span>
                    </span>
                    <span className={cx('label text-[11px]', i.state === 'en_atencion' ? 'text-info' : 'text-warn')}>{i.state === 'en_atencion' ? 'En atención' : 'Activo'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        </div>
      </div>
    </div>
  );
}
