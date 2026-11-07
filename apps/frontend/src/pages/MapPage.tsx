import { Layers, X } from 'lucide-react';
import { useState } from 'react';
import { CityMap, MapLegend, SEV_VAR, TYPE_LABEL, devicePosition } from '../components/CityMap';
import { CATEGORY_LABEL, DeviceIcon } from '../components/DeviceIcon';
import { Card, ProvenanceTag, StatusDot, Switch, cx } from '../components/ui';
import { fmtTime } from '../lib/format';
import { useLive } from '../lib/live';
import { deviceState } from '../lib/state';

export function MapPage() {
  const { list, incidents } = useLive();
  const [layers, setLayers] = useState({ devices: true, incidents: true, track: true });
  const [target, setTarget] = useState<[number, number] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // En pantallas pequeñas el panel de capas empieza plegado para no tapar el mapa.
  const [layersOpen, setLayersOpen] = useState(() => window.innerWidth >= 640);

  const go = (id: string, pos: [number, number]) => {
    setSelected(id);
    setTarget([pos[0] + Math.random() * 1e-9, pos[1]]); // fuerza el vuelo aunque sea el mismo punto
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:h-[calc(100vh-8.5rem)] xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="rise relative flex h-[68vh] flex-col overflow-hidden xl:h-full">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex items-baseline gap-3">
            <h1 className="display text-[30px] font-bold uppercase">Mapa operativo</h1>
            <span className="label hidden sm:inline">Bucaramanga · Floridablanca · Girón</span>
          </div>
          <MapLegend />
        </div>
        <div className="relative flex-1">
          <CityMap className="absolute inset-0 h-full w-full" showDevices={layers.devices} showIncidents={layers.incidents} showTrack={layers.track} target={target} />
          {!layersOpen ? (
            <button onClick={() => setLayersOpen(true)} className="panel absolute top-3 right-3 z-[500] flex h-9 items-center gap-2 px-3 text-[13px] font-semibold shadow-[0_18px_40px_-20px_oklch(0_0_0/0.7)]" aria-expanded={false}>
              <Layers className="size-4" aria-hidden /> Capas
            </button>
          ) : (
          <div className="panel absolute top-3 right-3 z-[500] w-56 p-3 shadow-[0_18px_40px_-20px_oklch(0_0_0/0.7)]">
            <div className="mb-1 flex items-center justify-between">
              <p className="label">Capas</p>
              <button onClick={() => setLayersOpen(false)} className="text-ink-3 hover:text-ink" aria-label="Plegar capas">
                <X className="size-4" />
              </button>
            </div>
            {(
              [
                ['devices', 'Dispositivos'],
                ['incidents', 'Incidentes simulados'],
                ['track', 'Recorrido GPS'],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="flex items-center justify-between py-1.5 text-[13px]">
                <span>{label}</span>
                <Switch checked={layers[k]} onChange={(v) => setLayers((l) => ({ ...l, [k]: v }))} label={label} />
              </div>
            ))}
          </div>
          )}
        </div>
      </Card>

      <div className="flex flex-col gap-5 xl:min-h-0">
        <Card className="rise flex flex-col overflow-hidden xl:min-h-0 xl:flex-[3]" style={{ ['--i' as string]: 1 }}>
          <div className="border-b border-line px-5 py-3">
            <h2 className="label text-ink-2">Nodos · clic para ubicar</h2>
          </div>
          <ul className="divide-y divide-line overflow-y-auto">
            {list.map((d) => {
              const st = deviceState(d);
              const t = d.live.telemetry;
              return (
                <li key={d.id}>
                  <button
                    onClick={() => go(d.id, devicePosition(d))}
                    className={cx('grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-2.5 text-left transition-colors', selected === d.id ? 'bg-surface-2' : 'hover:bg-surface-2')}
                  >
                    <span className="display w-7 text-[22px] font-bold text-ink-3">{d.id.slice(3)}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[14px] font-semibold">
                        <DeviceIcon id={d.id} className="size-4 text-ink-3" />
                        <span className="truncate">{d.name}</span>
                      </span>
                      <span className="block truncate text-xs text-ink-3">
                        {CATEGORY_LABEL[d.category]} · {t?.location.name ?? d.location.name}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {t && <ProvenanceTag synthetic={t.provenance.synthetic} compact />}
                      <StatusDot state={st} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="rise flex flex-col overflow-hidden xl:min-h-0 xl:flex-[2]" style={{ ['--i' as string]: 2 }}>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="label text-ink-2">Incidentes activos</h2>
            <ProvenanceTag synthetic compact />
          </div>
          {incidents.length === 0 ? (
            <div className="px-5 py-5">
              <p className="display text-[24px] font-bold text-ink-2">VÍAS DESPEJADAS</p>
              <p className="mt-1 max-w-[46ch] text-[13px] text-ink-3">El modelo probabilístico admite periodos prolongados sin incidentes, sobre todo de noche y en horas valle.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line overflow-y-auto">
              {incidents.map((i) => (
                <li key={i.incident_id}>
                  <button onClick={() => go(i.incident_id, [i.location.lat, i.location.lon])} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-3 text-left hover:bg-surface-2">
                    <span className="size-3 rotate-45" style={{ background: SEV_VAR[i.severity] }} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold">
                        {TYPE_LABEL[i.type]} <span className="font-normal text-ink-3">· {i.severity}</span>
                      </span>
                      <span className="block truncate text-xs text-ink-3">
                        {i.road_name} · desde {fmtTime(i.started_at)}
                      </span>
                    </span>
                    <span className={cx('label text-[11px]', i.state === 'en_atencion' ? 'text-info' : 'text-warn')}>{i.state === 'en_atencion' ? 'En atención' : 'Activo'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-auto border-t border-line px-5 py-2.5 text-[11px] text-ink-3">Modelo probabilístico sobre 202 tramos reales de OpenStreetMap. No son reportes reales.</p>
        </Card>
      </div>
    </div>
  );
}
