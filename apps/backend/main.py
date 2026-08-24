from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.v1.copilot_chat import router as copilot_router
from api.v1.draft import router as draft_router
from api.v1.faab import router as faab_router
from api.v1.lineup import router as lineup_router
from api.v1.sleeper_sync import router as sleeper_router
from core.config import get_settings
from core.database import init_db
from core.deps import set_client
from core.redis_client import close_cache, get_cache
from services.sleeper.client import SleeperClient

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    await get_cache()
    client = SleeperClient(
        base_url=settings.sleeper_base_url,
        rate_limit_per_minute=settings.rate_limit_per_minute,
    )
    set_client(client)
    yield
    await client.aclose()
    set_client(None)
    await close_cache()


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://([a-z0-9-]+\.)*(grok\.me|grok\.com)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(sleeper_router, prefix="/api/v1")
app.include_router(lineup_router, prefix="/api/v1")
app.include_router(faab_router, prefix="/api/v1")
app.include_router(copilot_router, prefix="/api/v1")
app.include_router(draft_router, prefix="/api/v1")


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": settings.app_name, "docs": "/docs"}


@app.get("/health")
@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "name": settings.app_name}
