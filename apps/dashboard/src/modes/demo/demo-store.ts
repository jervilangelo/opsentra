import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Role } from '@/types/domain';

import {
  advanceTo,
  advanceToNextStep,
  clockRunning,
  createInitialState,
  ENGINE_SCHEMA,
  execute,
  type Command,
  type CommandResult,
  type EngineState,
} from './engine/engine';

export const DEMO_SPEEDS = [1, 10, 30, 60] as const;
export type DemoSpeed = (typeof DEMO_SPEEDS)[number];

export const DEMO_ACTOR_ID: Record<Role, string> = {
  VIEWER: 'demo-viewer',
  OPERATOR: 'demo-operator',
  ADMIN: 'demo-admin',
};

interface DemoSession {
  engine: EngineState;
  speed: DemoSpeed;
  paused: boolean;
  /** Simulated role. Demo only: in Live, roles come from Cognito claims. */
  role: Role;
  run: (cmd: Command) => CommandResult;
  /** Advance simulated time by real elapsed ms × speed (only while a scenario runs). */
  tick: (realMs: number) => void;
  nextStep: () => void;
  reset: () => void;
  setSpeed: (speed: DemoSpeed) => void;
  setPaused: (paused: boolean) => void;
  setRole: (role: Role) => void;
}

/**
 * Demo session state. Kept in sessionStorage (blueprint §2.3): it survives a
 * reload in the same tab, never persists as "real" incidents, and Reset
 * restores the deterministic baseline.
 */
export const useDemoSession = create<DemoSession>()(
  persist(
    (set, get) => ({
      engine: createInitialState(),
      speed: 10,
      paused: false,
      role: 'ADMIN',
      run: (cmd) => {
        const { engine, role } = get();
        const { state, result } = execute(engine, cmd, { id: DEMO_ACTOR_ID[role], role });
        if (state !== engine) set({ engine: state });
        return result;
      },
      tick: (realMs) => {
        const { engine, paused, speed } = get();
        if (paused || !clockRunning(engine)) return;
        set({ engine: advanceTo(engine, engine.clockMs + Math.round(realMs * speed)) });
      },
      nextStep: () => set({ engine: advanceToNextStep(get().engine) }),
      reset: () => set({ engine: createInitialState(), paused: false }),
      setSpeed: (speed) => set({ speed }),
      setPaused: (paused) => set({ paused }),
      setRole: (role) => set({ role }),
    }),
    {
      name: 'opsentra:demo-session',
      version: ENGINE_SCHEMA,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ engine: s.engine, speed: s.speed, paused: s.paused, role: s.role }),
      // A stored session from an older engine is discarded, not migrated.
      migrate: () => ({ engine: createInitialState(), speed: 10, paused: false, role: 'ADMIN' }),
    },
  ),
);

export const getEngine = (): EngineState => useDemoSession.getState().engine;
