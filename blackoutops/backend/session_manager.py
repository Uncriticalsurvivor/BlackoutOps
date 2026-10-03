"""
BlackoutOps — Session Manager

Bug A: start_session passes get_player_id_fn (callable) to scheduler,
       resolving role→player at dispatch time. Warns if no player for a role.
       start_session now returns an error if scenario roles are unfilled
       (with an allow_partial flag for "start anyway").
Bug B: inject_message logs jamming level used (INFO). Existing closure
       correctly captures session.jamming_level; added assertion log.
Bug C: on_dp_fired callback stores dp_fired_at per player.
       record_decision uses dp_fired_at instead of dp.at_seconds + started_at.
       time_to_decide cannot be negative.
Bug D: MESSAGE_DROPPED payload now includes original_text for AAR.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import string
import time
from typing import Any, Callable, Optional

from fastapi import WebSocket

from models import (
    EventORM,
    EventType,
    PlayerState,
    SessionState,
    SessionStatus,
    engine,
)
from degradation import dispatch_message, schedule_scenario_messages
from sqlalchemy.orm import Session as DBSession

logger = logging.getLogger(__name__)

# Global in-memory registry
_sessions: dict[str, SessionState] = {}
_connections: dict[str, dict[str, WebSocket]] = {}  # session_id → {player_id → ws}
_scenario_tasks: dict[str, asyncio.Task] = {}  # session_id → asyncio.Task
_scenarios_cache: dict[str, dict] = {}  # scenario_id → scenario dict


# Helpers
_ALPHANUM = string.ascii_uppercase + string.digits
_TOKEN_CHARS = string.ascii_letters + string.digits


def _gen_session_id(length: int = 6) -> str:
    return "".join(secrets.choice(_ALPHANUM) for _ in range(length))


def _gen_token(length: int = 32) -> str:
    return "".join(secrets.choice(_TOKEN_CHARS) for _ in range(length))


def _load_scenario(scenario_id: str) -> dict:
    if scenario_id in _scenarios_cache:
        return _scenarios_cache[scenario_id]

    base = os.path.dirname(__file__)
    path = os.path.join(base, "scenarios", f"{scenario_id}.json")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    _scenarios_cache[scenario_id] = data
    return data


def list_scenarios() -> list[dict]:
    base = os.path.join(os.path.dirname(__file__), "scenarios")
    results = []
    for fname in os.listdir(base):
        if fname.endswith(".json"):
            sid = fname[:-5]
            try:
                s = _load_scenario(sid)
                results.append({
                    "id": sid,
                    "name": s.get("name", sid),
                    "description": s.get("description", ""),
                    "duration_minutes": s.get("duration_minutes", 0),
                    "roles": s.get("roles", []),
                    "role_labels": s.get("role_labels", {}),
                })
            except Exception as e:
                logger.warning("Could not load scenario %s: %s", fname, e)
    return results


# log_event: opens its own short-lived DB session (safe from background tasks)
def log_event(
    session_id: str,
    player_id: str,
    event_type: EventType,
    payload: dict,
    degradation_mode: Optional[str],
) -> None:
    record = EventORM(
        session_id=session_id,
        player_id=player_id,
        event_type=event_type.value,
        payload=json.dumps(payload),
        degradation_mode=degradation_mode,
        timestamp=time.time(),
    )
    db = DBSession(engine)
    try:
        db.add(record)
        db.commit()
    except Exception as exc:
        logger.error("log_event failed: %s", exc)
        db.rollback()
    finally:
        db.close()


# Session CRUD
def create_session(scenario_id: str, jamming_level: int) -> SessionState:
    _load_scenario(scenario_id)  # validate it exists

    sid = _gen_session_id()
    while sid in _sessions:
        sid = _gen_session_id()

    token = _gen_token()
    state = SessionState(
        session_id=sid,
        instructor_token=token,
        scenario_id=scenario_id,
        jamming_level=jamming_level,
    )
    _sessions[sid] = state
    _connections[sid] = {}
    logger.info("Session %s created (scenario=%s jam=%d%%)", sid, scenario_id, jamming_level)
    return state


def get_session(session_id: str) -> Optional[SessionState]:
    return _sessions.get(session_id)


def add_player(session_id: str, display_name: str, role: str) -> PlayerState:
    session = _sessions[session_id]
    scenario = _load_scenario(session.scenario_id)
    valid_roles = scenario.get("roles", [])

    if role not in valid_roles:
        raise ValueError(f"Role '{role}' is not valid for scenario '{session.scenario_id}'")

    for p in session.players.values():
        if p.role == role:
            raise ValueError(f"Role '{role}' is already taken")

    pid = _gen_token(16)
    player = PlayerState(
        player_id=pid,
        display_name=display_name,
        role=role,
    )
    session.players[pid] = player
    logger.info("Player %s (%s) joined session %s as %s", pid, display_name, session_id, role)
    return player


def get_all_sessions_summary() -> list[dict]:
    result = []
    for s in _sessions.values():
        result.append({
            "session_id": s.session_id,
            "scenario_id": s.scenario_id,
            "status": s.status,
            "jamming_level": s.jamming_level,
            "player_count": len(s.players),
        })
    return result


# Bug A: helper to check if all scenario roles are filled
def get_unfilled_roles(session_id: str) -> list[str]:
    """Return scenario roles that have no joined player yet."""
    session = _sessions[session_id]
    scenario = _load_scenario(session.scenario_id)
    all_roles = set(scenario.get("roles", []))
    filled = {p.role for p in session.players.values()}
    return sorted(all_roles - filled)


# WebSocket connection management
async def connect_player(session_id: str, player_id: str, ws: WebSocket) -> None:
    await ws.accept()
    _connections[session_id][player_id] = ws

    session = _sessions.get(session_id)
    if session and player_id in session.players:
        session.players[player_id].connected = True

    logger.info("Player %s connected to session %s", player_id, session_id)


def disconnect_player(session_id: str, player_id: str) -> None:
    _connections.get(session_id, {}).pop(player_id, None)
    session = _sessions.get(session_id)
    if session and player_id in session.players:
        session.players[player_id].connected = False
    logger.info("Player %s disconnected from session %s", player_id, session_id)


async def send_to_player(session_id: str, player_id: str, payload: dict) -> None:
    ws = _connections.get(session_id, {}).get(player_id)
    if ws:
        try:
            await ws.send_text(json.dumps(payload))
            session = _sessions.get(session_id)
            if session and player_id in session.players:
                player = session.players[player_id]
                mid = payload.get("message_id")
                if mid:
                    player.received_message_ids.append(mid)
                    player.delivered_messages.append({
                        "message_id": mid,
                        "text": payload.get("text"),
                        "original_text": payload.get("original_text"),   # Bug D
                        "degradation_mode": payload.get("degradation_mode"),
                        "delayed_by": payload.get("delayed_by", 0),
                        "timestamp": payload.get("timestamp"),
                    })
                player.visible_info_snapshot.append(payload)
        except Exception as e:
            logger.warning("Failed to send to player %s: %s", player_id, e)


def track_drop(session_id: str, player_id: str, message_id: str) -> None:
    session = _sessions.get(session_id)
    if session and player_id in session.players:
        session.players[player_id].dropped_message_ids.append(message_id)


async def broadcast_to_session(session_id: str, payload: dict, exclude: Optional[str] = None) -> None:
    coros = []
    for pid in list(_connections.get(session_id, {}).keys()):
        if pid == exclude:
            continue
        coros.append(send_to_player(session_id, pid, payload))
    if coros:
        await asyncio.gather(*coros, return_exceptions=True)


# Session lifecycle
async def start_session(session_id: str, allow_partial: bool = False) -> dict:
    """
    Start the session.

    Bug A: returns {"ok": False, "unfilled_roles": [...]} if not all roles
    are filled, unless allow_partial=True.
    """
    session = _sessions[session_id]
    if session.status == SessionStatus.RUNNING:
        return {"ok": True}

    # Bug A: check all roles filled
    if not allow_partial:
        unfilled = get_unfilled_roles(session_id)
        if unfilled:
            logger.warning("Session %s: unfilled roles %s — refusing start", session_id, unfilled)
            return {"ok": False, "unfilled_roles": unfilled}

    session.status = SessionStatus.RUNNING
    session.started_at = time.time()
    session.elapsed_seconds = 0.0

    log_event(session_id, "instructor", EventType.SESSION_START, {}, None)

    await broadcast_to_session(session_id, {
        "type": "session_start",
        "scenario_name": _load_scenario(session.scenario_id).get("name"),
        "jamming_level": session.jamming_level,
    })

    scenario = _load_scenario(session.scenario_id)
    messages = scenario.get("messages", [])
    decision_points = scenario.get("decision_points", [])

    async def _send(player_id: str, payload: dict) -> None:
        await send_to_player(session_id, player_id, payload)

    def _log(sid: str, pid: str, etype: EventType, pay: dict, mode: Optional[str]) -> None:
        if etype == EventType.MESSAGE_DROPPED:
            track_drop(sid, pid, pay.get("message_id", ""))
        log_event(sid, pid, etype, pay, mode)

    # P3: callable — always returns current jamming level
    def get_jamming() -> int:
        s = _sessions.get(session_id)
        return s.jamming_level if s else 0

    def is_running() -> bool:
        s = _sessions.get(session_id)
        return s is not None and s.status == SessionStatus.RUNNING

    # Bug A: callable that resolves role → player_id at dispatch time
    def get_player_id(role: str) -> Optional[str]:
        s = _sessions.get(session_id)
        if not s:
            return None
        for p in s.players.values():
            if p.role == role:
                return p.player_id
        return None

    # Bug C: callback called when a DP fires for a player
    def on_dp_fired(dp_id: str, player_id: str, fired_at: float) -> None:
        s = _sessions.get(session_id)
        if s and player_id in s.players:
            s.players[player_id].dp_fired_at[dp_id] = fired_at
            logger.info("DP %s fired_at=%.1f recorded for player %s", dp_id, fired_at, player_id)

    # Bug C: send DP event to specific player only
    async def broadcast_to_player(player_id: str, payload: dict) -> None:
        await send_to_player(session_id, player_id, payload)

    task = asyncio.create_task(
        schedule_scenario_messages(
            messages=messages,
            decision_points=decision_points,         # Bug C
            get_player_id_fn=get_player_id,          # Bug A
            get_jamming_fn=get_jamming,
            send_fn=_send,
            log_fn=_log,
            broadcast_fn=broadcast_to_player,        # Bug C
            session_id=session_id,
            start_time=session.started_at,
            is_running_fn=is_running,
            on_dp_fired=on_dp_fired,                 # Bug C
        )
    )
    _scenario_tasks[session_id] = task
    logger.info("Session %s STARTED", session_id)
    return {"ok": True}


async def end_session(session_id: str) -> None:
    session = _sessions[session_id]
    session.status = SessionStatus.ENDED

    task = _scenario_tasks.pop(session_id, None)
    if task:
        task.cancel()

    log_event(session_id, "instructor", EventType.SESSION_END, {}, None)
    await broadcast_to_session(session_id, {"type": "session_end"})
    logger.info("Session %s ENDED", session_id)


# Instructor utilities
async def inject_message(
    session_id: str,
    text: str,
    to_roles: list[str],
    apply_degradation: bool,
    conflicting_text: Optional[str] = None,
    outdated_text: Optional[str] = None,
) -> None:
    """
    Bug B: logs the actual jamming level used at INFO level.
    """
    session = _sessions[session_id]

    msg = {
        "id": f"inject_{int(time.time())}",
        "text": text,
        "category": "INJECT",
        "conflicting_variant": conflicting_text if conflicting_text else text,
        "outdated_variant": outdated_text if outdated_text else text,
    }

    roles_to_pids = {p.role: p.player_id for p in session.players.values()}

    async def _send(player_id: str, payload: dict) -> None:
        await send_to_player(session_id, player_id, payload)

    def _log(sid: str, pid: str, etype: EventType, pay: dict, mode: Optional[str]) -> None:
        if etype == EventType.MESSAGE_DROPPED:
            track_drop(sid, pid, pay.get("message_id", ""))
        log_event(sid, pid, etype, pay, mode)

    for role in to_roles:
        pid = roles_to_pids.get(role)
        if not pid:
            logger.warning("inject_message: no player for role=%s in session %s", role, session_id)
            continue

        # Bug B: capture jamming at call time; log it explicitly
        jamming_val = session.jamming_level if apply_degradation else 0
        logger.info(
            "inject_message | session=%s role=%s apply_degradation=%s jamming_used=%d%%",
            session_id, role, apply_degradation, jamming_val
        )

        def get_jamming(jv: int = jamming_val) -> int:
            return jv

        await dispatch_message(
            message=msg,
            player_id=pid,
            role=role,
            get_jamming_fn=get_jamming,
            send_fn=_send,
            log_fn=_log,
            session_id=session_id,
        )
        # Fix 5: delivering a message to the player auto-dismisses their confirmation request
        # (the instructor responded by injecting — which is the expected acknowledgement)
        dismiss_confirmation(session_id, pid)


def get_instructor_state(session_id: str) -> Optional[dict]:
    """Return a snapshot of all player states for the instructor live view."""
    session = _sessions.get(session_id)
    if not session:
        return None

    players_out = []
    for p in session.players.values():
        pending_confirmation = any(
            d.get("action") == "request_confirmation"
            for d in p.decisions[-3:]
        )
        players_out.append({
            "player_id": p.player_id,
            "display_name": p.display_name,
            "role": p.role,
            "connected": p.connected,
            "messages_received": len(p.received_message_ids),
            "decisions_made": len(p.decisions),
            "pending_confirmation": pending_confirmation,
        })

    return {
        "session_id": session_id,
        "status": session.status.value,
        "jamming_level": session.jamming_level,
        "elapsed_seconds": (
            time.time() - session.started_at
            if session.started_at and session.status == SessionStatus.RUNNING
            else session.elapsed_seconds
        ),
        "players": players_out,
    }


def dismiss_confirmation(session_id: str, player_id: str) -> bool:
    """
    Fix 5: clear the pending_confirmation flag for a player by overwriting the
    'action' field on all recent request_confirmation decisions to None.
    Returns True if anything was cleared.
    """
    session = _sessions.get(session_id)
    if not session or player_id not in session.players:
        return False
    player = session.players[player_id]
    cleared = False
    for d in player.decisions[-3:]:
        if d.get("action") == "request_confirmation":
            d["action"] = None
            cleared = True
    if cleared:
        logger.info("Confirmation dismissed for player %s in session %s", player_id, session_id)
    return cleared


def record_decision(
    session_id: str,
    player_id: str,
    text: str,
    decision_point_id: Optional[str],
    action: Optional[str] = None,
) -> dict:
    """
    Bug C: time_to_decide uses dp_fired_at[dp_id] (actual server fire time),
           never negative, null if DP hasn't fired yet.
    """
    session = _sessions[session_id]
    player = session.players[player_id]
    now = time.time()

    last_5 = player.delivered_messages[-5:] if player.delivered_messages else []
    dropped_ids = list(player.dropped_message_ids)

    # Bug C: find the best DP to attach this decision to
    # Use provided decision_point_id only if it has actually fired for this player.
    # If provided ID hasn't fired, fall back to the most recent unfired DP that has fired.
    time_to_decide: Optional[float] = None
    resolved_dp_id = decision_point_id

    if decision_point_id and decision_point_id in player.dp_fired_at:
        fired_at = player.dp_fired_at[decision_point_id]
        ttd = round(now - fired_at, 1)
        time_to_decide = ttd if ttd >= 0 else None   # never negative
    elif not decision_point_id:
        # Preset button with no specific DP — attach to most recent fired unanswered DP
        for dp_id, fired_at in sorted(
            player.dp_fired_at.items(), key=lambda kv: kv[1], reverse=True
        ):
            if dp_id not in player.dp_answered_ids:
                resolved_dp_id = dp_id
                ttd = round(now - fired_at, 1)
                time_to_decide = ttd if ttd >= 0 else None
                break

    # Fix 6: only the FIRST decision per DP counts — later ones get null dp + null ttd
    if resolved_dp_id and resolved_dp_id in player.dp_answered_ids:
        resolved_dp_id = None
        time_to_decide = None

    # Mark this DP as answered (first time only — above guard makes sure)
    if resolved_dp_id:
        if resolved_dp_id not in player.dp_answered_ids:
            player.dp_answered_ids.append(resolved_dp_id)

    decision: dict[str, Any] = {
        "text": text,
        "decision_point_id": resolved_dp_id,
        "action": action,
        "timestamp": now,
        "last_5_messages": last_5,
        "dropped_message_ids": dropped_ids,
        "time_to_decide_seconds": time_to_decide,
    }
    player.decisions.append(decision)

    log_event(
        session_id, player_id, EventType.DECISION,
        {
            "text": text,
            "decision_point_id": resolved_dp_id,
            "action": action,
            "last_5_messages": last_5,
            "dropped_message_ids": dropped_ids,
            "time_to_decide_seconds": time_to_decide,
            "visible_info_count": len(player.visible_info_snapshot),
        },
        None,
    )
    return decision
