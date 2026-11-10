/**
 * Controles de un dispositivo generados desde su especificación del catálogo.
 * Cada acción se envía al backend → MQTT → dispositivo, y se muestra la confirmación (ack) real.
 */
import { INCIDENT_SEVERITIES, INCIDENT_TYPES, validateCommand, type CommandAction, type ParamSpec, type Threshold } from '@scbga/shared';
import { CircleCheck, CircleX, Clock3, Lock, Power, RotateCcw, Siren } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { isOnline } from '../lib/live';
import { useToast } from '../lib/toast';
import type { CommandRecord, DeviceView } from '../lib/types';
import { Badge, Button, Field, Segmented, Switch, cx, inputCls } from './ui';

const MODE_LABEL: Record<string, string> = { twin: 'Gemelo', manual: 'Manual', normal: 'Normal', evento: 'Evento', silencio: 'Silencio', auto: 'Automático', cerrado: 'Cerrado' };
const INCIDENT_LABEL: Record<string, string> = { accidente: 'Accidente', vehiculo_averiado: 'Vehículo averiado', cierre_parcial: 'Cierre parcial', congestion: 'Congestión' };

export function useCommand(device: DeviceView) {
  const { user, requestLogin } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<CommandRecord | null>(null);
  // Guarda síncrona: dos clics en el mismo tic leen el mismo estado `busy`; la referencia no.
  const inFlight = useRef(false);

  const send = async (action: CommandAction, params: Record<string, unknown>, label: string) => {
    if (!user) return requestLogin();
    if (inFlight.current) return;
    const check = validateCommand(device.id, action, params);
    if (!check.ok) {
      toast({ tone: 'error', title: 'Valor no válido', detail: check.error });
      return;
    }
    inFlight.current = true;
    setBusy(label);
    try {
      const rec = await api<CommandRecord>(`/api/devices/${device.id}/commands`, { body: { action, params }, auth: true, expect: ['status'] });
      setLast(rec);
      if (rec.status === 'confirmed') toast({ tone: 'ok', title: `${device.id}: ${label}`, detail: `Confirmado por el dispositivo · config v${rec.config_version}` });
      else if (rec.status === 'rejected') toast({ tone: 'error', title: `${device.id} rechazó la orden`, detail: rec.error ?? undefined });
      else toast({ tone: 'error', title: `${device.id} no respondió`, detail: 'Sin confirmación en 10 s' });
    } catch (e) {
      toast({ tone: 'error', title: 'No se envió la orden', detail: (e as Error).message });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };
  return { send, busy, last, canControl: !!user };
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <div className="border-t border-line px-5 py-5 first:border-t-0">
      <p className="label">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function ParamInput({ spec, value, onChange, disabled }: { spec: ParamSpec; value: unknown; onChange: (v: number | string | boolean) => void; disabled: boolean }) {
  if (spec.type === 'boolean') return <Switch checked={!!value} onChange={onChange} disabled={disabled} label={spec.label} />;
  if (spec.type === 'enum')
    return (
      <select className={inputCls} value={String(value)} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {spec.options!.map((o) => (
          <option key={o} value={o}>
            {o === 'simulated_route' ? 'Ruta simulada (sintética)' : o === 'gpsmobile' ? 'gpsmobile.co (requiere autorización)' : o}
          </option>
        ))}
      </select>
    );
  const n = typeof value === 'number' ? value : Number(spec.default);
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={spec.min} max={spec.max} step={spec.step ?? 1} value={n} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} className="flex-1" aria-label={spec.label} />
      <input type="number" min={spec.min} max={spec.max} step={spec.step ?? 1} value={n} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} className={cx(inputCls, 'num w-24')} aria-label={`${spec.label} (valor)`} />
    </div>
  );
}

function ThresholdRow({ device, variable, send, busy, disabled }: { device: DeviceView; variable: string; send: ReturnType<typeof useCommand>['send']; busy: string | null; disabled: boolean }) {
  const spec = device.variables.find((v) => v.key === variable)!;
  const current = device.live.config?.thresholds[variable] ?? device.default_thresholds[variable] ?? {};
  const [t, setT] = useState<Threshold>(current);
  useEffect(() => setT(current), [JSON.stringify(current)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(t) !== JSON.stringify(current);
  const field = (k: keyof Threshold, label: string, tone: string) => (
    <label className="min-w-0">
      <span className={cx('mb-1 block text-[11px] font-medium', tone)}>{label}</span>
      <input
        type="number"
        className={cx(inputCls, 'num h-9')}
        value={t[k] ?? ''}
        placeholder="—"
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value === '' ? undefined : Number(e.target.value);
          setT((x) => {
            const n = { ...x };
            if (v === undefined) delete n[k];
            else n[k] = v;
            return n;
          });
        }}
      />
    </label>
  );
  return (
    <div className="rounded-[5px] border border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {spec.label} {spec.unit && <span className="text-ink-3">({spec.unit})</span>}
        </p>
        <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty || disabled} loading={busy === `umbral ${variable}`} onClick={() => send('set_thresholds', { variable, threshold: t }, `umbral ${variable}`)}>
          Aplicar
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field('warn_low', 'Aviso bajo', 'text-warn')}
        {field('crit_low', 'Crítico bajo', 'text-crit')}
        {field('warn_high', 'Aviso alto', 'text-warn')}
        {field('crit_high', 'Crítico alto', 'text-crit')}
      </div>
    </div>
  );
}

