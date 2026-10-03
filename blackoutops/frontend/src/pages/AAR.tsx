/**
 * AAR — After-Action Review page.
 *
 * Bug D: Timeline now shows ONE row per (player, message) with:
 *   - Coloured badge for the actual mode (CLEAR / DELAYED +Ns / CONFLICTING / OUTDATED / DROPPED)
 *   - "Original: ..." and "Player received: ..." on two lines for degraded messages
 *   - "Player never received this" + original text for DROPPED
 *   - sent → arrived time for DELAYED messages
 *   Queued / Delivered / Dropped events are pre-merged by the backend.
 *
 * P4: Decision events show last-5-messages, dropped IDs, time_to_decide.
 * P5: Confirmation flags per player in score cards.
 */

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import type { AARData, AAREvent, PlayerScore, ConfirmationFlags } from '../types';

const SCORE_COLORS: Record<string, string> = {
  complete:    '#2ecc71',
  delayed:     '#f39c12',
  conflicting: '#e74c3c',
  outdated:    '#e67e22',
  no_info:     '#7f8c8d',
};

const MODE_COLOR: Record<string, string> = {
  none:        '#2ecc71',
  delay:       '#f39c12',
  conflicting: '#e74c3c',
  outdated:    '#e67e22',
  dropout:     '#7f8c8d',
};

const MODE_LABEL: Record<string, string> = {
  none:        'CLEAR',
  delay:       'DELAYED',
  conflicting: 'CONFLICTING',
  outdated:    'OUTDATED',
  dropout:     'DROPPED',
};

const EVENT_ICONS: Record<string, string> = {
  message:       '📨',
  decision:      '🎯',
  session_start: '▶',
  session_pause: '⏸',
  session_end:   '■',
  inject:        '📡',
  share:         '🔁',
};

function fmtTs(unix: number) {
  return format(new Date(unix * 1000), 'HH:mm:ss');
}

function ModeBadge({ mode }: { mode: string | null }) {
  const m = mode ?? 'none';
  const color = MODE_COLOR[m] ?? '#ccc';
  return (
    <span className="deg-badge" style={{ color, borderColor: color }}>
      {MODE_LABEL[m] ?? m.toUpperCase()}
    </span>
  );
}

