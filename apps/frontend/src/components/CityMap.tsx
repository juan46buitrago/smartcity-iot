import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { fmtNum, fmtTime, timeAgo } from '../lib/format';
import { useLive } from '../lib/live';
import type { DeviceView, Incident } from '../lib/types';
import { deviceState } from '../lib/state';
import { CATEGORY_LABEL } from './DeviceIcon';
import { ProvenanceTag, STATE_LABEL, StatusDot } from './ui';

export const CENTER: [number, number] = [7.1193, -73.1227];
export const SEV_VAR: Record<string, string> = { baja: 'var(--sev-baja)', media: 'var(--sev-media)', alta: 'var(--sev-alta)', critica: 'var(--sev-critica)' };
export const TYPE_LABEL: Record<string, string> = { accidente: 'Accidente', vehiculo_averiado: 'Vehículo averiado', cierre_parcial: 'Cierre parcial', congestion: 'Congestión' };
const TYPE_GLYPH: Record<string, string> = { accidente: '!', vehiculo_averiado: 'A', cierre_parcial: 'C', congestion: '≡' };
const STATE_VAR = { online: 'var(--accent)', degraded: 'var(--warn)', offline: 'var(--crit)', stopped: 'var(--ink-3)', unknown: 'var(--ink-3)' } as const;

function deviceIcon(d: DeviceView) {
  const st = deviceState(d);
  return L.divIcon({
    className: '',
    html: `<div class="dev-marker" style="--marker:${STATE_VAR[st]}"><span>${d.id.slice(3)}</span></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  });
}

function incidentIcon(i: Incident) {
  return L.divIcon({
    className: '',
    html: `<div class="inc-ring" style="--sev:${SEV_VAR[i.severity]}"><div class="inc-marker">${TYPE_GLYPH[i.type]}</div></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16],
  });
}

export function devicePosition(d: DeviceView): [number, number] {
  const loc = d.live.telemetry?.location ?? d.location;
  return [loc.lat, loc.lon];
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 15), { duration: 0.7 });
  }, [target, map]);
  return null;
}

function useTheme() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'dark');
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(document.documentElement.dataset.theme ?? 'dark'));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export function CityMap({
  showDevices = true,
  showIncidents = true,
  showTrack = true,
  target = null,
  zoom = 13,
  className,
  wheelZoom = true,
}: {
  showDevices?: boolean;
  showIncidents?: boolean;
  showTrack?: boolean;
  target?: [number, number] | null;
  zoom?: number;
  className?: string;
  /** En el panel principal la rueda desplaza la página, no el mapa. */
  wheelZoom?: boolean;
}) {
  const { list, incidents, track } = useLive();
  const theme = useTheme();
  const now = Date.now();
  const trackLine = useMemo(() => track.map((p) => [p.lat, p.lon] as [number, number]), [track]);

  return (
    <MapContainer center={CENTER} zoom={zoom} minZoom={11} maxZoom={18} className={className ?? 'h-full w-full'} scrollWheelZoom={wheelZoom} zoomControl attributionControl>
      {/* Teselas estándar de OpenStreetMap (sin clave, bajo volumen, con atribución). */}
      <TileLayer
        key={theme}
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>'
        maxZoom={19}
        className={theme === 'dark' ? 'tiles-dark' : 'tiles-light'}
      />
      <FlyTo target={target} />
      {showTrack && trackLine.length > 1 && <Polyline positions={trackLine} pathOptions={{ className: 'gps-track', weight: 2, dashArray: '2 6', lineCap: 'round' }} />}
      {showDevices &&
        list.map((d) => {
          const st = deviceState(d);
          const t = d.live.telemetry;
          return (
            <Marker key={d.id} position={devicePosition(d)} icon={deviceIcon(d)}>
              <Popup>
                <div className="min-w-60">
                  <div className="flex items-center justify-between gap-3">
                    <p className="label">
                      {d.id} · {CATEGORY_LABEL[d.category]}
                    </p>
                    {t && <ProvenanceTag synthetic={t.provenance.synthetic} compact />}
                  </div>
                  <p className="mt-1 text-[15px] font-semibold">{d.name}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-2">
                    <StatusDot state={st} /> {STATE_LABEL[st]} · {t ? timeAgo(t.timestamp, now) : 'sin lecturas'}
                  </p>
                  {t && (
                    <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-line pt-2 text-[13px]">
                      {d.variables
                        .filter((v) => v.key in t.variables && v.key !== 'lat' && v.key !== 'lon')
                        .map((v) => {
                          const val = t.variables[v.key]!.value;
                          return (
                            <div key={v.key} className="contents">
                              <dt className="text-ink-3">{v.label}</dt>
                              <dd className="num text-right font-semibold">
                                {typeof val === 'number' ? fmtNum(val, v.decimals ?? 1) : String(val).replace(/_/g, ' ')} <span className="font-normal text-ink-3">{typeof val === 'number' ? v.unit : ''}</span>
                              </dd>
                            </div>
                          );
                        })}
                    </dl>
                  )}
                  <p className="mt-2 text-[11px] text-ink-3">{t?.location.name ?? d.location.name}</p>
                  <Link to={`/dispositivos/${d.id}`} className="mt-2 inline-block text-[13px] font-semibold text-accent">
                    Abrir consola del dispositivo →
                  </Link>
                </div>
              </Popup>
            </Marker>
          );
        })}
      {showIncidents &&
        incidents.map((i) => (
          <Marker key={i.incident_id} position={[i.location.lat, i.location.lon]} icon={incidentIcon(i)}>
            <Popup>
              <div className="min-w-60">
                <div className="flex items-center justify-between gap-3">
                  <p className="label">Incidente · {i.severity}</p>
                  <ProvenanceTag synthetic compact />
                </div>
                <p className="mt-1 text-[15px] font-semibold">{TYPE_LABEL[i.type]}</p>
                <p className="text-[13px] text-ink-2">{i.road_name}</p>
                <p className="mt-1 text-[13px]">{i.cause}</p>
                <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-line pt-2 text-[13px]">
                  <dt className="text-ink-3">Estado</dt>
                  <dd className="text-right font-semibold">{i.state === 'en_atencion' ? 'En atención' : 'Activo'}</dd>
                  <dt className="text-ink-3">Carriles bloqueados</dt>
                  <dd className="num text-right font-semibold">{i.lanes_blocked}</dd>
                  <dt className="text-ink-3">Reducción de velocidad</dt>
                  <dd className="num text-right font-semibold">{Math.round(i.speed_impact * 100)} %</dd>
                  <dt className="text-ink-3">Inicio · fin estimado</dt>
                  <dd className="num text-right font-semibold">
                    {fmtTime(i.started_at)} · {fmtTime(i.expected_end_at)}
                  </dd>
                </dl>
                <p className="mt-2 text-[11px] text-ink-3">Simulación — no es un reporte real · {i.incident_id}</p>
              </div>
            </Popup>
          </Marker>
        ))}
    </MapContainer>
  );
}

/** Leyenda del mapa (estado + incidentes) para superponer. */
export function MapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-2">
      {(['online', 'degraded', 'offline'] as const).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] border-[1.5px]" style={{ borderColor: STATE_VAR[s] }} />
          {STATE_LABEL[s]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rotate-45" style={{ background: 'var(--sev-alta)' }} />
        Incidente simulado
      </span>
    </div>
  );
}
