import type { SourceType } from '@scbga/shared';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

/** Panel de consola: superficie con línea fina, sin sombra. */
export function Card({ className, children, as: As = 'section', style }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article'; style?: React.CSSProperties }) {
  return (
    <As className={cx('panel', className)} style={style}>
      {children}
    </As>
  );
}

export function CardHeader({ title, eyebrow, action, className }: { title?: ReactNode; eyebrow?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <header className={cx('flex items-end justify-between gap-3 border-b border-line px-5 pt-4 pb-3', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="label">{eyebrow}</p>}
        {title && <h2 className="mt-1 truncate text-[17px] font-semibold leading-tight">{title}</h2>}
      </div>
      {action}
    </header>
  );
}

type Tone = 'neutral' | 'ok' | 'warn' | 'crit' | 'info' | 'synth';
const TONES: Record<Tone, string> = {
  neutral: 'border-line text-ink-2',
  ok: 'border-transparent bg-accent-soft text-accent',
  warn: 'border-transparent bg-warn-soft text-warn',
  crit: 'border-transparent bg-crit-soft text-crit',
  info: 'border-transparent bg-info-soft text-info',
  synth: 'hatch border-line text-ink-2',
};

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex h-6 items-center gap-1 rounded-[4px] border px-2 text-xs font-medium whitespace-nowrap', TONES[tone], className)}>
      {children}
    </span>
  );
}

const SOURCE_LABEL: Record<SourceType, string> = { simulated: 'Simulado', digital_twin: 'Gemelo digital', api: 'API', dataset: 'Dataset', real: 'Real (ESP32)' };

/** Etiqueta de procedencia: REAL (sólida) o SIM (rayada). Nunca depende solo del color. */
export function ProvenanceTag({ synthetic, compact }: { synthetic: boolean; compact?: boolean }) {
  return synthetic ? (
    <span title="Dato sintético: simulación o gemelo digital, no es una medición real" className={cx('hatch inline-flex items-center rounded-[3px] border border-line-strong font-display font-semibold tracking-[0.14em] text-ink-2', compact ? 'h-[18px] px-1.5 text-[11px]' : 'h-6 px-2 text-xs')}>
      SIM
    </span>
  ) : (
    <span title="Dato de fuente externa real" className={cx('inline-flex items-center rounded-[3px] bg-ink font-display font-semibold tracking-[0.14em] text-bg', compact ? 'h-[18px] px-1.5 text-[11px]' : 'h-6 px-2 text-xs')}>
      REAL
    </span>
  );
}

export function SourceBadge({ source, synthetic }: { source: SourceType; synthetic: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <ProvenanceTag synthetic={synthetic} />
      <span className="text-xs text-ink-2">{SOURCE_LABEL[source]}</span>
    </span>
  );
}

export type DevState = 'online' | 'degraded' | 'offline' | 'stopped' | 'unknown';

export function StatusDot({ state, className }: { state: DevState; className?: string }) {
  const color = { online: 'text-accent bg-accent', degraded: 'text-warn bg-warn', offline: 'text-crit bg-crit', stopped: 'bg-transparent border border-ink-3', unknown: 'bg-ink-3' }[state];
  return <span aria-hidden className={cx('inline-block size-2 shrink-0 rounded-full', color, state === 'online' && 'live-dot', className)} />;
}

export const STATE_LABEL = { online: 'En línea', degraded: 'Degradado', offline: 'Desconectado', stopped: 'Apagado', unknown: 'Sin datos' } as const;

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; loading?: boolean }) {
  const v = {
    primary: 'bg-accent text-accent-ink border-transparent hover:brightness-105',
    secondary: 'bg-transparent text-ink border-line-strong hover:bg-surface-2',
    ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-surface-2 hover:text-ink',
    danger: 'bg-transparent text-crit border-crit/50 hover:bg-crit-soft',
  }[variant];
  const s = size === 'sm' ? 'h-8 px-3 text-[13px] gap-1.5' : 'h-10 px-4 text-sm gap-2';
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-[5px] border font-semibold transition-[background-color,border-color,filter] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45',
        v,
        s,
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, disabled, ariaLabel }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap rounded-[6px] border border-line bg-bg p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-8 rounded-[4px] px-3 text-[13px] font-semibold transition-colors duration-150 disabled:opacity-45',
            value === o.value ? 'bg-surface-3 text-ink' : 'text-ink-3 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-45', checked ? 'border-transparent bg-accent' : 'border-line-strong bg-surface-2')}
    >
      <span className={cx('absolute top-[3px] size-4 rounded-full transition-transform duration-200 ease-[var(--ease-out-quart)]', checked ? 'translate-x-[22px] bg-accent-ink' : 'translate-x-[3px] bg-ink-3')} />
    </button>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-5 py-8">
      {icon && <div className="text-ink-3">{icon}</div>}
      <p className="text-[15px] font-semibold text-ink-2">{title}</p>
      {children && <div className="max-w-[52ch] text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'h-10 w-full rounded-[5px] border border-line-strong bg-bg px-3 text-sm text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none disabled:opacity-45';

/** Encabezado de página: código de sección + título en display. */
export function PageHeader({ title, subtitle, action, code }: { title: string; subtitle?: ReactNode; action?: ReactNode; code?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        {code && <p className="label">{code}</p>}
        <h1 className="display mt-1 text-[44px] font-bold uppercase sm:text-[52px]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-[70ch] text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
