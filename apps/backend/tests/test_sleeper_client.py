import httpx
import pytest
import respx

from services.sleeper.client import SleeperAPIError, SleeperClient
from services.sleeper.player_cache import normalize_player


@pytest.mark.asyncio
async def test_get_user_and_leagues():
    with respx.mock(base_url="https://api.sleeper.app/v1") as router:
        router.get("/user/nick").mock(
            return_value=httpx.Response(200, json={"user_id": "42", "username": "nick", "display_name": "Nick"})
        )
        router.get("/user/42/leagues/nfl/2026").mock(
            return_value=httpx.Response(200, json=[{"league_id": "99", "name": "Gridiron"}])
        )
        async with SleeperClient() as client:
            user = await client.get_user("nick")
            leagues = await client.get_user_leagues("42", "2026")
        assert user["user_id"] == "42"
        assert leagues[0]["league_id"] == "99"


@pytest.mark.asyncio
async def test_missing_user_is_404():
    with respx.mock(base_url="https://api.sleeper.app/v1") as router:
        router.get("/user/nope").mock(return_value=httpx.Response(200, content=b"null"))
        async with SleeperClient() as client:
            with pytest.raises(SleeperAPIError) as exc:
                await client.get_user("nope")
        assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_retries_on_429_then_succeeds():
    with respx.mock(base_url="https://api.sleeper.app/v1") as router:
        route = router.get("/state/nfl")
        route.side_effect = [
            httpx.Response(429, json={"error": "slow down"}),
            httpx.Response(200, json={"week": 3, "season": "2026"}),
        ]
        async with SleeperClient(max_retries=2) as client:
            state = await client.get_nfl_state()
        assert state["week"] == 3
        assert route.call_count == 2


def test_normalize_player_team_defense():
    row = normalize_player("DET", {"player_id": "DET", "first_name": "Detroit", "last_name": "", "position": "DEF", "team": "DET"})
    assert row["player_id"] == "DET"
    assert row["full_name"] == "Detroit"
    assert row["position"] == "DEF"
