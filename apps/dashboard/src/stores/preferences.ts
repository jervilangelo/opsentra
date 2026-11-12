import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
/** Detail level of the interface (ADR-013). Not the data mode (Demo/Live). */
export type View = 'easy' | 'advanced';

interface PreferencesState {
  theme: ThemePreference;
  sidebarCollapsed: boolean;
  view: View;
  setView: (view: View) => void;
  setTheme: (theme: ThemePreference) => void;
  toggleSidebar: () => void;
}

/** Per-browser UI preferences. Dark is the default theme. */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      view: 'easy',
      setView: (view) => set({ view }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: 'opsentra:preferences',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed, view: s.view }),
    },
  ),
);

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeSystemTheme(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY).matches : true;
}

export function useResolvedTheme(): ResolvedTheme {
  const theme = usePreferences((s) => s.theme);
  const systemDark = useSyncExternalStore(subscribeSystemTheme, systemPrefersDark, () => true);
  if (theme === 'system') return systemDark ? 'dark' : 'light';
  return theme;
}

/** Easy (default) or Advanced view. */
export const useView = (): View => usePreferences((s) => s.view);
