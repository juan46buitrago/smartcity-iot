/**
 * Asistente siempre a mano: botón flotante + panel lateral. En pantallas anchas el panel se
 * acopla a la derecha y el contenido se corre (se puede seguir usando la app al lado);
 * en móvil ocupa toda la pantalla.
 */
import { Maximize2, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAssistant } from '../lib/assistant';
import { useNodoMood } from '../lib/nodoMood';
import { setVoiceEnabled, speak, useSpeech } from '../lib/speech';
import { AssistantChat } from './AssistantChat';
import { Nodo } from './Nodo';
import { cx } from './ui';

export const DRAWER_W = 440;

export function AssistantDrawer() {
  const { open, setOpen, busy, ask } = useAssistant();
  const { mood, alerts } = useNodoMood();
  const voice = useSpeech();
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
          className="group fixed right-3 bottom-[4.6rem] z-[1100] flex items-end gap-1 lg:right-5 lg:bottom-4"
          aria-label="Abrir a Nodo, el asistente IA"
        >
          <span className="mb-5 max-w-[11rem] rounded-[10px] rounded-br-[3px] border border-line-strong bg-surface px-3 py-1.5 text-left text-[13px] leading-snug font-semibold text-ink shadow-[0_14px_34px_-14px_oklch(0_0_0/0.7)] transition-transform group-hover:-translate-y-0.5">
            {busy ? 'Pensando…' : alerts > 0 ? `Hay ${alerts} ${alerts === 1 ? 'alerta abierta' : 'alertas abiertas'}` : 'Pregúntale a Nodo'}
          </span>
          <Nodo mood={mood} size={68} />
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
            <Nodo mood={mood} size={34} bounce={false} /> Nodo <span className="font-normal text-ink-3">· asistente IA</span>
          </p>
          <div className="flex items-center gap-1">
            {voice.supported && (
              <button
                onClick={() => (voice.enabled ? setVoiceEnabled(false) : (setVoiceEnabled(true), speak('Listo, ahora te leo las respuestas.')))}
                className={cx('grid size-9 place-items-center rounded-[5px] hover:bg-surface-2', voice.enabled ? 'text-ai' : 'text-ink-3 hover:text-ink')}
                aria-label={voice.enabled ? 'Silenciar la voz de Nodo' : 'Activar la voz de Nodo'}
                aria-pressed={voice.enabled}
                title={voice.enabled ? 'Voz activada' : 'Voz desactivada'}
              >
                {voice.enabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </button>
            )}
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
