from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.config import get_settings
from core.redis_client import Cache
from services.analytics.scoring_engine import (
    INACTIVE_INJURIES,
    calculate_sleeper_points,
    prepare_stat_line,
)
from services.analytics.enrichment import (
    EnrichmentContext,
    POSITION_SIGMA,
    POSITION_SKEW,
    apply_enrichment,
    canon_team,
)
from services.sleeper.client import SleeperClient


@dataclass
class PlayerProjection:
    player_id: str
    position: str
    full_name: str
    nfl_team: str | None
    injury_status: str | None
    mu: float
    sigma: float
    skew: float
    source: str
    eligible: bool
    vegas_implied: float | None = None
    snap_share: float | None = None
    wopr: float | None = None


def injury_multiplier(status: str | None) -> float:
    if not status:
        return 1.0
    if status in INACTIVE_INJURIES:
        return 0.0
    if status == "Doubtful":
        return 0.35
    if status == "Questionable":
        return 0.85
    return 1.0


def _weekly_from_season(season_row: dict[str, Any]) -> dict[str, Any]:
    games = float(season_row.get("gp") or 0) or 1.0
    weekly: dict[str, Any] = {}
    for key, value in season_row.items():
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        weekly[key] = numeric / games if key != "gp" else 1.0
    return weekly


class ProjectionService:
    def __init__(self, client: SleeperClient, cache: Cache) -> None:
        self.client = client
        self.cache = cache
        self.settings = get_settings()
        self._nflverse = None

    async def load_stat_rows(self, season: str, week: int, season_type: str) -> tuple[dict[str, dict[str, Any]], str]:
        cache_key = f"sleeper:proj:{season_type}:{season}:{week}"
        cached = await self.cache.get_json(cache_key)
        if isinstance(cached, dict) and cached.get("rows"):
            return cached["rows"], cached.get("source", "sleeper_projections")

        projections = await self.client.get_projections(season, week, season_type=season_type)
        usable = {
            pid: row
            for pid, row in projections.items()
            if isinstance(row, dict) and any(k in row for k in ("pass_yd", "rush_yd", "rec", "rec_yd", "fgm", "pts_ppr"))
        }
        source = "sleeper_projections"
        if len(usable) < 50:
            season_stats = await self.client.get_season_stats(season, season_type=season_type)
            usable = {
                pid: _weekly_from_season(row)
                for pid, row in season_stats.items()
                if isinstance(row, dict) and float(row.get("gp") or 0) > 0
            }
            source = "season_per_game"

        await self.cache.set_json(
            cache_key,
            {"rows": usable, "source": source},
            ttl=self.settings.projection_ttl_seconds,
        )
        return usable, source

    async def load_context(self, season: str, week: int) -> EnrichmentContext:
        if not self.settings.nflverse_enabled:
            return EnrichmentContext(usage={}, vegas={}, loaded=False)
        if self._nflverse is None:
            from services.analytics.nflverse import NflverseClient

            self._nflverse = NflverseClient(self.cache)
        return await self._nflverse.load_context(season, week)

    def project_player(
        self,
        player_id: str,
        meta: dict[str, Any],
        row: dict[str, Any] | None,
        scoring_settings: dict[str, Any],
        source: str,
        context: EnrichmentContext | None = None,
    ) -> PlayerProjection:
        position = meta.get("position") or "FLEX"
        injury = meta.get("injury_status")
        stats = prepare_stat_line(row or {}, position, scoring_settings)
        mu = calculate_sleeper_points(stats, scoring_settings)
        mu *= injury_multiplier(injury)
        sigma_frac = POSITION_SIGMA.get(position, 0.42)
        skew = POSITION_SKEW.get(position, 0.7)
        vegas_implied = None
        snap_share = None
        wopr = None
        tag = ""
        if context and context.loaded and mu > 0 and injury not in INACTIVE_INJURIES:
            features = context.usage.get(player_id)
            team = canon_team((features.team if features else None) or meta.get("nfl_team"))
            game = context.vegas.get(team) if team else None
            mu, sigma_frac, skew, tag = apply_enrichment(mu, position, features, game)
            vegas_implied = game.implied_total if game else None
            snap_share = features.snap_share if features else None
            wopr = features.wopr if features else None
        sigma = max(0.35, mu * sigma_frac) if mu > 0 else 0.15
        if injury in INACTIVE_INJURIES:
            sigma = 0.05
        out_source = source if row else "unprojected"
        if tag:
            out_source = f"{out_source}+{tag}"
        return PlayerProjection(
            player_id=player_id,
            position=position,
            full_name=meta.get("full_name") or player_id,
            nfl_team=meta.get("nfl_team"),
            injury_status=injury,
            mu=round(mu, 2),
            sigma=round(sigma, 3),
            skew=round(skew, 3),
            source=out_source,
            eligible=injury not in INACTIVE_INJURIES,
            vegas_implied=round(vegas_implied, 2) if vegas_implied is not None else None,
            snap_share=round(snap_share, 3) if snap_share is not None else None,
            wopr=round(wopr, 3) if wopr is not None else None,
        )
