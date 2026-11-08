import { DEVICE_CATALOG, DEVICE_IDS, type DeviceId } from '@scbga/shared';
import { ArrowUp, Bot, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AiChart } from '../components/AiChart';
import { Button, Card, CardHeader, Empty, PageHeader, ProvenanceTag, cx, inputCls } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, fmtNum } from '../lib/format';
import { useToast } from '../lib/toast';
import type { AiAnalysis, AiChatResponse, AiStatus } from '../lib/types';

const SUGGESTIONS = [
  'Promedio, mínimo y máximo de temperatura hoy',
  'Compara el ruido con el flujo vehicular esta semana',
  '¿A qué hora hay más tráfico?',
  '¿Qué alertas hay activas?',
  '¿Cuántos incidentes hubo ayer?',
  'Nivel del río en los últimos 3 días',
];

const EXPERT_LABEL: Record<string, string> = {
  estadisticas: 'Estadísticas',
  serie: 'Serie temporal',
  perfil_horario: 'Perfil horario',
  alertas: 'Alertas',
  incidentes: 'Incidentes',
  estado: 'Estado',
  ayuda: 'Ayuda',
  fuera_de_tema: 'Fuera de tema',
};

type Msg = { id: number; role: 'user'; text: string } | { id: number; role: 'ai'; res: AiChatResponse } | { id: number; role: 'error'; text: string };

function Answer({ res }: { res: AiChatResponse }) {
  const tokens = res.usage.prompt_tokens + res.usage.completion_tokens;
  return (
    <div className="min-w-0">
      <p className="text-[15px] leading-relaxed whitespace-pre-line text-ink">{res.text}</p>
      {res.chart && <AiChart spec={res.chart} />}
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
        {res.synthetic && <ProvenanceTag synthetic compact />}
        {res.decision && <span>Experto: <span className="text-ink-2">{EXPERT_LABEL[res.decision.experto] ?? res.decision.experto}</span></span>}
        <span className="code">{res.cached ? '0 tokens · caché' : `${tokens} tokens`}</span>
        <span className="code">{(res.ms.total / 1000).toFixed(1)} s</span>
        {res.model && !res.cached && <span className="code">{res.model}</span>}
      </p>
    </div>
  );
}

