from __future__ import annotations

import json
from typing import Any

from core.config import get_settings

try:
    from redis.asyncio import Redis
except ImportError:  # pragma: no cover
    Redis = None  # type: ignore[misc, assignment]


class MemoryCache:
    """Process-local fallback used when Redis is not configured."""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self._store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self._store[key] = value

    async def setex(self, key: str, seconds: int, value: str) -> None:
        self._store[key] = value

    async def delete(self, *keys: str) -> None:
        for key in keys:
            self._store.pop(key, None)

    async def ping(self) -> bool:
        return True

    async def close(self) -> None:
        return None


class Cache:
    def __init__(self, backend: Any) -> None:
        self._backend = backend

    @property
    def is_redis(self) -> bool:
        return Redis is not None and isinstance(self._backend, Redis)

    async def get_json(self, key: str) -> Any | None:
        raw = await self._backend.get(key)
        if raw is None:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        return json.loads(raw)

    async def set_json(self, key: str, value: Any, ttl: int | None = None) -> None:
        payload = json.dumps(value)
        if ttl:
            if hasattr(self._backend, "setex"):
                await self._backend.setex(key, ttl, payload)
            else:
                await self._backend.set(key, payload, ex=ttl)
        else:
            await self._backend.set(key, payload)

    async def ping(self) -> bool:
        try:
            result = await self._backend.ping()
            return bool(result)
        except Exception:
            return False

    async def close(self) -> None:
        close = getattr(self._backend, "close", None)
        if close:
            await close()


_cache: Cache | None = None


async def get_cache() -> Cache:
    global _cache
    if _cache is not None:
        return _cache

    settings = get_settings()
    if settings.redis_url and Redis is not None:
        client = Redis.from_url(settings.redis_url, decode_responses=True)
        try:
            await client.ping()
            _cache = Cache(client)
            return _cache
        except Exception:
            await client.close()

    _cache = Cache(MemoryCache())
    return _cache


async def close_cache() -> None:
    global _cache
    if _cache is not None:
        await _cache.close()
        _cache = None
