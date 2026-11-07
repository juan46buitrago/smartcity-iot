import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, configureApi } from './api';

interface AuthState {
  user: string | null;
  token: string | null;
  /** Fin de la sesión (exp del JWT), o null sin sesión. */
  expiresAt: Date | null;
  login: (password: string) => Promise<void>;
  logout: () => void;
  /** Abre el panel de contraseña (se pide solo al intentar controlar algo). */
  requestLogin: () => void;
  loginOpen: boolean;
  setLoginOpen: (v: boolean) => void;
}

const AuthCtx = createContext<AuthState | null>(null);
const KEY = 'scbga.session';

interface Session {
  user: string;
  token: string;
}

function expOf(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** La sesión se recuerda en este navegador hasta que vence el token (30 días). */
function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    const exp = expOf(s.token);
    if (exp !== null && exp < Date.now()) {
      localStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(readSession);
  const [loginOpen, setLoginOpen] = useState(false);

  const logout = useCallback(() => {
    setSession(null);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* almacenamiento no disponible */
    }
  }, []);

  useEffect(() => {
    configureApi(
      () => session?.token ?? null,
      () => {
        logout();
        setLoginOpen(true);
      },
    );
  }, [session, logout]);

  const login = useCallback(async (password: string) => {
    const r = await api<{ token: string; user: string }>('/api/auth/login', { body: { password } });
    const s = { user: r.user, token: r.token };
    setSession(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* almacenamiento no disponible: la sesión vive en memoria */
    }
  }, []);

  const value = useMemo<AuthState>(() => {
    const exp = session ? expOf(session.token) : null;
    return {
      user: session?.user ?? null,
      token: session?.token ?? null,
      expiresAt: exp ? new Date(exp) : null,
      login,
      logout,
      requestLogin: () => setLoginOpen(true),
      loginOpen,
      setLoginOpen,
    };
  }, [session, login, logout, loginOpen]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('useAuth fuera de AuthProvider');
  return c;
}
