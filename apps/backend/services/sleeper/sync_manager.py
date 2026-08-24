from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.models import AppUser, SleeperLeague, SleeperPlayer, SleeperRoster, SleeperWeeklyMatchup
from core.redis_client import Cache
from services.sleeper.client import SleeperClient
from services.sleeper.player_cache import PlayerCacheManager

NFL_STATE_KEY = "sleeper:state:nfl"


def _is_dynasty(league: dict[str, Any]) -> bool:
    settings = league.get("settings") or {}
    if settings.get("type") == 2:
        return True
    if settings.get("taxi_slots") or settings.get("taxi_deadline"):
        return True
    name = (league.get("name") or "").lower()
    return "dynasty" in name


def _team_name(user: dict[str, Any] | None, roster: dict[str, Any]) -> str | None:
    if user:
        metadata = user.get("metadata") or {}
        return metadata.get("team_name") or user.get("display_name") or user.get("username")
    return None


def _faab_budget(league: dict[str, Any]) -> int:
    settings = league.get("settings") or {}
    return int(settings.get("waiver_budget") or settings.get("faab") or 100)


class SyncManager:
    def __init__(self, client: SleeperClient, cache: Cache) -> None:
        self.client = client
        self.cache = cache
        self.players = PlayerCacheManager(client, cache)
        self.settings = get_settings()

    async def nfl_state(self, *, force: bool = False) -> dict[str, Any]:
        if not force:
            cached = await self.cache.get_json(NFL_STATE_KEY)
            if cached:
                return cached
        state = await self.client.get_nfl_state()
        await self.cache.set_json(NFL_STATE_KEY, state, ttl=self.settings.nfl_state_ttl_seconds)
        return state

    async def sync_user(self, session: AsyncSession, username: str) -> dict[str, Any]:
        user_payload = await self.client.get_user(username)

        sleeper_user_id = str(user_payload["user_id"])
        sleeper_username = user_payload.get("username") or username
        result = await session.execute(
            select(AppUser).where(AppUser.sleeper_user_id == sleeper_user_id)
        )
        app_user = result.scalar_one_or_none()
        if app_user is None:
            app_user = AppUser(sleeper_user_id=sleeper_user_id, sleeper_username=sleeper_username)
            session.add(app_user)
        else:
            app_user.sleeper_username = sleeper_username

        state = await self.nfl_state()
        season = str(state.get("league_season") or state.get("season") or datetime.now().year)
        seasons = [season]
        previous = state.get("previous_season")
        if previous and str(previous) not in seasons:
            seasons.append(str(previous))
        leagues = []
        seen: set[str] = set()
        for season_year in seasons:
            for league in await self.client.get_user_leagues(sleeper_user_id, season_year):
                league_id = str(league.get("league_id") or "")
                if not league_id or league_id in seen:
                    continue
                seen.add(league_id)
                leagues.append(await self.upsert_league(session, league))

        await session.commit()
        return {
            "user": {
                "sleeper_user_id": sleeper_user_id,
                "username": sleeper_username,
                "display_name": user_payload.get("display_name"),
                "avatar": user_payload.get("avatar"),
            },
            "season": season,
            "nfl_state": state,
            "leagues": leagues,
        }

    async def upsert_league(self, session: AsyncSession, league: dict[str, Any]) -> dict[str, Any]:
        league_id = str(league["league_id"])
        result = await session.execute(
            select(SleeperLeague).where(SleeperLeague.sleeper_league_id == league_id)
        )
        row = result.scalar_one_or_none()
        fields = {
            "name": league.get("name") or "Unnamed League",
            "season": str(league.get("season") or ""),
            "total_rosters": int(league.get("total_rosters") or 0),
            "roster_positions": league.get("roster_positions") or [],
            "scoring_settings": league.get("scoring_settings") or {},
            "settings": league.get("settings") or {},
            "is_dynasty": _is_dynasty(league),
            "avatar": league.get("avatar"),
            "status": league.get("status"),
            "last_synced_at": datetime.now(timezone.utc),
        }
        if row is None:
            row = SleeperLeague(sleeper_league_id=league_id, **fields)
            session.add(row)
        else:
            for key, value in fields.items():
                setattr(row, key, value)
        return serialize_league(row, extra={"draft_id": league.get("draft_id")})

    async def sync_league(self, session: AsyncSession, league_id: str) -> dict[str, Any]:
        league_payload = await self.client.get_league(league_id)
        league = await self.upsert_league(session, league_payload)
        users = await self.client.get_league_users(league_id)
        rosters_payload = await self.client.get_rosters(league_id)
        users_by_id = {str(u.get("user_id")): u for u in users}
        now = datetime.now(timezone.utc)
        faab_total = _faab_budget(league_payload)

        persisted_rosters: list[dict[str, Any]] = []
        all_player_ids: list[str] = []
        for roster in rosters_payload:
            owner_id = roster.get("owner_id")
            user = users_by_id.get(str(owner_id)) if owner_id else None
            settings = roster.get("settings") or {}
            roster_id = int(roster["roster_id"])
            result = await session.execute(
                select(SleeperRoster).where(
                    SleeperRoster.league_id == league_id,
                    SleeperRoster.roster_id == roster_id,
                )
            )
            row = result.scalar_one_or_none()
            fields = {
                "owner_id": str(owner_id) if owner_id else None,
                "team_name": _team_name(user, roster),
                "players": roster.get("players") or [],
                "starters": roster.get("starters") or [],
                "reserve": roster.get("reserve") or [],
                "taxi": roster.get("taxi") or [],
                "waiver_budget_used": int(settings.get("waiver_budget_used") or 0),
                "total_faab": faab_total,
                "settings": settings,
                "last_synced_at": now,
            }
            if row is None:
                row = SleeperRoster(league_id=league_id, roster_id=roster_id, **fields)
                session.add(row)
            else:
                for key, value in fields.items():
                    setattr(row, key, value)
            all_player_ids.extend(fields["players"])
            persisted_rosters.append(
                serialize_roster(
                    row,
                    owner=serialize_league_user(user) if user else None,
                )
            )

        await session.commit()
        player_count = await session.scalar(select(func.count()).select_from(SleeperPlayer))
        if not player_count:
            await self.players.refresh(session, force=True)
        player_map = await self.players.lookup_many(session, all_player_ids)
        for roster in persisted_rosters:
            roster["hydrated_players"] = hydrate_ids(roster.get("players") or [], player_map)
            roster["hydrated_starters"] = hydrate_ids(roster.get("starters") or [], player_map)
            roster["hydrated_reserve"] = hydrate_ids(roster.get("reserve") or [], player_map)
            roster["hydrated_taxi"] = hydrate_ids(roster.get("taxi") or [], player_map)

        return {
            "league": league,
            "users": [serialize_league_user(u) for u in users],
            "rosters": persisted_rosters,
        }

    async def sync_matchups(
        self, session: AsyncSession, league_id: str, week: int
    ) -> list[dict[str, Any]]:
        matchups = await self.client.get_matchups(league_id, week)
        now = datetime.now(timezone.utc)
        persisted: list[dict[str, Any]] = []
        for matchup in matchups:
            roster_id = int(matchup["roster_id"])
            result = await session.execute(
                select(SleeperWeeklyMatchup).where(
                    SleeperWeeklyMatchup.league_id == league_id,
                    SleeperWeeklyMatchup.week == week,
                    SleeperWeeklyMatchup.roster_id == roster_id,
                )
            )
            row = result.scalar_one_or_none()
            fields = {
                "matchup_id": matchup.get("matchup_id"),
                "points": matchup.get("points"),
                "starters": matchup.get("starters") or [],
                "starters_points": matchup.get("starters_points"),
                "players": matchup.get("players") or [],
                "players_points": matchup.get("players_points"),
                "updated_at": now,
            }
            if row is None:
                row = SleeperWeeklyMatchup(league_id=league_id, week=week, roster_id=roster_id, **fields)
                session.add(row)
            else:
                for key, value in fields.items():
                    setattr(row, key, value)
            persisted.append(serialize_matchup(row))
        await session.commit()
        return persisted


