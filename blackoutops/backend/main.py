"""
BlackoutOps — FastAPI Application Entry Point

Wires together all routers, initialises the database,
and mounts the WebSocket endpoint.
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from models import init_db
from routers.instructor import router as instructor_router
from routers.player import router as player_router
from routers.aar import router as aar_router

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)

# App
app = FastAPI(
    title="BlackoutOps API",
    description="Degraded-communications multiplayer training platform.",
    version="0.1.0",
)

# Allow all origins for local development (restrict in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Startup
@app.on_event("startup")
def on_startup():
    init_db()
    logging.getLogger(__name__).info("BlackoutOps backend started — DB initialised")


# Routers
app.include_router(instructor_router)
app.include_router(player_router)
app.include_router(aar_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "BlackoutOps"}
