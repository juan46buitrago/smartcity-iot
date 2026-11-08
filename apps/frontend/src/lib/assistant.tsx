/**
 * Estado del asistente IA compartido por toda la app: la conversación sobrevive al cambiar de
 * página y el panel lateral y la página /asistente muestran la misma charla.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { AiAgent, AiChatResponse, AiStatus } from './types';

export type ChatMsg =
  | { id: number; role: 'user'; text: string; agent: string }
  | { id: number; role: 'ai'; res: AiChatResponse }
  | { id: number; role: 'error'; text: string; question: string; agent: string };

/** Respaldo si /api/ai/agents no responde: el panel sigue siendo usable. */
const FALLBACK_AGENTS: AiAgent[] = [
  { id: 'general', name: 'General', description: 'Toda la ciudad: elige el tema por ti.', devices: [], suggestions: ['¿Cómo está la ciudad ahora?', '¿Cuál es la temperatura actual?', '¿A qué hora hay más tráfico?'] },
];

interface Ctx {
  open: boolean;
  setOpen: (v: boolean) => void;
  agents: AiAgent[];
  agent: AiAgent;
  setAgent: (id: string) => void;
  msgs: ChatMsg[];
  busy: boolean;
  status: AiStatus | null;
  ask: (q: string) => Promise<void>;
  clear: () => void;
}

const AssistantCtx = createContext<Ctx | null>(null);
const STORE = 'scbga.assistant';

function friendly(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Vas muy rápido: espera unos segundos y vuelve a intentarlo.';
    if (err.status === 503) return 'El asistente no está disponible en este momento.';
    if (err.status === 502) return err.message || 'No entendí la pregunta; intenta decirla de otra forma.';
    return err.message;
  }
  return 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
}

function load(): { msgs: ChatMsg[]; agent: string } {
  try {
    const raw = sessionStorage.getItem(STORE);
    if (raw) return JSON.parse(raw);
  } catch {
    /* sin almacenamiento */
  }
  return { msgs: [], agent: 'general' };
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const initial = useRef(load());
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<AiAgent[]>(FALLBACK_AGENTS);
  const [agentId, setAgentId] = useState(initial.current.agent);
  const [msgs, setMsgs] = useState<ChatMsg[]>(initial.current.msgs);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const nextId = useRef(Math.max(0, ...initial.current.msgs.map((m) => m.id)) + 1);

  const loadStatus = useCallback(() => api<AiStatus>('/api/ai/status').then(setStatus).catch(() => setStatus(null)), []);
  useEffect(() => {
    void loadStatus();
    api<AiAgent[]>('/api/ai/agents')
      .then((a) => a.length && setAgents(a))
      .catch(() => {});
  }, [loadStatus]);

  // Se guardan las últimas 20 entradas en la sesión del navegador (solo comodidad del usuario).
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ msgs: msgs.slice(-20), agent: agentId }));
    } catch {
      /* sin almacenamiento o lleno */
    }
  }, [msgs, agentId]);

  const agent = agents.find((a) => a.id === agentId) ?? agents[0]!;

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (text.length < 2 || busy) return;
      // Contexto mínimo: la decisión de la última respuesta del mismo agente (no el historial).
      const lastAi = [...msgs].reverse().find((m): m is Extract<ChatMsg, { role: 'ai' }> => m.role === 'ai');
      const previous = lastAi && lastAi.res.agent === agent.id ? lastAi.res.decision : null;
      setMsgs((m) => [...m.filter((x) => x.role !== 'error'), { id: nextId.current++, role: 'user', text, agent: agent.id }]);
      setBusy(true);
      try {
        const res = await api<AiChatResponse>('/api/ai/chat', { body: { question: text, agent: agent.id, previous } });
        setMsgs((m) => [...m, { id: nextId.current++, role: 'ai', res }]);
        void loadStatus();
      } catch (err) {
        setMsgs((m) => [...m, { id: nextId.current++, role: 'error', text: friendly(err), question: text, agent: agent.id }]);
      } finally {
        setBusy(false);
      }
    },
    [agent.id, busy, msgs, loadStatus],
  );

  const value: Ctx = {
    open,
    setOpen,
    agents,
    agent,
    setAgent: setAgentId,
    msgs,
    busy,
    status,
    ask,
    clear: () => setMsgs([]),
  };
  return <AssistantCtx.Provider value={value}>{children}</AssistantCtx.Provider>;
}

export function useAssistant() {
  const c = useContext(AssistantCtx);
  if (!c) throw new Error('useAssistant fuera de AssistantProvider');
  return c;
}
