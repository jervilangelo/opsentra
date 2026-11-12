import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { useDemoSession } from '@/modes/demo/demo-store';
import { useModeStore } from '@/modes/mode-store';
import { usePreferences } from '@/stores/preferences';

// jsdom lacks matchMedia; default to "dark, motion allowed".
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('dark'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  useModeStore.setState({ mode: 'demo' });
  useDemoSession.getState().reset();
  useDemoSession.setState({ role: 'ADMIN', speed: 10, paused: false });
  // Existing tests exercise the Advanced view; Easy tests opt in.
  usePreferences.setState({ theme: 'dark', sidebarCollapsed: false, view: 'advanced' });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
