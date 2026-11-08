import { useMemo, useRef } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDateShort, fmtNum } from '../lib/format';
import type { AiChartSpec } from '../lib/types';
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

export function AiChart({ spec }: { spec: AiChartSpec }) {
  const ref = useRef<HTMLDivElement>(null);

  // Une las series por marca de tiempo para LineChart.
  const rows = useMemo(() => {
    if (spec.type !== 'line') return [];
    const byT = new Map<number, Record<string, number>>();
    for (const s of spec.series)
      for (const p of s.points) {
        const t = Date.parse(p.t);
        const row = byT.get(t) ?? { t };
        row[s.key] = p.v;
        byT.set(t, row);
      }
    return [...byT.values()].sort((a, b) => a.t! - b.t!);
  }, [spec]);

  const unitOf = (k: string) => (spec.type === 'line' ? (spec.series.find((s) => s.key === k)?.unit ?? '') : (spec.unit ?? ''));

  return (
    <figure className="mt-3 border-t border-line pt-3">
      <figcaption className="mb-2 flex items-center justify-between gap-3">
        <span className="label truncate">{spec.title}</span>
        <Button size="sm" variant="ghost" onClick={() => exportPng(ref.current, spec.title)} aria-label="Descargar gráfica en PNG">
          <Download className="size-4" /> PNG
        </Button>
      </figcaption>
      <div ref={ref} className="h-[260px]">
        {spec.type === 'line' ? (
          rows.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v) => fmtDateShort(v)} stroke="var(--ink-3)" fontSize={12} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={70} />
                <YAxis stroke="var(--ink-3)" fontSize={12} tickLine={false} axisLine={false} width={56} domain={['auto', 'auto']} tickFormatter={(v) => fmtNum(v, 1)} />
                <Tooltip
                  cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
                  content={<ChartTooltip format={(v, k) => `${fmtNum(v, 2)} ${unitOf(k)}`} labels={Object.fromEntries(spec.series.map((s) => [s.key, s.label]))} />}
                />
                {spec.series.length > 1 && (
                  <Legend formatter={(k) => <span style={{ color: 'var(--ink-2)' }}>{spec.series.find((s) => s.key === k)?.label ?? k}</span>} iconType="plainline" wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                )}
                {spec.refs?.map((r) => (
                  <ReferenceLine key={r.label} y={r.value} stroke={REF_COLORS[r.label] ?? 'var(--ink-3)'} strokeDasharray="4 4" label={{ value: `${r.label} ${fmtNum(r.value, 1)}`, position: 'insideTopRight', fill: 'var(--ink-2)', fontSize: 12 }} />
                ))}
                {spec.series.map((s, i) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} stroke={COLORS[i]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-10 text-sm text-ink-3">Sin datos suficientes para graficar en esta ventana.</p>
          )
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={spec.bars} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="label" stroke="var(--ink-3)" fontSize={12} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" />
              <YAxis stroke="var(--ink-3)" fontSize={12} tickLine={false} axisLine={false} width={48} allowDecimals={spec.bars.some((b) => !Number.isInteger(b.value))} />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip format={(v) => `${fmtNum(v, 2)} ${spec.unit ?? ''}`} labels={{ value: spec.title }} labelFormat={(l) => String(l)} />} />
              <Bar dataKey="value" fill="var(--series-1)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </figure>
  );
}