function UsageStrip({ status }: { status: AiStatus | null }) {
  const chat = status?.all_time.find((r) => r.kind === 'chat');
  if (!status) return null;
  return (
    <dl className="grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-4">
      {[
        { k: 'Modelo', v: status.enabled ? (status.model ?? '—') : 'deshabilitado' },
        { k: 'Consultas', v: fmtNum(chat?.calls ?? 0, 0) },
        { k: 'Tokens / consulta', v: chat?.avg_tokens ? fmtNum(chat.avg_tokens, 0) : '—' },
        { k: 'Latencia media', v: chat?.avg_total_ms ? `${(chat.avg_total_ms / 1000).toFixed(1)} s` : '—' },
      ].map((x) => (
        <div key={x.k} className="bg-surface px-5 py-3">
          <dt className="label">{x.k}</dt>
          <dd className="display mt-1 truncate text-[22px] font-semibold">{x.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function AnalysisPanel({ enabled }: { enabled: boolean }) {
  const { token, requestLogin } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<AiAnalysis[] | null>(null);
  const [busy, setBusy] = useState<DeviceId | null>(null);
  const [device, setDevice] = useState<DeviceId>('DEV01');

  const load = useCallback(() => api<AiAnalysis[]>('/api/ai/analysis').then(setItems).catch(() => setItems([])), []);
  useEffect(() => void load(), [load]);

  async function generate() {
    if (!token) return requestLogin();
    setBusy(device);
    try {
      await api(`/api/ai/analysis/${device}`, { body: { hours: 144 }, auth: true });
      await load();
      toast({ tone: 'ok', title: `Análisis de ${device} generado` });
    } catch (err) {
      toast({ tone: 'error', title: 'No se pudo generar el análisis', detail: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        eyebrow="Análisis de gráficas con IA · ventana de 6 días"
        title="Comportamiento por dispositivo"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select className={cx(inputCls, 'h-8 w-auto py-0 text-[13px]')} value={device} onChange={(e) => setDevice(e.target.value as DeviceId)} aria-label="Dispositivo a analizar">
              {DEVICE_IDS.map((id) => (
                <option key={id} value={id}>
                  {id} · {DEVICE_CATALOG[id].name}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={generate} loading={busy !== null} disabled={!enabled}>
              <Sparkles className="size-4" /> Generar
            </Button>
          </div>
        }
      />
      <p className="px-5 pt-3 text-[13px] text-ink-3">
        Los promedios, mínimos, máximos, horas pico y tendencias se calculan en el servidor; el modelo solo redacta el párrafo con esos números. Requiere sesión de operador.
      </p>
      {items === null ? (
        <p className="label px-5 py-6">Cargando…</p>
      ) : items.length === 0 ? (
        <Empty title="Aún no hay análisis generados" />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((a) => {
            const spec = DEVICE_CATALOG[a.device_id as DeviceId];
            return (
              <li key={a.device_id} className="px-5 py-4">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="code text-ink-2">{a.device_id}</span>
                  <span className="font-semibold">{spec?.name ?? a.device_id}</span>
                  {spec && <ProvenanceTag synthetic={spec.provenance.synthetic} compact />}
                  <span className="text-[12px] text-ink-3">
                    {fmtDateTime(a.created_at)} · {a.hours / 24} días · {a.model}
                  </span>
                </p>
                <p className="mt-2 max-w-[90ch] text-[14px] leading-relaxed text-ink-2">{a.text}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  const loadStatus = useCallback(() => api<AiStatus>('/api/ai/status').then(setStatus).catch(() => setStatus(null)), []);
  useEffect(() => void loadStatus(), [loadStatus]);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [msgs]);

  async function ask(question: string) {
    const text = question.trim();
    if (text.length < 2 || busy) return;
    setQ('');
    setMsgs((m) => [...m, { id: nextId.current++, role: 'user', text }]);
    setBusy(true);
    try {
      // Sin historial: cada pregunta viaja sola (bajo consumo de tokens).
      const res = await api<AiChatResponse>('/api/ai/chat', { body: { question: text } });
      setMsgs((m) => [...m, { id: nextId.current++, role: 'ai', res }]);
      void loadStatus();
    } catch (err) {
      setMsgs((m) => [...m, { id: nextId.current++, role: 'error', text: (err as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(q);
  };

  return (
    <>
      <PageHeader
        code="IA · Asistente"
        title="Asistente"
        subtitle="Pregunta en lenguaje natural por los datos de la ciudad. Un enrutador IA elige al experto y la gráfica; los cálculos se hacen sobre InfluxDB, no en el modelo."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <Card className="flex min-h-[560px] flex-col">
          <CardHeader
            eyebrow="Chat · sin historial · salida JSON restringida"
            title="Consulta"
            action={
              msgs.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setMsgs([])}>
                  <RefreshCw className="size-4" /> Limpiar
                </Button>
              )
            }
          />
          <UsageStrip status={status} />

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5" aria-live="polite">
            {msgs.length === 0 && (
              <div>
                <p className="text-[15px] text-ink-2">Prueba con alguna de estas preguntas:</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => void ask(s)} disabled={busy || status?.enabled === false} className="rounded-[5px] border border-line-strong px-3 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-45">
                      {s}
                    </button>
                  ))}
                </div>
                {status?.enabled === false && <p className="mt-4 text-[13px] text-warn">El asistente no está configurado en este servidor (falta AI_API_KEY).</p>}
              </div>
            )}
            {msgs.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[80%] rounded-[6px] bg-surface-3 px-3.5 py-2 text-[15px]">{m.text}</p>
                </div>
              ) : m.role === 'ai' ? (
                <div key={m.id} className="flex gap-3">
                  <Bot className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                  <Answer res={m.res} />
                </div>
              ) : (
                <p key={m.id} className="text-[14px] text-crit">
                  {m.text}
                </p>
              ),
            )}
            {busy && <p className="label animate-pulse">Consultando…</p>}
            <div ref={endRef} />
          </div>

          <form onSubmit={onSubmit} className="flex gap-2 border-t border-line p-4">
            <input
              className={inputCls}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ej.: ¿cuál fue la temperatura máxima ayer?"
              maxLength={300}
              aria-label="Pregunta para el asistente"
              disabled={status?.enabled === false}
            />
            <Button type="submit" variant="primary" loading={busy} disabled={q.trim().length < 2} aria-label="Enviar pregunta">
              <ArrowUp className="size-4" />
            </Button>
          </form>
        </Card>

        <AnalysisPanel enabled={status?.enabled !== false} />
      </div>
    </>
  );
}
