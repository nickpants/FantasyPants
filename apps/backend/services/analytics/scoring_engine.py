from __future__ import annotations

from typing import Any

FLEX_ELIGIBILITY: dict[str, set[str]] = {
    "QB": {"QB"},
    "RB": {"RB"},
    "WR": {"WR"},
    "TE": {"TE"},
    "K": {"K"},
    "DEF": {"DEF"},
    "DL": {"DL", "DE", "DT"},
    "LB": {"LB"},
    "DB": {"DB", "CB", "S", "SS", "FS"},
    "FLEX": {"RB", "WR", "TE"},
    "WRRB_FLEX": {"RB", "WR"},
    "REC_FLEX": {"WR", "TE"},
    "SUPER_FLEX": {"QB", "RB", "WR", "TE"},
    "IDP_FLEX": {"DL", "LB", "DB", "DE", "DT", "CB", "S", "SS", "FS"},
}

NON_STARTER_SLOTS = {"BN", "IR", "TAXI"}
INACTIVE_INJURIES = {"Out", "IR", "PUP", "Suspended", "NA"}

# Projection payloads include ADP / precomputed point totals that are not league scoring keys.
NON_SCORING_STAT_KEYS = {
    "adp_dd_ppr",
    "pos_adp_dd_ppr",
    "gp",
    "gs",
    "gms_active",
    "pts_ppr",
    "pts_std",
    "pts_half_ppr",
    "pos_rank_ppr",
    "pos_rank_std",
    "pos_rank_half_ppr",
    "rank_ppr",
    "rank_std",
    "rank_half_ppr",
    "cmp_pct",
}


def prepare_stat_line(stat_dict: dict[str, Any], position: str, scoring_settings: dict[str, Any]) -> dict[str, Any]:
    """Copy a Sleeper stat/projection row and fill positional bonus keys the league scores."""
    stats = {key: value for key, value in stat_dict.items() if key not in NON_SCORING_STAT_KEYS}
    rec = stats.get("rec") or 0
    if position == "TE" and "bonus_rec_te" in scoring_settings and "bonus_rec_te" not in stats:
        stats["bonus_rec_te"] = rec
    if position == "RB" and "bonus_rec_rb" in scoring_settings and "bonus_rec_rb" not in stats:
        stats["bonus_rec_rb"] = rec
    if position == "WR" and "bonus_rec_wr" in scoring_settings and "bonus_rec_wr" not in stats:
        stats["bonus_rec_wr"] = rec
    return stats


def calculate_sleeper_points(stat_dict: dict[str, Any], scoring_settings: dict[str, Any]) -> float:
    total = 0.0
    for key, value in stat_dict.items():
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        try:
            multiplier = float(scoring_settings.get(key, 0.0) or 0.0)
        except (TypeError, ValueError):
            multiplier = 0.0
        total += numeric * multiplier
    return round(total, 2)


def summarize_scoring(scoring_settings: dict[str, Any]) -> str:
    rec = float(scoring_settings.get("rec") or 0)
    if rec >= 1:
        ppr = "Full PPR"
    elif rec >= 0.5:
        ppr = "Half PPR"
    else:
        ppr = "Standard (0 PPR)"
    pass_td = scoring_settings.get("pass_td")
    te_prem = scoring_settings.get("bonus_rec_te")
    parts = [ppr]
    if pass_td is not None:
        parts.append(f"{pass_td}pt Pass TD")
    if te_prem:
        parts.append(f"{te_prem} TE Premium")
    return ", ".join(parts)


def starter_slots(roster_positions: list[str]) -> list[str]:
    return [slot for slot in roster_positions if slot not in NON_STARTER_SLOTS]


def slot_accepts(slot: str, position: str) -> bool:
    allowed = FLEX_ELIGIBILITY.get(slot)
    if allowed is None:
        return position == slot
    return position in allowed
