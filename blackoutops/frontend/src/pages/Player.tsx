/**
 * Player — main game view.
 * Left panel: tactical map | Right panel: message feed + decision panel
 */

import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TacticalMap } from '../components/TacticalMap';
import { MessageFeed } from '../components/MessageFeed';
import { DecisionPanel } from '../components/DecisionPanel';
import { useWebSocket } from '../hooks/useWebSocket';
import { useStore } from '../store/gameStore';

export default function Player() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const {
    playerId,
    role,
    roleLabel,
    displayName,
    scenarioName,
    sessionStatus,
    jammingLevel,
    scenarioMap,
    decisionPoints,
    messages,
    wsConnected,
    setScenarioData,
    setIdentity,
  } = useStore();

  // Restore from sessionStorage if page was refreshed
  useEffect(() => {
    if (!sessionId) return;
    const storedPid = sessionStorage.getItem(`player_id_${sessionId}`);
    const storedName = sessionStorage.getItem(`player_name_${sessionId}`);

    if (storedPid && storedName && !playerId) {
      // Re-hydrate minimal state enough to connect WS — real state comes from server
      setIdentity(sessionId, storedPid, role ?? '', roleLabel ?? '', storedName, scenarioName ?? '');
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch map and decision points
  useEffect(() => {
    if (!sessionId || !playerId) return;
    fetch(`/api/player/sessions/${sessionId}/scenario?player_id=${playerId}`)
      .then((r) => r.json())
      .then((data) => {
        setScenarioData(data.map, data.decision_points ?? []);
        // Also update role label if missing
        if (!roleLabel && data.role_label) {
          setIdentity(
            sessionId,
            playerId,
            data.role,
            data.role_label,
            displayName ?? '',
            data.scenario_name,
          );
        }
      })
      .catch(console.error);
  }, [sessionId, playerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect WebSocket
  const { sendShare } = useWebSocket(
    playerId ? sessionId ?? null : null,
    playerId,
  );

  const handleDecision = async (text: string, dpId?: string, action?: string) => {
    if (!sessionId || !playerId) return;
    await fetch(`/api/player/sessions/${sessionId}/decision?player_id=${playerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, decision_point_id: dpId ?? null, action: action ?? null }),
    });
  };

  const handleShare = (text: string) => {
    sendShare(text);
  };

  if (!playerId) {
    return (
      <div className="player-page centered">
        <div className="loading">
          Connecting...{' '}
          <button onClick={() => navigate(`/join/${sessionId}`)}>Re-join</button>
        </div>
      </div>
    );
  }

  const jammingColor = jammingLevel < 30 ? '#2ecc71' : jammingLevel < 60 ? '#f39c12' : '#e74c3c';

  return (
    <div className="player-page">
      {/* ── Top Bar ─────────────────────────────────────── */}
      <header className="player-header">
        <div className="player-id-block">
          <span className="logo-icon small">◈</span>
          <div>
            <strong>{displayName}</strong>
            <span className="role-tag">{roleLabel}</span>
          </div>
        </div>
        <div className="header-center">
          <strong className="scenario-name">{scenarioName}</strong>
        </div>
        <div className="header-right">
          <span className="jam-badge" style={{ color: jammingColor }}>
            📡 JAM {jammingLevel}%
          </span>
          <span className={`status-chip ${sessionStatus}`}>
            {sessionStatus.toUpperCase()}
          </span>
          <span className={`ws-dot ${wsConnected ? 'on' : 'off'}`} title={wsConnected ? 'Connected' : 'Reconnecting...'} />
        </div>
      </header>

      {/* ── Main Layout ─────────────────────────────────── */}
      <div className="player-layout">
        {/* Left: map */}
        <div className="map-panel">
          {scenarioMap ? (
            <TacticalMap mapData={scenarioMap} />
          ) : (
            <div className="map-loading">Loading map data...</div>
          )}
        </div>

        {/* Right: feed + decision */}
        <div className="right-panel">
          <div className="feed-section">
            <h3 className="section-title">
              📨 TRANSMISSIONS
              <span className="msg-count">{messages.length}</span>
            </h3>
            <div className="feed-scroll">
              <MessageFeed messages={messages} onShare={handleShare} />
            </div>
          </div>

          <div className="decision-section">
            <DecisionPanel
              sessionStatus={sessionStatus}
              onSubmit={handleDecision}
            />
          </div>
        </div>
      </div>

      {/* Session ended banner */}
      {sessionStatus === 'ended' && (
        <div className="ended-banner">
          🔴 SESSION ENDED — Await AAR briefing from your instructor.
        </div>
      )}
    </div>
  );
}
