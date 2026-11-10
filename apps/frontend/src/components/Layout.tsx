import { DEVICE_IDS } from '@scbga/shared';
import { Bell, Bot, CircleHelp, Cpu, Gauge, History, Map as MapIcon, Moon, Settings2, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAssistant } from '../lib/assistant';
import { TZ } from '../lib/format';
import { isOnline, useLive } from '../lib/live';
import { AssistantDrawer } from './AssistantDrawer';
import { useDev11Heartbeat } from './Dev11Power';
import { Welcome, useWelcome } from './Welcome';
import { LoginPopover } from './LoginDialog';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Panel', short: 'Panel', icon: Gauge, end: true },
  { to: '/mapa', label: 'Mapa', short: 'Mapa', icon: MapIcon },
  { to: '/dispositivos', label: 'Dispositivos', short: 'Equipos', icon: Cpu },
  { to: '/historico', label: 'Histórico', short: 'Histórico', icon: History },
  { to: '/alertas', label: 'Alertas', short: 'Alertas', icon: Bell },
  { to: '/asistente', label: 'Asistente', short: 'IA', icon: Bot },
  { to: '/configuracion', label: 'Configuración', short: 'Ajustes', icon: Settings2 },
];

type Theme = 'dark' | 'light';
function initialTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === 'light' ? 'light' : 'dark';
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hm = now.toLocaleTimeString('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const s = now.toLocaleTimeString('es-CO', { timeZone: TZ, second: '2-digit' }).padStart(2, '0');
  const date = now.toLocaleDateString('es-CO', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short' });
  return (
    <div className="hidden items-baseline gap-2 md:flex" title="Hora oficial de Colombia (UTC−5)">
      <span className="display text-[28px] font-semibold">
        {hm}
        <span className="text-ink-3">:{s}</span>
      </span>
      <span className="label hidden xl:inline">{date} · COT</span>
    </div>
  );
}

/** Se avisa solo si el corte dura unos segundos: una reconexión breve no debe interrumpir. */
const DISCONNECTED_NOTICE_DELAY_MS = 6000;

function ConnectionNotice({ connected }: { connected: boolean }) {
  const [show, setShow] = useState(false);
  // Si el propio navegador sabe que no hay red, se avisa al instante (el WebSocket puede tardar en notarlo).
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  useEffect(() => {
    if (connected) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), DISCONNECTED_NOTICE_DELAY_MS);
    return () => clearTimeout(t);
  }, [connected]);
  if (!show && !offline) return null;
  return (
    <div role="status" className="border-b border-warn/40 bg-warn-soft">
      <p className="mx-auto max-w-[1680px] px-4 py-2 text-sm font-medium text-warn sm:px-6">
        Sin conexión con el servidor. Lo que ves puede estar desactualizado; la página reintenta sola.
      </p>
    </div>
  );
}

