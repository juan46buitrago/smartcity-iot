import { DEVICE_CATALOG, DEVICE_IDS, type DeviceId } from '@scbga/shared';
import { Bot, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AGENT_ICON, AssistantChat } from '../components/AssistantChat';
import { Nodo } from '../components/Nodo';
import { Button, Card, CardHeader, Empty, PageHeader, ProvenanceTag, cx, inputCls } from '../components/ui';
import { api } from '../lib/api';
import { AI_TIMEOUT_MS, useAssistant } from '../lib/assistant';
import { useAuth } from '../lib/auth';
import { fmtDateTime, fmtNum } from '../lib/format';
import { useToast } from '../lib/toast';
import type { AiAnalysis, AiStatus } from '../lib/types';

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

  const load = useCallback(() => api<AiAnalysis[]>('/api/ai/analysis', { expect: 'array' }).then(setItems).catch(() => setItems([])), []);
  useEffect(() => void load(), [load]);

  async function generate() {
    if (!token) return requestLogin();
    setBusy(device);
    try {
      await api(`/api/ai/analysis/${device}`, { body: { hours: 144 }, auth: true, timeoutMs: AI_TIMEOUT_MS });
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

function AgentsGuide() {
  const { agents, agent, setAgent } = useAssistant();
  return (
    <Card>
      <CardHeader eyebrow="Cada agente ve solo su tema: menos tokens y respuestas más precisas" title="Agentes expertos" />
      <ul className="divide-y divide-line">
        {agents.map((a) => {
          const Icon = AGENT_ICON[a.id] ?? Bot;
          const on = a.id === agent.id;
          return (
            <li key={a.id}>
              <button onClick={() => setAgent(a.id)} className={cx('flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2', on && 'bg-ai-soft')} aria-pressed={on}>
                <Icon className={cx('mt-0.5 size-5 shrink-0', on ? 'text-ai' : 'text-ink-3')} aria-hidden />
                <span className="min-w-0">
                  <span className="block font-semibold">{a.name}</span>
                  <span className="block text-[13px] text-ink-2">{a.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function AssistantPage() {
  const { status } = useAssistant();
  return (
    <>
      <PageHeader
        code="IA · Asistente"
        title="Asistente"
        subtitle="Pregunta en lenguaje natural por los datos de la ciudad. Elige un agente experto o deja que el general escoja el tema; los cálculos se hacen sobre InfluxDB, no en el modelo. También lo tienes en el botón «Pregúntale a Nodo» de cualquier página."
        action={<Nodo mood="happy" size={112} />}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="flex h-[calc(100dvh-14rem)] min-h-[520px] flex-col overflow-hidden">
          <AssistantChat variant="page" />
        </Card>
        <div className="space-y-6">
          <AgentsGuide />
          <Card>
            <UsageStrip status={status} />
          </Card>
          <AnalysisPanel enabled={status?.enabled !== false} />
        </div>
      </div>
    </>
  );
}
