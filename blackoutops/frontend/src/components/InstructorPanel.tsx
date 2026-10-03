/**
 * InstructorPanel — session control and live player overview for the instructor.
 *
 * P1: Inject form adds conflicting/outdated variant inputs.
 * P5: Player row shows 🔔 when pending confirmation.
 * P6: Pause button removed.
 */

import { useState } from 'react';
import type { PlayerInfo, ScenarioInfo, SessionStatus } from '../types';

interface Props {
  sessionId: string;
  token: string;
  status: SessionStatus;
  jammingLevel: number;
  players: PlayerInfo[];
  scenario: ScenarioInfo | null;
  unfilledRoles: string[];
  onStart: () => void;
  onStartAnyway: () => void;
  onEnd: () => void;
  onSetJamming: (level: number) => void;
  onInject: (text: string, roles: string[], conflictingText?: string, outdatedText?: string) => void;
  onOpenAAR: () => void;
  onDismissConfirmation: (playerId: string) => void;   // Fix 5
}

export function InstructorPanel({
  sessionId,
  status,
  jammingLevel,
  players,
  scenario,
  unfilledRoles,
  onStart,
  onStartAnyway,
  onEnd,
  onSetJamming,
  onInject,
  onOpenAAR,
  onDismissConfirmation,
}: Props) {
  const [injectText, setInjectText] = useState('');
  const [injectConflicting, setInjectConflicting] = useState('');
  const [injectOutdated, setInjectOutdated] = useState('');
  const [injectRoles, setInjectRoles] = useState<Set<string>>(new Set());
  const [localJam, setLocalJam] = useState(jammingLevel);
  const [jamConfirmed, setJamConfirmed] = useState(false);   // Fix 3: "✓ Live" flash

  const allRoles = scenario?.roles ?? [];
  const roleLabels = scenario?.role_labels ?? {};

  const toggleRole = (r: string) => {
    setInjectRoles((prev) => {
      const next = new Set(prev);
      next.has(r) ? next.delete(r) : next.add(r);
      return next;
    });
  };

  const handleInject = () => {
    if (!injectText.trim()) return;
    onInject(
      injectText.trim(),
      Array.from(injectRoles),
      injectConflicting.trim() || undefined,
      injectOutdated.trim() || undefined,
    );
    setInjectText('');
    setInjectConflicting('');
    setInjectOutdated('');
  };

  // Fix 3: commit jamming on SET button or on slider release
  const commitJamming = () => {
    onSetJamming(localJam);
    setJamConfirmed(true);
    setTimeout(() => setJamConfirmed(false), 1500);
  };

  const sliderDiffers = localJam !== jammingLevel;

  const joinLink = `${window.location.origin}/join/${sessionId}`;

  return (
    <div className="instructor-panel">

      {/* ── Session Info ───────────────────────────────────── */}
      <section className="panel-section">
        <h3 className="section-title">SESSION</h3>
        <div className="info-row">
          <span>ID</span>
          <strong className="mono">{sessionId}</strong>
        </div>
        <div className="info-row">
          <span>Scenario</span>
          <strong>{scenario?.name ?? '—'}</strong>
        </div>
        <div className="info-row">
          <span>Status</span>
          <span className={`status-chip ${status}`}>{status.toUpperCase()}</span>
        </div>
        <div className="join-link-box">
          <small>Player join link:</small>
          <code
            className="join-link"
            onClick={() => navigator.clipboard.writeText(joinLink)}
            title="Click to copy"
          >
            {joinLink}
          </code>
        </div>
      </section>

      {/* ── Bug A: Readiness warning ────────────────────────── */}
      {unfilledRoles.length > 0 && status === 'lobby' && (
        <div className="readiness-warning">
          <strong>⚠ Not all roles filled:</strong>{' '}
          {unfilledRoles.join(', ')}
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
            <button className="ctrl-btn green" onClick={onStart}>
              ⟳ Try again
            </button>
            <button className="ctrl-btn yellow" onClick={onStartAnyway}>
              ▶ Start Anyway
            </button>
          </div>
        </div>
      )}

      {/* ── Controls ────────────────────────────────────────── */}
      <section className="panel-section">
        <h3 className="section-title">CONTROLS</h3>
        <div className="control-row">
          <button
            className="ctrl-btn green"
            onClick={onStart}
            disabled={status === 'running' || status === 'ended'}
          >
            ▶ START
          </button>
          <button
            className="ctrl-btn red"
            onClick={onEnd}
            disabled={status === 'ended' || status === 'lobby'}
          >
            ■ END
          </button>
        </div>
        {status === 'ended' && (
          <button className="ctrl-btn purple full" onClick={onOpenAAR}>
            📋 VIEW AAR
          </button>
        )}
      </section>

      {/* ── Jamming (Fix 3: auto-commit on release + highlight) ── */}
      <section className="panel-section">
        <h3 className="section-title">JAMMING LEVEL</h3>
        <div className="jam-row">
          <input
            type="range"
            min={0}
            max={100}
            value={localJam}
            onChange={(e) => setLocalJam(Number(e.target.value))}
            onMouseUp={commitJamming}        // Fix 3: auto-commit on release
            onTouchEnd={commitJamming}       // Fix 3: touch support
            className="jam-slider"
          />
          <span className="jam-value">{localJam}%</span>
          <button
            className={`ctrl-btn small ${sliderDiffers ? 'accent-btn' : ''}`}
            onClick={commitJamming}
            style={sliderDiffers ? { borderColor: '#00d4ff', color: '#00d4ff' } : {}}
          >
            {jamConfirmed ? '✓ Live' : 'SET'}
          </button>
        </div>
        <div className="jam-indicator">
          <div
            className="jam-bar"
            style={{ width: `${jammingLevel}%`, background: jammingColor(jammingLevel) }}
          />
        </div>
        <small className="jam-hint">
          Current: <strong>{jammingLevel}%</strong> — applies to all messages not yet dispatched
        </small>
      </section>

      {/* ── Players (Fix 5: Dismiss button on badge) ─────────── */}
      <section className="panel-section">
        <h3 className="section-title">PLAYERS ({players.length})</h3>
        {players.length === 0 && (
          <p className="muted">No players connected yet.</p>
        )}
        {players.map((p) => (
          <div key={p.player_id} className="player-row">
            <span
              className="player-dot"
              style={{ background: p.connected ? '#2ecc71' : '#e74c3c' }}
            />
            <div className="player-info">
              <strong>
                {p.display_name}
                {p.pending_confirmation && (
                  <span className="confirm-badge" title="Requesting confirmation">
                    🔔 CONFIRM?{' '}
                    <button
                      className="dismiss-btn"
                      onClick={() => onDismissConfirmation(p.player_id)}
                      title="Dismiss"
                    >
                      ✕
                    </button>
                  </span>
                )}
              </strong>
              <small>{roleLabels[p.role] ?? p.role}</small>
            </div>
            <div className="player-stats">
              <span title="Messages received">📨 {p.messages_received}</span>
              <span title="Decisions made">🎯 {p.decisions_made}</span>
            </div>
          </div>
        ))}
      </section>

      {/* ── Inject (P1: conflicting/outdated variant inputs) ─── */}
      <section className="panel-section">
        <h3 className="section-title">INJECT MESSAGE</h3>
        <div className="role-toggles">
          {allRoles.map((r) => (
            <button
              key={r}
              className={`role-toggle ${injectRoles.has(r) ? 'active' : ''}`}
              onClick={() => toggleRole(r)}
            >
              {roleLabels[r] ?? r}
            </button>
          ))}
          <button
            className={`role-toggle ${injectRoles.size === allRoles.length ? 'active' : ''}`}
            onClick={() => setInjectRoles(new Set(allRoles))}
          >
            ALL
          </button>
        </div>

        <label className="field-label">Message text</label>
        <textarea
          className="inject-input"
          placeholder="Type an ad-hoc message to inject..."
          value={injectText}
          onChange={(e) => setInjectText(e.target.value)}
          rows={2}
          maxLength={500}
        />

        {/* P1: variant inputs */}
        <label className="field-label" style={{ marginTop: 6 }}>
          Conflicting version <span className="muted">(optional — shown instead when CONFLICTING mode fires)</span>
        </label>
        <textarea
          className="inject-input"
          placeholder="e.g. contradictory alternative..."
          value={injectConflicting}
          onChange={(e) => setInjectConflicting(e.target.value)}
          rows={2}
          maxLength={500}
        />

        <label className="field-label" style={{ marginTop: 6 }}>
          Outdated version <span className="muted">(optional — shown when OUTDATED mode fires)</span>
        </label>
        <textarea
          className="inject-input"
          placeholder="e.g. stale/old version of this message..."
          value={injectOutdated}
          onChange={(e) => setInjectOutdated(e.target.value)}
          rows={2}
          maxLength={500}
        />

        <button
          className="ctrl-btn orange full"
          onClick={handleInject}
          disabled={!injectText.trim() || injectRoles.size === 0}
          style={{ marginTop: 8 }}
        >
          📡 INJECT
        </button>
      </section>
    </div>
  );
}

function jammingColor(level: number): string {
  if (level < 30) return '#2ecc71';
  if (level < 60) return '#f39c12';
  return '#e74c3c';
}
