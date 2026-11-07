import { ExternalLink, LockOpen, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DeviceGlyph } from '../components/DeviceIcon';
import { DeviceControls } from '../components/DeviceControls';
import { Badge, Card, CardHeader, PageHeader, Segmented, StatusDot, cx } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLive } from '../lib/live';
import { deviceState } from '../lib/state';

interface Health {
  status: string;
  mqtt: boolean;
  influxdb: boolean;
  sqlite: boolean;
  uptime_s: number;
  mqtt_messages: { received: number; rejected: number };
}

/** Sesión de controles de este navegador: estado y cierre. */
function SessionRow() {
  const { user, expiresAt, logout, requestLogin } = useAuth();
  const until = expiresAt?.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[5px] border border-line px-4 py-3">
      <span className="flex items-center gap-3">
        <LockOpen className={cx('size-4 shrink-0', user ? 'text-accent' : 'text-ink-3')} aria-hidden />
        <span>
          <span className="block font-medium">{user ? 'Controles desbloqueados' : 'Controles bloqueados'}</span>
          <span className="text-xs text-ink-3">{user ? `Este navegador recuerda la sesión hasta el ${until}.` : 'Se pedirá la contraseña al intentar controlar un dispositivo.'}</span>
        </span>
      </span>
      {user ? (
        <button onClick={logout} className="h-8 rounded-[5px] border border-line-strong px-3 text-[13px] font-semibold text-ink-2 transition-colors hover:text-ink">
          Cerrar sesión
        </button>
      ) : (
        <button data-login-trigger onClick={requestLogin} className="h-8 rounded-[5px] border border-line-strong px-3 text-[13px] font-semibold text-ink-2 transition-colors hover:text-ink">
          Desbloquear
        </button>
      )}
    </div>
  );
}

const TABS = [
  { value: 'interval', label: 'Intervalos' },
  { value: 'thresholds', label: 'Umbrales' },
  { value: 'sim', label: 'Simulación' },
];

export function SettingsPage() {
  const { list } = useLive();
  const [tab, setTab] = useState('interval');
  const [selected, setSelected] = useState('DEV04');
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    const load = () => api<Health>('/api/health').then(setHealth).catch(() => setHealth(null));
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const candidates = list.filter((d) => {
    if (tab === 'thresholds') return d.variables.some((v) => v.thresholdable);
    if (tab === 'sim') return d.params.length > 0 || d.modes.length > 1;
    return d.actions.includes('set_interval');
  });
  const device = candidates.find((d) => d.id === selected) ?? candidates[0];
  const sections = tab === 'interval' ? ['power', 'interval'] : tab === 'thresholds' ? ['thresholds'] : ['mode', 'params', 'calibration', 'incident'];

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <PageHeader code="06 · Parámetros" title="Configuración" subtitle="Intervalos de captura, umbrales de alerta y parámetros de simulación. Cada cambio viaja por MQTT y el dispositivo lo confirma." action={<Segmented ariaLabel="Sección" value={tab} onChange={setTab} options={TABS} />} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit">
          <ul className="divide-y divide-line">
            {candidates.map((d) => (
              <li key={d.id}>
                <button onClick={() => setSelected(d.id)} className={cx('flex w-full items-center gap-3 px-4 py-3 text-left transition-colors', device?.id === d.id ? 'bg-surface-3' : 'hover:bg-surface-2')}>
                  <DeviceGlyph device={d} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{d.name}</span>
                    <span className="block text-[11px] text-ink-3">
                      <span className="num">{d.id}</span> · {d.live.config ? `${d.live.config.interval_s} s · v${d.live.config.version}` : 'sin config'}
                    </span>
                  </span>
                  <StatusDot state={deviceState(d)} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {device && (
          <Card>
            <CardHeader eyebrow={`${device.id} · ${device.source_type}`} title={device.name} action={device.live.config && <Badge>config v{device.live.config.version}</Badge>} />
            {tab === 'interval' && (device.source_type === 'api' || device.source_type === 'dataset') && (
              <p className="mx-5 mt-4 rounded-[5px] border border-line px-3 py-2.5 text-[13px] text-ink-2">
                Intervalo de consulta a la fuente externa, separado del intervalo de simulación. Las lecturas repetidas se descartan por su marca de tiempo de origen.
              </p>
            )}
            <div className="mt-2">
              <DeviceControls key={`${device.id}-${tab}`} device={device} sections={sections} />
            </div>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader eyebrow="Plataforma" title="Estado de los servicios" />
          <dl className="grid grid-cols-2 gap-3 p-5 text-sm sm:grid-cols-4">
            {[
              ['Backend', health ? true : false],
              ['Broker MQTT', health?.mqtt],
              ['InfluxDB', health?.influxdb],
              ['SQLite', health?.sqlite],
            ].map(([k, ok]) => (
              <div key={k as string} className="border-l border-line pl-3">
                <dt className="text-[11px] text-ink-3">{k as string}</dt>
                <dd className={cx('mt-0.5 flex items-center gap-1.5 font-medium', ok ? 'text-accent' : 'text-crit')}>
                  <StatusDot state={ok ? 'online' : 'offline'} /> {ok ? 'Operativo' : 'Sin respuesta'}
                </dd>
              </div>
            ))}
          </dl>
          {health && (
            <p className="px-5 pb-4 text-xs text-ink-3">
              Mensajes MQTT procesados: <span className="num text-ink-2">{health.mqtt_messages.received.toLocaleString('es-CO')}</span> · rechazados por validación: <span className="num text-ink-2">{health.mqtt_messages.rejected}</span> · backend activo hace{' '}
              <span className="num text-ink-2">{Math.round(health.uptime_s / 60)}</span> min
            </p>
          )}
        </Card>
        <Card>
          <CardHeader eyebrow="Herramientas" title="Análisis e integración" />
          <div className="space-y-3 p-5 text-sm">
            <SessionRow />
            <a href="/grafana/" target="_blank" rel="noopener" className="flex items-center justify-between rounded-[5px] border border-line px-4 py-3 transition-colors hover:bg-surface-2">
              <span>
                <span className="block font-medium">Grafana</span>
                <span className="text-xs text-ink-3">Tableros de análisis complementarios (requiere usuario)</span>
              </span>
              <ExternalLink className="size-4 text-ink-3" />
            </a>
            <a href="/nodered/" target="_blank" rel="noopener" className="flex items-center justify-between rounded-[5px] border border-line px-4 py-3 transition-colors hover:bg-surface-2">
              <span>
                <span className="block font-medium">Node-RED</span>
                <span className="text-xs text-ink-3">Flujos de persistencia y reglas de automatización (requiere usuario)</span>
              </span>
              <ExternalLink className="size-4 text-ink-3" />
            </a>
            <p className="flex items-start gap-2 text-xs text-ink-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              El DEV06 solo usa gpsmobile.co con autorización explícita (variable GPS_USAGE_AUTHORIZED) y conserva únicamente posición, velocidad, estado y hora; nunca placas, conductores ni otros datos personales.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
