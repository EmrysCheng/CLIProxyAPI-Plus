import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, AuthState } from '../api/client';

export type AuthPhase = 'loading' | 'unavailable' | 'setup' | 'login' | 'ready';

interface AuthContextValue {
  phase: AuthPhase;
  state: AuthState | null;
  refresh: () => Promise<void>;
  setPhase: (p: AuthPhase) => void;
}

const AuthContext = createContext<AuthContextValue>({
  phase: 'loading',
  state: null,
  refresh: async () => {},
  setPhase: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>('loading');
  const [state, setState] = useState<AuthState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await authApi.state();
      setState(s);
      if (!s.available) setPhase('unavailable');
      else if (s.authenticated) setPhase('ready');
      else if (s.setup_required) setPhase('setup');
      else setPhase('login');
    } catch {
      // State endpoint unreachable (e.g. remote blocked) — surface unavailable
      // only if the server answered; network errors keep the loading gate.
      try {
        const res = await fetch('/panel/api/auth/state');
        if (res.status === 403 || res.status === 404) {
          setState({ available: false, error: res.status === 403 ? 'remote' : 'disabled' });
          setPhase('unavailable');
          return;
        }
      } catch {
        /* server unreachable */
      }
      setPhase('unavailable');
      setState({ available: false, error: 'network' });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => {
      setPhase((prev) => (prev === 'ready' ? 'login' : prev));
      setState((prev) => (prev ? { ...prev, authenticated: false } : prev));
    };
    window.addEventListener('panel:unauthorized', onUnauthorized);
    return () => window.removeEventListener('panel:unauthorized', onUnauthorized);
  }, [refresh]);

  const value = useMemo(() => ({ phase, state, refresh, setPhase }), [phase, state, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
