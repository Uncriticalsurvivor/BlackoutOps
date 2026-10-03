"""
BlackoutOps — Degradation Engine

Bug A: schedule_scenario_messages now takes get_player_id_fn(role)->Optional[str]
       instead of a static dict, so player resolution happens at dispatch time.
Bug A: Decision-point events are broadcast at fire time via broadcast_fn.
Bug B: dispatch_message logs the actual jamming level used (INFO).
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Awaitable, Callable, Optional

from models import DegradationMode, EventType

logger = logging.getLogger(__name__)


# Delay range configuration (seconds)
DELAY_MIN_SECONDS = 5
DELAY_MAX_SECONDS = 30


def pick_degradation_mode(jamming_level: int) -> DegradationMode:
    """
    Probabilistically select a degradation mode based on the jamming level.

    At jamming_level=0  → always NONE
    At jamming_level=100 → always degraded (one of the four modes)

    The four degraded modes are weighted:
        DROPOUT      35 %
        DELAY        30 %
        CONFLICTING  20 %
        OUTDATED     15 %
    """
    if random.randint(0, 99) >= jamming_level:
        return DegradationMode.NONE

    roll = random.random()
    if roll < 0.35:
        return DegradationMode.DROPOUT
    elif roll < 0.65:
        return DegradationMode.DELAY
    elif roll < 0.85:
        return DegradationMode.CONFLICTING
    else:
        return DegradationMode.OUTDATED


def apply_text_degradation(
    message: dict,
    mode: DegradationMode,
) -> Optional[dict]:
    """
    Transform a scenario message dict according to the degradation mode.

    If mode is CONFLICTING or OUTDATED but the message has no distinct variant
    (missing or equal to the original text), fall back to DELAY.

    Returns:
        None               — if message should be dropped (DROPOUT)
        mutated dict copy  — with text replaced and metadata appended
    """
    if mode == DegradationMode.DROPOUT:
        return None

    msg = dict(message)  # shallow copy
    original_text = msg.get("text", "")

    if mode == DegradationMode.CONFLICTING:
        variant = msg.get("conflicting_variant", "")
        if not variant or variant == original_text:
            logger.info(
                "CONFLICTING mode: no distinct variant for msg=%s — falling back to DELAY",
                msg.get("id")
            )
            mode = DegradationMode.DELAY
        else:
            msg["text"] = variant
            msg["_degraded"] = True
            msg["_mode"] = mode.value

    if mode == DegradationMode.OUTDATED:
        variant = msg.get("outdated_variant", "")
        if not variant or variant == original_text:
            logger.info(
                "OUTDATED mode: no distinct variant for msg=%s — falling back to DELAY",
                msg.get("id")
            )
            mode = DegradationMode.DELAY
        else:
            msg["text"] = variant
            msg["_degraded"] = True
            msg["_mode"] = mode.value
            msg["_outdated_warning"] = True

    if mode == DegradationMode.DELAY:
        msg["_degraded"] = True
        msg["_mode"] = mode.value
        msg["_delay_seconds"] = random.randint(DELAY_MIN_SECONDS, DELAY_MAX_SECONDS)
        msg["_applied_mode"] = mode.value

    if mode == DegradationMode.NONE:
        msg["_degraded"] = False
        msg["_mode"] = DegradationMode.NONE.value

    return msg


# Async delivery with delay support
async def dispatch_message(
    message: dict,
    player_id: str,
    role: str,
    get_jamming_fn: Callable[[], int],
    send_fn: Callable[[str, dict], Awaitable[None]],
    log_fn: Callable[[str, str, EventType, dict, Optional[str]], None],
    session_id: str,
) -> None:
    """
    Apply degradation and dispatch one message to one player.

    Bug B: logs actual jamming level used at INFO level.
    """
    # --- 1. Read current jamming level at dispatch time --------------------
    jamming_level = get_jamming_fn()
    mode = pick_degradation_mode(jamming_level)
    # Bug B: explicit INFO log with jamming level actually used
    logger.info(
        "dispatch | session=%s player=%s msg=%s mode=%s jam=%d%% [jamming_fn called at dispatch time]",
        session_id, player_id, message.get("id"), mode.value, jamming_level
    )

    # --- 2. Log the queuing event (always) --------------------------------
    log_fn(
        session_id, player_id,
        EventType.MESSAGE_QUEUED,
        {
            "message_id": message.get("id"),
            "original_text": message.get("text"),
            "sent_at": time.time(),
            "jamming_level_used": jamming_level,   # Bug B: auditable
        },
        mode.value,
    )

    # --- 3. DROPOUT — log and exit ----------------------------------------
    if mode == DegradationMode.DROPOUT:
        log_fn(
            session_id, player_id,
            EventType.MESSAGE_DROPPED,
            {
                "message_id": message.get("id"),
                "original_text": message.get("text"),   # Bug D: AAR needs original text
                "reason": "jamming_dropout",
                "jamming_level_used": jamming_level,
            },
            mode.value,
        )
        logger.info("Message %s DROPPED for player %s (jam=%d%%)", message.get("id"), player_id, jamming_level)
        return

    # --- 4. Apply text mutation (may change mode for fallback) ------------
    mutated = apply_text_degradation(message, mode)
    if mutated is None:
        return  # safety guard

    # Actual mode after potential fallback
    actual_mode_str = mutated.get("_applied_mode") or mutated.get("_mode") or mode.value
    try:
        actual_mode = DegradationMode(actual_mode_str)
    except ValueError:
        actual_mode = mode

    # --- 5. Handle delay --------------------------------------------------
    sent_at = time.time()
    delay = mutated.pop("_delay_seconds", 0)
    if delay:
        logger.info(
            "Message %s DELAYED %ds for player %s (jam=%d%%)",
            message.get("id"), delay, player_id, jamming_level
        )
        await asyncio.sleep(delay)

    # --- 6. Build WebSocket payload ----------------------------------------
    arrived_at = time.time()
    payload = {
        "type": "message",
        "message_id": mutated.get("id"),
        "category": mutated.get("category", "INFO"),
        "text": mutated.get("text"),
        "original_text": message.get("text"),    # Bug D: always include original
        "timestamp": arrived_at,
        "sent_at": sent_at,
        "degradation_mode": actual_mode.value,
        "degraded": mutated.get("_degraded", False),
        "outdated_warning": mutated.get("_outdated_warning", False),
        "delayed_by": delay if delay else 0,
    }

    # --- 7. Send ----------------------------------------------------------
    await send_fn(player_id, payload)

    # --- 8. Log delivery --------------------------------------------------
    log_fn(
        session_id, player_id,
        EventType.MESSAGE_DELIVERED,
        payload,
        actual_mode.value,
    )


async def schedule_scenario_messages(
    messages: list[dict],
    decision_points: list[dict],            # Bug C: needed for DP fire events
    get_player_id_fn: Callable[[str], Optional[str]],  # Bug A: callable, not static dict
    get_jamming_fn: Callable[[], int],
    send_fn: Callable,
    log_fn: Callable,
    broadcast_fn: Callable,                 # Bug C: broadcast DP events to players
    session_id: str,
    start_time: float,
    is_running_fn: Callable[[], bool],
    on_dp_fired: Callable[[str, str, float], None],  # Bug C: callback(dp_id, player_id, fired_at)
) -> None:
    """
    Main scheduler: runs scenario messages + decision-point events on timecodes.

    Bug A: get_player_id_fn(role) resolves player at dispatch time.
    Bug C: fires 'decision_point' WS events at the authored at_seconds offset.
    """
    # Sort all items (messages + DPs) by time
    sorted_msgs = sorted(messages, key=lambda m: m.get("at_seconds", 0))
    sorted_dps  = sorted(decision_points, key=lambda d: d.get("at_seconds", 0))

    tasks = []

    # Schedule message dispatches (Bug A: no pre-resolution)
    for msg in sorted_msgs:
        at_sec = msg.get("at_seconds", 0)
        target_roles = msg.get("to", [])

        for role in target_roles:
            tasks.append(
                _scheduled_dispatch(
                    offset_seconds=at_sec,
                    start_time=start_time,
                    message=msg,
                    role=role,
                    get_player_id_fn=get_player_id_fn,   # Bug A
                    get_jamming_fn=get_jamming_fn,
                    send_fn=send_fn,
                    log_fn=log_fn,
                    session_id=session_id,
                    is_running_fn=is_running_fn,
                )
            )

    # Bug C: Schedule decision-point fire events
    for dp in sorted_dps:
        tasks.append(
            _scheduled_dp_fire(
                offset_seconds=dp.get("at_seconds", 0),
                start_time=start_time,
                dp=dp,
                get_player_id_fn=get_player_id_fn,
                broadcast_fn=broadcast_fn,
                session_id=session_id,
                is_running_fn=is_running_fn,
                on_dp_fired=on_dp_fired,
            )
        )

    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def _scheduled_dispatch(
    offset_seconds: float,
    start_time: float,
    message: dict,
    role: str,
    get_player_id_fn: Callable[[str], Optional[str]],  # Bug A
    get_jamming_fn: Callable[[], int],
    send_fn: Callable,
    log_fn: Callable,
    session_id: str,
    is_running_fn: Callable,
) -> None:
    """Wait until offset_seconds past start_time, then resolve player and dispatch."""
    now = time.time()
    target_time = start_time + offset_seconds
    wait_for = target_time - now

    if wait_for > 0:
        slept = 0.0
        while slept < wait_for:
            if not is_running_fn():
                logger.info("Session stopped — aborting scheduled dispatch for role=%s", role)
                return
            chunk = min(0.5, wait_for - slept)
            await asyncio.sleep(chunk)
            slept += chunk

    if not is_running_fn():
        return

    # Bug A: resolve player_id at dispatch time, not at session start
    player_id = get_player_id_fn(role)
    if not player_id:
        logger.warning(
            "No player found for role=%s at dispatch time (msg=%s) — skipping",
            role, message.get("id")
        )
        return

    await dispatch_message(
        message=message,
        player_id=player_id,
        role=role,
        get_jamming_fn=get_jamming_fn,
        send_fn=send_fn,
        log_fn=log_fn,
        session_id=session_id,
    )


async def _scheduled_dp_fire(
    offset_seconds: float,
    start_time: float,
    dp: dict,
    get_player_id_fn: Callable[[str], Optional[str]],
    broadcast_fn: Callable,
    session_id: str,
    is_running_fn: Callable,
    on_dp_fired: Callable[[str, str, float], None],
) -> None:
    """Bug C: wait until the DP's at_seconds, then broadcast a decision_point event."""
    now = time.time()
    target_time = start_time + offset_seconds
    wait_for = target_time - now

    if wait_for > 0:
        slept = 0.0
        while slept < wait_for:
            if not is_running_fn():
                return
            chunk = min(0.5, wait_for - slept)
            await asyncio.sleep(chunk)
            slept += chunk

    if not is_running_fn():
        return

    fired_at = time.time()
    dp_id = dp.get("id")
    for_roles = dp.get("for_roles", [])

    for role in for_roles:
        player_id = get_player_id_fn(role)
        if player_id:
            # Record fired_at per player (Bug C)
            on_dp_fired(dp_id, player_id, fired_at)
            # Send WS event to that player only (via send_fn wrapper)
            await broadcast_fn(player_id, {
                "type": "decision_point",
                "dp_id": dp_id,
                "prompt": dp.get("prompt", ""),
                "fired_at": fired_at,
            })
            logger.info("DP %s fired for player %s (role=%s)", dp_id, player_id, role)
