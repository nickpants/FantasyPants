from __future__ import annotations

from typing import Any

IR_STATUS_FLAGS = {
    "Out": "reserve_allow_out",
    "IR": "reserve_allow_out",
    "PUP": "reserve_allow_out",
    "Doubtful": "reserve_allow_doubtful",
    "Questionable": None,
    "NA": "reserve_allow_na",
    "Suspended": "reserve_allow_sus",
    "COV": "reserve_allow_cov",
    "COVID": "reserve_allow_cov",
    "COVID-19": "reserve_allow_cov",
    "DNR": "reserve_allow_dnr",
}


def ir_status_allowed(injury_status: str | None, settings: dict[str, Any]) -> bool:
    if not injury_status:
        return False
    flag = IR_STATUS_FLAGS.get(injury_status)
    if flag is None:
        return False
    return bool(settings.get(flag))


def taxi_eligible(years_exp: int | None, settings: dict[str, Any]) -> bool:
    if not settings.get("taxi_slots"):
        return True
    if settings.get("taxi_allow_vets"):
        return True
    limit = int(settings.get("taxi_years") or 0)
    if limit <= 0:
        return True
    exp = 0 if years_exp is None else int(years_exp)
    return exp < limit


def validate_roster(
    roster: dict[str, Any],
    player_meta: dict[str, dict[str, Any]],
    settings: dict[str, Any],
    roster_positions: list[str],
) -> list[dict[str, Any]]:
    flags: list[dict[str, Any]] = []
    has_ir_slots = "IR" in roster_positions or int(settings.get("reserve_slots") or 0) > 0
    if has_ir_slots:
        for player_id in roster.get("reserve") or []:
            if not player_id or player_id == "0":
                continue
            meta = player_meta.get(player_id) or {}
            status = meta.get("injury_status")
            if not ir_status_allowed(status, settings):
                flags.append(
                    {
                        "code": "ir_ineligible",
                        "severity": "lock",
                        "player_id": player_id,
                        "full_name": meta.get("full_name") or player_id,
                        "detail": (
                            f"{meta.get('full_name') or player_id} is in IR with status "
                            f"{status or 'Healthy'}. Sleeper freezes adds until you move them out."
                        ),
                    }
                )
    if int(settings.get("taxi_slots") or 0) > 0:
        for player_id in roster.get("taxi") or []:
            if not player_id or player_id == "0":
                continue
            meta = player_meta.get(player_id) or {}
            if not taxi_eligible(meta.get("years_exp"), settings):
                flags.append(
                    {
                        "code": "taxi_ineligible",
                        "severity": "lock",
                        "player_id": player_id,
                        "full_name": meta.get("full_name") or player_id,
                        "detail": (
                            f"{meta.get('full_name') or player_id} exceeds taxi year limit "
                            f"({meta.get('years_exp')} exp)."
                        ),
                    }
                )
    return flags
