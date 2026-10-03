"""
BlackoutOps — Player Router
REST endpoints for joining sessions and submitting decisions.
WebSocket endpoint for real-time message delivery.

P2: record_decision no longer takes db param.
P4+P5: DecisionPayload includes action field, passed through.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session as DBSession 

import session_manager as sm
from models import DecisionPayload, JoinSessionRequest, JoinSessionResponse, get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/player", tags=["Player"])


@router.post("/sessions/{session_id}/join", response_model=JoinSessionResponse)
def join_session(session_id: str, req: JoinSessionRequest):
    session = sm.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    try:
        player = sm.add_player(session_id, req.display_name, req.role)
    except ValueError as e:
        raise HTTPException(400, str(e))

    scenario = sm._load_scenario(session.scenario_id)
    return JoinSessionResponse(
        player_id=player.player_id,
        token=player.player_id,  # token == player_id for MVP simplicity
        session_id=session_id,
        role=player.role,
        scenario_name=scenario.get("name", ""),
    )


@router.get("/sessions/{session_id}/scenario")
def get_scenario_map(session_id: str, player_id: str):
    """Return map data and decision points relevant to this player's role."""
    session = sm.get_session(session_id)
    if not session or player_id not in session.players:
        raise HTTPException(404, "Session or player not found")

    player = session.players[player_id]
    scenario = sm._load_scenario(session.scenario_id)

    dps = [
        dp for dp in scenario.get("decision_points", [])
        if player.role in dp.get("for_roles", [])
    ]

    return {
        "map": scenario.get("map", {}),
        "decision_points": dps,
        "role": player.role,
        "role_label": scenario.get("role_labels", {}).get(player.role, player.role),
        "scenario_name": scenario.get("name", ""),
    }


@router.post("/sessions/{session_id}/decision")
def submit_decision(
    session_id: str,
    player_id: str,
    req: DecisionPayload,
):
    # P2: no db param
    session = sm.get_session(session_id)
    if not session or player_id not in session.players:
        raise HTTPException(404, "Session or player not found")

    decision = sm.record_decision(
        session_id=session_id,
        player_id=player_id,
        text=req.text,
        decision_point_id=req.decision_point_id,
        action=req.action,  # P5
    )
    return {"recorded": True, "decision": decision}


@router.get("/sessions/{session_id}/roles")
def get_available_roles(session_id: str):
    """Return roles and which are already taken."""
    session = sm.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    scenario = sm._load_scenario(session.scenario_id)
    taken = {p.role for p in session.players.values()}
    labels = scenario.get("role_labels", {})

    return {
        "roles": [
            {
                "id": r,
                "label": labels.get(r, r),
                "taken": r in taken,
            }
            for r in scenario.get("roles", [])
        ]
    }


# WebSocket
@router.websocket("/ws/{session_id}/{player_id}")
async def player_websocket(session_id: str, player_id: str, ws: WebSocket):
    session = sm.get_session(session_id)
    if not session or player_id not in session.players:
        await ws.close(code=4004, reason="Player or session not found")
        return

    await sm.connect_player(session_id, player_id, ws)

    player = session.players[player_id]
    await ws.send_text(json.dumps({
        "type": "connected",
        "player_id": player_id,
        "role": player.role,
        "session_status": session.status.value,
        "jamming_level": session.jamming_level,
    }))

    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue

            if msg.get("type") == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))

            elif msg.get("type") == "share":
                text = msg.get("text", "")
                payload = {
                    "type": "share",
                    "from_role": player.role,
                    "from_name": player.display_name,
                    "text": text,
                }
                await sm.broadcast_to_session(session_id, payload, exclude=player_id)

    except WebSocketDisconnect:
        sm.disconnect_player(session_id, player_id)
        logger.info("Player %s WebSocket disconnected from session %s", player_id, session_id)
