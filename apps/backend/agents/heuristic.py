from __future__ import annotations

from typing import Any


def _names(slots: list[dict[str, Any]]) -> list[str]:
    names = []
    for slot in slots:
        player = slot.get("player") or {}
        if player.get("full_name"):
            names.append(f"{player['full_name']} ({slot.get('slot')})")
    return names


def floor_brief(ctx: dict[str, Any]) -> str:
    current = ctx["current"]
    safest = sorted(
        [
            slot
            for slot in current.get("slots") or []
            if slot.get("player") and slot["player"].get("p10") is not None
        ],
        key=lambda slot: slot["player"].get("p10") or 0,
        reverse=True,
    )[:3]
    names = ", ".join(_names(safest)) or "your high-volume starters"
    return (
        f"Floor Conservator: Protect the median. I would keep {names} locked in. "
        "Chase volume over splash plays in FLEX. Sit anyone whose P10 is near zero or who is Questionable "
        "without a clear replacement-level gap. Boom/bust sits belong on the bench unless we are desperate."
    )


def ceiling_brief(ctx: dict[str, Any]) -> str:
    swaps = ctx.get("swaps") or []
    if swaps:
        best = max(swaps, key=lambda swap: float(swap.get("delta_p50") or 0))
        sit = (best.get("sit") or {}).get("full_name")
        start = (best.get("start") or {}).get("full_name")
        move = f"Sit {sit} and start {start} at {best.get('slot')} for +{best.get('delta_p50')} P50, and more importantly P90 leverage."
    else:
        move = "The P50 sheet is already maxed; look at P90 on the FLEX for a smash-game pivot."
    wp = ctx.get("win_probability")
    underdog = wp is not None and wp < 0.42
    posture = "We are an underdog, so variance is a feature." if underdog else "We can still take a calculated dart in FLEX."
    return f"Ceiling Gambler: {posture} {move} I want the highest P90 in FLEX even if it dents P10."


def injury_brief(ctx: dict[str, Any]) -> str:
    flags = ctx.get("flags") or []
    injured = []
    for slot in (ctx.get("current") or {}).get("slots") or []:
        player = slot.get("player") or {}
        status = player.get("injury_status")
        if status and status not in {"Healthy", None}:
            injured.append(f"{player.get('full_name')} ({status}) in {slot.get('slot')}")
    parts = []
    if flags:
        parts.append("LOCKOUT: " + "; ".join(flag.get("detail") for flag in flags))
    if injured:
        parts.append("Start/sit medicals: " + "; ".join(injured) + ".")
    intel = ctx.get("beat_intel") or []
    if intel:
        parts.append(
            "Beat: "
            + "; ".join(
                f"{item.get('full_name') or item.get('player_id')}: {item.get('report_text')}"
                for item in intel[:6]
            )
        )
    if not parts:
        return "Injury Agent: No IR/taxi lockouts and no Out/IR starters. Clear to set the lineup."
    return "Injury Agent: " + " ".join(parts)


def trade_brief(ctx: dict[str, Any]) -> str:
    trade = ctx.get("trade") or {}
    give = ", ".join(p.get("full_name") or p.get("player_id") for p in trade.get("give") or []) or "nothing"
    receive = ", ".join(p.get("full_name") or p.get("player_id") for p in trade.get("receive") or []) or "nothing"
    delta = trade.get("delta")
    grade = trade.get("grade") or "unscored"
    faab = ctx.get("remaining_faab")
    extra = f" You have ${faab} FAAB left." if faab is not None else ""
    if delta is not None and delta >= 1.5:
        call = "ACCEPT — you are buying weekly points."
    elif delta is not None and delta <= -1.5:
        call = "REJECT — you are selling the middle of your roster."
    else:
        call = "COUNTER — value is close; ask for a dart or $FAAB."
    return (
        f"Trade Arbiter: Send {give} for {receive}. Sheet says {grade} "
        f"({delta:+.1f} P50).{extra} {call}"
    )


def master_trade_brief(ctx: dict[str, Any], floor: str, ceiling: str, injury: str, trade: str) -> str:
    packed = ctx.get("trade") or {}
    delta = packed.get("delta") or 0
    wp = ctx.get("win_probability")
    if wp is not None and wp < 0.42 and delta >= -1:
        ruling = "ACCEPT"
        why = "We are an underdog. I will pay a little P50 to buy a higher ceiling."
    elif delta >= 1.5:
        ruling = "ACCEPT"
        why = "The Trade Arbiter has the points. Take them."
    elif delta <= -2:
        ruling = "REJECT"
        why = "This punches a hole in the floor without enough return."
    else:
        ruling = "COUNTER"
        why = "Close. Come back with a bench dart or FAAB on top."
    intel = ctx.get("beat_intel") or []
    medical = " Check beat intel before you click confirm." if intel else ""
    return (
        f"Head Coach: {ruling}. {why}{medical}\n\n"
        f"- Arbiter: {trade[:140]}\n"
        f"- Floor: {floor[:100]}\n"
        f"- Ceiling: {ceiling[:100]}\n"
        f"- Injury: {injury[:100]}"
    )


def master_brief(ctx: dict[str, Any], floor: str, ceiling: str, injury: str) -> str:
    bias = ctx.get("bias") or "balanced"
    swaps = ctx.get("swaps") or []
    if bias == "ceiling":
        lean = "Win probability is under 42%. I am taking the Ceiling Gambler's FLEX upside."
        use_swaps = swaps
    elif bias == "floor":
        lean = "Win probability is over 58%. I am siding with the Floor Conservator and the safer P10."
        use_swaps = []
    else:
        lean = "This is a coin-flip matchup. I am taking the optimizer's P50 swaps unless Injury vetoes them."
        use_swaps = swaps
    flag_blob = " ".join(flag.get("detail") or "" for flag in ctx.get("flags") or [])
    use_swaps = [
        swap
        for swap in use_swaps
        if (swap.get("start") or {}).get("full_name") not in flag_blob
    ]
    bullets = []
    if use_swaps:
        for swap in use_swaps[:4]:
            sit = (swap.get("sit") or {}).get("full_name")
            start = (swap.get("start") or {}).get("full_name")
            bullets.append(f"START {start} over {sit} at {swap.get('slot')}.")
    else:
        bullets.append("Hold current starters — do not donate P10 for fireworks.")
    if ctx.get("flags"):
        bullets.append("Move ineligible IR/taxi players before any add, or Sleeper will freeze the roster.")
    bullets.append("Re-check Friday practice tags before lock.")
    return (
        f"Head Coach: {lean}\n\n"
        + "\n".join(f"- {b}" for b in bullets)
        + f"\n\nFloor said: {floor[:120]}…\nCeiling said: {ceiling[:120]}…\n{injury[:160]}"
    )
