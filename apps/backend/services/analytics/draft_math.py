from __future__ import annotations

from collections import Counter
from typing import Any

from services.analytics.projections import PlayerProjection
from services.analytics.scoring_engine import NON_STARTER_SLOTS

FLEX_POSITIONS = {"RB", "WR", "TE"}


def slot_for_pick(pick_no: int, teams: int, draft_type: str = "snake") -> int:
    """1-based draft column for a pick number."""
    if pick_no < 1 or teams < 1:
        raise ValueError("pick_no and teams must be positive")
    index = pick_no - 1
    pos = index % teams
    round_index = index // teams
    if draft_type == "linear":
        return pos + 1
    # snake (default): even 0-based rounds go L->R, odd rounds R->L
    if round_index % 2 == 1:
        return teams - pos
    return pos + 1


def round_for_pick(pick_no: int, teams: int) -> int:
    return ((pick_no - 1) // teams) + 1


def roster_id_for_slot(slot: int, slot_to_roster: dict[Any, Any] | None) -> int | None:
    if not slot_to_roster:
        return None
    if slot in slot_to_roster:
        return int(slot_to_roster[slot])
    if str(slot) in slot_to_roster:
        return int(slot_to_roster[str(slot)])
    return None


def picks_until_roster(
    next_pick_no: int,
    roster_id: int,
    teams: int,
    rounds: int,
    draft_type: str,
    slot_to_roster: dict[Any, Any] | None,
) -> int | None:
    total = teams * rounds
    for pick_no in range(next_pick_no, total + 1):
        slot = slot_for_pick(pick_no, teams, draft_type)
        if roster_id_for_slot(slot, slot_to_roster) == roster_id:
            return pick_no - next_pick_no
    return None


def starter_counts(roster_positions: list[str]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for slot in roster_positions:
        if slot in NON_STARTER_SLOTS:
            continue
        counts[slot] += 1
    return counts


def position_need(
    drafted_positions: list[str],
    roster_positions: list[str],
    candidate_position: str,
) -> str:
    counts = starter_counts(roster_positions)
    have = Counter(pos for pos in drafted_positions if pos)
    hard = have[candidate_position]
    starters = counts[candidate_position]
    if hard < starters:
        return "starter"
    flex = counts.get("FLEX", 0) + counts.get("WRRB_FLEX", 0) + counts.get("REC_FLEX", 0)
    used_flex = sum(max(0, have[pos] - counts[pos]) for pos in FLEX_POSITIONS)
    if candidate_position in FLEX_POSITIONS and used_flex < flex:
        return "flex"
    superflex = counts.get("SUPER_FLEX", 0)
    if candidate_position in FLEX_POSITIONS | {"QB"} and superflex:
        qb_overflow = max(0, have["QB"] - counts["QB"])
        # SUPER_FLEX can eat one extra QB or skill player
        if have["QB"] < counts["QB"] + superflex or used_flex + qb_overflow < flex + superflex:
            if candidate_position == "QB" and have["QB"] < counts["QB"] + superflex:
                return "superflex"
    return "bench"


def vor_for_player(
    player: PlayerProjection,
    available: list[PlayerProjection],
    starter_slots_at_pos: int,
    teams: int,
    already_drafted_at_pos: int,
) -> float:
    others = sorted(
        (item for item in available if item.position == player.position and item.player_id != player.player_id),
        key=lambda item: item.mu,
        reverse=True,
    )
    remaining_starters = max(starter_slots_at_pos * teams - already_drafted_at_pos, 0)
    if not others:
        return round(player.mu, 2)
    idx = min(max(remaining_starters, 1) - 1, len(others) - 1)
    return round(player.mu - others[idx].mu, 2)


def recommend_score(vor: float, need: str) -> float:
    bonus = {"starter": 4.0, "flex": 2.0, "superflex": 2.5, "bench": 0.0}[need]
    return round(vor + bonus, 3)
