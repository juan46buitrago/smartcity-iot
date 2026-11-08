/**
 * Chat del asistente (panel lateral y página /asistente). Agentes expertos por tema, respuestas
 * con viñetas, gráfica, accesos a la vista relacionada y reintento si algo falla.
 */
import { ArrowUp, Bot, CloudSun, Droplets, Lamp, LayoutGrid, RotateCcw, ShieldAlert, Trash2, Wind, Car, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAssistant, type ChatMsg } from '../lib/assistant';
import type { AiChatResponse } from '../lib/types';
import { AiChart } from './AiChart';
import { Button, ProvenanceTag, cx } from './ui';

export const AGENT_ICON: Record<string, LucideIcon> = {
  general: LayoutGrid,
  clima: CloudSun,
  aire: Wind,
  movilidad: Car,
  agua: Droplets,
  alumbrado: Lamp,
  operacion: ShieldAlert,
};

const EXPERT_LABEL: Record<string, string> = {
  estadisticas: 'estadísticas',
  serie: 'serie temporal',
  perfil_horario: 'perfil horario',
  estado: 'valor actual',
  resumen: 'resumen',
  alertas: 'alertas',
  incidentes: 'incidentes',
  dispositivos: 'dispositivos',
  ayuda: 'ayuda',
  fuera_de_tema: 'fuera de tema',
};

