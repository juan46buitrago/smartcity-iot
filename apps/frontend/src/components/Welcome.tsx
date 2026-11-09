import { Bell, Cpu, Gauge, History, Lock, Map as MapIcon, Sparkles, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAssistant } from '../lib/assistant';
import { Nodo } from './Nodo';
import { Button } from './ui';

const KEY = 'scbga.bienvenida';

const STOPS: { to: string; icon: LucideIcon; title: string; text: string }[] = [
  { to: '/', icon: Gauge, title: 'Panel', text: 'La ciudad de un vistazo: lecturas en vivo, mapa y alertas abiertas.' },
  { to: '/mapa', icon: MapIcon, title: 'Mapa', text: 'Dónde está cada dispositivo y los incidentes viales.' },
  { to: '/dispositivos', icon: Cpu, title: 'Dispositivos', text: 'La ficha de cada uno: qué es, dónde está y cómo controlarlo (apagar, ajustar, calibrar).' },
  { to: '/historico', icon: History, title: 'Histórico', text: 'Las gráficas de los días de datos, con promedio, mínimo y máximo.' },
  { to: '/alertas', icon: Bell, title: 'Alertas', text: 'Avisos por umbrales, valores atípicos y equipos desconectados.' },
];

/** Cuándo mostrar la bienvenida: la primera visita, salvo enlaces directos (?asistente) o ?bienvenida=0 (capturas). */
export function useWelcome() {
  const [open, setOpen] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.has('asistente') || q.get('bienvenida') === '0') return false;
      return localStorage.getItem(KEY) !== '1';
    } catch {
      return false;
    }
  });
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* sin almacenamiento */
    }
  };
  return { open, show: () => setOpen(true), close };
}

/** Guía de primera vez: Nodo explica qué es el sitio y dónde está cada cosa. Se reabre con «¿Cómo se usa?». */
export function Welcome({ onClose }: { onClose: () => void }) {
  const { setOpen: openAssistant } = useAssistant();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1500] grid place-items-center overflow-y-auto bg-bg/80 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="panel w-full max-w-[720px] shadow-[0_30px_80px_-30px_oklch(0_0_0/0.8)]">
        <div className="flex items-start gap-4 border-b border-line px-6 py-5">
          <Nodo mood="happy" size={84} />
          <div className="min-w-0 flex-1">
            <p className="label text-ai">Bienvenida</p>
            <h2 id="welcome-title" className="display mt-1 text-[34px] leading-none font-extrabold uppercase">
              Hola, soy Nodo
            </h2>
            <p className="mt-2 text-[14.5px] text-ink-2">
              Esto es SmartCityBGA: una ciudad inteligente de Bucaramanga con 12 dispositivos IoT conectados por MQTT. Te muestro dónde está cada cosa.
            </p>
          </div>
          <button onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-[5px] text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Cerrar la guía">
            <X className="size-5" />
          </button>
        </div>

        <ul className="grid gap-px bg-line sm:grid-cols-2">
          {STOPS.map(({ to, icon: Icon, title, text }) => (
            <li key={to} className="bg-surface">
              <Link to={to} onClick={onClose} className="flex h-full gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2">
                <Icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-[13.5px] text-ink-3">{text}</span>
                </span>
              </Link>
            </li>
          ))}
          <li className="bg-surface">
            <button
              onClick={() => {
                onClose();
                openAssistant(true);
              }}
              className="flex h-full w-full gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-2"
            >
              <Sparkles className="mt-0.5 size-5 shrink-0 text-ai" aria-hidden />
              <span>
                <span className="block font-semibold">Pregúntale a Nodo</span>
                <span className="block text-[13.5px] text-ink-3">Habla en lenguaje natural: resúmenes del día, gráficas y órdenes con confirmación.</span>
              </span>
            </button>
          </li>
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
          <p className="flex items-start gap-2 text-[13px] text-ink-3">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Mirar es libre. Para <strong className="text-ink-2">controlar</strong> dispositivos pulsa «Desbloquear» (contraseña de operador). Lo simulado lleva la etiqueta <span className="code">SIM</span>.
            </span>
          </p>
          <Button data-autofocus onClick={onClose}>
            Empezar
          </Button>
        </div>
      </div>
    </div>
  );
}
