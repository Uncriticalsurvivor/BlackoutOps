/**
 * Instructor — console view.
 * Uses polling for live player state (avoids need for instructor WS).
 *
 * P6: pause removed.
 * P1: inject passes conflicting/outdated texts.
 * P5: LiveState shows pending_confirmation per player.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { InstructorPanel } from '../components/InstructorPanel';
import type { ScenarioInfo, SessionStatus } from '../types';

interface LiveState {
  status: SessionStatus;
  jamming_level: number;
  elapsed_seconds: number;
  players: Array<{
    player_id: string;
    display_name: string;
    role: string;
    connected: boolean;
    messages_received: number;
    decisions_made: number;
    pending_confirmation: boolean;
  }>;
}

export default function Instructor() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const token = sessionId ? sessionStorage.getItem(`instructor_token_${sessionId}`) ?? '' : '';

  const [liveState, setLiveState] = useState<LiveState | null>(null);
  const [scenario, setScenario] = useState<ScenarioInfo | null>(null);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const fetchState = useCallback(async () => {
    if (!sessionId || !token) return;
    try {
      const res = await fetch(`/api/instructor/sessions/${sessionId}/state?token=${token}`);
      if (!res.ok) return;
      const data: LiveState = await res.json();
      setLiveState(data);
      if (data.status === 'running') {
        setElapsed(data.elapsed_seconds);
      }
    } catch {
      /* ignore network hiccups */
    }
  }, [sessionId, token]);

  useEffect(() => {
    fetch('/api/instructor/scenarios')
      .then((r) => r.json())
      .then((list: ScenarioInfo[]) => {
        const found = list.find((s) => s.id === 'op_black_ridge') ?? list[0] ?? null;
        setScenario(found);
      });

    fetchState();
    const interval = setInterval(fetchState, 2000);
    return () => clearInterval(interval);
  }, [fetchState]);

  useEffect(() => {
    if (liveState?.status !== 'running') return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [liveState?.status]);

  const [unfilledRoles, setUnfilledRoles] = useState<string[]>([]);

  const apiCall = async (path: string, method = 'POST', body?: unknown) => {
    const res = await fetch(`/api/instructor/sessions/${sessionId}/${path}?token=${token}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ detail: 'Request failed' }));
      // Bug A: handle 409 unfilled_roles specially
      if (res.status === 409 && data?.detail?.error === 'unfilled_roles') {
        setUnfilledRoles(data.detail.unfilled_roles ?? []);
        return;
      }
      setError(
        typeof data.detail === 'string'
          ? data.detail
          : JSON.stringify(data.detail) ?? 'Request failed'
      );
    } else {
      setUnfilledRoles([]);
    }
    await fetchState();
  };

  const handleStart = () => apiCall('start');
  const handleStartAnyway = () => {
    setUnfilledRoles([]);
    apiCall('start?allow_partial=true');
  };
  const handleEnd = () => apiCall('end');
  // Fix 5: dismiss a player's pending confirmation badge
  const handleDismissConfirmation = (playerId: string) =>
    apiCall(`dismiss/${playerId}`);
  const handleSetJamming = (level: number) => apiCall('jamming', 'POST', { jamming_level: level });
  const handleInject = (
    text: string,
    roles: string[],
    conflictingText?: string,
    outdatedText?: string,
  ) =>
    apiCall('inject', 'POST', {
      text,
      to: roles,
      apply_degradation: true,
      conflicting_text: conflictingText,
      outdated_text: outdatedText,
    });
  const handleOpenAAR = () => navigate(`/aar/${sessionId}`);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  if (!token) {
    return (
      <div className="instructor-page">
        <div className="error-msg">
          Instructor token missing. Please create a session from the home page.
        </div>
      </div>
    );
  }

  return (
    <div className="instructor-page">
      <header className="inst-header">
        <div className="logo small">
          <span className="logo-icon">◈</span>
          <span>BLACKOUT<span className="accent">OPS</span> — INSTRUCTOR CONSOLE</span>
        </div>
        <div className="header-right">
          {liveState?.status === 'running' && (
            <div className="clock">⏱ {formatTime(elapsed)}</div>
          )}
          <span className={`status-chip ${liveState?.status ?? 'lobby'}`}>
            {(liveState?.status ?? 'lobby').toUpperCase()}
          </span>
        </div>
      </header>

      {error && (
        <div className="error-banner" onClick={() => setError('')}>
          ⚠ {error} <small>(click to dismiss)</small>
        </div>
      )}

      <div className="inst-layout">
        <InstructorPanel
          sessionId={sessionId ?? ''}
          token={token}
          status={liveState?.status ?? 'lobby'}
          jammingLevel={liveState?.jamming_level ?? 0}
          players={liveState?.players ?? []}
          scenario={scenario}
          onStart={handleStart}
          onStartAnyway={handleStartAnyway}
          unfilledRoles={unfilledRoles}
          onEnd={handleEnd}
          onSetJamming={handleSetJamming}
          onInject={handleInject}
          onOpenAAR={handleOpenAAR}
          onDismissConfirmation={handleDismissConfirmation}
        />
      </div>
    </div>
  );
}
