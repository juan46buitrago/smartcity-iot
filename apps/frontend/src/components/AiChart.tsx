import { useMemo, useRef } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDateShort, fmtNum } from '../lib/format';
import type { AiChartSeries, AiChartSpec } from '../lib/types';
import { ChartTooltip } from './ChartTooltip';
import { Button } from './ui';
import { Download } from 'lucide-react';

const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
const REF_COLORS: Record<string, string> = { promedio: 'var(--ink-2)', 'mín': 'var(--info)', 'máx': 'var(--warn)' };

/**
 * Exporta el SVG de Recharts a PNG: sustituye las variables CSS por sus valores
 * calculados (el SVG suelto no conoce el tema) y lo dibuja en un canvas a 2×.
 */
function exportPng(container: HTMLElement | null, name: string) {
  const svg = container?.querySelector('svg.recharts-surface');
  if (!svg) return;
  const css = getComputedStyle(document.documentElement);
  const bg = css.getPropertyValue('--surface').trim() || '#111';
  let src = new XMLSerializer().serializeToString(svg).replace(/var\((--[\w-]+)\)/g, (_, v: string) => css.getPropertyValue(v).trim() || '#888');
  if (!src.includes('xmlns="http://www.w3.org/2000/svg"')) src = src.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const { width, height } = svg.getBoundingClientRect();
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, width, height);
    const a = document.createElement('a');
    a.download = `${name.replace(/[^\w-]+/g, '_').slice(0, 60)}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
}

/** Una gráfica de líneas con un solo eje: todas sus series comparten unidad. */
function LinePanel({ series, refs, colorOf, height, title }: { series: AiChartSeries[]; refs?: { label: string; value: number }[]; colorOf: (k: string) => string; height: number; title?: string }) {
  const rows = useMemo(() => {
    const byT = new Map<number, Record<string, number>>();
    for (const s of series)
      for (const p of s.points) {
        const t = Date.parse(p.t);
        const row = byT.get(t) ?? { t };
        row[s.key] = p.v;
        byT.set(t, row);
      }
    return [...byT.values()].sort((a, b) => a.t! - b.t!);
  }, [series]);
  const unitOf = (k: string) => series.find((s) => s.key === k)?.unit ?? '';
  if (rows.length < 2) return <p className="py-6 text-sm text-ink-3">Sin datos suficientes para graficar en esta ventana.</p>;
  return (
    <div>
      {title && <p className="mb-1 text-[12px] font-semibold text-ink-2">{title}</p>}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v) => fmtDateShort(v)} stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={60} />
            <YAxis stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={false} width={48} domain={['auto', 'auto']} tickFormatter={(v) => fmtNum(v, 1)} />
            <Tooltip
              cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
              content={<ChartTooltip format={(v, k) => `${fmtNum(v, 2)} ${unitOf(k)}`} labels={Object.fromEntries(series.map((s) => [s.key, s.label]))} />}
            />
            {series.length > 1 && (
              <Legend formatter={(k) => <span style={{ color: 'var(--ink-2)' }}>{series.find((s) => s.key === k)?.label ?? k}</span>} iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
            )}
            {refs?.map((r) => (
              <ReferenceLine key={r.label} y={r.value} stroke={REF_COLORS[r.label] ?? 'var(--ink-3)'} strokeDasharray="4 4" label={{ value: `${r.label} ${fmtNum(r.value, 1)}`, position: 'insideTopRight', fill: 'var(--ink-2)', fontSize: 11 }} />
            ))}
            {series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} stroke={colorOf(s.key)} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function AiChart({ spec, compact }: { spec: AiChartSpec; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  // Nunca doble eje: si las series tienen unidades distintas se dibujan como pequeños múltiplos.
  const groups = useMemo(() => {
    if (spec.type !== 'line') return [];
    const byUnit = new Map<string, AiChartSeries[]>();
    for (const s of spec.series) byUnit.set(s.unit ?? '', [...(byUnit.get(s.unit ?? '') ?? []), s]);
    return [...byUnit.values()];
  }, [spec]);
  // El color sigue a la serie (orden fijo), no a su posición dentro de cada panel.
  const colorOf = (k: string) => (spec.type === 'line' ? COLORS[Math.max(0, spec.series.findIndex((s) => s.key === k)) % COLORS.length]! : COLORS[0]!);
  const h = compact ? 190 : 260;

  return (
    <figure className="mt-3 border-t border-line pt-3">
      <figcaption className="mb-2 flex items-center justify-between gap-3">
        <span className="label truncate">{spec.title}</span>
        <Button size="sm" variant="ghost" onClick={() => exportPng(ref.current, spec.title)} aria-label="Descargar gráfica en PNG">
          <Download className="size-4" /> PNG
        </Button>
      </figcaption>
      <div ref={ref} className="space-y-4">
        {spec.type === 'line' ? (
          groups.map((g) => (
            <LinePanel
              key={g.map((s) => s.key).join()}
              series={g}
              refs={groups.length === 1 ? spec.refs : undefined}
              colorOf={colorOf}
              height={groups.length > 1 ? Math.round(h * 0.7) : h}
              title={groups.length > 1 ? g.map((s) => s.label).join(' · ') + (g[0]!.unit ? ` (${g[0]!.unit})` : '') : undefined}
            />
          ))
        ) : (
          <div style={{ height: h }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spec.bars} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" />
                <YAxis stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={false} width={40} allowDecimals={spec.bars.some((b) => !Number.isInteger(b.value))} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip format={(v) => `${fmtNum(v, 2)} ${spec.unit ?? ''}`} labels={{ value: spec.title }} labelFormat={(l) => String(l)} />} />
                <Bar dataKey="value" fill="var(--series-1)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </figure>
  );
}
