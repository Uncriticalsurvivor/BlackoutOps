"""
BlackoutOps — Data Models
Pydantic v2 schemas for API validation + SQLAlchemy ORM for persistence.

P1: InjectMessageRequest extended with conflicting_text / outdated_text.
P4: DecisionPayload extended with action field.
P5: action field supports 'request_confirmation'.
"""

from __future__ import annotations
import time
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import create_engine, Column, String, Float, Text, Integer
from sqlalchemy.orm import DeclarativeBase, Session

# SQLite setup
DATABASE_URL = "sqlite:///./blackoutops.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


class Base(DeclarativeBase):
    pass


class EventORM(Base):
    """Persistent log of every game event (messages + decisions)."""
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, index=True, nullable=False)
    player_id = Column(String, nullable=False)
    event_type = Column(String, nullable=False)   # see EventType enum
    payload = Column(Text, nullable=False)         # JSON-encoded dict
    degradation_mode = Column(String, nullable=True)
    timestamp = Column(Float, nullable=False, default=time.time)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db():
    db = Session(engine)
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class DegradationMode(str, Enum):
    NONE = "none"
    DELAY = "delay"
    DROPOUT = "dropout"
    CONFLICTING = "conflicting"
    OUTDATED = "outdated"


class SessionStatus(str, Enum):
    LOBBY = "lobby"
    RUNNING = "running"
    PAUSED = "paused"
    ENDED = "ended"


class EventType(str, Enum):
    MESSAGE_QUEUED = "message_queued"
    MESSAGE_DELIVERED = "message_delivered"
    MESSAGE_DROPPED = "message_dropped"
    DECISION = "decision"
    SHARE = "share"
    SESSION_START = "session_start"
    SESSION_PAUSE = "session_pause"
    SESSION_END = "session_end"
    INJECT = "inject"


# Pydantic v2 schemas — API request / response
class CreateSessionRequest(BaseModel):
    scenario_id: str = Field(..., examples=["op_black_ridge"])
    jamming_level: int = Field(50, ge=0, le=100)


class CreateSessionResponse(BaseModel):
    session_id: str
    instructor_token: str
    join_url: str


class JoinSessionRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=30)
    role: str = Field(..., examples=["alpha_lead"])


class JoinSessionResponse(BaseModel):
    player_id: str
    token: str
    session_id: str
    role: str
    scenario_name: str


class InjectMessageRequest(BaseModel):
    """
    P1: Added conflicting_text and outdated_text optional fields.
    When present and distinct from text, these are used as degradation variants.
    """
    text: str = Field(..., min_length=1, max_length=500)
    to: List[str] = Field(..., description="List of role ids to send to")
    apply_degradation: bool = True
    conflicting_text: Optional[str] = Field(None, max_length=500)
    outdated_text: Optional[str] = Field(None, max_length=500)


class SetJammingRequest(BaseModel):
    jamming_level: int = Field(..., ge=0, le=100)


class DecisionPayload(BaseModel):
    """
    P4+P5: added action field (preset actions including 'request_confirmation').
    """
    text: str = Field(..., min_length=1, max_length=1000)
    decision_point_id: Optional[str] = None
    action: Optional[str] = None   # P5: 'advance', 'hold', 'request_confirmation', or None


# In-memory player / session state (mutable — use model_config)
class PlayerState(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    player_id: str
    display_name: str
    role: str
    connected: bool = False
    received_message_ids: List[str] = Field(default_factory=list)
    # P4: track delivered message details for decision context
    delivered_messages: List[Dict[str, Any]] = Field(default_factory=list)
    # P4: track dropped message IDs server-side
    dropped_message_ids: List[str] = Field(default_factory=list)
    decisions: List[Dict[str, Any]] = Field(default_factory=list)
    visible_info_snapshot: List[Dict[str, Any]] = Field(default_factory=list)
    # Bug C: track when each decision point fired for this player {dp_id: fired_at}
    dp_fired_at: Dict[str, float] = Field(default_factory=dict)
    # Bug C: track which DPs this player has already answered
    dp_answered_ids: List[str] = Field(default_factory=list)


class SessionState(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    session_id: str
    instructor_token: str
    scenario_id: str
    jamming_level: int = 50
    status: SessionStatus = SessionStatus.LOBBY
    started_at: Optional[float] = None
    paused_at: Optional[float] = None
    elapsed_seconds: float = 0.0
    players: Dict[str, PlayerState] = Field(default_factory=dict)
