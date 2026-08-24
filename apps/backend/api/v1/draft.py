from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_session
from core.deps import get_client
from core.redis_client import Cache, get_cache
from services.analytics.draft_service import DraftService
from services.sleeper.client import SleeperAPIError, SleeperClient

router = APIRouter()


async def get_draft_service(
    client: SleeperClient = Depends(get_client),
    cache: Cache = Depends(get_cache),
) -> DraftService:
    return DraftService(client, cache)


@router.get("/leagues/{league_id}/draft")
async def league_draft(
    league_id: str,
    sleeper_user_id: str | None = Query(default=None),
    roster_id: int | None = Query(default=None),
    draft_id: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    service: DraftService = Depends(get_draft_service),
) -> dict[str, Any]:
    try:
        return await service.board(
            session,
            league_id,
            sleeper_user_id=sleeper_user_id,
            roster_id=roster_id,
            draft_id=draft_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SleeperAPIError as exc:
        status = exc.status_code or 502
        raise HTTPException(status_code=status if status < 500 else 502, detail=str(exc)) from exc