export function LastCommand({ rec }: { rec: CommandRecord | null }) {
  if (!rec) return null;
  const map = {
    confirmed: { icon: CircleCheck, tone: 'ok' as const, label: 'Confirmada' },
    rejected: { icon: CircleX, tone: 'crit' as const, label: 'Rechazada' },
    timeout: { icon: Clock3, tone: 'warn' as const, label: 'Sin respuesta' },
    pending: { icon: Clock3, tone: 'info' as const, label: 'Pendiente' },
  }[rec.status];
  const Icon = map.icon;
  return (
    <div className="mx-5 mb-5 flex items-start gap-2 rounded-[5px] border border-line bg-surface-2 px-3 py-2.5 text-[13px]">
      <Icon className={cx('mt-0.5 size-4 shrink-0', map.tone === 'ok' ? 'text-accent' : map.tone === 'crit' ? 'text-crit' : 'text-warn')} />
      <div className="min-w-0">
        <p>
          Última orden <span className="font-mono">{rec.action}</span> · <Badge tone={map.tone}>{map.label}</Badge>
        </p>
        {rec.error && <p className="mt-0.5 text-crit">{rec.error}</p>}
        <p className="code mt-0.5 text-ink-3">id {rec.command_id.slice(0, 8)} · {rec.config_version !== null ? `config v${rec.config_version}` : ''}</p>
      </div>
    </div>
  );
}

