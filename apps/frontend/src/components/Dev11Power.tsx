import { Power } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Card, cx } from './ui';

interface Dev11State {
  available: boolean;
  running: boolean;
  lease_s: number;
  max_s: number;
  error?: string | null;
}

/**
 * Latido global: mientras alguien tenga una pestaña visible y DEV11 esté encendido, avisa al servidor.
 * Cuando nadie lo hace (pestañas cerradas u ocultas) el arriendo vence y el simulador se apaga solo.
 */
export function useDev11Heartbeat() {
  useEffect(() => {
    let stop = false;
    const beat = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const s = await api<Dev11State>('/api/dev11');
        if (!stop && s.available && s.running) await api<Dev11State>('/api/dev11/ping', { method: 'POST', body: {} });
      } catch {
        /* sin controlador o sin red: no pasa nada */
      }
    };
    void beat();
    const t = setInterval(beat, 40_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
}

/** Tarjeta de DEV11 «bajo demanda»: encender/apagar el ESP32 simulado desde la página, para demostraciones. */
export function Dev11Power({ online }: { online: boolean }) {
  const { user, requestLogin } = useAuth();
  const toast = useToast();
  const [s, setS] = useState<Dev11State | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => api<Dev11State>('/api/dev11').then(setS).catch(() => setS(null)), []);
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!s?.available) return null;

  const act = async (what: 'start' | 'stop') => {
    if (!user) {
      requestLogin();
      return;
    }
    setBusy(true);
    try {
      setS(await api<Dev11State>(`/api/dev11/${what}`, { method: 'POST', body: {}, auth: true }));
      toast(what === 'start' ? { tone: 'ok', title: 'Encendiendo DEV11', detail: 'El simulador tarda 1 o 2 minutos en conectarse al broker.' } : { tone: 'ok', title: 'DEV11 apagado' });
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo cambiar DEV11', detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const connecting = s.running && !online;
  const label = !s.running ? 'Apagado' : connecting ? 'Arrancando…' : 'En línea · demostración';
  return (
    <Card className="rise" style={{ ['--i' as string]: 1 }}>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className={cx('grid size-10 place-items-center rounded-full', s.running ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-ink-3')}>
            <Power className="size-5" aria-hidden />
          </span>
          <div>
            <p className="label">Encendido bajo demanda</p>
            <p className="flex items-center gap-2 font-semibold">
              <span className={cx('size-2 rounded-full', connecting ? 'animate-pulse bg-warn' : s.running ? 'live-dot bg-accent text-accent' : 'bg-ink-3')} aria-hidden />
              {label}
            </p>
            <p className={cx('mt-0.5 max-w-[60ch] text-[13px]', s.error && !s.running ? 'text-warn' : 'text-ink-3')}>
              {s.error && !s.running
                ? `No pudo arrancar: ${s.error}`
                : s.running
                ? 'Se apaga solo un par de minutos después de que nadie tenga la página abierta.'
                : 'Este ESP32 corre en un simulador que solo se enciende para demostraciones, así no gasta nada el resto del tiempo.'}
            </p>
          </div>
        </div>
        {s.running ? (
          <Button variant="danger" onClick={() => act('stop')} disabled={busy}>
            Apagar DEV11
          </Button>
        ) : (
          <Button variant="primary" onClick={() => act("start")} disabled={busy}>
            {user ? 'Encender para la demostración' : 'Desbloquear para encender'}
          </Button>
        )}
      </div>
    </Card>
  );
}
