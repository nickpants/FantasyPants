"""Poll Sleeper matchups while the NFL week is live.

    cd apps/backend && ../../.venv/bin/python -m workers.matchup_poller
    MATCHUP_POLL_SECONDS=60 ../../.venv/bin/python -m workers.matchup_poller
"""

from __future__ import annotations

import asyncio
import logging
import os

from sqlalchemy import select

from core.config import get_settings
from core.database import init_db, session_scope
from core.models import SleeperLeague
from core.redis_client import close_cache, get_cache
from services.sleeper.client import SleeperClient
from services.sleeper.sync_manager import SyncManager

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("matchup_poller")


async def poll_once(sync: SyncManager, week: int) -> int:
    refreshed = 0
    async with session_scope() as session:
        leagues = (await session.execute(select(SleeperLeague))).scalars().all()
        for league in leagues:
            await sync.sync_matchups(session, league.sleeper_league_id, week)
            refreshed += 1
            log.info("Synced %s week %s", league.name, week)
    return refreshed


async def run() -> None:
    settings = get_settings()
    await init_db()
    cache = await get_cache()
    delay = int(os.environ.get("MATCHUP_POLL_SECONDS") or "0")
    async with SleeperClient(
        base_url=settings.sleeper_base_url,
        rate_limit_per_minute=settings.rate_limit_per_minute,
    ) as client:
        sync = SyncManager(client, cache)
        state = await sync.nfl_state()
        week = int(state.get("display_week") or state.get("week") or 1)
        if delay <= 0:
            count = await poll_once(sync, week)
            log.info("Matchup poll complete (%s leagues).", count)
        else:
            log.info("Polling Sleeper matchups every %ss (week %s)", delay, week)
            while True:
                try:
                    state = await sync.nfl_state(force=True)
                    week = int(state.get("display_week") or state.get("week") or week)
                    await poll_once(sync, week)
                except Exception:
                    log.exception("Matchup poll failed")
                await asyncio.sleep(delay)
    await close_cache()


if __name__ == "__main__":
    asyncio.run(run())