export function DeviceControls({ device, sections = ['power', 'mode', 'interval', 'params', 'thresholds', 'calibration', 'incident', 'restart'] }: { device: DeviceView; sections?: string[] }) {
  const { send, busy, last, canControl } = useCommand(device);
  const { requestLogin } = useAuth();
  const cfg = device.live.config;
  const online = isOnline(device);
  const disabled = !canControl || !online || !cfg;
  const [params, setParams] = useState<Record<string, number | string | boolean>>(cfg?.params ?? {});
  const [interval, setIntervalS] = useState<number>(cfg?.interval_s ?? device.interval.default);
  const [calib, setCalib] = useState<Record<string, number>>(cfg?.calibration ?? {});
  const [inc, setInc] = useState<{ type: string; severity: string }>({ type: 'accidente', severity: 'media' });

  useEffect(() => {
    if (!cfg) return;
    setParams(cfg.params);
    setIntervalS(cfg.interval_s);
    setCalib(cfg.calibration);
  }, [cfg?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const has = (a: CommandAction) => device.actions.includes(a);
  const show = (s: string) => sections.includes(s);
  const paramsDirty = cfg ? device.params.some((p) => params[p.key] !== cfg.params[p.key]) : false;

  return (
    <div>
      {!canControl && (
        <button
          data-login-trigger
          onClick={requestLogin}
          className="mx-5 mt-5 flex w-[calc(100%-40px)] items-center gap-2 rounded-[5px] border border-line px-3 py-2.5 text-left text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
        >
          <Lock className="size-4 shrink-0 text-ink-3" aria-hidden />
          <span>
            Controles bloqueados. <span className="font-semibold text-ink underline underline-offset-2">Desbloquear</span> — se pide la contraseña una sola vez.
          </span>
        </button>
      )}
      {canControl && !online && <div className="mx-5 mt-5 rounded-[5px] bg-crit-soft px-3 py-2.5 text-[13px] text-crit">El dispositivo está desconectado: no puede recibir órdenes.</div>}

      {show('power') && has('power') && cfg && (
        <Section title="Encendido">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{cfg.enabled ? 'Midiendo y publicando' : 'Sensor apagado'}</p>
              <p className="text-xs text-ink-3">Apagar detiene la medición; el dispositivo sigue escuchando órdenes.</p>
            </div>
            <Button variant={cfg.enabled ? 'danger' : 'primary'} size="sm" disabled={disabled} loading={busy === 'encendido'} onClick={() => send('power', { on: !cfg.enabled }, 'encendido')}>
              <Power className="size-4" aria-hidden />
              {cfg.enabled ? 'Apagar' : 'Encender'}
            </Button>
          </div>
        </Section>
      )}

      {show('mode') && has('set_mode') && cfg && device.modes.length > 1 && (
        <Section title="Modo de operación">
          <Segmented ariaLabel="Modo de operación" value={cfg.mode} disabled={disabled || !!busy} options={device.modes.map((m) => ({ value: m, label: MODE_LABEL[m] ?? m }))} onChange={(m) => send('set_mode', { mode: m }, `modo ${MODE_LABEL[m] ?? m}`)} />
        </Section>
      )}

      {show('interval') && has('set_interval') && cfg && (
        <Section title="Intervalo de medición" hint={device.source_type === 'api' || device.source_type === 'dataset' ? `Mínimo ${device.interval.min} s para respetar los límites de la fuente externa.` : undefined}>
          <div className="flex items-end gap-2">
            <Field label={`Segundos (${device.interval.min}–${device.interval.max})`}>
              <input type="number" className={cx(inputCls, 'num w-32')} min={device.interval.min} max={device.interval.max} value={interval} onChange={(e) => setIntervalS(Number(e.target.value))} disabled={disabled} />
            </Field>
            <Button disabled={disabled || interval === cfg.interval_s} loading={busy === 'intervalo'} onClick={() => send('set_interval', { interval_s: interval }, 'intervalo')}>
              Aplicar
            </Button>
          </div>
        </Section>
      )}

      {show('params') && has('set_params') && device.params.length > 0 && cfg && (
        <Section title={device.id === 'DEV04' ? 'Parámetros de la simulación' : 'Parámetros'}>
          <div className="space-y-4">
            {device.params.map((p) => (
              <Field key={p.key} label={`${p.label}${p.unit ? ` (${p.unit})` : ''}`} hint={p.help}>
                <ParamInput spec={p} value={params[p.key]} disabled={disabled} onChange={(v) => setParams((x) => ({ ...x, [p.key]: v }))} />
              </Field>
            ))}
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={disabled || !paramsDirty}
                loading={busy === 'parámetros'}
                onClick={() => {
                  const changed = Object.fromEntries(device.params.filter((p) => params[p.key] !== cfg.params[p.key]).map((p) => [p.key, params[p.key]]));
                  void send('set_params', changed, 'parámetros');
                }}
              >
                Aplicar cambios
              </Button>
              {paramsDirty && (
                <Button variant="ghost" onClick={() => setParams(cfg.params)}>
                  Descartar
                </Button>
              )}
            </div>
          </div>
        </Section>
      )}

      {show('thresholds') && has('set_thresholds') && (
        <Section title="Umbrales de alerta">
          <div className="space-y-3">
            {device.variables
              .filter((v) => v.thresholdable)
              .map((v) => (
                <ThresholdRow key={v.key} device={device} variable={v.key} send={send} busy={busy} disabled={disabled} />
              ))}
          </div>
        </Section>
      )}

      {show('calibration') && has('calibrate') && cfg && (
        <Section title="Calibración" hint="Desplazamiento que se suma a la lectura del sensor.">
          <div className="space-y-3">
            {device.variables
              .filter((v) => v.calibratable)
              .map((v) => (
                <div key={v.key} className="flex items-end gap-2">
                  <Field label={`${v.label} (${v.unit})`}>
                    <input type="number" step="0.1" min={-20} max={20} className={cx(inputCls, 'num w-28')} value={calib[v.key] ?? 0} disabled={disabled} onChange={(e) => setCalib((c) => ({ ...c, [v.key]: Number(e.target.value) }))} />
                  </Field>
                  <Button disabled={disabled || (calib[v.key] ?? 0) === (cfg.calibration[v.key] ?? 0)} loading={busy === `calibración ${v.key}`} onClick={() => send('calibrate', { variable: v.key, offset: calib[v.key] ?? 0 }, `calibración ${v.key}`)}>
                    Calibrar
                  </Button>
                </div>
              ))}
          </div>
        </Section>
      )}

      {show('incident') && has('inject_test_incident') && (
        <Section title="Incidente de prueba" hint="Genera un incidente sintético marcado como prueba sobre una vía real elegida al azar.">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select className={inputCls} value={inc.type} onChange={(e) => setInc((x) => ({ ...x, type: e.target.value }))} disabled={disabled} aria-label="Tipo de incidente">
              {INCIDENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {INCIDENT_LABEL[t]}
                </option>
              ))}
            </select>
            <select className={inputCls} value={inc.severity} onChange={(e) => setInc((x) => ({ ...x, severity: e.target.value }))} disabled={disabled} aria-label="Gravedad">
              {INCIDENT_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Button disabled={disabled} loading={busy === 'incidente de prueba'} onClick={() => send('inject_test_incident', inc, 'incidente de prueba')}>
              <Siren className="size-4" aria-hidden /> Generar
            </Button>
          </div>
        </Section>
      )}

      {show('restart') && has('restart') && (
        <Section title="Mantenimiento">
          <Button variant="secondary" disabled={disabled} loading={busy === 'reinicio'} onClick={() => send('restart', {}, 'reinicio')}>
            <RotateCcw className="size-4" aria-hidden /> Reiniciar dispositivo
          </Button>
          <p className="mt-2 text-xs text-ink-3">Desconexión ordenada y reconexión a los 3 s (sirve para comprobar que el aviso de desconexión llega).</p>
        </Section>
      )}

      <LastCommand rec={last} />
    </div>
  );
}
