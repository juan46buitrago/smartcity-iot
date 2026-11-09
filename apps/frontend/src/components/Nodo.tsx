import { useEffect, useRef } from 'react';
import { cx } from './ui';

export type NodoMood = 'idle' | 'thinking' | 'talking' | 'alert' | 'happy';

/**
 * Nodo, la mascota del asistente: un nodo de la red con carita y antena.
 * El humor (data-mood) lo anima solo con CSS (ver index.css, «Nodo»): rebota en reposo,
 * parpadea, piensa con la antena, mueve la boca al hablar y se sacude ante una alerta.
 * Las pupilas siguen al cursor; con reduced-motion todo queda quieto.
 */
export function Nodo({ mood = 'idle', size = 56, bounce = true, className }: { mood?: NodoMood; size?: number; bounce?: boolean; className?: string }) {
  const eyes = useRef<SVGGElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const g = eyes.current;
        if (!g) return;
        const r = g.ownerSVGElement!.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 240) * 3.2;
        g.style.transform = `translate(${(dx / d) * k}px, ${(dy / d) * k}px)`;
      });
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      window.removeEventListener('pointermove', move);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <svg viewBox="0 0 120 124" width={size} height={size * (124 / 120)} role="img" aria-label="Nodo, el asistente" className={cx('nodo', bounce && 'nodo-bounce', className)} data-mood={mood}>
      <ellipse className="nodo-shadow" cx="60" cy="118" rx="26" ry="4.5" fill="var(--ink)" opacity="0.16" />
      <g className="nodo-body">
        {/* antena */}
        <g className="nodo-antenna">
          <line x1="60" y1="26" x2="60" y2="11" stroke="var(--ai)" strokeWidth="4" strokeLinecap="round" />
          <circle className="nodo-bulb" cx="60" cy="8" r="5.5" fill="var(--accent)" />
        </g>
        {/* orejas / brazos */}
        <rect className="nodo-arm nodo-arm-l" x="9" y="52" width="14" height="26" rx="7" fill="var(--ai)" opacity="0.78" />
        <rect className="nodo-arm nodo-arm-r" x="97" y="52" width="14" height="26" rx="7" fill="var(--ai)" opacity="0.78" />
        {/* patas */}
        <rect x="38" y="100" width="14" height="12" rx="6" fill="var(--ai)" opacity="0.78" />
        <rect x="68" y="100" width="14" height="12" rx="6" fill="var(--ai)" opacity="0.78" />
        {/* cuerpo */}
        <rect x="18" y="26" width="84" height="78" rx="30" fill="var(--ai)" />
        <path d="M30 40c6-8 16-11 30-11" fill="none" stroke="#fff" strokeOpacity="0.38" strokeWidth="4" strokeLinecap="round" />
        {/* pantalla */}
        <rect x="29" y="42" width="62" height="44" rx="20" fill="var(--bg)" />
        <g ref={eyes} className="nodo-eyes">
          <g className="nodo-eye">
            <ellipse cx="47" cy="61" rx="6.2" ry="7.4" fill="var(--accent)" />
          </g>
          <g className="nodo-eye">
            <ellipse cx="73" cy="61" rx="6.2" ry="7.4" fill="var(--accent)" />
          </g>
        </g>
        <path className="nodo-mouth" d="M52 75q8 7 16 0" fill="none" stroke="var(--accent)" strokeWidth="3.4" strokeLinecap="round" />
        <rect className="nodo-talk" x="53" y="72" width="14" height="8" rx="4" fill="var(--accent)" />
        {/* mejillas */}
        <circle cx="38" cy="73" r="3.4" fill="var(--accent)" opacity="0.22" />
        <circle cx="82" cy="73" r="3.4" fill="var(--accent)" opacity="0.22" />
      </g>
    </svg>
  );
}
