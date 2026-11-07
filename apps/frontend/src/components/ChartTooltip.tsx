import { fmtDateShort } from '../lib/format';

interface Item {
  dataKey?: string | number;
  value?: number;
  color?: string;
}

/** Tooltip de gráficos con los tokens de la consola. El texto usa tinta, nunca el color de la serie. */
export function ChartTooltip({
  active,
  payload,
  label,
  format,
  labels,
  labelFormat = (l) => fmtDateShort(l as number),
}: {
  active?: boolean;
  payload?: Item[];
  label?: unknown;
  format: (v: number, key: string) => string;
  labels: Record<string, string>;
  labelFormat?: (l: unknown) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="panel min-w-44 px-3 py-2.5 text-[13px] shadow-[0_16px_36px_-18px_oklch(0_0_0/0.7)]">
      <p className="code mb-1.5 text-ink-3">{labelFormat(label)}</p>
      <ul className="space-y-1">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-ink-2">
              <span className="h-0.5 w-3 rounded-full" style={{ background: p.color }} aria-hidden />
              {labels[String(p.dataKey)] ?? String(p.dataKey)}
            </span>
            <span className="num font-semibold text-ink">{typeof p.value === 'number' ? format(p.value, String(p.dataKey)) : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
