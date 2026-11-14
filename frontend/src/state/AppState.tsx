import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { AnalysisInput, JobRecord, JobStatus } from '../api/types';

export type Mode = 'public' | 'engineer';

export interface AnalysisEntry {
  id: string;
  input: AnalysisInput;
  kind: 'analysis' | 'shift';
  parentId: string | null;
  createdAtMs: number;
  job: JobRecord | null;
  /** Client-side polling state; never a scientific result. */
  lost: boolean;
  pollErrorCode: string | null;
}

interface State {
  mode: Mode;
  entries: Record<string, AnalysisEntry>;
  order: string[];
  selectedId: string | null;
}

type Action =
  | { type: 'mode'; mode: Mode }
  | { type: 'add'; entry: AnalysisEntry; select: boolean }
  | { type: 'job'; id: string; job: JobRecord }
  | { type: 'lost'; id: string }
  | { type: 'pollError'; id: string; code: string | null }
  | { type: 'select'; id: string | null }
  | { type: 'remove'; id: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'mode':
      return { ...state, mode: action.mode };
    case 'add':
      return {
        ...state,
        entries: { ...state.entries, [action.entry.id]: action.entry },
        order: [action.entry.id, ...state.order],
        selectedId: action.select ? action.entry.id : state.selectedId,
      };
    case 'job': {
      const prev = state.entries[action.id];
      if (!prev) return state;
      return { ...state, entries: { ...state.entries, [action.id]: { ...prev, job: action.job, pollErrorCode: null } } };
    }
    case 'lost': {
      const prev = state.entries[action.id];
      if (!prev) return state;
      return { ...state, entries: { ...state.entries, [action.id]: { ...prev, lost: true } } };
    }
    case 'pollError': {
      const prev = state.entries[action.id];
      if (!prev || prev.pollErrorCode === action.code) return state;
      return { ...state, entries: { ...state.entries, [action.id]: { ...prev, pollErrorCode: action.code } } };
    }
    case 'select':
      return { ...state, selectedId: action.id };
    case 'remove': {
      const entries = { ...state.entries };
      delete entries[action.id];
      return {
        ...state,
        entries,
        order: state.order.filter((x) => x !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };
    }
    default:
      return state;
  }
}

export const TERMINAL: JobStatus[] = ['completed', 'partial', 'failed'];

export function isActive(entry: AnalysisEntry): boolean {
  return !entry.lost && (entry.job === null || !TERMINAL.includes(entry.job.status));
}

interface Ctx extends State {
  setMode: (mode: Mode) => void;
  register: (id: string, input: AnalysisInput, kind?: AnalysisEntry['kind'], parentId?: string | null) => void;
  select: (id: string | null) => void;
  remove: (id: string) => void;
  selected: AnalysisEntry | null;
  list: AnalysisEntry[];
}

const AppContext = createContext<Ctx | null>(null);

export const POLL_INTERVAL_MS = 2000;
const MAX_BACKOFF_MS = 10000;

/**
 * Polls GET /analyses/{id} for every non-terminal job. Stops on terminal status,
 * marks 404 as lost (server restarted), backs off while offline, and cancels all
 * timers and in-flight requests on unmount.
 */
function useJobPolling(state: State, dispatch: (a: Action) => void) {
  const activeKey = state.order.filter((id) => {
    const e = state.entries[id];
    return e ? isActive(e) : false;
  }).join(',');

  useEffect(() => {
    if (!activeKey) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    let delay = POLL_INTERVAL_MS;

    const tick = async () => {
      const ids = activeKey.split(',');
      let offline = false;
      await Promise.all(
        ids.map(async (id) => {
          try {
            const job = await api.analysis(id, controller.signal);
            if (!cancelled) dispatch({ type: 'job', id, job });
          } catch (error) {
            if (cancelled) return;
            if (error instanceof ApiError && error.code === 'ANALYSIS_NOT_FOUND') dispatch({ type: 'lost', id });
            else if (error instanceof ApiError) {
              if (error.code === 'BACKEND_OFFLINE') offline = true;
              dispatch({ type: 'pollError', id, code: error.code });
            }
          }
        }),
      );
      if (cancelled) return;
      delay = offline ? Math.min(MAX_BACKOFF_MS, delay * 2) : POLL_INTERVAL_MS;
      timer = setTimeout(() => void tick(), delay);
    };
    timer = setTimeout(() => void tick(), 0);
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [activeKey, dispatch]);
}

export function AppStateProvider({ children, initialMode = 'public' }: { children: ReactNode; initialMode?: Mode }) {
  const [state, dispatch] = useReducer(reducer, { mode: initialMode, entries: {}, order: [], selectedId: null });
  useJobPolling(state, dispatch);

  const setMode = useCallback((mode: Mode) => dispatch({ type: 'mode', mode }), []);
  const register = useCallback(
    (id: string, input: AnalysisInput, kind: AnalysisEntry['kind'] = 'analysis', parentId: string | null = null) =>
      dispatch({
        type: 'add',
        // New analyses become the selection; shift children do not, so the parent stays on screen.
        select: kind === 'analysis',
        entry: { id, input, kind, parentId, createdAtMs: Date.now(), job: null, lost: false, pollErrorCode: null },
      }),
    [],
  );
  const select = useCallback((id: string | null) => dispatch({ type: 'select', id }), []);
  const remove = useCallback((id: string) => dispatch({ type: 'remove', id }), []);

  const value = useMemo<Ctx>(() => {
    const list = state.order.map((id) => state.entries[id]).filter((e): e is AnalysisEntry => Boolean(e));
    return {
      ...state,
      setMode,
      register,
      select,
      remove,
      list,
      selected: state.selectedId ? (state.entries[state.selectedId] ?? null) : null,
    };
  }, [state, setMode, register, select, remove]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider');
  return ctx;
}
