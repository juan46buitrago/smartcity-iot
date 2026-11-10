import { DEVICE_CATALOG, DEVICE_IDS } from '@scbga/shared';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Nodo } from '../components/Nodo';
import { Badge, Button, Card, Empty, PageHeader, Segmented, cx, inputCls } from '../components/ui';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { useLive } from '../lib/live';
import { useToast } from '../lib/toast';
import type { AlertRow } from '../lib/types';

const SEV = { critical: { tone: 'crit', label: 'Crítica' }, warning: { tone: 'warn', label: 'Advertencia' }, info: { tone: 'info', label: 'Informativa' } } as const;
const KIND: Record<AlertRow['kind'], string> = { threshold: 'Umbral', anomaly: 'Anomalía', offline: 'Conexión', incident: 'Incidente (sim.)' };
const STATUS_TONE = { abierta: 'crit', reconocida: 'warn', resuelta: 'ok' } as const;

export function AlertsPage() {
  const { alerts: liveAlerts } = useLive();
  const { user, requestLogin } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<'activas' | 'abierta' | 'reconocida' | 'resuelta' | 'todas'>('activas');
  const [device, setDevice] = useState('');
  const [rows, setRows] = useState<AlertRow[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api<AlertRow[]>(`/api/alerts${qs({ status: status === 'todas' ? undefined : status, device, limit: 300 })}`, { expect: 'array' })
      .then((r) => {
        setRows(r);
        setLoadError(null);
      })
      // Un fallo no es «no hay alertas»: se avisa y se conserva la última lista conocida.
      .catch((e) => setLoadError((e as Error).message));
  }, [status, device, liveAlerts]);

  const act = async (a: AlertRow, kind: 'ack' | 'resolve') => {
    if (!user) return requestLogin();
    setBusy(a.id);
    try {
      await api(`/api/alerts/${a.id}/${kind}`, { method: 'POST', auth: true });
      setRows((xs) => xs?.map((x) => (x.id === a.id ? { ...x, status: kind === 'ack' ? 'reconocida' : 'resuelta' } : x)) ?? null);
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo actualizar la alerta', detail: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        code="05 · Atención"
        title="Alertas"
        subtitle="Umbrales configurables, detección de valores atípicos (z-score), desconexiones e incidentes simulados graves. Cada alerta se reconoce y se resuelve con trazabilidad."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select className={cx(inputCls, 'h-9 w-auto')} value={device} onChange={(e) => setDevice(e.target.value)} aria-label="Filtrar por dispositivo">
              <option value="">Todos los dispositivos</option>
              {DEVICE_IDS.map((id) => (
                <option key={id} value={id}>
                  {id} · {DEVICE_CATALOG[id].name}
                </option>
              ))}
            </select>
            <Segmented
              ariaLabel="Estado"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'activas', label: 'Activas' },
                { value: 'abierta', label: 'Abiertas' },
                { value: 'reconocida', label: 'Reconocidas' },
                { value: 'resuelta', label: 'Resueltas' },
                { value: 'todas', label: 'Todas' },
              ]}
            />
          </div>
        }
      />
      <Card>
        {loadError && (
          <p role="alert" className="border-b border-warn/40 bg-warn-soft px-5 py-3 text-sm text-warn">
            No se pudo actualizar la lista de alertas. {loadError}
          </p>
        )}
        {rows === null ? (
          <p className="px-5 py-8 text-sm text-ink-3">{loadError ? 'Sin datos por ahora.' : 'Cargando…'}</p>
        ) : rows.length === 0 ? (
          <Empty icon={<Nodo mood="happy" size={64} />} title="No hay alertas con este filtro">
            Todo tranquilo por aquí. Si algo se sale de rango, te aviso.
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <li key={a.id} className="grid gap-3 px-5 py-4 md:grid-cols-[10rem_1fr_auto] md:items-center">
                <div className="flex items-center gap-3">
                  <span className="size-3 shrink-0 rotate-45" style={{ background: a.severity === "critical" ? "var(--crit)" : a.severity === "warning" ? "var(--warn)" : "var(--info)" }} aria-hidden />
                  <span>
                    <span className="block text-[14px] font-semibold">{SEV[a.severity].label}</span>
                    <span className="label text-[11px]">{KIND[a.kind]}</span>
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-[15px] leading-snug">{a.message}</p>
                  <p className="mt-1 text-xs text-ink-3">
                    <span className="code">{a.device_id}</span> {DEVICE_CATALOG[a.device_id as keyof typeof DEVICE_CATALOG]?.name} · {fmtDateTime(a.created_at)}
                    {a.updated_at !== a.created_at && ` · actualizada ${fmtDateTime(a.updated_at)}`}
                    {a.acknowledged_by && ` · reconocida por ${a.acknowledged_by}`}
                    {a.resolved_by && ` · resuelta por ${a.resolved_by}`}
                    {a.synthetic ? ' · dato sintético' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 md:justify-end">
                  <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                  {a.status === 'abierta' && (
                    <Button size="sm" loading={busy === a.id} onClick={() => act(a, 'ack')}>
                      <Check className="size-3.5" /> Reconocer
                    </Button>
                  )}
                  {a.status !== 'resuelta' && (
                    <Button size="sm" variant="ghost" loading={busy === a.id} onClick={() => act(a, 'resolve')}>
                      <CheckCheck className="size-3.5" /> Resolver
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
