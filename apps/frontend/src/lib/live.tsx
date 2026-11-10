/**
 * Estado en vivo de la ciudad: dispositivos, alertas e incidentes, actualizado por WebSocket.
 * Mantiene además buffers cortos por variable (sparklines) y un feed de últimas actualizaciones.
 */
import { DEVICE_CATALOG, type DeviceConfig, type DeviceId, type DeviceStatus, type IncidentEvent, type Telemetry } from '@scbga/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { isLinkStale, LINK_STALE_AFTER_MS, parseLiveEvent, wellFormedDevices } from './liveData';
import type { AlertRow, CommandRecord, DeviceView, FeedItem, Incident } from './types';

type WsState = 'connecting' | 'open' | 'closed';
const SPARK_LEN = 90;
const FEED_LEN = 60;

interface LiveState {
  devices: Record<string, DeviceView>;
  list: DeviceView[];
  alerts: AlertRow[];
  incidents: Incident[];
  feed: FeedItem[];
  ws: WsState;
  loaded: boolean;
  /** Motivo del último fallo de carga inicial (null si la última carga fue bien). */
  loadError: string | null;
  spark: (device: string, variable: string) => number[];
  track: { lat: number; lon: number }[];
  lastCommand: CommandRecord | null;
  refresh: () => Promise<void>;
}

const LiveCtx = createContext<LiveState | null>(null);

