// Keadaan global: pengguna semasa, data rujukan (zon/team/pencawang) dan nombor semakan data.
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Meta, SessionUser } from '../shared/types';
import { api, onAuthProblem } from './api';

interface AppState {
  /** undefined = masih menyemak sesi; null = belum log masuk */
  user: SessionUser | null | undefined;
  setUser: (u: SessionUser | null) => void;
  meta: Meta;
  reloadMeta: () => Promise<void>;
  /** Berubah setiap kali data di pelayan berubah (atau selepas tindakan sendiri). Guna sebagai kebergantungan useEffect. */
  dataKey: string;
  /** Panggil selepas mengubah data supaya semua paparan muat semula serta-merta. */
  touch: () => void;
  logout: () => Promise<void>;
}

const EMPTY: Meta = { zones: [], teams: [], substations: [] };
const Ctx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(Ctx);

const POLL_MS = 20_000;

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [meta, setMeta] = useState<Meta>(EMPTY);
  const [rev, setRev] = useState(0);
  const [tick, setTick] = useState(0);
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    onAuthProblem((code) => {
      if (code === 'unauthenticated') setUser(null);
      else setUser((u) => (u ? { ...u, must_change_password: true } : u));
    });
    api
      .get<{ user: SessionUser }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  const ready = !!user && !user.must_change_password;
  const reloadMeta = useCallback(async () => {
    setMeta(await api.get<Meta>('/meta'));
  }, []);

  useEffect(() => {
    if (!ready) {
      setMeta(EMPTY);
      return;
    }
    reloadMeta().catch(() => {});
    let stop = false;
    const poll = () => {
      if (stop || document.visibilityState !== 'visible') return;
      api
        .get<{ rev: number }>('/rev')
        .then((r) => !stop && setRev(r.rev))
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [ready, user?.id, reloadMeta]);

  const touch = useCallback(() => setTick((t) => t + 1), []);
  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo<AppState>(
    () => ({ user, setUser, meta, reloadMeta, dataKey: `${rev}:${tick}`, touch, logout }),
    [user, meta, reloadMeta, rev, tick, touch, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Muat data dari API; muat semula bila `deps` atau data pelayan berubah. Data lama kekal dipapar semasa muat semula. */
export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const { dataKey } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    let dead = false;
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => {
        if (dead) return;
        setData(d);
        setError(null);
      })
      .catch((e) => !dead && setError(e instanceof Error ? e.message : 'Ralat'))
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, dataKey, ...deps]);
  return { data, error, loading };
}
