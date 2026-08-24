from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_session
from core.deps import get_client
from core.redis_client import Cache, get_cache
from services.analytics.scoring_engine import summarize_scoring
from services.sleeper.client import SleeperAPIError, SleeperClient
from services.sleeper.sync_manager import SyncManager

router = APIRouter()


class SyncUserRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)


class RefreshPlayersRequest(BaseModel):
    force: bool = False


async def get_sleeper_client() -> SleeperClient:
    return get_client()


async def get_sync_manager(
    client: SleeperClient = Depends(get_sleeper_client),
    cache: Cache = Depends(get_cache),
) -> SyncManager:
    return SyncManager(client, cache)


@router.get("/health")
async def health(cache: Cache = Depends(get_cache)) -> dict[str, Any]:
    return {"ok": True, "cache": "redis" if cache.is_redis else "memory"}


@router.get("/state/nfl")
async def nfl_state(sync: SyncManager = Depends(get_sync_manager)) -> dict[str, Any]:
    return await sync.nfl_state()


@router.post("/sync/sleeper")
async def sync_sleeper_user(
    body: SyncUserRequest,
    session: AsyncSession = Depends(get_session),
    sync: SyncManager = Depends(get_sync_manager),
) -> dict[str, Any]:
    try:
        result = await sync.sync_user(session, body.username.strip())
    except SleeperAPIError as exc:
        status = exc.status_code or 502
        raise HTTPException(status_code=status if status < 500 else 502, detail=str(exc)) from exc
    for league in result["leagues"]:
        league["scoring_summary"] = summarize_scoring(league.get("scoring_settings") or {})
    return result


@router.post("/sync/sleeper/{league_id}")
async def sync_league(
    league_id: str,
    session: AsyncSession = Depends(get_session),
    sync: SyncManager = Depends(get_sync_manager),
) -> dict[str, Any]:
    try:
        return await sync.sync_league(session, league_id)
    except SleeperAPIError as exc:
        status = exc.status_code or 502
        raise HTTPException(status_code=status if status < 500 else 502, detail=str(exc)) from exc


@router.get("/leagues/{league_id}")
async def get_league(
    league_id: str,
    session: AsyncSession = Depends(get_session),
    sync: SyncManager = Depends(get_sync_manager),
) -> dict[str, Any]:
    try:
        payload = await sync.sync_league(session, league_id)
    except SleeperAPIError as exc:
        status = exc.status_code or 502
        raise HTTPException(status_code=status if status < 500 else 502, detail=str(exc)) from exc
    payload["league"]["scoring_summary"] = summarize_scoring(
        payload["league"].get("scoring_settings") or {}
    )
    return payload


@router.get("/leagues/{league_id}/matchups/{week}")
async def get_matchups(
    league_id: str,
    week: int,
    session: AsyncSession = Depends(get_session),
    sync: SyncManager = Depends(get_sync_manager),
) -> dict[str, Any]:
    try:
        matchups = await sync.sync_matchups(session, league_id, week)
    except SleeperAPIError as exc:
        status = exc.status_code or 502
        raise HTTPException(status_code=status if status < 500 else 502, detail=str(exc)) from exc
    return {"league_id": league_id, "week": week, "matchups": matchups}


@router.post("/sync/players")
async def refresh_players(
    body: RefreshPlayersRequest,
    session: AsyncSession = Depends(get_session),
    sync: SyncManager = Depends(get_sync_manager),
) -> dict[str, Any]:
    return await sync.players.refresh(session, force=body.force)
