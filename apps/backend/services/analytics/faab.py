from __future__ import annotations

from typing import Any

from services.analytics.projections import PlayerProjection


def replacement_mu(available: list[PlayerProjection], position: str, exclude_id: str | None = None) -> float:
    pool = [
        player
        for player in available
        if player.position == position and player.player_id != exclude_id
    ]
    if not pool:
        return 0.0
    return max(player.mu for player in pool)


def replacement_level_delta(
    target: PlayerProjection,
    available: list[PlayerProjection],
    roster_players: list[PlayerProjection],
) -> dict[str, float]:
    wire = replacement_mu(available, target.position, exclude_id=target.player_id)
    same_pos = [
        player
        for player in roster_players
        if player.position == target.position and player.eligible and player.mu > 1
    ]
    flex_eligible = target.position in {"RB", "WR", "TE"}
    roster_cmp = same_pos or (
        [
            player
            for player in roster_players
            if player.position in {"RB", "WR", "TE"} and player.eligible and player.mu > 1
        ]
        if flex_eligible
        else [player for player in roster_players if player.eligible and player.mu > 1]
    )
    worst = min((player.mu for player in roster_cmp), default=0.0)
    rld_wire = round(target.mu - wire, 2)
    rld_roster = round(target.mu - worst, 2)
    return {
        "replacement_wire": round(wire, 2),
        "worst_roster_comp": round(worst, 2),
        "rld_vs_wire": rld_wire,
        "rld_vs_roster": rld_roster,
        "rld": round(max(rld_wire, rld_roster, 0.0), 2),
    }


def tiered_bids(
    rld: float,
    remaining_faab: int,
    weeks_left: int,
    min_bid: int = 0,
) -> dict[str, int]:
    if remaining_faab <= 0:
        return {"conservative": 0, "fair": 0, "aggressive": 0}
    if rld <= 0:
        floor = min(min_bid, remaining_faab)
        return {"conservative": floor, "fair": floor, "aggressive": floor}
    season_value = rld * max(1, min(weeks_left, 12))
    frac = min(1.0, season_value / 40.0)
    conservative = max(min_bid, round(frac * remaining_faab * 0.4))
    fair = max(conservative, round(frac * remaining_faab * 0.7))
    aggressive = max(fair, round(frac * remaining_faab * 0.95))
    aggressive = min(remaining_faab, aggressive)
    if aggressive >= remaining_faab and remaining_faab > 1 and frac < 0.98:
        aggressive = remaining_faab - 1
    fair = min(fair, aggressive)
    conservative = min(conservative, fair)
    return {
        "conservative": int(conservative),
        "fair": int(fair),
        "aggressive": int(aggressive),
    }


def grade_trade(give_mu: float, receive_mu: float) -> dict[str, Any]:
    delta = round(receive_mu - give_mu, 2)
    if delta >= 4:
        label = "steal"
    elif delta >= 1.5:
        label = "win"
    elif delta > -1.5:
        label = "fair"
    elif delta > -4:
        label = "loss"
    else:
        label = "lopsided"
    return {"give_p50": round(give_mu, 2), "receive_p50": round(receive_mu, 2), "delta": delta, "grade": label}
