import asyncio
import time

import pytest

from services.sleeper.client import TokenBucket


@pytest.mark.asyncio
async def test_token_bucket_allows_burst_then_waits():
    bucket = TokenBucket(rate=2, per_seconds=1)
    waited = await bucket.acquire()
    assert waited == 0.0
    waited = await bucket.acquire()
    assert waited == 0.0
    started = time.monotonic()
    waited = await bucket.acquire()
    elapsed = time.monotonic() - started
    assert waited > 0
    assert elapsed >= 0.3


@pytest.mark.asyncio
async def test_token_bucket_serializes_concurrent_acquires():
    bucket = TokenBucket(rate=5, per_seconds=1)
    results = await asyncio.gather(*[bucket.acquire() for _ in range(5)])
    assert all(wait == 0.0 for wait in results)
