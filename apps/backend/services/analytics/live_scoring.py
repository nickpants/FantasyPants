from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from services.analytics.enrichment import VegasGame, canon_team, clamp
from services.analytics.projections import PlayerProjection

EASTERN = ZoneInfo("America/New_York")
GAME_SECONDS = 3.25 * 3600


def parse_kickoff(gameday: str | None, gametime: str | None) -> datetime | None:
    if not gameday:
        return None
    stamp = gameday.strip()
    time_part = (gametime or "13:00").strip() or "13:00"
    if len(time_part) == 4:
        time_part = f"0{time_part}"
    try:
        naive = datetime.strptime(f"{stamp} {time_part}", "%Y-%m-%d %H:%M")
    except ValueError:
        try:
            naive = datetime.strptime(stamp, "%Y-%m-%d")
        except ValueError:
            return None
    return naive.replace(tzinfo=EASTERN)


def game_phase(game: VegasGame | None, now: datetime | None = None) -> tuple[str, float]:
    """Return (upcoming|live|final, progress 0-1)."""
    if game is None:
        return "upcoming", 0.0
    result = (game.result or "").strip()
    if result not in {"", "NA"}:
        return "final", 1.0
    now = now or datetime.now(timezone.utc)
    kickoff = parse_kickoff(game.gameday, game.gametime)
    if kickoff is None:
        if game.home_score is not None and game.away_score is not None:
            return "final", 1.0
        return "upcoming", 0.0
    if now.astimezone(timezone.utc) < kickoff.astimezone(timezone.utc):
        return "upcoming", 0.0
    elapsed = (now.astimezone(timezone.utc) - kickoff.astimezone(timezone.utc)).total_seconds()
    if elapsed >= GAME_SECONDS:
        return "final", 1.0
    return "live", clamp(elapsed / GAME_SECONDS, 0.02, 0.98)


def remaining_projection(mu: float, sigma: float, progress: float, actual: float) -> tuple[float, float]:
    leftover = clamp(1.0 - progress, 0.0, 1.0)
    if leftover <= 0:
        return 0.0, 0.0
    if actual >= mu:
        rem_mu = mu * 0.12 * leftover
    else:
        rem_mu = (mu - actual) * leftover
    rem_sigma = max(0.15, sigma * leftover)
    return rem_mu, rem_sigma


def is_toast(actual: float, mu: float, phase: str) -> bool:
    if phase != "final" or mu < 6:
        return False
    return actual < 0.45 * mu


def actuals_from_matchup(matchup: dict[str, Any]) -> dict[str, float]:
    pts: dict[str, float] = {}
    raw = matchup.get("players_points") or {}
    if isinstance(raw, dict):
        for key, value in raw.items():
            try:
                pts[str(key)] = float(value)
            except (TypeError, ValueError):
                continue
    starters = matchup.get("starters") or []
    starter_pts = matchup.get("starters_points") or []
    if isinstance(starter_pts, list):
        for player_id, value in zip(starters, starter_pts):
            if not player_id or str(player_id) in pts:
                continue
            try:
                pts[str(player_id)] = float(value)
            except (TypeError, ValueError):
                continue
    return pts


def phase_for_player(
    player: PlayerProjection, games: dict[str, VegasGame], now: datetime | None = None
) -> tuple[str, float]:
    team = canon_team(player.nfl_team)
    if player.position == "DEF":
        team = canon_team(player.player_id) or team
    game = games.get(team) if team else None
    return game_phase(game, now)
