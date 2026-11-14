import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Health, Horizon, SitesResponse, TimelineResponse, ValidationResponse } from '../api/types';

export interface Remote<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

interface Snapshot<T> {
  key: string | null;
  nonce: number;
  data: T | null;
  error: ApiError | null;
}

/**
 * Generic fetch with abort on unmount / key change. State is tagged with the key
 * it belongs to, so a stale response is never shown for a different analysis.
 */
export function useRemote<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>, refreshMs?: number): Remote<T> {
  const [snap, setSnap] = useState<Snapshot<T>>({ key: null, nonce: -1, data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (key === null) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const run = async () => {
      try {
        const value = await fetcher(controller.signal);
        if (!cancelled) setSnap({ key, nonce, data: value, error: null });
      } catch (e) {
        if (cancelled) return;
        const error = e instanceof ApiError ? e : new ApiError(0, 'CLIENT_ERROR', String(e));
        // While offline keep the last good payload visible (it is labelled stale by the error).
        setSnap((prev) => ({ key, nonce, error,
          data: error.code === 'BACKEND_OFFLINE' && prev.key === key ? prev.data : null }));
      } finally {
        if (!cancelled && refreshMs) timer = setTimeout(() => void run(), refreshMs);
      }
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // fetcher identity is intentionally excluded; `key` captures the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, refreshMs]);

  const current = key !== null && snap.key === key;
  return {
    data: current ? snap.data : null,
    error: current ? snap.error : null,
    loading: key !== null && (!current || snap.nonce !== nonce),
    reload,
  };
}

export const useHealth = () => useRemote<Health>('health', (s) => api.health(s), 15000);
export const useSites = (refreshKey: string) => useRemote<SitesResponse>(`sites:${refreshKey}`, (s) => api.sites(s));
export const useValidation = () => useRemote<ValidationResponse>('validation', (s) => api.validation(s), 60000);

/** Horizon/timeline are fetched from their dedicated endpoints once the job is terminal. */
export const useHorizon = (id: string | null) =>
  useRemote<Horizon>(id ? `horizon:${id}` : null, (s) => api.horizon(id as string, s));
export const useTimeline = (id: string | null) =>
  useRemote<TimelineResponse>(id ? `timeline:${id}` : null, (s) => api.timeline(id as string, s));
