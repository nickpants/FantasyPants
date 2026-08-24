from __future__ import annotations

from dataclasses import dataclass

LEAGUE_AVG_IMPLIED = 22.5
POSITION_SIGMA = {
    "QB": 0.32,
    "RB": 0.40,
    "WR": 0.45,
    "TE": 0.42,
    "K": 0.50,
    "DEF": 0.55,
}
POSITION_SKEW = {
    "QB": 0.25,
    "RB": 0.85,
    "WR": 1.15,
    "TE": 1.0,
    "K": 0.2,
    "DEF": 0.45,
}
TEAM_ALIASES = {
    "LAR": "LA",
    "LA": "LA",
    "WSH": "WAS",
    "WAS": "WAS",
    "JAC": "JAX",
    "JAX": "JAX",
}


def canon_team(team: str | None) -> str | None:
    if not team:
        return None
    code = team.strip().upper()
    return TEAM_ALIASES.get(code, code)


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def implied_scores(spread_line: float, total_line: float) -> tuple[float, float]:
    """Home, away implied points. nflverse spread_line is the home spread (negative = home favorite)."""
    home = (total_line - spread_line) / 2.0
    away = (total_line + spread_line) / 2.0
    return home, away


@dataclass(frozen=True)
class UsageFeatures:
    target_share: float | None = None
    air_yards_share: float | None = None
    wopr: float | None = None
    snap_share: float | None = None
    receiving_epa: float | None = None
    games: int = 0
    team: str | None = None


@dataclass(frozen=True)
class VegasGame:
    implied_total: float
    opponent_implied: float
    spread: float
    total: float
    opponent: str
    roof: str | None = None
    wind: float | None = None
    gameday: str | None = None
    gametime: str | None = None
    result: str | None = None
    home_score: float | None = None
    away_score: float | None = None


@dataclass
class EnrichmentContext:
    usage: dict[str, UsageFeatures]
    vegas: dict[str, VegasGame]
    loaded: bool = False
    usage_season: str | None = None


def vegas_mu_multiplier(game: VegasGame | None, position: str) -> float:
    if game is None:
        return 1.0
    if position == "DEF":
        delta = game.opponent_implied / LEAGUE_AVG_IMPLIED - 1.0
        return clamp(1.0 - 0.35 * delta, 0.85, 1.15)
    delta = game.implied_total / LEAGUE_AVG_IMPLIED - 1.0
    if position in {"QB", "WR", "TE"}:
        weight = 0.42
    elif position == "RB":
        weight = 0.28
    elif position == "K":
        weight = 0.22
    else:
        weight = 0.15
    return clamp(1.0 + weight * delta, 0.85, 1.18)


def weather_mu_multiplier(game: VegasGame | None, position: str) -> float:
    if game is None:
        return 1.0
    roof = (game.roof or "").lower()
    wind = game.wind or 0.0
    adj = 1.0
    if roof in {"dome", "closed"}:
        if position in {"QB", "WR", "TE"}:
            adj *= 1.02
    elif wind >= 15 and position in {"QB", "WR", "TE", "K"}:
        adj *= 0.96
    elif wind >= 15 and position == "RB":
        adj *= 1.02
    return adj


def usage_mu_multiplier(features: UsageFeatures | None, position: str) -> float:
    if features is None:
        return 1.0
    nudge = 1.0
    if position in {"WR", "TE"} and features.target_share is not None:
        nudge *= clamp(1.0 + (features.target_share - 0.16) * 0.55, 0.92, 1.10)
    if position == "RB" and features.snap_share is not None:
        nudge *= clamp(1.0 + (features.snap_share - 0.55) * 0.25, 0.94, 1.08)
    if position == "QB" and features.snap_share is not None:
        nudge *= 1.0 if features.snap_share >= 0.7 else 0.92
    return nudge


def usage_sigma_and_skew(
    features: UsageFeatures | None, position: str
) -> tuple[float, float]:
    sigma_frac = POSITION_SIGMA.get(position, 0.42)
    skew = POSITION_SKEW.get(position, 0.7)
    if features is None:
        return sigma_frac, skew
    snap = features.snap_share
    if snap is not None:
        sigma_frac *= 1.0 + 0.5 * max(0.0, 0.85 - snap)
    boom = max(features.wopr or 0.0, features.air_yards_share or 0.0)
    if position in {"WR", "TE"}:
        sigma_frac *= 1.0 + 0.28 * min(max(boom, 0.0), 1.2)
        skew += 0.7 * min(max(features.air_yards_share or 0.0, 0.0), 0.45)
    if position == "RB" and snap is not None and snap < 0.45:
        sigma_frac *= 1.15
        skew += 0.25
    return sigma_frac, skew


def apply_enrichment(
    mu: float,
    position: str,
    features: UsageFeatures | None,
    game: VegasGame | None,
) -> tuple[float, float, float, str]:
    """Return mu, sigma_frac, skew, tag."""
    tags = []
    mu_adj = mu * usage_mu_multiplier(features, position)
    if features and (features.target_share or features.snap_share):
        tags.append("nflverse")
    vegas_mult = vegas_mu_multiplier(game, position) * weather_mu_multiplier(game, position)
    if game is not None:
        mu_adj *= vegas_mult
        tags.append("vegas")
    sigma_frac, skew = usage_sigma_and_skew(features, position)
    return mu_adj, sigma_frac, skew, "+".join(tags) if tags else ""
