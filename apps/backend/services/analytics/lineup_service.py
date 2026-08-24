from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.redis_client import Cache
from services.analytics.live_scoring import (
    actuals_from_matchup,
    is_toast,
    phase_for_player,
    remaining_projection,
)
from services.analytics.lp_optimizer import SlotAssignment, optimize_lineup
from services.analytics.monte_carlo import (
    ScoreDistribution,
    simulate_live_players,
    simulate_players,
    sum_samples,
    win_probability,
)
from services.analytics.projections import PlayerProjection, ProjectionService
from services.analytics.scoring_engine import summarize_scoring
from services.sleeper.client import SleeperClient
from services.sleeper.player_cache import PlayerCacheManager
from services.sleeper.sync_manager import SyncManager


def _serialize_player(player: PlayerProjection | None, dist: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if player is None:
        return None
    payload = {
        "player_id": player.player_id,
        "full_name": player.full_name,
        "position": player.position,
        "nfl_team": player.nfl_team,
        "injury_status": player.injury_status,
        "mu": player.mu,
        "sigma": player.sigma,
        "eligible": player.eligible,
        "source": player.source,
        "vegas_implied": player.vegas_implied,
        "snap_share": player.snap_share,
        "wopr": player.wopr,
    }
    if dist:
        payload.update(dist)
    return payload


def _slot_payload(assignment: SlotAssignment, dists: dict) -> dict[str, Any]:
    dist = dists.get(assignment.player.player_id) if assignment.player else None
    return {
        "slot": assignment.slot,
        "player": _serialize_player(
            assignment.player,
            None
            if dist is None
            else {"p10": dist.p10, "p50": dist.p50, "p90": dist.p90},
        ),
    }


def _current_assignments(
    roster_positions: list[str],
    starters: list[str],
    projections: dict[str, PlayerProjection],
) -> list[SlotAssignment]:
    from services.analytics.scoring_engine import starter_slots

    slots = starter_slots(roster_positions)
    assignments: list[SlotAssignment] = []
    for index, slot in enumerate(slots):
        player_id = starters[index] if index < len(starters) else ""
        player = projections.get(player_id) if player_id and player_id != "0" else None
        assignments.append(SlotAssignment(index=index, slot=slot, player=player))
    return assignments


def _swaps(current: list[SlotAssignment], optimal: list[SlotAssignment]) -> list[dict[str, Any]]:
    current_ids = {slot.player.player_id for slot in current if slot.player}
    optimal_ids = {slot.player.player_id for slot in optimal if slot.player}
    sits = [slot.player for slot in current if slot.player and slot.player.player_id not in optimal_ids]
    starts = [
        (slot.slot, slot.player)
        for slot in optimal
        if slot.player and slot.player.player_id not in current_ids
    ]
    swaps = []
    for sit, (slot, start) in zip(sits, starts):
        swaps.append(
            {
                "slot": slot,
                "sit": _serialize_player(sit),
                "start": _serialize_player(start),
                "delta_p50": round((start.mu if start else 0) - (sit.mu if sit else 0), 2),
            }
        )
    return swaps


class LineupService:
    def __init__(self, client: SleeperClient, cache: Cache) -> None:
        self.client = client
        self.cache = cache
        self.sync = SyncManager(client, cache)
        self.projections = ProjectionService(client, cache)
        self.players = PlayerCacheManager(client, cache)
        self.settings = get_settings()

    def _resolve_week(self, league: dict[str, Any], state: dict[str, Any], week: int | None) -> tuple[int, str]:
        season = str(league.get("season") or state.get("league_season") or state.get("season"))
        season_type = "regular"
        if week is not None:
            return week, season
        if season == str(state.get("league_season") or state.get("season")):
            current_type = state.get("season_type") or "regular"
            if current_type == "pre":
                return int(state.get("display_week") or 1), season
            return int(state.get("display_week") or state.get("week") or 1), season
        return 1, season

    async def _project_ids(
        self,
        session: AsyncSession,
        player_ids: list[str],
        scoring: dict[str, Any],
        season: str,
        week: int,
        season_type: str = "regular",
    ) -> tuple[dict[str, PlayerProjection], str]:
        unique = [pid for pid in dict.fromkeys(player_ids) if pid and pid != "0"]
        meta = await self.players.lookup_many(session, unique)
        rows, source = await self.projections.load_stat_rows(season, week, season_type)
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
        return projected, source

    async def analyze_roster(
        self,
        session: AsyncSession,
        league_id: str,
        roster_id: int,
        week: int | None = None,
    ) -> dict[str, Any]:
        detail = await self.sync.sync_league(session, league_id)
        league = detail["league"]
        roster = next((item for item in detail["rosters"] if item["roster_id"] == roster_id), None)
        if roster is None:
            raise KeyError(f"Roster {roster_id} not in league {league_id}")

        state = await self.sync.nfl_state()
        week_num, season = self._resolve_week(league, state, week)
        scoring = league.get("scoring_settings") or {}
        player_ids = list(roster.get("players") or [])
        projected, source = await self._project_ids(session, player_ids, scoring, season, week_num)
        pool = list(projected.values())
        n = self.settings.monte_carlo_iterations
        dists = simulate_players(pool, n)

        current = _current_assignments(league["roster_positions"], roster.get("starters") or [], projected)
        optimal = optimize_lineup(league["roster_positions"], pool)
        current_ids = [slot.player.player_id for slot in current if slot.player]
        optimal_ids = [slot.player.player_id for slot in optimal if slot.player]
        current_team = sum_samples(current_ids, dists, n)
        optimal_team = sum_samples(optimal_ids, dists, n)

        opponent = await self._opponent(
            session, detail, roster_id, week_num, scoring, season, n, current_team, optimal_team
        )

        return {
            "league_id": league_id,
            "roster_id": roster_id,
            "team_name": roster.get("team_name"),
            "week": week_num,
            "season": season,
            "scoring_summary": summarize_scoring(scoring),
            "source": source,
            "iterations": n,
            "current": {
                "slots": [_slot_payload(slot, dists) for slot in current],
                "p10": current_team.p10,
                "p50": current_team.p50,
                "p90": current_team.p90,
            },
            "optimal": {
                "slots": [_slot_payload(slot, dists) for slot in optimal],
                "p10": optimal_team.p10,
                "p50": optimal_team.p50,
                "p90": optimal_team.p90,
            },
            "swaps": _swaps(current, optimal),
            "opponent": opponent,
        }

    async def _opponent(
        self,
        session: AsyncSession,
        detail: dict[str, Any],
        roster_id: int,
        week: int,
        scoring: dict[str, Any],
        season: str,
        n: int,
        current_team,
        optimal_team,
    ) -> dict[str, Any] | None:
        matchups = await self.sync.sync_matchups(session, detail["league"]["sleeper_league_id"], week)
        mine = next((item for item in matchups if item["roster_id"] == roster_id), None)
        if mine is None or mine.get("matchup_id") is None:
            return None
        other = next(
            (
                item
                for item in matchups
                if item.get("matchup_id") == mine.get("matchup_id") and item["roster_id"] != roster_id
            ),
            None,
        )
        if other is None:
            return None
        opp_roster = next((item for item in detail["rosters"] if item["roster_id"] == other["roster_id"]), None)
        opp_ids = [pid for pid in (other.get("starters") or (opp_roster or {}).get("starters") or []) if pid and pid != "0"]
        opp_proj, _ = await self._project_ids(session, opp_ids, scoring, season, week)
        opp_dists = simulate_players(list(opp_proj.values()), n)
        # Re-key into a combined draw? Independent draws vs opponent is correct for WP.
        opp_team = sum_samples(opp_ids, opp_dists, n)
        return {
            "roster_id": other["roster_id"],
            "team_name": (opp_roster or {}).get("team_name"),
            "p10": opp_team.p10,
            "p50": opp_team.p50,
            "p90": opp_team.p90,
            "win_probability": win_probability(current_team.samples, opp_team.samples),
            "optimal_win_probability": win_probability(optimal_team.samples, opp_team.samples),
        }

    async def analyze_matchups(
        self,
        session: AsyncSession,
        league_id: str,
        week: int | None = None,
    ) -> dict[str, Any]:
        detail = await self.sync.sync_league(session, league_id)
        league = detail["league"]
        state = await self.sync.nfl_state()
        week_num, season = self._resolve_week(league, state, week)
        scoring = league.get("scoring_settings") or {}
        matchups = await self.sync.sync_matchups(session, league_id, week_num)
        n = self.settings.monte_carlo_iterations

        all_ids: list[str] = []
        for roster in detail["rosters"]:
            all_ids.extend(roster.get("starters") or [])
        projected, source = await self._project_ids(session, all_ids, scoring, season, week_num)
        context = await self.projections.load_context(season, week_num)
        games = context.vegas if context.loaded else {}
        pregame = simulate_players(list(projected.values()), n)
        all_actuals: dict[str, float] = {}
        for matchup in matchups:
            all_actuals.update(actuals_from_matchup(matchup))
        phases = {
            pid: phase_for_player(player, games)
            for pid, player in projected.items()
        }
        live_dists = simulate_live_players(
            list(projected.values()), n, actuals=all_actuals, phases=phases
        )
        for pid, actual in all_actuals.items():
            if pid not in live_dists:
                live_dists[pid] = ScoreDistribution.from_samples([float(actual)] * n)
                phases[pid] = ("final", 1.0)
        phase_names = {phase for phase, _ in phases.values()}
        if phase_names == {"final"}:
            mode = "final"
        elif "live" in phase_names or ("final" in phase_names and "upcoming" in phase_names):
            mode = "live"
        else:
            mode = "pregame"

        by_roster = {roster["roster_id"]: roster for roster in detail["rosters"]}
        cards = []
        for matchup in matchups:
            roster = by_roster.get(matchup["roster_id"])
            starter_ids = [pid for pid in (matchup.get("starters") or (roster or {}).get("starters") or []) if pid and pid != "0"]
            team = sum_samples(starter_ids, live_dists, n)
            pre = sum_samples(starter_ids, pregame, n)
            actual_total = matchup.get("points")
            if actual_total is None:
                actual_total = round(sum(all_actuals.get(pid, 0.0) for pid in starter_ids), 2)
            live_starters = []
            for pid in starter_ids:
                player = projected.get(pid)
                actual = all_actuals.get(pid, 0.0)
                phase, progress = phases.get(pid, ("upcoming", 0.0))
                if player is None and actual:
                    phase, progress = "final", 1.0
                mu = player.mu if player else 0.0
                sigma = player.sigma if player else 0.0
                rem_mu, _ = remaining_projection(mu, sigma, progress, actual) if phase != "upcoming" else (mu, sigma)
                if phase == "upcoming":
                    rem_mu = mu
                if phase == "final":
                    rem_mu = 0.0
                live_starters.append(
                    {
                        "player_id": pid,
                        "full_name": player.full_name if player else pid,
                        "position": player.position if player else None,
                        "nfl_team": player.nfl_team if player else None,
                        "actual": round(actual, 2),
                        "projected": mu,
                        "remaining": round(rem_mu, 2),
                        "phase": phase,
                        "progress": round(progress, 3),
                        "toast": is_toast(actual, mu, phase),
                    }
                )
            cards.append(
                {
                    **matchup,
                    "team_name": (roster or {}).get("team_name"),
                    "owner_id": (roster or {}).get("owner_id"),
                    "points": actual_total,
                    "projected_floor": team.p10,
                    "projected_median": team.p50,
                    "projected_ceiling": team.p90,
                    "pregame_median": pre.p50,
                    "live_starters": live_starters,
                    "samples": team.samples,
                    "pregame_samples": pre.samples,
                }
            )

        grouped: dict[Any, list[dict[str, Any]]] = {}
        for card in cards:
            grouped.setdefault(card.get("matchup_id"), []).append(card)
        results = []
        for matchup_id, group in grouped.items():
            left = group[0]
            right = group[1] if len(group) > 1 else None
            wp = win_probability(left["samples"], right["samples"] if right else [0.0] * n)
            pre_wp = win_probability(
                left["pregame_samples"],
                right["pregame_samples"] if right else [0.0] * n,
            )
            drop = {"samples", "pregame_samples"}
            left_out = {k: v for k, v in left.items() if k not in drop}
            left_out["win_probability"] = wp
            left_out["pregame_win_probability"] = pre_wp
            right_out = None
            if right:
                right_out = {k: v for k, v in right.items() if k not in drop}
                right_out["win_probability"] = round(1 - wp, 3)
                right_out["pregame_win_probability"] = round(1 - pre_wp, 3)
            results.append({"matchup_id": matchup_id, "home": left_out, "away": right_out})

        return {
            "league_id": league_id,
            "week": week_num,
            "season": season,
            "source": source,
            "mode": mode,
            "iterations": n,
            "scoring_summary": summarize_scoring(scoring),
            "matchups": results,
        }
