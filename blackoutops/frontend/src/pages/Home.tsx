/**
 * Home — Landing page.
 * Instructor creates a room; players join with a code.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ScenarioInfo } from '../types';

export default function Home() {
  const navigate = useNavigate();

  // Instructor form
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [selectedScenario, setSelectedScenario] = useState('op_black_ridge');
  const [jamming, setJamming] = useState(50);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Player join form
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    fetch('/api/instructor/scenarios')
      .then((r) => r.json())
      .then(setScenarios)
      .catch(() => setScenarios([]));
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch('/api/instructor/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario_id: selectedScenario, jamming_level: jamming }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      // Store token in sessionStorage for the instructor
      sessionStorage.setItem(`instructor_token_${data.session_id}`, data.instructor_token);
      navigate(`/instructor/${data.session_id}`);
    } catch (e: unknown) {
      setCreateError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setJoinError('');
    navigate(`/join/${code}`);
  };

  return (
    <div className="home-page">
      <header className="home-header">
        <div className="logo">
          <span className="logo-icon">◈</span>
          <h1>BLACKOUT<span className="accent">OPS</span></h1>
        </div>
        <p className="tagline">Degraded-Communications Decision Training Platform</p>
      </header>

      <div className="home-cards">
        {/* ── Instructor Card ─────────────────────────────── */}
        <div className="card">
          <div className="card-header instructor-header">
            <span className="card-icon">🎖</span>
            <h2>Instructor</h2>
          </div>
          <div className="card-body">
            <label className="field-label">Scenario</label>
            <select
              className="field-select"
              value={selectedScenario}
              onChange={(e) => setSelectedScenario(e.target.value)}
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.duration_minutes} min)
                </option>
              ))}
            </select>

            {scenarios.find((s) => s.id === selectedScenario) && (
              <p className="scenario-desc">
                {scenarios.find((s) => s.id === selectedScenario)?.description}
              </p>
            )}

            <label className="field-label">
              Initial Jamming Level: <strong>{jamming}%</strong>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={jamming}
              onChange={(e) => setJamming(Number(e.target.value))}
              className="jam-slider"
            />
            <div className="jam-indicator">
              <div
                className="jam-bar"
                style={{
                  width: `${jamming}%`,
                  background: jamming < 30 ? '#2ecc71' : jamming < 60 ? '#f39c12' : '#e74c3c',
                }}
              />
            </div>

            {createError && <p className="error-msg">{createError}</p>}

            <button
              className="primary-btn"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? 'Creating...' : '▶ CREATE SESSION'}
            </button>
          </div>
        </div>

        {/* ── Player Card ─────────────────────────────────── */}
        <div className="card">
          <div className="card-header player-header">
            <span className="card-icon">🪖</span>
            <h2>Player</h2>
          </div>
          <div className="card-body">
            <p className="muted">Enter the 6-character room code provided by your instructor.</p>
            <label className="field-label">Room Code</label>
            <input
              className="field-input mono"
              type="text"
              placeholder="XXXXXX"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              maxLength={6}
            />
            {joinError && <p className="error-msg">{joinError}</p>}
            <button className="primary-btn" onClick={handleJoin} disabled={!joinCode.trim()}>
              → JOIN SESSION
            </button>
          </div>
        </div>
      </div>

      <footer className="home-footer">
        <small>BlackoutOps MVP · Degradation Engine v0.1 · Operation Black Ridge ready</small>
      </footer>
    </div>
  );
}
