import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'ok' | 'error' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  detail?: string;
}

const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq;
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === 'error' ? 8000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-36 z-[2000] flex flex-col items-center gap-2 px-4 lg:bottom-24 lg:items-end lg:pr-6" role="status" aria-live="polite">
        {items.map((t) => {
          const Icon = t.tone === 'ok' ? CheckCircle2 : t.tone === 'error' ? CircleAlert : Info;
          const color = t.tone === 'ok' ? 'text-accent' : t.tone === 'error' ? 'text-crit' : 'text-info';
          return (
            <div key={t.id} className="panel rise pointer-events-auto flex w-full max-w-sm items-start gap-3 px-4 py-3 shadow-[0_20px_44px_-20px_oklch(0_0_0/0.75)]">
              <Icon className={`mt-0.5 size-5 shrink-0 ${color}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.detail && <p className="mt-0.5 text-xs break-words text-ink-2">{t.detail}</p>}
              </div>
              <button className="text-ink-3 hover:text-ink" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} aria-label="Cerrar">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
