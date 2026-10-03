// BlackoutOps — Shared TypeScript Types

export type DegradationMode = 'none' | 'delay' | 'dropout' | 'conflicting' | 'outdated';

export type SessionStatus = 'lobby' | 'running' | 'paused' | 'ended';

export type MessageCategory = 'INTEL' | 'ORDERS' | 'SITREP' | 'LOGISTICS' | 'COMMAND' | 'INJECT' | 'SHARE';

export interface ReceivedMessage {
  id: string;
  message_id: string;
  category: MessageCategory;
  text: string;
  timestamp: number;
  sent_at?: number;          // P7: original send time (before delay)
  degradation_mode: DegradationMode;
  degraded: boolean;
  outdated_warning: boolean;
  delayed_by: number;
  from_role?: string;
  from_name?: string;
}

export interface DecisionPoint {
  id: string;
  at_seconds: number;
  prompt: string;
  for_roles: string[];
}

export interface MapMarker {
  id: string;
  latlng: [number, number];
  label: string;
  color: string;
  icon: string;
}

export interface ScenarioMap {
  center: [number, number];
  zoom: number;
  markers: MapMarker[];
}

export interface PlayerInfo {
  player_id: string;
  display_name: string;
  role: string;
  connected: boolean;
  messages_received: number;
  decisions_made: number;
  pending_confirmation: boolean;   // P5
}

export interface SessionState {
  session_id: string;
  status: SessionStatus;
  jamming_level: number;
  elapsed_seconds: number;
  players: PlayerInfo[];
}

export interface AAREvent {
  id: number;
  player_id: string;
  event_type: string;
  degradation_mode: string | null;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface PlayerScore {
  decisions: number;
  complete: number;
  delayed: number;
  conflicting: number;
  outdated: number;
  no_info: number;
  messages_received: number;
  messages_dropped: number;
}

// confirmation behaviour flags per player
export interface ConfirmationFlags {
  decided_on_degraded_without_confirming: number;
  requested_confirmation_after_degraded: number;
}

export interface AARData {
  session_id: string;
  scenario_id: string;
  status: string;
  timeline: AAREvent[];
  scores: Record<string, PlayerScore>;
  confirmation_flags: Record<string, ConfirmationFlags>;  // P5
  player_labels: Record<string, string>;
}

export interface RoleInfo {
  id: string;
  label: string;
  taken: boolean;
}

export interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
  roles: string[];
  role_labels: Record<string, string>;
}
