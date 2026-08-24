from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_session
from core.deps import get_client
from core.redis_client import Cache, get_cache
from services.analytics.lineup_service import LineupService
from services.sleeper.client import SleeperAPIError, SleeperClient

router = APIRouter()


class LineupRequest(BaseModel):
    league_id: str = Field(min_length=1)
    roster_id: int
    week: int | None = Field(default=None, ge=1, le=25)


async def get_lineup_service(
    client: SleeperClient = Depends(get_client),
    cache: Cache = Depends(get_cache),
) -> LineupService:
    return LineupService(client, cache)


@router.post("/optimizer/lineup")
async def optimize_lineup(
    body: LineupRequest,
    session: AsyncSession = Depends(get_session),
    service: LineupService = Depends(get_lineup_service),
) -> dict[str, Any]:
    try:
        return await service.analyze_roster(session, body.league_id, body.roster_id, body.week)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SleeperAPIError as exc:
        status = exc.status_code or 502
        raise HTTPException(status_code=status if status < 500 else 502, detail=str(exc)) from exc


@router.get("/leagues/{league_id}/analytics/{week}")
async def matchup_analytics(
    league_id: str,
    week: int,
    session: AsyncSession = Depends(get_session),
    service: LineupService = Depends(get_lineup_service),
) -> dict[str, Any]:
    try:
        return await service.analyze_matchups(session, league_id, week)
    except SleeperAPIError as exc:
        status = exc.status_code or 502
        raise HTTPException(status_code=status if status < 500 else 502, detail=str(exc)) from exc
