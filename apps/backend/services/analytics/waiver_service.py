from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.redis_client import Cache
from services.analytics.faab import grade_trade, replacement_level_delta, tiered_bids
from services.analytics.projections import PlayerProjection, ProjectionService
from services.analytics.roster_rules import validate_roster
from services.sleeper.client import SleeperClient
from services.sleeper.player_cache import PlayerCacheManager
from services.sleeper.sync_manager import SyncManager
from services.sleeper.transaction_parser import (
    faab_spent_by_roster,
    parse_transaction,
    serialize_transaction,
)

FANTASY_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DEF"}


class WaiverService:
    def __init__(self, client: SleeperClient, cache: Cache) -> None:
        self.client = client
        self.cache = cache
        self.sync = SyncManager(client, cache)
        self.projections = ProjectionService(client, cache)
        self.players = PlayerCacheManager(client, cache)
        self.settings = get_settings()

    def _week_and_season(self, league: dict[str, Any], state: dict[str, Any], week: int | None) -> tuple[int, str]:
        season = str(league.get("season") or state.get("league_season") or state.get("season"))
        if week is not None:
            return week, season
        if season == str(state.get("league_season") or state.get("season")):
            return int(state.get("display_week") or state.get("week") or 1), season
        return 1, season

    async def _transactions(self, league_id: str, through_week: int) -> list:
        parsed = []
        for week in range(1, max(1, through_week) + 1):
            cache_key = f"sleeper:txn:{league_id}:{week}"
            raw = await self.cache.get_json(cache_key)
            if raw is None:
                raw = await self.client.get_transactions(league_id, week) or []
                await self.cache.set_json(cache_key, raw, ttl=120)
            for item in raw or []:
                parsed.append(parse_transaction(item, week))
        return parsed

    async def compliance(self, session: AsyncSession, league_id: str) -> dict[str, Any]:
        detail = await self.sync.sync_league(session, league_id)
        league = detail["league"]
        settings = league.get("settings") or {}
        ids: list[str] = []
        for roster in detail["rosters"]:
            ids.extend(roster.get("reserve") or [])
            ids.extend(roster.get("taxi") or [])
        meta = await self.players.lookup_many(session, ids)
        reports = []
        for roster in detail["rosters"]:
            flags = validate_roster(roster, meta, settings, league.get("roster_positions") or [])
            if flags:
                reports.append(
                    {
                        "roster_id": roster["roster_id"],
                        "team_name": roster.get("team_name"),
                        "flags": flags,
                    }
                )
        return {"league_id": league_id, "compliance": reports}

    async def _project_ids(
        self,
        session: AsyncSession,
        player_ids: list[str],
        scoring: dict[str, Any],
        season: str,
        week: int,
    ) -> tuple[dict[str, PlayerProjection], dict[str, dict[str, Any]], str]:
        unique = [pid for pid in dict.fromkeys(player_ids) if pid and pid != "0"]
        meta = await self.players.lookup_many(session, unique)
        rows, source = await self.projections.load_stat_rows(season, week, "regular")
        context = await self.projections.load_context(season, week)
        projected = {
            pid: self.projections.project_player(
                pid,
                meta.get(pid, {"full_name": pid, "position": "FLEX"}),
                rows.get(pid),
                scoring,
                source,
                context,
            )
            for pid in unique
        }
        if context.loaded:
            source = f"{source}+nflverse"
        return projected, meta, source

    async def board(
        self,
        session: AsyncSession,
        league_id: str,
        roster_id: int | None = None,
        week: int | None = None,
        limit: int = 80,
    ) -> dict[str, Any]:
        detail = await self.sync.sync_league(session, league_id)
        league = detail["league"]
        settings = league.get("settings") or {}
        state = await self.sync.nfl_state()
        week_num, season = self._week_and_season(league, state, week)
        scoring = league.get("scoring_settings") or {}
        playoff_start = int(settings.get("playoff_week_start") or 15)
        weeks_left = max(1, playoff_start - week_num + 3)
        through_week = max(
            week_num,
            int(settings.get("last_scored_leg") or 0),
            int(settings.get("leg") or 0),
        )
        through_week = min(max(through_week, 1), 18)

        transactions = await self._transactions(league_id, through_week)
        parsed_spent = faab_spent_by_roster(transactions)
        total_faab = int(settings.get("waiver_budget") or 100)
        min_bid = int(settings.get("waiver_bid_min") or 0)
        is_faab = int(settings.get("waiver_type") or 0) == 2

        rostered: set[str] = set()
        for roster in detail["rosters"]:
            rostered.update(pid for pid in (roster.get("players") or []) if pid and pid != "0")

        rows, source = await self.projections.load_stat_rows(season, week_num, "regular")
        available_ids = [pid for pid in rows if pid not in rostered]
        projected, meta, source = await self._project_ids(session, available_ids + list(rostered), scoring, season, week_num)
        available = sorted(
            (
                projected[pid]
                for pid in available_ids
                if pid in projected and projected[pid].position in FANTASY_POSITIONS and projected[pid].mu > 0
            ),
            key=lambda player: player.mu,
            reverse=True,
        )[:limit]

        focus = roster_id
        if focus is None and detail["rosters"]:
            focus = detail["rosters"][0]["roster_id"]
        focus_roster = next((item for item in detail["rosters"] if item["roster_id"] == focus), None)
        roster_players = [
            projected[pid]
            for pid in (focus_roster or {}).get("players") or []
            if pid in projected
        ]
        remaining = 0
        if focus_roster:
            remaining = max(0, int(focus_roster.get("total_faab") or total_faab) - int(focus_roster.get("waiver_budget_used") or 0))

        targets = []
        for player in available:
            rld = replacement_level_delta(player, available, roster_players)
            bids = tiered_bids(rld["rld"], remaining, weeks_left, min_bid) if is_faab else None
            targets.append(
                {
                    "player_id": player.player_id,
                    "full_name": player.full_name,
                    "position": player.position,
                    "nfl_team": player.nfl_team,
                    "injury_status": player.injury_status,
                    "p50": player.mu,
                    **rld,
                    "bids": bids,
                }
            )
        targets.sort(key=lambda row: (row["rld"], row["p50"]), reverse=True)

        all_meta: dict[str, dict[str, Any]] = dict(meta)
        faab_table = []
        compliance = []
        for roster in detail["rosters"]:
            used = int(roster.get("waiver_budget_used") or 0)
            cap = int(roster.get("total_faab") or total_faab)
            faab_table.append(
                {
                    "roster_id": roster["roster_id"],
                    "team_name": roster.get("team_name"),
                    "owner_id": roster.get("owner_id"),
                    "total_faab": cap,
                    "used": used,
                    "remaining": max(0, cap - used),
                    "parsed_spent": parsed_spent.get(roster["roster_id"], 0),
                }
            )
            flags = validate_roster(roster, all_meta, settings, league.get("roster_positions") or [])
            if flags:
                compliance.append(
                    {
                        "roster_id": roster["roster_id"],
                        "team_name": roster.get("team_name"),
                        "flags": flags,
                    }
                )

        recent = [
            serialize_transaction(txn)
            for txn in transactions
            if txn.status == "complete"
        ]
        recent.sort(key=lambda item: (item["week"], item.get("bid") or 0), reverse=True)

        return {
            "league_id": league_id,
            "week": week_num,
            "season": season,
            "source": source,
            "is_faab": is_faab,
            "waiver_budget": total_faab,
            "min_bid": min_bid,
            "weeks_left": weeks_left,
            "roster_id": focus,
            "remaining_faab": remaining,
            "faab_table": sorted(faab_table, key=lambda row: row["remaining"]),
            "available": targets,
            "compliance": compliance,
            "transactions": recent[:40],
        }

    async def bid_for_player(
        self,
        session: AsyncSession,
        league_id: str,
        roster_id: int,
        player_id: str,
        week: int | None = None,
    ) -> dict[str, Any]:
        board = await self.board(session, league_id, roster_id, week, limit=80)
        target = next((item for item in board["available"] if item["player_id"] == player_id), None)
        if target is None:
            raise KeyError(f"Player {player_id} is not on waivers or has no projection")
        return {"league_id": league_id, "roster_id": roster_id, "week": board["week"], **target}

    async def evaluate_trade(
        self,
        session: AsyncSession,
        league_id: str,
        give: list[str],
        receive: list[str],
        week: int | None = None,
    ) -> dict[str, Any]:
        detail = await self.sync.sync_league(session, league_id)
        league = detail["league"]
        state = await self.sync.nfl_state()
        week_num, season = self._week_and_season(league, state, week)
        scoring = league.get("scoring_settings") or {}
        ids = [pid for pid in give + receive if pid]
        projected, _, source = await self._project_ids(session, ids, scoring, season, week_num)

        def pack(player_ids: list[str]) -> list[dict[str, Any]]:
            packed = []
            for pid in player_ids:
                player = projected.get(pid)
                packed.append(
                    {
                        "player_id": pid,
                        "full_name": player.full_name if player else pid,
                        "position": player.position if player else "UNK",
                        "p50": player.mu if player else 0.0,
                    }
                )
            return packed

        give_side = pack(give)
        receive_side = pack(receive)
        verdict = grade_trade(sum(item["p50"] for item in give_side), sum(item["p50"] for item in receive_side))
        return {
            "league_id": league_id,
            "week": week_num,
            "season": season,
            "source": source,
            "give": give_side,
            "receive": receive_side,
            **verdict,
        }

    async def trade_desk(self, session: AsyncSession, league_id: str, week: int | None = None) -> dict[str, Any]:
        detail = await self.sync.sync_league(session, league_id)
        league = detail["league"]
        state = await self.sync.nfl_state()
        week_num, season = self._week_and_season(league, state, week)
        scoring = league.get("scoring_settings") or {}
        ids: list[str] = []
        for roster in detail["rosters"]:
            ids.extend(roster.get("players") or [])
        projected, _, source = await self._project_ids(session, ids, scoring, season, week_num)
        transactions = await self._transactions(league_id, week_num)
        trades = [serialize_transaction(txn) for txn in transactions if txn.type == "trade" and txn.status == "complete"]
        desks = []
        for roster in detail["rosters"]:
            players = []
            for pid in roster.get("players") or []:
                player = projected.get(pid)
                if not player:
                    continue
                players.append(
                    {
                        "player_id": player.player_id,
                        "full_name": player.full_name,
                        "position": player.position,
                        "nfl_team": player.nfl_team,
                        "p50": player.mu,
                    }
                )
            players.sort(key=lambda item: item["p50"], reverse=True)
            desks.append(
                {
                    "roster_id": roster["roster_id"],
                    "team_name": roster.get("team_name"),
                    "owner_id": roster.get("owner_id"),
                    "players": players,
                }
            )
        return {
            "league_id": league_id,
            "week": week_num,
            "season": season,
            "source": source,
            "rosters": desks,
            "recent_trades": trades,
        }
