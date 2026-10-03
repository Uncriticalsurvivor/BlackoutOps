/**
 * DecisionPanel — allows the player to submit decisions / orders.
 *
 * Bug C: Renders DPs from firedDecisionPoints (server-driven, fired at actual
 *        at_seconds) instead of all static DPs loaded at join time. This
 *        ensures time_to_decide is always >= 0.
 * P5: Preset buttons — Advance, Hold, Request Confirmation.
 */

import { useState } from 'react';
import { useStore } from '../store/gameStore';

interface Props {
  sessionStatus: string;
  onSubmit: (text: string, dpId?: string, action?: string) => void;
}

const PRESET_ACTIONS = [
  { label: '⬆ Advance',              action: 'advance',              color: '#2ecc71' },
  { label: '✋ Hold',                  action: 'hold',                 color: '#f39c12' },
  { label: '🔔 Request Confirmation', action: 'request_confirmation', color: '#3498db' },
];

export function DecisionPanel({ sessionStatus, onSubmit }: Props) {
  const [text, setText] = useState('');
  const [selectedDpId, setSelectedDpId] = useState<string | undefined>(undefined);
  const [cooldown, setCooldown] = useState(false);   // Fix 4: prevent duplicates
  const [sentFlash, setSentFlash] = useState(false); // Fix 4: "Sent ✓" feedback

  // Bug C: use server-fired DPs, not static list
  const { firedDecisionPoints, markDpAnswered } = useStore();
  const pendingDPs = firedDecisionPoints.filter((d) => !d.answered);

  const isActive = sessionStatus === 'running' && !cooldown;

  // Fix 4: shared cooldown trigger after any submission
  const triggerCooldown = () => {
    setCooldown(true);
    setSentFlash(true);
    setTimeout(() => setSentFlash(false), 800);
    setTimeout(() => setCooldown(false), 2000);
  };

  const handleSubmit = (overrideText?: string, overrideAction?: string) => {
    const finalText = (overrideText ?? text).trim();
    if (!finalText || !isActive) return;
    onSubmit(finalText, selectedDpId, overrideAction);
    if (selectedDpId) markDpAnswered(selectedDpId);
    if (!overrideText) {
      setText('');
      setSelectedDpId(undefined);
    }
    triggerCooldown();
  };

  const handlePreset = (action: string, label: string) => {
    if (!isActive) return;
    const actionText = action === 'request_confirmation'
      ? 'REQUEST CONFIRMATION — awaiting updated orders.'
      : label.replace(/^[^ ]+ /, '');
    onSubmit(actionText, selectedDpId, action);
    if (selectedDpId) markDpAnswered(selectedDpId);
    setSelectedDpId(undefined);
    triggerCooldown();
  };

  return (
    <div className="decision-panel">
      <h3 className="panel-title">🎯 Decision / Order</h3>

      {/* P5: Preset action buttons */}
      <div className="preset-actions">
        {PRESET_ACTIONS.map(({ label, action, color }) => (
          <button
            key={action}
            className="preset-btn"
            style={{ borderColor: color, color: color }}
            onClick={() => handlePreset(action, label)}
            disabled={!isActive}
            title={label}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Bug C: Show only DPs that have actually fired on the server */}
      {pendingDPs.length > 0 && (
        <div className="dp-list">
          {pendingDPs.map((dp) => (
            <div
              key={dp.dpId}
              className={`dp-card ${selectedDpId === dp.dpId ? 'selected' : ''}`}
              onClick={() => {
                setSelectedDpId(selectedDpId === dp.dpId ? undefined : dp.dpId);
                setText(dp.prompt.endsWith('?') ? '' : dp.prompt);
              }}
            >
              <span className="dp-prompt">{dp.prompt}</span>
              {selectedDpId !== dp.dpId && (
                <span className="dp-tap">Tap to respond</span>
              )}
            </div>
          ))}
        </div>
      )}

      <textarea
        className="decision-input"
        placeholder={
          isActive
            ? 'Enter your decision or order...'
            : 'Session not active — awaiting start.'
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!isActive}
        rows={3}
        maxLength={1000}
      />

      <div className="decision-footer">
        <span className="char-count">{text.length}/1000</span>
        <button
          className="submit-btn"
          onClick={() => handleSubmit()}
          disabled={!isActive || !text.trim()}
        >
          {sentFlash ? '✓ Sent' : 'TRANSMIT DECISION'}
        </button>
      </div>
    </div>
  );
}
