from __future__ import annotations

import csv
import io
import logging
from collections import defaultdict
from typing import Any

import httpx

from core.config import get_settings
from core.redis_client import Cache
from services.analytics.enrichment import (
    EnrichmentContext,
    UsageFeatures,
    VegasGame,
    canon_team,
    implied_scores,
)

log = logging.getLogger("nflverse")

PLAYERS_URL = "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv"
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
STATS_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/stats_player/"
    "stats_player_week_{season}.csv"
)
SNAPS_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/snap_counts/"
    "snap_counts_{season}.csv"
)


def _f(row: dict[str, str], key: str) -> float | None:
    raw = row.get(key)
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _i(row: dict[str, str], key: str) -> int | None:
    value = _f(row, key)
    return int(value) if value is not None else None


class NflverseClient:
    def __init__(self, cache: Cache) -> None:
        self.cache = cache
        self.settings = get_settings()

    async def _get_csv(self, url: str) -> list[dict[str, str]]:
        async with httpx.AsyncClient(
            timeout=60.0,
            follow_redirects=True,
            headers={"User-Agent": "GridironAI/0.1", "Accept": "text/csv"},
        ) as client:
            response = await client.get(url)
            if response.status_code == 404:
                return []
            response.raise_for_status()
            text = response.text
        reader = csv.DictReader(io.StringIO(text))
        return list(reader)

    async def load_context(self, season: str, week: int) -> EnrichmentContext:
        cache_key = f"nflverse:ctx:v2:{season}:{week}"
        cached = await self.cache.get_json(cache_key)
        if isinstance(cached, dict) and cached.get("loaded"):
            return _context_from_json(cached)

        try:
            context = await self._build_context(int(season), int(week))
        except Exception:
            log.exception("nflverse enrichment failed; using Sleeper-only projections")
            return EnrichmentContext(usage={}, vegas={}, loaded=False)

        await self.cache.set_json(
            cache_key,
            _context_to_json(context),
            ttl=self.settings.nflverse_ttl_seconds,
        )
        return context

    async def _build_context(self, season: int, week: int) -> EnrichmentContext:
        ids_rows, games_rows = await _gather_two(
            self._get_csv(PLAYERS_URL),
            self._get_csv(GAMES_URL),
        )
        gsis_to_sleeper: dict[str, str] = {}
        pfr_to_sleeper: dict[str, str] = {}
        for row in ids_rows:
            sleeper_id = (row.get("sleeper_id") or "").strip()
            if not sleeper_id:
                continue
            gsis = (row.get("gsis_id") or "").strip()
            pfr = (row.get("pfr_id") or "").strip()
            if gsis:
                gsis_to_sleeper[gsis] = sleeper_id
            if pfr:
                pfr_to_sleeper[pfr] = sleeper_id

        usage_season = season
        stats_rows = await self._get_csv(STATS_URL.format(season=usage_season))
        if not stats_rows:
            usage_season = season - 1
            stats_rows = await self._get_csv(STATS_URL.format(season=usage_season))
        snaps_rows = await self._get_csv(SNAPS_URL.format(season=usage_season))

        usage = _aggregate_usage(stats_rows, snaps_rows, gsis_to_sleeper, pfr_to_sleeper)
        vegas = _parse_vegas(games_rows, season, week)
        return EnrichmentContext(
            usage=usage,
            vegas=vegas,
            loaded=bool(usage or vegas),
            usage_season=str(usage_season),
        )


async def _gather_two(a, b):
    import asyncio

    return await asyncio.gather(a, b)


