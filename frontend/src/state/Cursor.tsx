import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Shared time cursor so Sky View and Timeline always show the same analysis,
 * shift scenario and timeline sample. Pure UI state (no scientific values).
 */
interface CursorState {
  analysisId: string | null;
  shift: number;
  index: number;
}

interface CursorCtx {
  shiftFor: (analysisId: string, available: number[]) => number;
  indexFor: (analysisId: string, shift: number, length: number) => number;
  setShift: (analysisId: string, shift: number) => void;
  setIndex: (analysisId: string, shift: number, index: number) => void;
}

const Ctx = createContext<CursorCtx | null>(null);

export function CursorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CursorState>({ analysisId: null, shift: 0, index: 0 });

  const shiftFor = useCallback((analysisId: string, available: number[]) => {
    if (state.analysisId === analysisId && available.includes(state.shift)) return state.shift;
    return available.includes(0) ? 0 : (available[0] ?? 0);
  }, [state]);

  const indexFor = useCallback((analysisId: string, shift: number, length: number) => {
    if (length <= 0) return 0;
    if (state.analysisId === analysisId && state.shift === shift) return Math.min(Math.max(0, state.index), length - 1);
    return 0;
  }, [state]);

  const setShift = useCallback((analysisId: string, shift: number) => {
    // Keep the same relative sample when switching scenario (same mission clock).
    setState((s) => ({ analysisId, shift, index: s.analysisId === analysisId ? s.index : 0 }));
  }, []);

  const setIndex = useCallback((analysisId: string, shift: number, index: number) => {
    setState({ analysisId, shift, index });
  }, []);

  const value = useMemo(() => ({ shiftFor, indexFor, setShift, setIndex }), [shiftFor, indexFor, setShift, setIndex]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCursor(): CursorCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCursor must be used inside CursorProvider');
  return ctx;
}
