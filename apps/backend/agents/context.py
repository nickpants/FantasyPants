from __future__ import annotations

from typing import Any


def coach_bias(win_probability: float | None) -> str:
    if win_probability is None:
        return "balanced"
    if win_probability < 0.42:
        return "ceiling"
    if win_probability > 0.58:
        return "floor"
    return "balanced"


def _slot_line(slot: dict[str, Any]) -> str:
    player = slot.get("player") or {}
    if not player:
        return f"{slot.get('slot')}: empty"
    p10 = player.get("p10")
    p50 = player.get("p50") if player.get("p50") is not None else player.get("mu")
    p90 = player.get("p90")
    injury = player.get("injury_status") or "Healthy"
    return (
        f"{slot.get('slot')}: {player.get('full_name')} ({player.get('position')}, "
        f"{player.get('nfl_team')}) P10={p10} P50={p50} P90={p90} {injury}"
    )


def pack_trade_context(
    grade: dict[str, Any],
    *,
    flags: list[dict[str, Any]] | None = None,
    beat_intel: list[dict[str, Any]] | None = None,
    remaining_faab: int | None = None,
    win_probability: float | None = None,
    question: str | None = None,
) -> dict[str, Any]:
    give = grade.get("give") or []
    receive = grade.get("receive") or []
    lines = [
        f"TRADE PROPOSAL in league {grade.get('league_id')} week {grade.get('week')} ({grade.get('season')})",
        f"You SEND: {_side_line(give)}",
        f"You GET: {_side_line(receive)}",
        f"P50 delta: {grade.get('delta')} ({grade.get('grade')})",
        f"Win probability: {None if win_probability is None else round(win_probability * 100)}%",
        f"Remaining FAAB: {remaining_faab}",
        "IR / taxi flags:",
        *([flag.get("detail") for flag in flags or []] or ["None reported."]),
        "Beat intel:",
        *([item.get("report_text") for item in beat_intel or []] or ["None filed."]),
    ]
    if question:
        lines.append(f"User question: {question}")
    bias = coach_bias(win_probability)
    return {
        "topic": "trade",
        "text": "\n".join(lines),
        "bias": bias,
        "win_probability": win_probability,
        "flags": flags or [],
        "beat_intel": beat_intel or [],
        "remaining_faab": remaining_faab,
        "trade": grade,
        "question": question,
        "current": {"slots": []},
        "optimal": {},
        "swaps": [],
    }


def _side_line(players: list[dict[str, Any]]) -> str:
    if not players:
        return "(empty)"
    return ", ".join(
        f"{p.get('full_name')} ({p.get('position')}, P50={p.get('p50')})" for p in players
    )


def pack_context(
    lineup: dict[str, Any],
    flags: list[dict[str, Any]] | None = None,
    question: str | None = None,
    beat_intel: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    opponent = lineup.get("opponent") or {}
    wp = opponent.get("win_probability")
    bias = coach_bias(wp)
    current = lineup.get("current") or {}
    optimal = lineup.get("optimal") or {}
    swaps = []
    for swap in lineup.get("swaps") or []:
        sit = (swap.get("sit") or {}).get("full_name")
        start = (swap.get("start") or {}).get("full_name")
        swaps.append(f"Sit {sit}, start {start} at {swap.get('slot')} ({swap.get('delta_p50')} P50)")
    lines = [
        f"League {lineup.get('league_id')} roster {lineup.get('roster_id')} ({lineup.get('team_name')})",
        f"Season {lineup.get('season')} week {lineup.get('week')} · {lineup.get('scoring_summary')}",
        f"Current team P10/P50/P90: {current.get('p10')}/{current.get('p50')}/{current.get('p90')}",
        f"Optimal P50 lineup: {optimal.get('p10')}/{optimal.get('p50')}/{optimal.get('p90')}",
        f"Win probability (current): {None if wp is None else round(wp * 100)}%",
        f"Optimal win probability: {None if opponent.get('optimal_win_probability') is None else round(opponent['optimal_win_probability'] * 100)}%",
        f"Opponent: {opponent.get('team_name')} P50={opponent.get('p50')}",
        f"Coach bias: {bias}",
        "Current starters:",
        *[_slot_line(slot) for slot in current.get("slots") or []],
        "Optimizer starters:",
        *[_slot_line(slot) for slot in optimal.get("slots") or []],
        "Suggested swaps:",
        *(swaps or ["None — current matches P50 optimal."]),
        "IR / taxi flags:",
        *(
            [flag.get("detail") for flag in flags or []]
            if flags
            else ["None reported."]
        ),
        "Beat intel:",
        *([item.get("report_text") for item in beat_intel or []] or ["None filed."]),
    ]
    if question:
        lines.append(f"User question: {question}")
    text = "\n".join(lines)
    return {
        "topic": "lineup",
        "text": text,
        "bias": bias,
        "beat_intel": beat_intel or [],
        "win_probability": wp,
        "swaps": lineup.get("swaps") or [],
        "current": current,
        "optimal": optimal,
        "flags": flags or [],
        "question": question,
        "team_name": lineup.get("team_name"),
        "opponent_name": opponent.get("team_name"),
    }
