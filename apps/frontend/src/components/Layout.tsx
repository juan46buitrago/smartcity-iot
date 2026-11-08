import { Bell, Bot, Cpu, Gauge, History, Map as MapIcon, Moon, Settings2, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { TZ } from '../lib/format';
import { isOnline, useLive } from '../lib/live';
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
  const { ws, alerts, list } = useLive();
  const [theme, setTheme] = useState<Theme>(initialTheme);
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

  const wsLabel = ws === 'open' ? 'En vivo' : ws === 'connecting' ? 'Conectando' : 'Sin enlace';

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
                <span className={cx('display text-[18px] font-bold', online === list.length && list.length ? 'text-accent' : 'text-warn')}>{online}</span>/{list.length || 10} nodos
              </span>
            </div>
            <Clock />
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="grid size-9 place-items-center rounded-[5px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
              >
                {theme === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
              </button>
              <LoginPopover />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1680px] min-w-0 flex-1 px-4 pt-6 pb-28 sm:px-6 lg:pb-12">{children}</main>

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
