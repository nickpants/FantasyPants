from __future__ import annotations

from collections import Counter
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.redis_client import Cache
from services.analytics.draft_math import (
    FLEX_POSITIONS,
    picks_until_roster,
    position_need,
    recommend_score,
    roster_id_for_slot,
    round_for_pick,
    slot_for_pick,
    starter_counts,
    vor_for_player,
)
from services.analytics.projections import PlayerProjection, ProjectionService
from services.analytics.scoring_engine import summarize_scoring
from services.sleeper.client import SleeperClient
from services.sleeper.player_cache import PlayerCacheManager
from services.sleeper.sync_manager import SyncManager

FANTASY_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DEF"}


def _int_map(raw: dict[str, Any] | None) -> dict[str, int]:
    if not raw:
        return {}
    out: dict[str, int] = {}
    for key, value in raw.items():
        try:
            out[str(key)] = int(value)
        except (TypeError, ValueError):
            continue
    return out


def _serialize_proj(player: PlayerProjection, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "player_id": player.player_id,
        "full_name": player.full_name,
        "position": player.position,
        "nfl_team": player.nfl_team,
        "injury_status": player.injury_status,
        "p50": player.mu,
        "eligible": player.eligible,
    }
    if extra:
        payload.update(extra)
    return payload


class DraftService:
    def __init__(self, client: SleeperClient, cache: Cache) -> None:
        self.client = client
        self.cache = cache
        self.sync = SyncManager(client, cache)
        self.projections = ProjectionService(client, cache)
        self.players = PlayerCacheManager(client, cache)
        self.settings = get_settings()

    async def board(
        self,
        session: AsyncSession,
        league_id: str,
        *,
        sleeper_user_id: str | None = None,
        roster_id: int | None = None,
        draft_id: str | None = None,
    ) -> dict[str, Any]:
        detail = await self.sync.sync_league(session, league_id)
        league = detail["league"]
        drafts = await self.client.get_league_drafts(league_id)
        if not drafts:
            raise KeyError(f"No drafts for league {league_id}")
        drafts_sorted = sorted(drafts, key=lambda item: item.get("created") or 0, reverse=True)
        selected = None
        if draft_id:
            selected = next((item for item in drafts_sorted if str(item.get("draft_id")) == str(draft_id)), None)
        if selected is None:
            selected = next((item for item in drafts_sorted if item.get("status") == "drafting"), None)
            selected = selected or next((item for item in drafts_sorted if item.get("status") == "pre_draft"), None)
            selected = selected or drafts_sorted[0]
        draft = await self.client.get_draft(str(selected["draft_id"]))
        picks = await self.client.get_draft_picks(str(draft["draft_id"]))
        picks = sorted(picks, key=lambda item: int(item.get("pick_no") or 0))

        settings = draft.get("settings") or {}
        teams = int(settings.get("teams") or league.get("total_rosters") or 0) or 1
        rounds = int(settings.get("rounds") or 15)
        draft_type = str(draft.get("type") or "snake")
        slot_to_roster = _int_map(draft.get("slot_to_roster_id"))
        draft_order = _int_map(draft.get("draft_order"))
        scoring = league.get("scoring_settings") or {}
        positions = league.get("roster_positions") or []
        season = str(draft.get("season") or league.get("season"))

        users = {str(user.get("user_id")): user for user in detail.get("users") or []}
        roster_by_id = {roster["roster_id"]: roster for roster in detail.get("rosters") or []}

        my_roster_id = roster_id
        if my_roster_id is None and sleeper_user_id:
            mine = next(
                (roster for roster in detail["rosters"] if roster.get("owner_id") == sleeper_user_id),
                None,
            )
            if mine:
                my_roster_id = mine["roster_id"]
            elif sleeper_user_id in draft_order and slot_to_roster:
                slot = draft_order[sleeper_user_id]
                my_roster_id = roster_id_for_slot(slot, slot_to_roster)

        drafted_ids = {str(pick.get("player_id")) for pick in picks if pick.get("player_id")}
        season_type = str(draft.get("season_type") or "regular")
        if season_type.lower() in {"reg", "regular"}:
            season_type = "regular"
        rows, source = await self.projections.load_stat_rows(season, 1, season_type)
        context = await self.projections.load_context(season, 1)
        if context.loaded:
            source = f"{source}+nflverse"
        available_ids = [
            pid
            for pid in rows
            if pid not in drafted_ids
        ]
        lookup_ids = available_ids + list(drafted_ids)
        meta = await self.players.lookup_many(session, lookup_ids)
        projected: dict[str, PlayerProjection] = {}
        for pid in lookup_ids:
            row = rows.get(pid)
            info = meta.get(pid) or {}
            if not info and pid in drafted_ids:
                pick = next((item for item in picks if str(item.get("player_id")) == pid), None)
                md = (pick or {}).get("metadata") or {}
                info = {
                    "full_name": f"{md.get('first_name') or ''} {md.get('last_name') or ''}".strip() or pid,
                    "position": md.get("position") or "FLEX",
                    "nfl_team": md.get("team"),
                    "injury_status": md.get("injury_status") or None,
                }
            if not info.get("position") and row:
                info["position"] = "FLEX"
            if info.get("position") not in FANTASY_POSITIONS and pid not in drafted_ids:
                continue
            projected[pid] = self.projections.project_player(
                pid, info, row, scoring, source, context
            )

        available = sorted(
            (
                player
                for player in projected.values()
                if player.player_id not in drafted_ids
                and player.position in FANTASY_POSITIONS
                and player.mu > 0
            ),
            key=lambda player: player.mu,
            reverse=True,
        )
        drafted_pos = Counter()
        for pick in picks:
            pid = str(pick.get("player_id") or "")
            pos = (projected.get(pid).position if pid in projected else None) or (pick.get("metadata") or {}).get("position")
            if pos:
                drafted_pos[pos] += 1
        slot_counts = starter_counts(positions)

        your_positions = []
        your_picks = []
        for pick in picks:
            rid = int(pick.get("roster_id") or 0)
            if my_roster_id is not None:
                if rid != my_roster_id:
                    continue
            elif sleeper_user_id:
                if str(pick.get("picked_by") or "") != sleeper_user_id:
                    continue
            else:
                continue
            pid = str(pick.get("player_id") or "")
            player = projected.get(pid)
            pos = player.position if player else (pick.get("metadata") or {}).get("position")
            if pos:
                your_positions.append(pos)
            your_picks.append(pick)

        drafted_before: set[str] = set()
        pick_grades: dict[str, float | None] = {}
        for pick in picks:
            pid = str(pick.get("player_id") or "")
            is_yours = my_roster_id is not None and int(pick.get("roster_id") or 0) == my_roster_id
            if pid and is_yours:
                remaining_then = [
                    player
                    for player in projected.values()
                    if player.player_id not in drafted_before and player.position in FANTASY_POSITIONS
                ]
                bpa = max((player.mu for player in remaining_then), default=None)
                taken = projected.get(pid)
                if taken and bpa is not None:
                    pick_grades[pid] = round(taken.mu - bpa, 2)
            if pid:
                drafted_before.add(pid)

        recommendations = []
        for player in available[:80]:
            need = position_need(your_positions, positions, player.position)
            vor = vor_for_player(
                player,
                available,
                slot_counts.get(player.position, 1),
                teams,
                drafted_pos.get(player.position, 0),
            )
            adp = (rows.get(player.player_id) or {}).get("adp_dd_ppr")
            score = recommend_score(vor, need)
            reason = {
                "starter": f"Fills a {player.position} starter hole",
                "flex": f"Best {player.position} for FLEX",
                "superflex": "SUPER_FLEX value",
                "bench": "Best player available",
            }[need]
            if vor >= 3 and need == "bench":
                reason = "BPA / positional scarcity"
            recommendations.append(
                {
                    **_serialize_proj(
                        player,
                        {
                            "vor": vor,
                            "need": need,
                            "score": score,
                            "reason": reason,
                            "adp": adp,
                        },
                    )
                }
            )
        recommendations.sort(key=lambda item: item["score"], reverse=True)

        next_pick_no = (picks[-1]["pick_no"] + 1) if picks else 1
        total_picks = teams * rounds
        on_clock = None
        until_you = None
        if next_pick_no <= total_picks:
            slot = slot_for_pick(next_pick_no, teams, draft_type)
            clock_roster = roster_id_for_slot(slot, slot_to_roster)
            clock_user = next((uid for uid, order_slot in draft_order.items() if order_slot == slot), None)
            clock_team = (roster_by_id.get(clock_roster) or {}).get("team_name") if clock_roster else None
            clock_name = None
            if clock_user and clock_user in users:
                clock_name = users[clock_user].get("display_name") or users[clock_user].get("username")
            on_clock = {
                "pick_no": next_pick_no,
                "round": round_for_pick(next_pick_no, teams),
                "draft_slot": slot,
                "roster_id": clock_roster,
                "user_id": clock_user,
                "team_name": clock_team,
                "display_name": clock_name,
                "is_you": bool(
                    (my_roster_id is not None and clock_roster == my_roster_id)
                    or (sleeper_user_id and clock_user == sleeper_user_id)
                ),
            }
            if my_roster_id is not None:
                until_you = picks_until_roster(
                    next_pick_no, my_roster_id, teams, rounds, draft_type, slot_to_roster
                )

        def pack_pick(pick: dict[str, Any]) -> dict[str, Any]:
            pid = str(pick.get("player_id") or "")
            player = projected.get(pid)
            md = pick.get("metadata") or {}
            name = (
                player.full_name
                if player
                else f"{md.get('first_name') or ''} {md.get('last_name') or ''}".strip() or pid
            )
            return {
                "pick_no": pick.get("pick_no"),
                "round": pick.get("round"),
                "draft_slot": pick.get("draft_slot"),
                "roster_id": pick.get("roster_id"),
                "picked_by": pick.get("picked_by"),
                "player_id": pid,
                "full_name": name,
                "position": (player.position if player else md.get("position")),
                "nfl_team": (player.nfl_team if player else md.get("team")),
                "p50": player.mu if player else None,
                "grade": pick_grades.get(pid),
            }

        your_roster = [pack_pick(pick) for pick in your_picks]
        recent = [pack_pick(pick) for pick in picks[-12:]]

        return {
            "league_id": league_id,
            "scoring_summary": summarize_scoring(scoring),
            "source": source,
            "draft": {
                "draft_id": str(draft.get("draft_id")),
                "status": draft.get("status"),
                "type": draft_type,
                "season": season,
                "teams": teams,
                "rounds": rounds,
                "pick_timer": settings.get("pick_timer"),
                "picks_made": len(picks),
                "total_picks": total_picks,
            },
            "on_the_clock": on_clock,
            "picks_until_you": until_you,
            "roster_id": my_roster_id,
            "your_roster": your_roster,
            "recommendations": recommendations[:12],
            "available": [
                _serialize_proj(
                    player,
                    {"adp": (rows.get(player.player_id) or {}).get("adp_dd_ppr")},
                )
                for player in available[:50]
            ],
            "recent_picks": recent,
        }
