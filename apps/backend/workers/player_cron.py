"""Daily /v1/players/nfl refresh. Run: python -m workers.player_cron from apps/backend."""

from __future__ import annotations

import asyncio
import logging

from core.config import get_settings
from core.database import init_db, session_scope
from core.redis_client import close_cache, get_cache
from services.sleeper.client import SleeperClient
from services.sleeper.player_cache import PlayerCacheManager

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("player_cron")


async def run() -> None:
    settings = get_settings()
    await init_db()
    cache = await get_cache()
    async with SleeperClient(
        base_url=settings.sleeper_base_url,
        rate_limit_per_minute=settings.rate_limit_per_minute,
        timeout=120.0,
    ) as client:
        manager = PlayerCacheManager(client, cache)
        async with session_scope() as session:
            summary = await manager.refresh(session, force=True)
            log.info("Player cache refresh complete: %s", summary)
    await close_cache()


if __name__ == "__main__":
    asyncio.run(run())