/** Texto del experto: párrafos y viñetas "• " como lista real. */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2.5 text-[14.5px] leading-relaxed text-ink">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        const head = lines.filter((l) => !l.startsWith('• '));
        const items = lines.filter((l) => l.startsWith('• '));
        return (
          <div key={i}>
            {head.map((l, j) => (
              <p key={j} className={cx(items.length > 0 && 'font-semibold')}>
                {l}
              </p>
            ))}
            {items.length > 0 && (
              <ul className="mt-1 space-y-1">
                {items.map((l, j) => (
                  <li key={j} className="relative pl-4 text-ink-2 before:absolute before:top-[0.6em] before:left-0.5 before:size-1.5 before:rounded-full before:bg-ink-3">
                    {l.slice(2)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Answer({ res, compact, onNavigate }: { res: AiChatResponse; compact?: boolean; onNavigate?: () => void }) {
  const tokens = res.usage.prompt_tokens + res.usage.completion_tokens;
  return (
    <div className="min-w-0 flex-1">
      <RichText text={res.text} />
      {res.chart && <AiChart spec={res.chart} compact={compact} />}
      {!!res.links?.length && (
        <div className="mt-3 flex flex-wrap gap-2">
          {res.links.map((l) => (
            <Link key={l.to + l.label} to={l.to} onClick={onNavigate} className="rounded-[5px] border border-line-strong px-2.5 py-1 text-[12.5px] font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
              {l.label} →
            </Link>
          ))}
        </div>
      )}
      <p className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-3">
        {res.synthetic && <ProvenanceTag synthetic compact />}
        {res.decision && <span>{EXPERT_LABEL[res.decision.experto] ?? res.decision.experto}</span>}
        <span aria-hidden>·</span>
        <span className="code">{res.cached ? 'caché · 0 tokens' : `${tokens} tokens`}</span>
        <span aria-hidden>·</span>
        <span className="code">{(res.ms.total / 1000).toFixed(1)} s</span>
      </p>
    </div>
  );
}

function Message({ m, compact, onNavigate, onRetry }: { m: ChatMsg; compact?: boolean; onNavigate?: () => void; onRetry: (q: string) => void }) {
  if (m.role === 'user')
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[8px] rounded-br-[2px] bg-surface-3 px-3.5 py-2 text-[14.5px]">{m.text}</p>
      </div>
    );
  if (m.role === 'error')
    return (
      <div className="rounded-[6px] border border-crit/40 bg-crit-soft px-3.5 py-2.5 text-[13.5px]">
        <p className="text-ink">{m.text}</p>
        <button onClick={() => onRetry(m.question)} className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-crit hover:underline">
          <RotateCcw className="size-3.5" /> Reintentar
        </button>
      </div>
    );
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
        <Bot className="size-3.5" aria-hidden />
      </span>
      <Answer res={m.res} compact={compact} onNavigate={onNavigate} />
    </div>
  );
}

export function AgentPicker({ compact }: { compact?: boolean }) {
  const { agents, agent, setAgent, busy } = useAssistant();
  return (
    <div className={cx('flex gap-1.5 overflow-x-auto pb-1', !compact && 'flex-wrap overflow-visible')} role="radiogroup" aria-label="Agente experto">
      {agents.map((a) => {
        const Icon = AGENT_ICON[a.id] ?? Bot;
        const on = a.id === agent.id;
        return (
          <button
            key={a.id}
            role="radio"
            aria-checked={on}
            disabled={busy}
            onClick={() => setAgent(a.id)}
            title={a.description}
            className={cx(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-60',
              on ? 'border-transparent bg-accent text-accent-ink' : 'border-line-strong text-ink-2 hover:bg-surface-2 hover:text-ink',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {a.name}
          </button>
        );
      })}
    </div>
  );
}

export function AssistantChat({ variant = 'panel', onNavigate }: { variant?: 'panel' | 'page'; onNavigate?: () => void }) {
  const { agent, msgs, busy, status, ask, clear, open } = useAssistant();
  const [q, setQ] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const compact = variant === 'panel';
  const disabled = status?.enabled === false;

  // Llaves obligatorias: en Chrome reciente scrollIntoView devuelve una promesa y React la tomaría como limpieza.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);
  useEffect(() => {
    if (open || variant === 'page') inputRef.current?.focus();
  }, [open, variant]);

  const send = (text: string) => {
    setQ('');
    void ask(text);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(q);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(q);
    }
  };
  const AgentIcon = AGENT_ICON[agent.id] ?? Bot;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cx('border-b border-line', compact ? 'px-4 py-3' : 'px-5 py-4')}>
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <p className="label">Agentes expertos</p>
          {msgs.length > 0 && (
            <Button size="sm" variant="ghost" onClick={clear} aria-label="Borrar la conversación">
              <Trash2 className="size-4" /> Limpiar
            </Button>
          )}
        </div>
        <AgentPicker compact={compact} />
      </div>

      <div className={cx('min-h-0 flex-1 space-y-5 overflow-y-auto', compact ? 'px-4 py-4' : 'px-5 py-5')} aria-live="polite">
        {msgs.length === 0 && (
          <div>
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-accent-soft text-accent">
                <AgentIcon className="size-5" aria-hidden />
              </span>
              <div>
                <p className="font-semibold">Agente {agent.name}</p>
                <p className="text-[13.5px] text-ink-2">{agent.description}</p>
              </div>
            </div>
            <p className="mt-5 mb-2 text-[13px] text-ink-3">Toca una pregunta o escribe la tuya:</p>
            <div className="flex flex-col items-start gap-2">
              {agent.suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} disabled={busy || disabled} className="rounded-[6px] border border-line-strong px-3 py-1.5 text-left text-[13.5px] text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:opacity-45">
                  {s}
                </button>
              ))}
            </div>
            {disabled && <p className="mt-4 text-[13px] text-warn">El asistente no está configurado en este servidor.</p>}
          </div>
        )}
        {msgs.map((m) => (
          <Message key={m.id} m={m} compact={compact} onNavigate={onNavigate} onRetry={send} />
        ))}
        {busy && (
          <div className="flex items-center gap-2.5 text-[13px] text-ink-3">
            <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-accent">
              <Bot className="size-3.5" aria-hidden />
            </span>
            <span className="flex gap-1" aria-label="Pensando">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-pulse rounded-full bg-ink-3" style={{ animationDelay: `${i * 160}ms` }} />
              ))}
            </span>
            Consultando a {agent.name}…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className={cx('border-t border-line', compact ? 'p-3' : 'p-4')}>
        {msgs.length > 0 && !busy && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {agent.suggestions.slice(0, 3).map((s) => (
              <button key={s} type="button" onClick={() => send(s)} disabled={disabled} className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink">
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-[8px] border border-line-strong bg-bg p-1.5 focus-within:border-accent">
          <textarea
            ref={inputRef}
            rows={1}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[14.5px] text-ink placeholder:text-ink-3 focus:outline-none disabled:opacity-45"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={`Pregúntale a ${agent.name}…`}
            maxLength={300}
            aria-label="Pregunta para el asistente"
            disabled={disabled}
          />
          <Button type="submit" variant="primary" size="sm" className="size-9 px-0" loading={busy} disabled={q.trim().length < 2} aria-label="Enviar pregunta">
            {!busy && <ArrowUp className="size-4" />}
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-ink-3">Entiende seguimientos como «¿y ayer?». Los cálculos se hacen sobre los datos, no en el modelo.</p>
      </form>
    </div>
  );
}
