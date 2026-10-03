"""
BlackoutOps — Instructor Router
Handles session creation, control, and live-state queries.

P2: start/end no longer pass db — session_manager handles its own sessions.
P1: inject endpoint passes conflicting_text / outdated_text.
P6: pause endpoint removed.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

import session_manager as sm
from models import (
    CreateSessionRequest,
    CreateSessionResponse,
    InjectMessageRequest,
    SetJammingRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/instructor", tags=["Instructor"])


def _verify_instructor(session_id: str, token: str):
    session = sm.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session.instructor_token != token:
        raise HTTPException(403, "Invalid instructor token")
    return session


# Session lifecycle
@router.post("/sessions", response_model=CreateSessionResponse)
def create_session(req: CreateSessionRequest):
    try:
        state = sm.create_session(req.scenario_id, req.jamming_level)
    except FileNotFoundError:
        raise HTTPException(404, f"Scenario '{req.scenario_id}' not found")
    return CreateSessionResponse(
        session_id=state.session_id,
        instructor_token=state.instructor_token,
        join_url=f"/join/{state.session_id}",
    )


@router.post("/sessions/{session_id}/start")
async def start_session(session_id: str, token: str, allow_partial: bool = False):
    """
    Bug A: returns 409 with unfilled_roles list if any scenario role has no player.
    Pass allow_partial=true to start anyway (e.g. "start anyway" button in UI).
    """
    _verify_instructor(session_id, token)
    result = await sm.start_session(session_id, allow_partial=allow_partial)
    if not result.get("ok"):
        from fastapi import HTTPException
        raise HTTPException(
            status_code=409,
            detail={
                "error": "unfilled_roles",
                "unfilled_roles": result.get("unfilled_roles", []),
                "message": "Not all scenario roles have a joined player. Pass allow_partial=true to start anyway.",
            }
        )
    return {"status": "running"}


@router.post("/sessions/{session_id}/end")
async def end_session(session_id: str, token: str):
    # P2: no db param
    _verify_instructor(session_id, token)
    await sm.end_session(session_id)
    return {"status": "ended"}


@router.post("/sessions/{session_id}/jamming")
def set_jamming(session_id: str, token: str, req: SetJammingRequest):
    session = _verify_instructor(session_id, token)
    session.jamming_level = req.jamming_level
    return {"jamming_level": session.jamming_level}


@router.post("/sessions/{session_id}/inject")
async def inject_message(
    session_id: str,
    token: str,
    req: InjectMessageRequest,
):
    # P1: pass conflicting_text / outdated_text; P2: no db param
    _verify_instructor(session_id, token)
    await sm.inject_message(
        session_id=session_id,
        text=req.text,
        to_roles=req.to,
        apply_degradation=req.apply_degradation,
        conflicting_text=req.conflicting_text,
        outdated_text=req.outdated_text,
    )
    return {"injected": True}


# Live view
@router.get("/sessions/{session_id}/state")
def get_session_state(session_id: str, token: str):
    _verify_instructor(session_id, token)
    state = sm.get_instructor_state(session_id)
    return state


@router.get("/sessions/{session_id}/readiness")
def get_readiness(session_id: str, token: str):
    """Bug A: returns unfilled scenario roles so the UI can warn before START."""
    _verify_instructor(session_id, token)
    unfilled = sm.get_unfilled_roles(session_id)
    return {"ready": len(unfilled) == 0, "unfilled_roles": unfilled}


@router.post("/sessions/{session_id}/dismiss/{player_id}")
def dismiss_confirmation(session_id: str, player_id: str, token: str):
    """Fix 5: instructor manually dismisses a player's pending confirmation badge."""
    _verify_instructor(session_id, token)
    cleared = sm.dismiss_confirmation(session_id, player_id)
    return {"dismissed": cleared}


@router.get("/sessions")
def list_sessions():
    return sm.get_all_sessions_summary()


@router.get("/scenarios")
def list_scenarios():
    return sm.list_scenarios()
