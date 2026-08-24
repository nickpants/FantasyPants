from __future__ import annotations

import asyncio
import random
import time
from typing import Any

import httpx


class SleeperAPIError(Exception):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class TokenBucket:
    """Sliding token bucket matching Sleeper's 1000 req/min guidance."""

    def __init__(self, rate: int = 1000, per_seconds: float = 60.0) -> None:
        if rate <= 0 or per_seconds <= 0:
            raise ValueError("rate and per_seconds must be positive")
        self.rate = rate
        self.per_seconds = per_seconds
        self.tokens = float(rate)
        self.updated_at = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> float:
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self.updated_at
            refill = elapsed * (self.rate / self.per_seconds)
            self.tokens = min(float(self.rate), self.tokens + refill)
            self.updated_at = now
            if self.tokens >= 1:
                self.tokens -= 1
                return 0.0
            wait = (1 - self.tokens) * (self.per_seconds / self.rate)
            self.tokens = 0.0
        await asyncio.sleep(wait)
        return wait


class SleeperClient:
    def __init__(
        self,
        base_url: str = "https://api.sleeper.app/v1",
        *,
        rate_limit_per_minute: int = 1000,
        timeout: float = 30.0,
        max_retries: int = 4,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self._bucket = TokenBucket(rate=rate_limit_per_minute)
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=timeout,
            headers={"Accept": "application/json", "User-Agent": "GridironAI/0.1"},
        )

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> SleeperClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            await self._bucket.acquire()
            try:
                response = await self._client.get(path, params=params)
            except httpx.TransportError as exc:
                last_error = exc
                await self._backoff(attempt)
                continue

            if response.status_code == 404:
                raise SleeperAPIError(f"Not found: {path}", status_code=404)
            if response.status_code in {429, 500, 502, 503, 504}:
                last_error = SleeperAPIError(
                    f"Sleeper {response.status_code} on {path}",
                    status_code=response.status_code,
                )
                await self._backoff(attempt)
                continue
            if response.status_code >= 400:
                raise SleeperAPIError(
                    f"Sleeper {response.status_code}: {response.text[:200]}",
                    status_code=response.status_code,
                )
            if not response.content:
                return None
            return response.json()

        raise SleeperAPIError(f"Exhausted retries for {path}: {last_error}")

    async def _backoff(self, attempt: int) -> None:
        if attempt >= self.max_retries:
            return
        delay = (2**attempt) + random.random()
        await asyncio.sleep(delay)

    async def get_nfl_state(self) -> dict[str, Any]:
        return await self._get("/state/nfl")

    async def get_user(self, username_or_id: str) -> dict[str, Any]:
        payload = await self._get(f"/user/{username_or_id}")
        if not payload:
            raise SleeperAPIError(
                f"Sleeper user '{username_or_id}' not found",
                status_code=404,
            )
        return payload

    async def get_user_leagues(
        self, user_id: str, season: str, sport: str = "nfl"
    ) -> list[dict[str, Any]]:
        return await self._get(f"/user/{user_id}/leagues/{sport}/{season}")

    async def get_league(self, league_id: str) -> dict[str, Any]:
        return await self._get(f"/league/{league_id}")

    async def get_rosters(self, league_id: str) -> list[dict[str, Any]]:
        return await self._get(f"/league/{league_id}/rosters")

    async def get_league_users(self, league_id: str) -> list[dict[str, Any]]:
        return await self._get(f"/league/{league_id}/users")

    async def get_matchups(self, league_id: str, week: int) -> list[dict[str, Any]]:
        return await self._get(f"/league/{league_id}/matchups/{week}")

    async def get_transactions(self, league_id: str, week: int) -> list[dict[str, Any]]:
        return await self._get(f"/league/{league_id}/transactions/{week}")

    async def get_traded_picks(self, league_id: str) -> list[dict[str, Any]]:
        return await self._get(f"/league/{league_id}/traded_picks")

    async def get_draft(self, draft_id: str) -> dict[str, Any]:
        payload = await self._get(f"/draft/{draft_id}")
        return payload if isinstance(payload, dict) else {}

    async def get_league_drafts(self, league_id: str) -> list[dict[str, Any]]:
        payload = await self._get(f"/league/{league_id}/drafts")
        return payload if isinstance(payload, list) else []

    async def get_draft_picks(self, draft_id: str) -> list[dict[str, Any]]:
        payload = await self._get(f"/draft/{draft_id}/picks")
        return payload if isinstance(payload, list) else []

    async def get_draft_traded_picks(self, draft_id: str) -> list[dict[str, Any]]:
        payload = await self._get(f"/draft/{draft_id}/traded_picks")
        return payload if isinstance(payload, list) else []

    async def get_all_players(self, sport: str = "nfl") -> dict[str, dict[str, Any]]:
        return await self._get(f"/players/{sport}")

    async def get_projections(
        self,
        season: str,
        week: int,
        *,
        season_type: str = "regular",
        sport: str = "nfl",
    ) -> dict[str, dict[str, Any]]:
        payload = await self._get(f"/projections/{sport}/{season_type}/{season}/{week}")
        return payload if isinstance(payload, dict) else {}

    async def get_weekly_stats(
        self,
        season: str,
        week: int,
        *,
        season_type: str = "regular",
        sport: str = "nfl",
    ) -> dict[str, dict[str, Any]]:
        payload = await self._get(f"/stats/{sport}/{season_type}/{season}/{week}")
        return payload if isinstance(payload, dict) else {}

    async def get_season_stats(
        self,
        season: str,
        *,
        season_type: str = "regular",
        sport: str = "nfl",
    ) -> dict[str, dict[str, Any]]:
        payload = await self._get(f"/stats/{sport}/{season_type}/{season}")
        return payload if isinstance(payload, dict) else {}

    async def get_trending_players(
        self,
        *,
        sport: str = "nfl",
        kind: str = "add",
        lookback_hours: int = 24,
        limit: int = 25,
    ) -> list[dict[str, Any]]:
        return await self._get(
            f"/players/{sport}/trending/{kind}",
            params={"lookback_hours": lookback_hours, "limit": limit},
        )
