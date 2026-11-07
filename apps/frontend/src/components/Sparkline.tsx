/**
 * Traza de tendencia compacta y SIGNIFICATIVA: muestra el rango (mín–máx) de la ventana para que
 * la forma tenga escala de lectura; no es decoración.
 */
export function Sparkline({ data, color = 'var(--ink-2)', height = 32, className }: { data: number[]; color?: string; height?: number; className?: string }) {
  if (data.length < 2) return <div style={{ height }} className={className} aria-hidden />;
  const w = 160;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 3;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, height - pad - ((v - min) / span) * (height - pad * 2)] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={className} style={{ height, width: '100%', overflow: 'visible' }} aria-hidden>
      <line x1="0" x2={w} y1={height - 0.5} y2={height - 0.5} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill="var(--accent)" />
    </svg>
  );
}
