/**
 * BlackoutOps — Zustand Global Store
 *
 * Single source of truth for both player and instructor views.
 * Updated by the WebSocket hook on every incoming server event.
 *
 * Bug C: firedDecisionPoints tracks DPs that have actually fired on the server.
 */

import { create } from 'zustand';
import type {
  DecisionPoint,
  ReceivedMessage,
  ScenarioMap,
  SessionStatus,
} from '../types';

// ---------------------------------------------------------------------------
// Bug C: type for a decision point that has actually fired on the server
// ---------------------------------------------------------------------------
export interface FiredDP {
  dpId: string;
  prompt: string;
  firedAt: number;
  answered: boolean;
}

// ---------------------------------------------------------------------------
// Player slice
// ---------------------------------------------------------------------------
interface PlayerSlice {
  sessionId: string | null;
  playerId: string | null;
  role: string | null;
  roleLabel: string | null;
  displayName: string | null;
  scenarioName: string | null;

  sessionStatus: SessionStatus;
  jammingLevel: number;

  scenarioMap: ScenarioMap | null;
  decisionPoints: DecisionPoint[];

  // Bug C: DPs that have actually fired on the server
  firedDecisionPoints: FiredDP[];

  messages: ReceivedMessage[];
  wsConnected: boolean;

  setIdentity: (
    sessionId: string,
    playerId: string,
    role: string,
    roleLabel: string,
    displayName: string,
    scenarioName: string
  ) => void;
  setScenarioData: (map: ScenarioMap, dps: DecisionPoint[]) => void;
  addMessage: (msg: ReceivedMessage) => void;
  setSessionStatus: (status: SessionStatus) => void;
  setJammingLevel: (level: number) => void;
  setWsConnected: (connected: boolean) => void;
  setFiredDp: (dpId: string, prompt: string, firedAt: number) => void;
  markDpAnswered: (dpId: string) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Instructor slice
// ---------------------------------------------------------------------------
interface InstructorSlice {
  instructorToken: string | null;
  setInstructorToken: (token: string) => void;
}

// ---------------------------------------------------------------------------
// Combined store
// ---------------------------------------------------------------------------
type Store = PlayerSlice & InstructorSlice;

const initialPlayerState = {
  sessionId: null,
  playerId: null,
  role: null,
  roleLabel: null,
  displayName: null,
  scenarioName: null,
  sessionStatus: 'lobby' as SessionStatus,
  jammingLevel: 0,
  scenarioMap: null,
  decisionPoints: [],
  firedDecisionPoints: [] as FiredDP[],
  messages: [],
  wsConnected: false,
};

export const useStore = create<Store>((set) => ({
  ...initialPlayerState,

  setIdentity: (sessionId, playerId, role, roleLabel, displayName, scenarioName) =>
    set({ sessionId, playerId, role, roleLabel, displayName, scenarioName }),

  setScenarioData: (scenarioMap, decisionPoints) =>
    set({ scenarioMap, decisionPoints }),

  addMessage: (msg) =>
    set((state) => ({ messages: [msg, ...state.messages] })),

  setSessionStatus: (sessionStatus) => set({ sessionStatus }),

  setJammingLevel: (jammingLevel) => set({ jammingLevel }),

  setWsConnected: (wsConnected) => set({ wsConnected }),

  // Bug C: server fired a decision_point event
  setFiredDp: (dpId, prompt, firedAt) =>
    set((state) => ({
      firedDecisionPoints: [
        ...state.firedDecisionPoints.filter((d) => d.dpId !== dpId),
        { dpId, prompt, firedAt, answered: false },
      ],
    })),

  markDpAnswered: (dpId) =>
    set((state) => ({
      firedDecisionPoints: state.firedDecisionPoints.map((d) =>
        d.dpId === dpId ? { ...d, answered: true } : d
      ),
    })),

  reset: () => set(initialPlayerState),

  instructorToken: null,
  setInstructorToken: (token) => set({ instructorToken: token }),
}));