def _aggregate_usage(
    stats_rows: list[dict[str, str]],
    snaps_rows: list[dict[str, str]],
    gsis_to_sleeper: dict[str, str],
    pfr_to_sleeper: dict[str, str],
) -> dict[str, UsageFeatures]:
    buckets: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "n": 0,
            "target_share": 0.0,
            "air_yards_share": 0.0,
            "wopr": 0.0,
            "receiving_epa": 0.0,
            "team": None,
        }
    )
    for row in stats_rows:
        if (row.get("season_type") or "REG") not in {"REG", "regular"}:
            continue
        gsis = (row.get("player_id") or "").strip()
        sleeper_id = gsis_to_sleeper.get(gsis)
        if not sleeper_id:
            continue
        b = buckets[sleeper_id]
        b["n"] += 1
        for key in ("target_share", "air_yards_share", "wopr", "receiving_epa"):
            value = _f(row, key)
            if value is not None:
                b[key] += value
        b["team"] = row.get("team") or b["team"]

    snap_acc: dict[str, list[float]] = defaultdict(list)
    for row in snaps_rows:
        pfr = (row.get("pfr_player_id") or "").strip()
        sleeper_id = pfr_to_sleeper.get(pfr)
        if not sleeper_id:
            continue
        pct = _f(row, "offense_pct")
        if pct is None:
            continue
        if pct > 1.5:
            pct /= 100.0
        snap_acc[sleeper_id].append(pct)

    features: dict[str, UsageFeatures] = {}
    for sleeper_id, b in buckets.items():
        n = b["n"] or 1
        features[sleeper_id] = UsageFeatures(
            target_share=b["target_share"] / n,
            air_yards_share=b["air_yards_share"] / n,
            wopr=b["wopr"] / n,
            snap_share=(sum(snap_acc[sleeper_id]) / len(snap_acc[sleeper_id]))
            if snap_acc.get(sleeper_id)
            else None,
            receiving_epa=b["receiving_epa"] / n,
            games=b["n"],
            team=canon_team(b["team"]),
        )
    for sleeper_id, snaps in snap_acc.items():
        if sleeper_id in features:
            continue
        features[sleeper_id] = UsageFeatures(
            snap_share=sum(snaps) / len(snaps),
            games=len(snaps),
        )
    return features


def _parse_vegas(rows: list[dict[str, str]], season: int, week: int) -> dict[str, VegasGame]:
    games: dict[str, VegasGame] = {}
    for row in rows:
        if _i(row, "season") != season:
            continue
        if _i(row, "week") != week:
            continue
        if (row.get("game_type") or "REG") not in {"REG", "regular", "WC", "DIV", "CON", "SB"}:
            continue
        total = _f(row, "total_line")
        spread = _f(row, "spread_line")
        if total is None or spread is None:
            continue
        home_imp, away_imp = implied_scores(spread, total)
        home = canon_team(row.get("home_team"))
        away = canon_team(row.get("away_team"))
        wind = _f(row, "wind")
        roof = row.get("roof") or None
        gameday = row.get("gameday") or None
        gametime = row.get("gametime") or None
        result = row.get("result") or None
        home_score = _f(row, "home_score")
        away_score = _f(row, "away_score")
        if home:
            games[home] = VegasGame(
                implied_total=home_imp,
                opponent_implied=away_imp,
                spread=spread,
                total=total,
                opponent=away or "",
                roof=roof,
                wind=wind,
                gameday=gameday,
                gametime=gametime,
                result=result,
                home_score=home_score,
                away_score=away_score,
            )
        if away:
            games[away] = VegasGame(
                implied_total=away_imp,
                opponent_implied=home_imp,
                spread=-spread,
                total=total,
                opponent=home or "",
                roof=roof,
                wind=wind,
                gameday=gameday,
                gametime=gametime,
                result=result,
                home_score=home_score,
                away_score=away_score,
            )
    return games


def _context_to_json(ctx: EnrichmentContext) -> dict[str, Any]:
    return {
        "loaded": ctx.loaded,
        "usage_season": ctx.usage_season,
        "usage": {
            pid: {
                "target_share": feat.target_share,
                "air_yards_share": feat.air_yards_share,
                "wopr": feat.wopr,
                "snap_share": feat.snap_share,
                "receiving_epa": feat.receiving_epa,
                "games": feat.games,
                "team": feat.team,
            }
            for pid, feat in ctx.usage.items()
        },
        "vegas": {
            team: {
                "implied_total": game.implied_total,
                "opponent_implied": game.opponent_implied,
                "spread": game.spread,
                "total": game.total,
                "opponent": game.opponent,
                "roof": game.roof,
                "wind": game.wind,
                "gameday": game.gameday,
                "gametime": game.gametime,
                "result": game.result,
                "home_score": game.home_score,
                "away_score": game.away_score,
            }
            for team, game in ctx.vegas.items()
        },
    }


def _context_from_json(payload: dict[str, Any]) -> EnrichmentContext:
    usage = {
        pid: UsageFeatures(**feat) for pid, feat in (payload.get("usage") or {}).items()
    }
    vegas = {team: VegasGame(**game) for team, game in (payload.get("vegas") or {}).items()}
    return EnrichmentContext(
        usage=usage,
        vegas=vegas,
        loaded=bool(payload.get("loaded")),
        usage_season=payload.get("usage_season"),
    )
