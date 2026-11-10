import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { Button, Field, inputCls } from './ui';

/**
 * Panel de contraseña (no modal). Aparece solo cuando se intenta controlar algo sin sesión;
 * se cierra con Escape o clic fuera. La sesión se recuerda 12 horas en este navegador.
 */
export function LoginPopover() {
  const { loginOpen, setLoginOpen, login } = useAuth();
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loginOpen) return;
    const t = setTimeout(() => field.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLoginOpen(false);
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(target) && !target.closest('[data-login-trigger]')) setLoginOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [loginOpen, setLoginOpen]);

  if (!loginOpen) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(pass);
      setPass('');
      setLoginOpen(false);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} role="dialog" aria-label="Desbloquear controles" className="panel rise fixed top-[76px] right-4 z-[1200] w-[min(calc(100vw-32px),340px)] p-5 shadow-[0_24px_60px_-24px_oklch(0_0_0/0.8)] sm:right-6">
      <p className="label">Controles protegidos</p>
      <p className="mt-1 text-[17px] font-semibold">Desbloquear controles</p>
      <p className="mt-1 text-[13px] text-ink-3">Este navegador recordará la sesión durante 12 horas o hasta que la cierres.</p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        {/* Ayuda a los gestores de contraseñas a asociar la clave a este sitio. */}
        <input type="text" autoComplete="username" value="smartcitybga" readOnly hidden />
        <Field label="Contraseña">
          <input ref={field} className={inputCls} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" required />
        </Field>
        {err && <p className="rounded-[5px] bg-crit-soft px-3 py-2 text-[13px] text-crit">{err}</p>}
        <Button variant="primary" className="w-full" loading={busy} type="submit">
          Desbloquear
        </Button>
      </form>
    </div>
  );
}