export default function AAR() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [data, setData] = useState<AARData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/aar/${sessionId}`)
      .then((r) => {
        if (!r.ok) throw new Error('AAR data not available');
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const handleExport = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aar_${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="aar-page"><div className="loading">Loading AAR...</div></div>;
  if (error)   return <div className="aar-page"><div className="error-msg">{error}</div></div>;
  if (!data)   return null;

  const filteredTimeline = filter === 'all'
    ? data.timeline
    : data.timeline.filter((e: AAREvent) => e.player_id === filter);

  const allPlayerIds = Object.keys(data.scores);

  return (
    <div className="aar-page">
      <header className="aar-header">
        <div className="logo small">
          <span className="logo-icon">◈</span>
          <span>BLACKOUT<span className="accent">OPS</span> — AFTER-ACTION REVIEW</span>
        </div>
        <div>
          <span className="mono">Session: {sessionId}</span>
          <button className="export-btn" onClick={handleExport}>
            ⬇ Export JSON
          </button>
        </div>
      </header>

      {/* ── Scoring Cards (P5 flags) ─────────────────────────── */}
      <section className="aar-section">
        <h2 className="section-title">PLAYER SCORES &amp; FLAGS</h2>
        <div className="score-grid">
          {allPlayerIds.map((pid) => {
            const score: PlayerScore = data.scores[pid];
            const flags: ConfirmationFlags = data.confirmation_flags?.[pid] ?? {
              acted_on_degraded_without_confirmation: 0,
              requested_confirmation_after_degraded: 0,
            };
            const label = data.player_labels[pid] ?? pid;
            const total = score.messages_received + score.messages_dropped;
            return (
              <div key={pid} className="score-card">
                <h3>{label}</h3>
                <div className="score-bars">
                  {(['complete', 'delayed', 'conflicting', 'outdated', 'no_info'] as const).map((k) => {
                    const val = score[k] ?? 0;
                    const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                    return (
                      <div key={k} className="score-row">
                        <span className="score-label" style={{ color: SCORE_COLORS[k] }}>
                          {k.replace('_', ' ').toUpperCase()}
                        </span>
                        <div className="score-bar-track">
                          <div className="score-bar-fill"
                            style={{ width: `${pct}%`, background: SCORE_COLORS[k] }} />
                        </div>
                        <span className="score-num">{val}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="score-meta">
                  <span>📨 {score.messages_received} received</span>
                  <span>🚫 {score.messages_dropped} dropped</span>
                  <span>🎯 {score.decisions} decisions</span>
                </div>
                {/* P5: confirmation flags */}
                <div className="confirm-flags">
                  <div className="flag-row"
                    style={{ color: flags.decided_on_degraded_without_confirming > 0 ? '#e74c3c' : '#2ecc71' }}>
                    ⚠ Decided on degraded info without confirming:{' '}
                    <strong>{flags.decided_on_degraded_without_confirming}</strong>
                  </div>
                  <div className="flag-row" style={{ color: '#3498db' }}>
                    🔔 Requested confirmation after degraded info:{' '}
                    <strong>{flags.requested_confirmation_after_degraded}</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Timeline ─────────────────────────────────────────── */}
      <section className="aar-section">
        <div className="timeline-header">
          <h2 className="section-title">EVENT TIMELINE</h2>
          <div className="filter-row">
            <label>Filter player:</label>
            <select className="field-select small" value={filter}
              onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="instructor">Instructor</option>
              {allPlayerIds.filter((p) => p !== 'instructor').map((pid) => (
                <option key={pid} value={pid}>{data.player_labels[pid] ?? pid}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="timeline">
          {filteredTimeline.map((ev: AAREvent) => {
            const icon = EVENT_ICONS[ev.event_type] ?? '•';
            const ts = format(new Date(ev.timestamp * 1000), 'HH:mm:ss.SSS');
            const actorLabel = data.player_labels[ev.player_id] ?? ev.player_id;

            // ── Bug D: merged message row ──────────────────────
            if (ev.event_type === 'message') {
              const p = ev.payload;
              const mode = (ev.degradation_mode ?? 'none') as string;
              const dropped = p.dropped as boolean;
              const originalText = p.original_text != null ? String(p.original_text) : undefined;
              const receivedText = p.received_text != null ? String(p.received_text) : undefined;
              const delayedBy = Number(p.delayed_by ?? 0);
              const sentAt = p.sent_at != null ? Number(p.sent_at) : null;
              const arrivedAt = p.arrived_at != null ? Number(p.arrived_at) : null;

              return (
                <div key={String(ev.id)} className={`timeline-event message ${mode}`}>
                  <div className="tl-icon">{dropped ? '🚫' : '📨'}</div>
                  <div className="tl-body">
                    <div className="tl-meta">
                      <span className="tl-time mono">{ts}</span>
                      <span className="tl-actor">{actorLabel}</span>
                      <ModeBadge mode={mode} />
                      {/* Bug D: delay timing */}
                      {delayedBy > 0 && sentAt && arrivedAt && (
                        <span className="delay-info" style={{ color: '#f39c12', fontSize: '0.75rem' }}>
                          sent {fmtTs(sentAt)} → arrived {fmtTs(arrivedAt)} (+{delayedBy}s)
                        </span>
                      )}
                    </div>

                    {dropped ? (
                      // Bug D: DROPPED — show original text, mark as never received
                      <>
                        <p className="tl-text" style={{ color: '#7f8c8d' }}>
                          <em>Player never received this transmission</em>
                        </p>
                        {originalText && (
                          <p className="tl-text muted" style={{ fontSize: '0.8rem' }}>
                            <strong>Original:</strong> {originalText}
                          </p>
                        )}
                      </>
                    ) : receivedText && originalText && receivedText !== originalText ? (
                      // Bug D: degraded (CONFLICTING / OUTDATED) — show both lines
                      <>
                        <p className="tl-text" style={{ fontSize: '0.82rem', color: '#c8cfe0' }}>
                          <strong>Player received:</strong> {receivedText}
                        </p>
                        <p className="tl-text muted" style={{ fontSize: '0.78rem' }}>
                          <strong>Original:</strong> {originalText}
                        </p>
                      </>
                    ) : (
                      // CLEAR or DELAYED (same text)
                      <p className="tl-text">{receivedText ?? originalText}</p>
                    )}
                  </div>
                </div>
              );
            }

            // ── Decision row (P4) ─────────────────────────────
            if (ev.event_type === 'decision') {
              const p = ev.payload;
              const decText = p.text != null ? String(p.text) : undefined;
              const decAction = p.action != null ? String(p.action) : null;
              const timeToDec = p.time_to_decide_seconds != null ? Number(p.time_to_decide_seconds) : null;
              const last5 = (p.last_5_messages as Array<Record<string, unknown>> | undefined) ?? [];
              const droppedIds = (p.dropped_message_ids as string[] | undefined) ?? [];

              return (
                <div key={String(ev.id)} className="timeline-event decision">
                  <div className="tl-icon">🎯</div>
                  <div className="tl-body">
                    <div className="tl-meta">
                      <span className="tl-time mono">{ts}</span>
                      <span className="tl-actor">{actorLabel}</span>
                      <span className="tl-type">decision</span>
                      {decAction === 'request_confirmation' && (
                        <span className="tl-action" style={{ color: '#3498db' }}>🔔 REQUEST CONFIRMATION</span>
                      )}
                      {decAction && decAction !== 'request_confirmation' && (
                        <span className="tl-action">[{decAction.toUpperCase()}]</span>
                      )}
                    </div>
                    {decText && <p className="tl-text">{decText}</p>}
                    {timeToDec !== null && (
                      <div className="dc-time">
                        ⏱ Time to decide: <strong>{timeToDec}s</strong> after decision point fired
                      </div>
                    )}
                    {last5.length > 0 && (
                      <details className="decision-context">
                        <summary className="dc-summary">
                          📋 Messages player had seen (last {last5.length})
                        </summary>
                        <ul className="dc-list">
                          {last5.map((m, i) => {
                            const mmode = String(m.degradation_mode ?? 'none');
                            const mc = MODE_COLOR[mmode] ?? '#ccc';
                            return (
                              <li key={i} className="dc-item">
                                <span className="dc-badge" style={{ color: mc, borderColor: mc }}>
                                  {mmode.toUpperCase()}
                                </span>
                                <span className="dc-mid mono">{String(m.message_id ?? '')}</span>
                                <span className="dc-text">{String(m.text ?? '')}</span>
                                {Number(m.delayed_by) > 0 && (
                                  <span className="dc-delay">+{Number(m.delayed_by)}s delay</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    )}
                    {droppedIds.length > 0 && (
                      <details className="decision-context">
                        <summary className="dc-summary" style={{ color: '#e74c3c' }}>
                          🚫 Dropped (not visible to player): {droppedIds.length}
                        </summary>
                        <ul className="dc-list">
                          {droppedIds.map((id) => (
                            <li key={id} className="dc-item">
                              <span className="dc-badge" style={{ color: '#7f8c8d', borderColor: '#7f8c8d' }}>DROPPED</span>
                              <span className="dc-mid mono">{id}</span>
                              <em className="muted">(player never saw this)</em>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              );
            }

            // ── Generic passthrough rows ──────────────────────
            const payloadText = ev.payload.text != null ? String(ev.payload.text) : undefined;

            return (
              <div key={String(ev.id)} className={`timeline-event ${ev.event_type}`}>
                <div className="tl-icon">{icon}</div>
                <div className="tl-body">
                  <div className="tl-meta">
                    <span className="tl-time mono">{ts}</span>
                    <span className="tl-actor">{actorLabel}</span>
                    <span className="tl-type">{ev.event_type.replace(/_/g, ' ')}</span>
                  </div>
                  {payloadText && <p className="tl-text">{payloadText}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
