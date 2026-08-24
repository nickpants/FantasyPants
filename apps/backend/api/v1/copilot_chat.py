from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from agents.llm import llm_configured, persist_xai_key
from agents.orchestrator import run_debate, run_trade_debate
from core.config import get_settings
from core.database import get_session
from core.deps import get_client
from core.redis_client import Cache, get_cache
from services.analytics.lineup_service import LineupService
from services.analytics.waiver_service import WaiverService
from services.rag.beat_retriever import BeatRetriever
from services.sleeper.client import SleeperAPIError, SleeperClient

router = APIRouter()


class CopilotRequest(BaseModel):
    league_id: str
    roster_id: int
    week: int | None = Field(default=None, ge=1, le=25)
    question: str | None = None
    give: list[str] = Field(default_factory=list)
    receive: list[str] = Field(default_factory=list)


class ConfigureRequest(BaseModel):
    api_key: str = Field(min_length=8, max_length=200)


def _sse(payload: dict[str, Any]) -> str:
    return f"event: {payload['type']}\ndata: {json.dumps(payload)}\n\n"


async def get_lineup_service(
    client: SleeperClient = Depends(get_client),
    cache: Cache = Depends(get_cache),
) -> LineupService:
    return LineupService(client, cache)


async def get_waiver_service(
    client: SleeperClient = Depends(get_client),
    cache: Cache = Depends(get_cache),
) -> WaiverService:
    return WaiverService(client, cache)


async def get_beat(cache: Cache = Depends(get_cache)) -> BeatRetriever:
    return BeatRetriever(cache)


@router.get("/copilot/status")
async def copilot_status() -> dict[str, Any]:
    settings = get_settings()
    return {
        "configured": llm_configured(),
        "model": settings.xai_model,
        "provider": "SpaceXAI",
        "base_url": settings.xai_base_url,
    }


@router.post("/copilot/configure")
async def copilot_configure(body: ConfigureRequest) -> dict[str, Any]:
    try:
        persist_xai_key(body.api_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "configured": llm_configured(),
        "model": get_settings().xai_model,
        "provider": "SpaceXAI",
    }


@router.post("/copilot/stream")
async def copilot_stream(
    body: CopilotRequest,
    session: AsyncSession = Depends(get_session),
    lineup_service: LineupService = Depends(get_lineup_service),
    waiver_service: WaiverService = Depends(get_waiver_service),
    beat: BeatRetriever = Depends(get_beat),
) -> StreamingResponse:
    async def generate() -> AsyncIterator[str]:
        try:
            async for event in _run_copilot(
                body, session, lineup_service, waiver_service, beat
            ):
                yield _sse(event)
        except KeyError as exc:
            yield _sse({"type": "error", "detail": str(exc)})
        except SleeperAPIError as exc:
            yield _sse({"type": "error", "detail": str(exc)})
        except Exception as exc:  # noqa: BLE001
            yield _sse({"type": "error", "detail": f"Copilot failed: {exc}"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/copilot/chat")
async def copilot_chat(
    body: CopilotRequest,
    session: AsyncSession = Depends(get_session),
    lineup_service: LineupService = Depends(get_lineup_service),
    waiver_service: WaiverService = Depends(get_waiver_service),
    beat: BeatRetriever = Depends(get_beat),
) -> dict[str, Any]:
    agents: dict[str, str] = {}
    meta: dict[str, Any] = {}
    try:
        async for event in _run_copilot(body, session, lineup_service, waiver_service, beat):
            if event["type"] == "status":
                meta = event
            elif event["type"] == "agent":
                agents[event["agent"]] = event["text"]
            elif event["type"] == "error":
                raise HTTPException(status_code=400, detail=event.get("detail") or "Copilot failed")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SleeperAPIError as exc:
        status = exc.status_code or 502
        raise HTTPException(status_code=status if status < 500 else 502, detail=str(exc)) from exc
    return {
        "configured": llm_configured(),
        "model": get_settings().xai_model,
        "source": meta.get("source"),
        "bias": meta.get("bias"),
        "agents": agents,
    }


def _flags_for(compliance: dict[str, Any], roster_id: int) -> list[dict[str, Any]]:
    for row in compliance.get("compliance") or []:
        if row.get("roster_id") == roster_id:
            return row.get("flags") or []
    return []


def _ids_from_lineup(lineup: dict[str, Any]) -> list[str]:
    ids = []
    for side in (lineup.get("current"), lineup.get("optimal")):
        for slot in (side or {}).get("slots") or []:
            pid = (slot.get("player") or {}).get("player_id")
            if pid:
                ids.append(pid)
    return ids


async def _run_copilot(
    body: CopilotRequest,
    session,
    lineup_service: LineupService,
    waiver_service: WaiverService,
    beat: BeatRetriever,
):
    compliance = await waiver_service.compliance(session, body.league_id)
    flags = _flags_for(compliance, body.roster_id)
    if body.give or body.receive:
        grade = await waiver_service.evaluate_trade(
            session, body.league_id, body.give, body.receive, body.week
        )
        detail = await waiver_service.sync.sync_league(session, body.league_id)
        roster = next((item for item in detail["rosters"] if item["roster_id"] == body.roster_id), None)
        remaining = None
        if roster:
            remaining = max(
                0,
                int(roster.get("total_faab") or 100) - int(roster.get("waiver_budget_used") or 0),
            )
        wp = None
        try:
            lineup = await lineup_service.analyze_roster(
                session, body.league_id, body.roster_id, body.week
            )
            wp = (lineup.get("opponent") or {}).get("win_probability")
        except Exception:
            wp = None
        intel = await beat.for_players(
            session,
            [p.get("player_id") for p in (grade.get("give") or []) + (grade.get("receive") or [])],
            season=str(grade.get("season") or ""),
        )
        yield {"type": "context", "topic": "trade", "grade": grade.get("grade")}
        async for event in run_trade_debate(
            grade,
            flags=flags,
            beat_intel=intel,
            remaining_faab=remaining,
            win_probability=wp,
            question=body.question,
        ):
            yield event
        return

    lineup = await lineup_service.analyze_roster(session, body.league_id, body.roster_id, body.week)
    intel = await beat.for_players(
        session, _ids_from_lineup(lineup), season=str(lineup.get("season") or "")
    )
    yield {"type": "context", "bias": None, "team_name": lineup.get("team_name")}
    async for event in run_debate(lineup, flags, body.question, intel):
        yield event
