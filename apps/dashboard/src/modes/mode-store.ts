import { create } from 'zustand';

import { env } from '@/config/env';
import type { Mode } from '@/types/domain';

interface ModeState {
  mode: Mode;
  setMode: (mode: Mode) => void;
}

/**
 * Current data mode. Deliberately not persisted: every fresh load starts in the
 * configured default (Demo), so a stale Live choice never survives a reload.
 */
export const useModeStore = create<ModeState>()((set) => ({
  mode: env.defaultMode,
  setMode: (mode) => set({ mode }),
}));

export const useMode = (): Mode => useModeStore((s) => s.mode);
