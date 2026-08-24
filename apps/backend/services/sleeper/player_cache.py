from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.models import SleeperPlayer
from core.redis_client import Cache
from services.sleeper.client import SleeperClient

PLAYER_CACHE_KEY = "sleeper:players:nfl:meta"
PLAYER_LOOKUP_PREFIX = "sleeper:player:"


def normalize_player(player_id: str, raw: dict[str, Any]) -> dict[str, Any]:
    first = (raw.get("first_name") or "").strip()
    last = (raw.get("last_name") or "").strip()
    full = (raw.get("full_name") or f"{first} {last}").strip() or player_id
    fantasy_positions = raw.get("fantasy_positions") or []
    position = raw.get("position") or (fantasy_positions[0] if fantasy_positions else "UNK")
    age = raw.get("age")
    try:
        age_val = float(age) if age is not None else None
    except (TypeError, ValueError):
        age_val = None
    return {
        "player_id": str(raw.get("player_id") or player_id),
        "full_name": full[:255],
        "position": str(position)[:10],
        "nfl_team": raw.get("team"),
        "injury_status": raw.get("injury_status"),
        "injury_body_part": raw.get("injury_body_part"),
        "injury_notes": raw.get("injury_notes"),
        "depth_chart_order": raw.get("depth_chart_order"),
        "depth_chart_position": (raw.get("depth_chart_position") or None),
        "years_exp": raw.get("years_exp"),
        "age": age_val,
        "status": raw.get("status"),
        "metadata_json": raw,
    }


def player_to_public(row: SleeperPlayer) -> dict[str, Any]:
    return {
        "player_id": row.player_id,
        "full_name": row.full_name,
        "position": row.position,
        "nfl_team": row.nfl_team,
        "injury_status": row.injury_status,
        "injury_body_part": row.injury_body_part,
        "depth_chart_order": row.depth_chart_order,
        "status": row.status,
        "age": float(row.age) if row.age is not None else None,
        "years_exp": row.years_exp,
    }


class PlayerCacheManager:
    def __init__(self, client: SleeperClient, cache: Cache) -> None:
        self.client = client
        self.cache = cache
        self.settings = get_settings()

    async def refresh(self, session: AsyncSession, *, force: bool = False) -> dict[str, Any]:
        meta = await self.cache.get_json(PLAYER_CACHE_KEY)
        if meta and not force:
            return {"cached": True, **meta}

        payload = await self.client.get_all_players()
        now = datetime.now(timezone.utc)
        rows: list[SleeperPlayer] = []
        lookup: dict[str, dict[str, Any]] = {}

        for player_id, raw in payload.items():
            if not isinstance(raw, dict):
                continue
            row_data = normalize_player(player_id, raw)
            rows.append(SleeperPlayer(**row_data, updated_at=now))
            lookup[row_data["player_id"]] = {
                "player_id": row_data["player_id"],
                "full_name": row_data["full_name"],
                "position": row_data["position"],
                "nfl_team": row_data["nfl_team"],
                "injury_status": row_data["injury_status"],
                "status": row_data["status"],
                "years_exp": row_data["years_exp"],
            }

        await session.execute(delete(SleeperPlayer))
        session.add_all(rows)
        await session.commit()
        upserted = len(rows)
        await self.cache.set_json(
            f"{PLAYER_LOOKUP_PREFIX}index",
            lookup,
            ttl=self.settings.player_cache_ttl_seconds,
        )
        summary = {
            "count": upserted,
            "refreshed_at": now.isoformat(),
        }
        await self.cache.set_json(
            PLAYER_CACHE_KEY, summary, ttl=self.settings.player_cache_ttl_seconds
        )
        return {"cached": False, **summary}

    async def lookup_many(
        self, session: AsyncSession, player_ids: list[str]
    ) -> dict[str, dict[str, Any]]:
        unique_ids = [pid for pid in dict.fromkeys(player_ids) if pid]
        if not unique_ids:
            return {}

        index = await self.cache.get_json(f"{PLAYER_LOOKUP_PREFIX}index")
        if isinstance(index, dict):
            found = {pid: index[pid] for pid in unique_ids if pid in index}
            if len(found) == len(unique_ids) and all("years_exp" in row for row in found.values()):
                return found

        result = await session.execute(
            select(SleeperPlayer).where(SleeperPlayer.player_id.in_(unique_ids))
        )
        rows = result.scalars().all()
        return {row.player_id: player_to_public(row) for row in rows}
