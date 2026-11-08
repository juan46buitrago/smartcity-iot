/**
 * Asistente siempre a mano: botón flotante + panel lateral. En pantallas anchas el panel se
 * acopla a la derecha y el contenido se corre (se puede seguir usando la app al lado);
 * en móvil ocupa toda la pantalla.
 */
import { Bot, Maximize2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAssistant } from '../lib/assistant';
import { AssistantChat } from './AssistantChat';
import { cx } from './ui';

export const DRAWER_W = 440;

export function AssistantDrawer() {
  const { open, setOpen, busy, ask } = useAssistant();
  const { pathname } = useLocation();
  const onPage = pathname === '/asistente';

  // Enlace directo: ?asistente abre el panel; ?asistente=<pregunta> además la hace (una sola vez).
  const { search } = useLocation();
  const asked = useRef<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(search);
    if (!p.has('asistente')) return;
    setOpen(true);
    const q = p.get('asistente')?.trim();
    if (q && asked.current !== q) {
      asked.current = q;
      void ask(q);
    }
  }, [search, setOpen, ask]);

  // En la página del asistente el panel sobra; Esc lo cierra.
  useEffect(() => {
    if (onPage) setOpen(false);
  }, [onPage, setOpen]);
  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [setOpen]);

  // En móvil, al tocar un acceso se cierra el panel para ver la vista.
  const closeOnMobile = () => {
    if (window.matchMedia('(max-width: 1279px)').matches) setOpen(false);
  };

  return (
    <>
      {!open && !onPage && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-20 z-[1100] inline-flex h-12 items-center gap-2 rounded-full bg-accent pr-5 pl-4 text-[14px] font-semibold text-accent-ink shadow-[0_14px_34px_-12px_oklch(0_0_0/0.7)] transition-transform hover:-translate-y-0.5 lg:right-6 lg:bottom-6"
          aria-label="Abrir el asistente IA"
        >
          <Bot className="size-5" aria-hidden />
          Pregúntale a la IA
          {busy && <span className="size-2 animate-pulse rounded-full bg-accent-ink" />}
        </button>
      )}

      <aside
        className={cx(
          'fixed inset-0 z-[1300] flex flex-col bg-surface transition-transform duration-200 xl:inset-y-0 xl:top-16 xl:right-0 xl:left-auto xl:z-[900] xl:w-[440px] xl:border-l xl:border-line',
          open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
        )}
        aria-label="Asistente IA"
        aria-hidden={!open}
        inert={!open}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-4 xl:w-[440px]">
          <p className="flex items-center gap-2 font-semibold">
            <Bot className="size-5 text-accent" aria-hidden /> Asistente IA
          </p>
          <div className="flex items-center gap-1">
            <Link to="/asistente" className="grid size-9 place-items-center rounded-[5px] text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Abrir en página completa" title="Página completa">
              <Maximize2 className="size-4" />
            </Link>
            <button onClick={() => setOpen(false)} className="grid size-9 place-items-center rounded-[5px] text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Cerrar el asistente">
              <X className="size-5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 xl:w-[440px]">
          <AssistantChat variant="panel" onNavigate={closeOnMobile} />
        </div>
      </aside>
    </>
  );
}
