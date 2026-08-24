from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.models import QualitativeBeatIntel, SleeperPlayer
from core.redis_client import Cache
from services.analytics.nflverse import PLAYERS_URL, _i

INJURIES_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/injuries/"
    "injuries_{season}.csv"
)

HIGH = {"Out", "IR", "Doubtful", "Injured Reserve"}
MODERATE = {"Questionable", "Limited Participation in Practice", "Did Not Participate In Practice"}


def classify_impact(report_status: str, practice_status: str) -> str:
    blob = f"{report_status} {practice_status}".strip()
    if any(tag.lower() in blob.lower() for tag in HIGH):
        return "High"
    if any(tag.lower() in blob.lower() for tag in MODERATE):
        return "Moderate"
    if "Full Participation" in practice_status:
        return "Low"
    return "Low"


def practice_code(practice_status: str) -> str | None:
    text = practice_status.lower()
    if "did not participate" in text:
        return "DNP"
    if "limited" in text:
        return "LP"
    if "full participation" in text:
        return "FP"
    return None


def format_report(row: dict[str, str]) -> str:
    name = row.get("full_name") or "Unknown"
    team = row.get("team") or "?"
    week = row.get("week") or "?"
    status = row.get("report_status") or "undated"
    practice = row.get("practice_status") or "no practice tag"
    injury = row.get("report_primary_injury") or row.get("practice_primary_injury") or "unspecified"
    return (
        f"{name} ({team}, week {week}): {status or 'no game status'}, "
        f"practice {practice}, injury {injury}."
    )


class BeatRetriever:
    def __init__(self, cache: Cache) -> None:
        self.cache = cache
        self.settings = get_settings()

    async def ingest(self, session: AsyncSession, season: str) -> dict[str, Any]:
        cache_key = f"beat:ingest:{season}"
        cached = await self.cache.get_json(cache_key)
        if cached:
            return cached

        year = int(season)
        rows = await _csv(INJURIES_URL.format(season=year))
        used_season = year
        if not rows:
            used_season = year - 1
            rows = await _csv(INJURIES_URL.format(season=used_season))
        ids_rows = await _csv(PLAYERS_URL)
        gsis_to_sleeper = {
            (row.get("gsis_id") or "").strip(): (row.get("sleeper_id") or "").strip()
            for row in ids_rows
            if row.get("gsis_id") and row.get("sleeper_id")
        }
        known = set(
            (await session.execute(select(SleeperPlayer.player_id))).scalars().all()
        )

        # Prefer the latest week per player.
        latest: dict[str, dict[str, str]] = {}
        for row in rows:
            gsis = (row.get("gsis_id") or "").strip()
            sleeper_id = gsis_to_sleeper.get(gsis)
            if not sleeper_id or sleeper_id not in known:
                continue
            week = _i(row, "week") or 0
            prev = latest.get(sleeper_id)
            if prev is None or (_i(prev, "week") or 0) <= week:
                latest[sleeper_id] = row

        await session.execute(
            delete(QualitativeBeatIntel).where(QualitativeBeatIntel.source == "nflverse_injuries")
        )
        inserted = 0
        now = datetime.now(timezone.utc)
        for sleeper_id, row in latest.items():
            report_status = row.get("report_status") or ""
            practice_status = row.get("practice_status") or ""
            if not report_status and not practice_status:
                continue
            session.add(
                QualitativeBeatIntel(
                    player_id=sleeper_id,
                    source="nflverse_injuries",
                    report_text=format_report(row),
                    impact_level=classify_impact(report_status, practice_status),
                    practice_status=practice_code(practice_status),
                    created_at=now,
                )
            )
            inserted += 1

        # Sleeper player notes already in the catalog.
        sleeper_rows = (
            await session.execute(
                select(SleeperPlayer).where(SleeperPlayer.injury_status.is_not(None))
            )
        ).scalars().all()
        await session.execute(
            delete(QualitativeBeatIntel).where(QualitativeBeatIntel.source == "sleeper")
        )
        for player in sleeper_rows:
            note = (player.injury_notes or "").strip()
            status = player.injury_status or "listed"
            body = player.injury_body_part or "n/a"
            text = f"{player.full_name}: Sleeper status {status}, {body}."
            if note:
                text += f" {note[:240]}"
            session.add(
                QualitativeBeatIntel(
                    player_id=player.player_id,
                    source="sleeper",
                    report_text=text,
                    impact_level=classify_impact(status, ""),
                    practice_status=None,
                    created_at=now,
                )
            )
            inserted += 1
        await session.commit()
        summary = {"count": inserted, "season": str(used_season), "players": len(latest)}
        await self.cache.set_json(cache_key, summary, ttl=self.settings.nflverse_ttl_seconds)
        return summary

    async def for_players(
        self, session: AsyncSession, player_ids: list[str], *, season: str
    ) -> list[dict[str, Any]]:
        unique = [pid for pid in dict.fromkeys(player_ids) if pid]
        if not unique:
            return []
        await self.ingest(session, season)
        result = await session.execute(
            select(QualitativeBeatIntel).where(QualitativeBeatIntel.player_id.in_(unique))
        )
        names = {
            row.player_id: row.full_name
            for row in (
                await session.execute(select(SleeperPlayer).where(SleeperPlayer.player_id.in_(unique)))
            ).scalars()
        }
        reports = []
        for intel in result.scalars():
            reports.append(
                {
                    "player_id": intel.player_id,
                    "full_name": names.get(intel.player_id),
                    "source": intel.source,
                    "report_text": intel.report_text,
                    "impact_level": intel.impact_level,
                    "practice_status": intel.practice_status,
                }
            )
        reports.sort(key=lambda item: {"High": 0, "Moderate": 1, "Low": 2}.get(item["impact_level"] or "", 3))
        return reports[:12]


async def _csv(url: str) -> list[dict[str, str]]:
    async with httpx.AsyncClient(
        timeout=60.0,
        follow_redirects=True,
        headers={"User-Agent": "GridironAI/0.1"},
    ) as client:
        response = await client.get(url)
        if response.status_code == 404:
            return []
        response.raise_for_status()
        return list(csv.DictReader(io.StringIO(response.text)))