def hydrate_ids(ids: list[str], player_map: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    hydrated = []
    for player_id in ids:
        if not player_id or player_id == "0":
            hydrated.append(
                {
                    "player_id": "",
                    "full_name": "Empty",
                    "position": "UNK",
                    "nfl_team": None,
                    "injury_status": None,
                    "status": None,
                }
            )
            continue
        if player_id in player_map:
            hydrated.append(player_map[player_id])
        else:
            hydrated.append(
                {
                    "player_id": player_id,
                    "full_name": player_id,
                    "position": "UNK",
                    "nfl_team": None,
                    "injury_status": None,
                    "status": None,
                }
            )
    return hydrated


def serialize_league(row: SleeperLeague, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "sleeper_league_id": row.sleeper_league_id,
        "name": row.name,
        "season": row.season,
        "total_rosters": row.total_rosters,
        "roster_positions": row.roster_positions,
        "scoring_settings": row.scoring_settings,
        "settings": row.settings,
        "is_dynasty": row.is_dynasty,
        "avatar": row.avatar,
        "status": row.status,
        "last_synced_at": row.last_synced_at.isoformat() if row.last_synced_at else None,
    }
    if extra:
        payload.update(extra)
    return payload


def serialize_roster(row: SleeperRoster, owner: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = row.settings or {}
    return {
        "roster_id": row.roster_id,
        "owner_id": row.owner_id,
        "team_name": row.team_name,
        "players": row.players or [],
        "starters": row.starters or [],
        "reserve": row.reserve or [],
        "taxi": row.taxi or [],
        "waiver_budget_used": row.waiver_budget_used,
        "total_faab": row.total_faab,
        "wins": settings.get("wins", 0),
        "losses": settings.get("losses", 0),
        "ties": settings.get("ties", 0),
        "fpts": settings.get("fpts"),
        "owner": owner,
    }


def serialize_league_user(user: dict[str, Any] | None) -> dict[str, Any] | None:
    if not user:
        return None
    metadata = user.get("metadata") or {}
    return {
        "user_id": user.get("user_id"),
        "username": user.get("username"),
        "display_name": user.get("display_name"),
        "avatar": user.get("avatar"),
        "team_name": metadata.get("team_name"),
        "is_owner": user.get("is_owner", False),
    }


def serialize_matchup(row: SleeperWeeklyMatchup) -> dict[str, Any]:
    return {
        "week": row.week,
        "matchup_id": row.matchup_id,
        "roster_id": row.roster_id,
        "points": float(row.points) if row.points is not None else None,
        "starters": row.starters or [],
        "starters_points": row.starters_points,
        "players": row.players or [],
        "players_points": row.players_points,
        "projected_median": float(row.projected_median) if row.projected_median is not None else None,
        "projected_floor": float(row.projected_floor) if row.projected_floor is not None else None,
        "projected_ceiling": float(row.projected_ceiling) if row.projected_ceiling is not None else None,
        "win_probability": float(row.win_probability) if row.win_probability is not None else None,
    }
