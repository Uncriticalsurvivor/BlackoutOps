"""
BlackoutOps — AAR Router
After-Action Review endpoints: timeline, scoring, and JSON export.

Bug D: merge MESSAGE_QUEUED + MESSAGE_DELIVERED + MESSAGE_DROPPED into one
       row per (message_id, player_id). Each merged row carries:
       - original_text  (always from QUEUED event)
       - received_text  (from DELIVERED; absent for DROPPED)
       - degradation_mode
       - sent_at / arrived_at / delayed_by (for DELAYED mode)
       - dropped: True for DROPPED messages

P4: decision events in timeline include last_5_messages, dropped_message_ids,
    time_to_decide_seconds.
P5: per-player flags for acted-on-conflicting-without-confirmation pattern.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

import session_manager as sm
from models import EventORM, EventType, get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/aar", tags=["AAR"])


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------
_SCORE_MAP = {
    "none": "complete",
    "delay": "delayed",
    "conflicting": "conflicting",
    "outdated": "outdated",
    "dropout": "no_info",
}


def _score_label(degradation_mode: str | None) -> str:
    return _SCORE_MAP.get(degradation_mode or "none", "complete")


def _compute_scores(events: list[EventORM]) -> dict[str, Any]:
    player_stats: dict[str, dict] = defaultdict(lambda: {
        "decisions": 0,
        "complete": 0,
        "delayed": 0,
        "conflicting": 0,
        "outdated": 0,
        "no_info": 0,
        "messages_received": 0,
        "messages_dropped": 0,
    })

    for ev in events:
        # Fix 2: exclude instructor pseudo-player from score cards
        if ev.player_id == "instructor":
            continue
        stats = player_stats[ev.player_id]
        if ev.event_type == EventType.DECISION.value:
            stats["decisions"] += 1
        elif ev.event_type == EventType.MESSAGE_DELIVERED.value:
            stats["messages_received"] += 1
            label = _score_label(ev.degradation_mode)
            stats[label] = stats.get(label, 0) + 1
        elif ev.event_type == EventType.MESSAGE_DROPPED.value:
            # Fix 1: dropped messages count as no_info in the score bar
            stats["messages_dropped"] += 1
            stats["no_info"] += 1

    return dict(player_stats)


_DEGRADED_MODES = {"delay", "conflicting", "outdated"}


def _compute_confirmation_flags(events: list[EventORM]) -> dict[str, dict]:
    """
    Rule-based flags per player, evaluated on EVERY decision independently.

    For each DECISION event:
      1. Inspect last_5_messages stored in the decision's payload.
      2. If at least one has degradation_mode in {delay, conflicting, outdated},
         the decision counts as "after degraded info".
      3. action == "request_confirmation" → requested_confirmation_after_degraded += 1
         any other action                 → acted_on_degraded_without_confirmation  += 1
      4. Decisions with no degraded message in context count in neither bucket.

    decision_point_id and time_to_decide are ignored.
    Instructor pseudo-player is always excluded.
    """
    flags: dict[str, dict] = {}
    player_decisions: dict[str, list[dict]] = defaultdict(list)

    for ev in sorted(events, key=lambda e: e.timestamp):
        if ev.player_id == "instructor":
            continue
        if ev.event_type != EventType.DECISION.value:
            continue
        try:
            payload = json.loads(ev.payload)
        except Exception:
            payload = {}
        player_decisions[ev.player_id].append(payload)

    for pid, decisions in player_decisions.items():
        acted = 0
        requested = 0

        for dec in decisions:
            last_5 = dec.get("last_5_messages") or []
            has_degraded = any(
                str(m.get("degradation_mode") or "none").lower() in _DEGRADED_MODES
                for m in last_5
            )
            if not has_degraded:
                continue  # context was clear — counts in neither bucket

            action = (dec.get("action") or "").strip().lower()
            if action == "request_confirmation":
                requested += 1
            else:
                acted += 1

        flags[pid] = {
            "decided_on_degraded_without_confirming": acted,
            "requested_confirmation_after_degraded": requested,
        }

    return flags


def _build_merged_timeline(events: list[EventORM]) -> list[dict]:
    """
    Bug D: merge QUEUED + DELIVERED + DROPPED per (player_id, message_id) into
    one 'message' row. Non-message events (decisions, session_start, etc.) are
    passed through unchanged.
    """
    # First pass: collect queued/delivered/dropped events keyed by (pid, mid)
    # Key: (player_id, message_id)
    msg_buckets: dict[tuple[str, str], dict] = {}
    passthrough: list[dict] = []

    for ev in events:
        try:
            payload = json.loads(ev.payload)
        except Exception:
            payload = {}

        if ev.event_type == EventType.MESSAGE_QUEUED.value:
            mid = payload.get("message_id", "")
            key = (ev.player_id, mid)
            msg_buckets.setdefault(key, {
                "merged": True,
                "player_id": ev.player_id,
                "message_id": mid,
                "original_text": payload.get("original_text"),
                "received_text": None,
                "degradation_mode": ev.degradation_mode,
                "dropped": False,
                "sent_at": payload.get("sent_at", ev.timestamp),
                "arrived_at": None,
                "delayed_by": 0,
                "timestamp": ev.timestamp,
            })

        elif ev.event_type == EventType.MESSAGE_DELIVERED.value:
            mid = payload.get("message_id", "")
            key = (ev.player_id, mid)
            bucket = msg_buckets.setdefault(key, {
                "merged": True,
                "player_id": ev.player_id,
                "message_id": mid,
                "original_text": payload.get("original_text"),
                "received_text": None,
                "degradation_mode": ev.degradation_mode,
                "dropped": False,
                "sent_at": payload.get("sent_at", ev.timestamp),
                "arrived_at": None,
                "delayed_by": 0,
                "timestamp": ev.timestamp,
            })
            bucket["received_text"] = payload.get("text")
            if bucket["original_text"] is None:
                bucket["original_text"] = payload.get("original_text")
            bucket["degradation_mode"] = ev.degradation_mode
            bucket["arrived_at"] = payload.get("timestamp", ev.timestamp)
            bucket["delayed_by"] = payload.get("delayed_by", 0)
            bucket["timestamp"] = ev.timestamp   # use delivery time for sort

        elif ev.event_type == EventType.MESSAGE_DROPPED.value:
            mid = payload.get("message_id", "")
            key = (ev.player_id, mid)
            bucket = msg_buckets.setdefault(key, {
                "merged": True,
                "player_id": ev.player_id,
                "message_id": mid,
                "original_text": payload.get("original_text"),
                "received_text": None,
                "degradation_mode": "dropout",
                "dropped": True,
                "sent_at": ev.timestamp,
                "arrived_at": None,
                "delayed_by": 0,
                "timestamp": ev.timestamp,
            })
            bucket["dropped"] = True
            bucket["degradation_mode"] = "dropout"
            if payload.get("original_text"):
                bucket["original_text"] = payload["original_text"]

        else:
            passthrough.append({
                "id": ev.id,
                "player_id": ev.player_id,
                "event_type": ev.event_type,
                "degradation_mode": ev.degradation_mode,
                "timestamp": ev.timestamp,
                "payload": payload,
                "merged": False,
            })

    # Convert buckets to list items
    merged_msgs = []
    for (player_id, mid), b in msg_buckets.items():
        merged_msgs.append({
            "id": f"msg_{player_id}_{mid}",
            "player_id": b["player_id"],
            "event_type": "message",  # unified type for frontend
            "degradation_mode": b["degradation_mode"],
            "timestamp": b["timestamp"],
            "payload": {
                "message_id": b["message_id"],
                "original_text": b["original_text"],
                "received_text": b["received_text"],
                "dropped": b["dropped"],
                "sent_at": b["sent_at"],
                "arrived_at": b["arrived_at"],
                "delayed_by": b["delayed_by"],
            },
            "merged": True,
        })

    # Combine and sort chronologically
    all_events = passthrough + merged_msgs
    all_events.sort(key=lambda e: e.get("timestamp", 0))
    return all_events


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/{session_id}")
def get_aar(session_id: str, db: DBSession = Depends(get_db)):
    """Full AAR: merged timeline + per-player scores + P5 flags."""
    session = sm.get_session(session_id)

    stmt = select(EventORM).where(EventORM.session_id == session_id).order_by(EventORM.timestamp)
    events: list[EventORM] = db.execute(stmt).scalars().all()

    if not events and not session:
        raise HTTPException(404, "Session not found")

    timeline = _build_merged_timeline(events)   # Bug D
    scores = _compute_scores(events)
    confirmation_flags = _compute_confirmation_flags(events)

    player_labels: dict[str, str] = {}
    if session:
        for p in session.players.values():
            player_labels[p.player_id] = f"{p.display_name} ({p.role})"

    return {
        "session_id": session_id,
        "scenario_id": session.scenario_id if session else None,
        "status": session.status.value if session else "ended",
        "timeline": timeline,
        "scores": scores,
        "confirmation_flags": confirmation_flags,
        "player_labels": player_labels,
    }


@router.get("/{session_id}/export")
def export_aar_json(session_id: str, db: DBSession = Depends(get_db)):
    """Download the full AAR as a JSON file."""
    data = get_aar(session_id, db)
    headers = {
        "Content-Disposition": f'attachment; filename="aar_{session_id}.json"',
    }
    return JSONResponse(content=data, headers=headers)
