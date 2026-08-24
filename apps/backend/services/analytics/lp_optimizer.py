from __future__ import annotations

from dataclasses import dataclass

from services.analytics.projections import PlayerProjection
from services.analytics.scoring_engine import slot_accepts, starter_slots


@dataclass
class SlotAssignment:
    index: int
    slot: str
    player: PlayerProjection | None


def _eligible(player: PlayerProjection, slot: str) -> bool:
    if not player.eligible or not player.player_id or player.player_id == "0":
        return False
    return slot_accepts(slot, player.position)


def _greedy(slots: list[tuple[int, str]], pool: list[PlayerProjection]) -> list[SlotAssignment]:
    remaining = sorted(pool, key=lambda player: player.mu, reverse=True)
    used: set[str] = set()
    assignments: list[SlotAssignment] = []
    # Fill more specific slots first so FLEX does not steal the only QB.
    order = sorted(
        enumerate(slots),
        key=lambda item: (
            0 if item[1][1] not in {"FLEX", "WRRB_FLEX", "REC_FLEX", "SUPER_FLEX", "IDP_FLEX"} else 1,
            item[0],
        ),
    )
    picked: dict[int, PlayerProjection] = {}
    for _, (index, slot) in order:
        choice = next((player for player in remaining if player.player_id not in used and _eligible(player, slot)), None)
        if choice is not None:
            used.add(choice.player_id)
            picked[index] = choice
    for index, slot in slots:
        assignments.append(SlotAssignment(index=index, slot=slot, player=picked.get(index)))
    return assignments


def optimize_lineup(
    roster_positions: list[str],
    players: list[PlayerProjection],
) -> list[SlotAssignment]:
    slots = list(enumerate(starter_slots(roster_positions)))
    if not slots:
        return []
    pool = [player for player in players if player.eligible]
    try:
        import pulp
    except ImportError:
        return _greedy(slots, pool)

    problem = pulp.LpProblem("sleeper_lineup", pulp.LpMaximize)
    variables: dict[tuple[str, int], pulp.LpVariable] = {}
    for player in pool:
        for index, slot in slots:
            if _eligible(player, slot):
                variables[(player.player_id, index)] = pulp.LpVariable(
                    f"x_{player.player_id}_{index}", cat=pulp.LpBinary
                )
    if not variables:
        return [SlotAssignment(index=index, slot=slot, player=None) for index, slot in slots]

    problem += pulp.lpSum(
        variables[(player.player_id, index)] * player.mu
        for player in pool
        for index, slot in slots
        if (player.player_id, index) in variables
    )
    for index, slot in slots:
        problem += (
            pulp.lpSum(
                variables[(player.player_id, index)]
                for player in pool
                if (player.player_id, index) in variables
            )
            <= 1,
            f"slot_{index}",
        )
    for player in pool:
        keys = [variables[(player.player_id, index)] for index, _ in slots if (player.player_id, index) in variables]
        if keys:
            problem += pulp.lpSum(keys) <= 1, f"player_{player.player_id}"

    solver = pulp.PULP_CBC_CMD(msg=False, timeLimit=5)
    problem.solve(solver)
    if pulp.LpStatus[problem.status] != "Optimal":
        return _greedy(slots, pool)

    chosen: dict[int, PlayerProjection] = {}
    by_id = {player.player_id: player for player in pool}
    for (player_id, index), var in variables.items():
        if var.value() and var.value() >= 0.5:
            chosen[index] = by_id[player_id]
    if len(chosen) < min(len(slots), len(pool)):
        return _greedy(slots, pool)
    return [
        SlotAssignment(index=index, slot=slot, player=chosen.get(index))
        for index, slot in slots
    ]
