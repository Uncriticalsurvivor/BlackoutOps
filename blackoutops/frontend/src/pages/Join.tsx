/**
 * Join — player role-selection page before entering the game.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { RoleInfo } from '../types';
import { useStore } from '../store/gameStore';

export default function Join() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const [loading, setLoading] = useState(true);

  const { setIdentity } = useStore();

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/player/sessions/${sessionId}/roles`)
      .then((r) => {
        if (!r.ok) throw new Error('Session not found');
        return r.json();
      })
      .then((data) => {
        setRoles(data.roles ?? []);
        const avail = (data.roles as RoleInfo[]).find((r) => !r.taken);
        if (avail) setSelectedRole(avail.id);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const handleJoin = async () => {
    if (!displayName.trim() || !selectedRole || !sessionId) return;
    setJoining(true);
    setError('');
    try {
      const res = await fetch(`/api/player/sessions/${sessionId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName.trim(), role: selectedRole }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? 'Join failed');
      }
      const data = await res.json();

      // Store player credentials
      sessionStorage.setItem(`player_id_${sessionId}`, data.player_id);
      sessionStorage.setItem(`player_name_${sessionId}`, displayName.trim());

      const roleLabel = roles.find((r) => r.id === selectedRole)?.label ?? selectedRole;
      setIdentity(sessionId, data.player_id, data.role, roleLabel, displayName.trim(), data.scenario_name);

      navigate(`/player/${sessionId}`);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="join-page">
        <div className="loading">Loading session...</div>
      </div>
    );
  }

  return (
    <div className="join-page">
      <div className="join-card">
        <div className="join-header">
          <span className="logo-icon">◈</span>
          <h2>JOIN SESSION <span className="mono accent">{sessionId}</span></h2>
        </div>

        {error && <div className="error-msg">{error}</div>}

        <label className="field-label">Call Sign / Name</label>
        <input
          className="field-input"
          type="text"
          placeholder="Enter your call sign..."
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={30}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
        />

        <label className="field-label">Select Role</label>
        <div className="role-cards">
          {roles.map((r) => (
            <div
              key={r.id}
              className={`role-card ${selectedRole === r.id ? 'selected' : ''} ${r.taken ? 'taken' : ''}`}
              onClick={() => !r.taken && setSelectedRole(r.id)}
            >
              <span className="role-label">{r.label}</span>
              {r.taken && <span className="taken-badge">TAKEN</span>}
            </div>
          ))}
        </div>

        <button
          className="primary-btn"
          onClick={handleJoin}
          disabled={joining || !displayName.trim() || !selectedRole}
        >
          {joining ? 'Joining...' : '→ ENTER FIELD'}
        </button>
      </div>
    </div>
  );
}