/** Marca: silueta de la meseta de Bucaramanga sobre una retícula de sensores. */
function Wordmark() {
  return (
    <NavLink to="/" className="flex items-center gap-3" aria-label="Smart City Bucaramanga — inicio">
      <svg viewBox="0 0 40 40" className="size-9 shrink-0" aria-hidden>
        <rect x="0.75" y="0.75" width="38.5" height="38.5" rx="6" fill="var(--surface-2)" stroke="var(--line-strong)" strokeWidth="1.5" />
        <path d="M6 28 L13 21 L17 24 L24 14 L29 19 L34 16" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M6 32 H34" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="24" cy="14" r="2.4" fill="var(--ink)" />
      </svg>
      <span className="leading-none">
        <span className="display block text-[22px] font-bold tracking-[0.04em] uppercase">Bucaramanga</span>
        <span className="label mt-1 hidden text-[11px] sm:block">Smart City · Centro de operaciones</span>
      </span>
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { ws, alerts, list, loaded } = useLive();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const assistant = useAssistant();
  const welcome = useWelcome();
  useDev11Heartbeat();
  const online = list.filter((d) => isOnline(d)).length;
  const openAlerts = alerts.filter((a) => a.status === 'abierta').length;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('scbga.theme', theme);
    } catch {
      /* sin almacenamiento */
    }
  }, [theme]);

  const wsLabel = ws === 'open' ? 'En vivo' : ws === 'connecting' ? 'Conectando' : 'Sin conexión';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-[1000] border-b border-line bg-bg/92 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1680px] items-center gap-5 px-4 sm:px-6">
          <Wordmark />

          <nav className="ml-4 hidden h-full items-stretch lg:flex" aria-label="Principal">
            {NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cx(
                    'relative flex items-center gap-2 px-3.5 text-[14px] font-semibold transition-colors',
                    isActive ? 'text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:bg-accent' : 'text-ink-3 hover:text-ink',
                  )
                }
              >
                {label}
                {to === '/alertas' && openAlerts > 0 && <span className="display rounded-[3px] bg-crit px-1.5 text-[13px] font-bold text-bg">{openAlerts}</span>}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <div className="hidden items-center gap-4 sm:flex">
              <span className="flex items-center gap-2" title="Enlace en tiempo real (WebSocket)">
                <span className={cx('size-2 rounded-full', ws === 'open' ? 'live-dot bg-accent text-accent' : ws === 'connecting' ? 'bg-warn' : 'bg-crit')} />
                <span className="label text-ink-2">{wsLabel}</span>
              </span>
              <span className="label text-ink-2" title="Dispositivos en línea">
                <span className={cx('display text-[18px] font-bold', online === list.length && list.length ? 'text-accent' : 'text-warn')}>{loaded ? online : '…'}</span>/{list.length || DEVICE_IDS.length} nodos
              </span>
            </div>
            <Clock />
            <div className="flex items-center gap-1.5">
              <button
                onClick={welcome.show}
                className="grid size-11 place-items-center rounded-[5px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink sm:size-9"
                aria-label="¿Cómo se usa? Guía del sitio"
                title="¿Cómo se usa?"
              >
                <CircleHelp className="size-[18px]" />
              </button>
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="grid size-11 place-items-center rounded-[5px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink sm:size-9"
                aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
              >
                {theme === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
              </button>
              <LoginPopover />
            </div>
          </div>
        </div>
      </header>
      <ConnectionNotice connected={ws === 'open'} />

      {/* Con el asistente abierto en pantallas anchas, el contenido se corre para dejarlo al lado. */}
      <div className={cx('flex flex-1 flex-col transition-[padding] duration-200', assistant.open && 'xl:pr-[440px]')}>
        {/* Altura mínima: mientras carga una vista, el pie no sube y luego salta (CLS). */}
        <main className="mx-auto min-h-[calc(100dvh-4rem)] w-full max-w-[1680px] min-w-0 flex-1 px-4 pt-6 pb-6 sm:px-6">{children}</main>
        <footer className="mx-auto w-full max-w-[1680px] px-4 pb-28 text-[12px] text-ink-3 sm:px-6 lg:pb-8">
          Proyecto académico de la UNAB · no es un servicio oficial de la Alcaldía de Bucaramanga ·{' '}
          <NavLink to="/acerca" className="underline hover:text-ink">
            Acerca, privacidad y términos
          </NavLink>
        </footer>
      </div>
      <AssistantDrawer />
      {welcome.open && <Welcome onClose={welcome.close} />}

      {/* Navegación inferior (móvil y tableta) */}
      <nav className="fixed inset-x-0 bottom-0 z-[1000] grid grid-cols-7 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Principal">
        {NAV.map(({ to, short, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', isActive ? 'text-ink' : 'text-ink-3')}>
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute inset-x-4 top-0 h-[2px] bg-accent" />}
                <Icon className="size-5" aria-hidden strokeWidth={1.75} />
                <span>{short}</span>
                {to === '/alertas' && openAlerts > 0 && <span className="absolute top-2.5 right-[calc(50%-16px)] size-2 rounded-full bg-crit" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