function shortVars(t: Telemetry): string {
  const spec = DEVICE_CATALOG[t.device_id];
  return spec.variables
    .filter((v) => v.key in t.variables && v.key !== 'lat' && v.key !== 'lon')
    .slice(0, 3)
    .map((v) => {
      const val = t.variables[v.key]!.value;
      return `${v.label}: ${typeof val === 'number' ? val.toLocaleString('es-CO', { maximumFractionDigits: v.decimals ?? 1 }) : val}${v.unit && typeof val === 'number' ? ' ' + v.unit : ''}`;
    })
    .join(' · ');
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState<Record<string, DeviceView>>({});
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [ws, setWs] = useState<WsState>('connecting');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [track, setTrack] = useState<{ lat: number; lon: number }[]>([]);
  const [lastCommand, setLastCommand] = useState<CommandRecord | null>(null);
  const sparks = useRef(new Map<string, number[]>());
  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  const [, setSparkTick] = useState(0);

  const pushFeed = useCallback((item: Omit<FeedItem, 'id'>) => {
    setFeed((f) => [{ ...item, id: `${item.at}-${item.device}-${Math.random().toString(36).slice(2, 7)}` }, ...f].slice(0, FEED_LEN));
  }, []);

  const pushSpark = useCallback((t: Telemetry) => {
    for (const [k, v] of Object.entries(t.variables)) {
      if (typeof v.value !== 'number') continue;
      const key = `${t.device_id}.${k}`;
      const arr = sparks.current.get(key) ?? [];
      arr.push(v.value);
      if (arr.length > SPARK_LEN) arr.shift();
      sparks.current.set(key, arr);
    }
    setSparkTick((n) => n + 1);
  }, []);

  const refresh = useCallback(async () => {
    const [devs, al, inc] = await Promise.all([
      api<DeviceView[]>('/api/devices', { expect: 'array' }),
      api<AlertRow[]>('/api/alerts?status=activas&limit=200', { expect: 'array' }),
      api<{ items: Incident[] }>('/api/incidents?scope=active', { expect: ['items'] }),
    ]);
    setDevices(Object.fromEntries(wellFormedDevices(devs).map((d) => [d.id, d])));
    setAlerts(al);
    setIncidents(inc.items);
    setLoaded(true);
    setLoadError(null);
  }, []);

  /** Precarga de sparklines con la última hora del histórico. */
  useEffect(() => {
    const keys: [DeviceId, string][] = [
      ['DEV01', 'temperature'], ['DEV02', 'us_aqi'], ['DEV03', 'noise_db'], ['DEV04', 'congestion_index'],
      ['DEV05', 'vehicles_per_min'], ['DEV07', 'power_w'], ['DEV08', 'free_spaces'], ['DEV09', 'water_level'], ['DEV10', 'wind_speed'],
    ];
    const from = new Date(Date.now() - (6 * 3600_000)).toISOString();
    void Promise.allSettled(
      keys.map(async ([d, v]) => {
        const r = await api<{ points: { v: number }[] }>(`/api/history/${d}/${v}?from=${encodeURIComponent(from)}&points=${SPARK_LEN}`, { expect: ['points'] });
        const key = `${d}.${v}`;
        const live = sparks.current.get(key) ?? [];
        sparks.current.set(key, [...r.points.map((p) => p.v), ...live].slice(-SPARK_LEN));
      }),
    ).then(() => setSparkTick((n) => n + 1));
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let lastMessageAt = Date.now();

    const scheduleReconnect = () => {
      if (disposed) return;
      timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
    };

    const connect = () => {
      setWs('connecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}/ws`);
      socket.onopen = () => {
        retry = 0;
        lastMessageAt = Date.now();
        setWs('open');
        void refresh().catch((e) => setLoadError((e as Error).message));
      };
      socket.onclose = () => {
        setWs('closed');
        scheduleReconnect();
      };
      socket.onmessage = (m) => {
        lastMessageAt = Date.now();
        const ev = parseLiveEvent(String(m.data));
        if (!ev) return;
        try {
          handle(ev);
        } catch (err) {
          // Un evento con datos inesperados se descarta: no debe interrumpir el resto del flujo en vivo.
          console.warn('Evento en vivo descartado', ev.type, err);
        }
      };
    };

    // Un servidor colgado puede mantener la conexión abierta sin enviar nada: el latido lo delata.
    const watchdog = setInterval(() => {
      if (!socket || socket.readyState !== WebSocket.OPEN || !isLinkStale(lastMessageAt, Date.now())) return;
      const stale = socket;
      stale.onclose = null;
      stale.onmessage = null;
      stale.close();
      setWs('closed');
      scheduleReconnect();
    }, LINK_STALE_AFTER_MS / 3);

    const patch = (id: string, fn: (d: DeviceView) => DeviceView) =>
      setDevices((ds) => (ds[id] ? { ...ds, [id]: fn(ds[id]!) } : ds));

    const handle = (ev: { type: string; data: any }) => {
      const now = new Date().toISOString();
      switch (ev.type) {
        case 'telemetry': {
          const t = ev.data as Telemetry;
          patch(t.device_id, (d) => {
            if (d.live.telemetry && Date.parse(d.live.telemetry.timestamp) > Date.parse(t.timestamp)) return d;
            return { ...d, live: { ...d.live, telemetry: { ...t, received_at: now } } };
          });
          pushSpark(t);
          if (t.device_id === 'DEV06') {
            const lat = t.variables.lat?.value;
            const lon = t.variables.lon?.value;
            if (typeof lat === 'number' && typeof lon === 'number') setTrack((tr) => [...tr, { lat, lon }].slice(-120));
          }
          pushFeed({ at: now, kind: 'telemetry', device: t.device_id, text: shortVars(t), tone: t.provenance.synthetic ? 'synth' : 'info' });
          break;
        }
        case 'status': {
          const s = ev.data as DeviceStatus & { received_at: string };
          const prev = devicesRef.current[s.device_id]?.live.status;
          patch(s.device_id, (d) => ({ ...d, live: { ...d.live, status: s } }));
          if (prev && (prev.connection !== s.connection || prev.stale))
            pushFeed({ at: now, kind: 'status', device: s.device_id, text: s.connection === 'online' ? 'Conectado' : `Desconectado${s.reason ? ` · ${s.reason}` : ''}`, tone: s.connection === 'online' ? 'ok' : 'crit' });
          break;
        }
        case 'config': {
          const c = ev.data as DeviceConfig;
          patch(c.device_id, (d) => ({ ...d, live: { ...d.live, config: c } }));
          break;
        }
        case 'command': {
          const c = ev.data as CommandRecord;
          setLastCommand(c);
          if (c.status !== 'pending')
            pushFeed({
              at: now,
              kind: 'command',
              device: c.device_id,
              text: `Orden ${c.action} ${c.status === 'confirmed' ? 'confirmada' : c.status === 'rejected' ? `rechazada: ${c.error}` : 'sin respuesta'}${c.origin === 'external' ? ` (${c.issued_by})` : ''}`,
              tone: c.status === 'confirmed' ? 'ok' : 'warn',
            });
          break;
        }
        case 'alert': {
          const a = ev.data as AlertRow;
          setAlerts((xs) => {
            const rest = xs.filter((x) => x.id !== a.id);
            return a.status === 'resuelta' ? rest : [a, ...rest];
          });
          if (a.status === 'abierta' && a.created_at === a.updated_at)
            pushFeed({ at: now, kind: 'alert', device: a.device_id, text: a.message, tone: a.severity === 'critical' ? 'crit' : a.severity === 'warning' ? 'warn' : 'info' });
          break;
        }
        case 'incident': {
          const e = ev.data as IncidentEvent;
          setIncidents((xs) => {
            const rest = xs.filter((x) => x.incident_id !== e.incident.incident_id);
            return e.incident.state === 'resuelto' ? rest : [e.incident, ...rest];
          });
          const verb = e.event === 'incident_created' ? 'Nuevo' : e.event === 'incident_attended' ? 'En atención' : 'Resuelto';
          pushFeed({ at: now, kind: 'incident', device: 'DEV04', text: `${verb}: ${e.incident.type.replace('_', ' ')} (${e.incident.severity}) en ${e.incident.road_name}`, tone: 'synth' });
          break;
        }
      }
    };

    void refresh().catch((e) => setLoadError((e as Error).message));
    connect();
    return () => {
      disposed = true;
      clearInterval(watchdog);
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [refresh, pushFeed, pushSpark]);

  const list = useMemo(() => Object.values(devices).sort((a, b) => a.id.localeCompare(b.id)), [devices]);
  const spark = useCallback((d: string, v: string) => sparks.current.get(`${d}.${v}`) ?? [], []);

  const value: LiveState = { devices, list, alerts, incidents, feed, ws, loaded, loadError, spark, track, lastCommand, refresh };
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}

export function useLive() {
  const c = useContext(LiveCtx);
  if (!c) throw new Error('useLive fuera de LiveProvider');
  return c;
}

/** Valor numérico actual de una variable de un dispositivo. */
export function useValue(device: DeviceId, variable: string): { value: number | string | null; ts: string | null; synthetic: boolean } {
  const { devices } = useLive();
  const t = devices[device]?.live.telemetry;
  const v = t?.variables[variable]?.value;
  return { value: typeof v === 'number' || typeof v === 'string' ? v : null, ts: t?.timestamp ?? null, synthetic: !!t?.provenance.synthetic };
}

export function isOnline(d: DeviceView | undefined): boolean {
  const s = d?.live.status;
  return !!s && s.connection === 'online' && !s.stale;
}
