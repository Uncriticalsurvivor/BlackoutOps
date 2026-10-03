/**
 * BlackoutOps — WebSocket Hook
 *
 * Manages the player's real-time WebSocket connection.
 * Handles:
 *   - Auto-connect on mount
 *   - Auto-reconnect with exponential backoff (max 30 s)
 *   - Heartbeat ping every 20 s
 *   - Dispatching incoming events to the Zustand store
 */

import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store/gameStore';
import type { ReceivedMessage, SessionStatus } from '../types';

const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;

export function useWebSocket(sessionId: string | null, playerId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(BASE_RECONNECT_MS);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldReconnect = useRef(true);

  const { addMessage, setSessionStatus, setJammingLevel, setWsConnected, setFiredDp } = useStore();

  const connect = useCallback(() => {
    if (!sessionId || !playerId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;
    const url = `${protocol}://${host}/api/player/ws/${sessionId}/${playerId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] Connected');
      setWsConnected(true);
      reconnectDelay.current = BASE_RECONNECT_MS;

      // Heartbeat
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 20_000);
    };

    ws.onmessage = (event) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(event.data as string);
      } catch {
        return;
      }

      const type = data.type as string;

      switch (type) {
        case 'connected':
          setSessionStatus((data.session_status as SessionStatus) ?? 'lobby');
          setJammingLevel((data.jamming_level as number) ?? 0);
          break;

        case 'session_start':
          setSessionStatus('running');
          setJammingLevel((data.jamming_level as number) ?? 0);
          addMessage({
            id: `sys_${Date.now()}`,
            message_id: 'session_start',
            category: 'COMMAND',
            text: `⚡ SESSION STARTED — ${data.scenario_name ?? 'Scenario'}. Jamming: ${data.jamming_level ?? 0}%`,
            timestamp: Date.now() / 1000,
            degradation_mode: 'none',
            degraded: false,
            outdated_warning: false,
            delayed_by: 0,
          });
          break;

        case 'session_pause':
          setSessionStatus('paused');
          addMessage({
            id: `sys_${Date.now()}`,
            message_id: 'session_pause',
            category: 'COMMAND',
            text: '⏸ SESSION PAUSED — Standby for further instructions.',
            timestamp: Date.now() / 1000,
            degradation_mode: 'none',
            degraded: false,
            outdated_warning: false,
            delayed_by: 0,
          });
          break;

        case 'session_end':
          setSessionStatus('ended');
          addMessage({
            id: `sys_${Date.now()}`,
            message_id: 'session_end',
            category: 'COMMAND',
            text: '🔴 SESSION ENDED — Proceed to After-Action Review.',
            timestamp: Date.now() / 1000,
            degradation_mode: 'none',
            degraded: false,
            outdated_warning: false,
            delayed_by: 0,
          });
          break;

        case 'message': {
          const msg: ReceivedMessage = {
            id: `msg_${Date.now()}_${Math.random()}`,
            message_id: (data.message_id as string) ?? '',
            category: (data.category as ReceivedMessage['category']) ?? 'INTEL',
            text: (data.text as string) ?? '',
            timestamp: (data.timestamp as number) ?? Date.now() / 1000,
            sent_at: (data.sent_at as number) ?? undefined,      // Bug D
            degradation_mode: (data.degradation_mode as ReceivedMessage['degradation_mode']) ?? 'none',
            degraded: (data.degraded as boolean) ?? false,
            outdated_warning: (data.outdated_warning as boolean) ?? false,
            delayed_by: (data.delayed_by as number) ?? 0,
          };
          addMessage(msg);
          break;
        }

        case 'share': {
          const shared: ReceivedMessage = {
            id: `share_${Date.now()}`,
            message_id: 'share',
            category: 'SHARE',
            text: (data.text as string) ?? '',
            timestamp: Date.now() / 1000,
            degradation_mode: 'none',
            degraded: false,
            outdated_warning: false,
            delayed_by: 0,
            from_role: data.from_role as string,
            from_name: data.from_name as string,
          };
          addMessage(shared);
          break;
        }

        // Bug C: server fires a decision_point at its at_seconds offset
        case 'decision_point': {
          const dpId = data.dp_id as string;
          const prompt = data.prompt as string;
          const firedAt = (data.fired_at as number) ?? Date.now() / 1000;
          setFiredDp(dpId, prompt, firedAt);
          break;
        }

        case 'pong':
          break;

        default:
          console.log('[WS] Unknown message type:', type);
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      console.log(`[WS] Disconnected. Reconnecting in ${reconnectDelay.current}ms`);

      if (shouldReconnect.current) {
        setTimeout(() => {
          if (shouldReconnect.current) connect();
        }, reconnectDelay.current);
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_MS);
      }
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };
  }, [sessionId, playerId, addMessage, setSessionStatus, setJammingLevel, setWsConnected, setFiredDp]);

  useEffect(() => {
    shouldReconnect.current = true;
    connect();

    return () => {
      shouldReconnect.current = false;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Expose send function for player sharing
  const sendShare = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'share', text }));
    }
  }, []);

  return { sendShare };
}
