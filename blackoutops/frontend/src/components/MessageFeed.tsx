/**
 * MessageFeed — scrollable timeline of received transmissions.
 *
 * P7: Delayed messages show "sent HH:mm:ss, arrived HH:mm:ss (+Ns delay)"
 */

import { format } from 'date-fns';
import type { ReceivedMessage } from '../types';

const CATEGORY_COLORS: Record<string, string> = {
  INTEL: '#f39c12',
  ORDERS: '#e74c3c',
  SITREP: '#3498db',
  LOGISTICS: '#2ecc71',
  COMMAND: '#9b59b6',
  INJECT: '#e67e22',
  SHARE: '#1abc9c',
};

const DEGRADATION_BADGE: Record<string, { label: string; color: string }> = {
  none:        { label: 'CLEAR',       color: '#2ecc71' },
  delay:       { label: 'DELAYED',     color: '#f39c12' },
  conflicting: { label: 'CONFLICTING', color: '#e74c3c' },
  outdated:    { label: 'OUTDATED',    color: '#e67e22' },
  dropout:     { label: 'DROPPED',     color: '#7f8c8d' },
};

interface Props {
  messages: ReceivedMessage[];
  onShare?: (text: string) => void;
}

export function MessageFeed({ messages, onShare }: Props) {
  if (messages.length === 0) {
    return (
      <div className="feed-empty">
        <span className="blink">▮</span> Awaiting transmissions...
      </div>
    );
  }

  return (
    <div className="message-feed">
      {messages.map((msg) => {
        const catColor = CATEGORY_COLORS[msg.category] ?? '#ccc';
        const deg = DEGRADATION_BADGE[msg.degradation_mode] ?? DEGRADATION_BADGE.none;
        const arrivedTs = format(new Date(msg.timestamp * 1000), 'HH:mm:ss');

        // P7: for delayed messages, show sent time and arrival time separately
        const isDelayed = msg.delayed_by > 0 && msg.sent_at != null;
        const sentTs = isDelayed && msg.sent_at
          ? format(new Date(msg.sent_at * 1000), 'HH:mm:ss')
          : null;

        return (
          <div
            key={msg.id}
            className={`message-card ${msg.degraded ? 'degraded' : ''}`}
            style={{ borderLeftColor: catColor }}
          >
            <div className="message-header">
              <span className="cat-badge" style={{ background: catColor }}>
                {msg.category}
              </span>
              {msg.from_name && (
                <span className="share-tag">📡 via {msg.from_name}</span>
              )}
              <span
                className="deg-badge"
                style={{ color: deg.color, borderColor: deg.color }}
              >
                {deg.label}
              </span>
              <span className="msg-time">
                {/* P7: show sent → arrived for delayed messages */}
                {isDelayed && sentTs
                  ? `sent ${sentTs} → arrived ${arrivedTs} (+${msg.delayed_by}s)`
                  : arrivedTs}
              </span>
            </div>

            <div className="message-body">
              {msg.outdated_warning && (
                <div className="outdated-warning">
                  ⚠ STALE DATA — This report may not reflect current situation.
                </div>
              )}
              <p>{msg.text}</p>
            </div>

            {onShare && msg.category !== 'SHARE' && (
              <button
                className="share-btn"
                onClick={() => onShare(msg.text)}
                title="Share with teammates"
              >
                📡 Share
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
