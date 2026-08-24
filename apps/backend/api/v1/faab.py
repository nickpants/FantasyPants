from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_session
from core.deps import get_client
from core.redis_client import Cache, get_cache
from services.analytics.waiver_service import WaiverService
from services.sleeper.client import SleeperAPIError, SleeperClient

router = APIRouter()


class FaabRequest(BaseModel):
    league_id: str
    roster_id: int
    player_id: str
    week: int | None = Field(default=None, ge=1, le=25)


class TradeRequest(BaseModel):
    league_id: str
    give: list[str] = Field(default_factory=list)
    receive: list[str] = Field(default_factory=list)
    week: int | None = Field(default=None, ge=1, le=25)


async def get_waiver_service(
    client: SleeperClient = Depends(get_client),
    cache: Cache = Depends(get_cache),
) -> WaiverService:
    return WaiverService(client, cache)


def _http(exc: SleeperAPIError) -> HTTPException:
    status = exc.status_code or 502
    return HTTPException(status_code=status if status < 500 else 502, detail=str(exc))


@router.get("/leagues/{league_id}/compliance")
async def compliance(
    league_id: str,
    session: AsyncSession = Depends(get_session),
    service: WaiverService = Depends(get_waiver_service),
) -> dict[str, Any]:
    try:
        return await service.compliance(session, league_id)
    except SleeperAPIError as exc:
        raise _http(exc) from exc


@router.get("/leagues/{league_id}/waivers")
async def waivers(
    league_id: str,
    roster_id: int | None = None,
    week: int | None = None,
    session: AsyncSession = Depends(get_session),
    service: WaiverService = Depends(get_waiver_service),
) -> dict[str, Any]:
    try:
        return await service.board(session, league_id, roster_id, week)
    except SleeperAPIError as exc:
        raise _http(exc) from exc


@router.get("/leagues/{league_id}/trades")
async def trades(
    league_id: str,
    week: int | None = None,
    session: AsyncSession = Depends(get_session),
    service: WaiverService = Depends(get_waiver_service),
) -> dict[str, Any]:
    try:
        return await service.trade_desk(session, league_id, week)
    except SleeperAPIError as exc:
        raise _http(exc) from exc


@router.post("/optimizer/faab")
async def faab_bid(
    body: FaabRequest,
    session: AsyncSession = Depends(get_session),
    service: WaiverService = Depends(get_waiver_service),
) -> dict[str, Any]:
    try:
        return await service.bid_for_player(session, body.league_id, body.roster_id, body.player_id, body.week)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SleeperAPIError as exc:
        raise _http(exc) from exc


@router.post("/optimizer/trade")
async def trade_grade(
    body: TradeRequest,
    session: AsyncSession = Depends(get_session),
    service: WaiverService = Depends(get_waiver_service),
) -> dict[str, Any]:
    try:
        return await service.evaluate_trade(session, body.league_id, body.give, body.receive, body.week)
    except SleeperAPIError as exc:
        raise _http(exc) from exc
