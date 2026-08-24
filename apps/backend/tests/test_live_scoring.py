from datetime import datetime, timedelta, timezone

from services.analytics.enrichment import VegasGame
from services.analytics.live_scoring import game_phase, is_toast, remaining_projection
from services.analytics.monte_carlo import simulate_live_players
from services.analytics.projections import PlayerProjection


def _game(**kwargs) -> VegasGame:
    base = dict(
        implied_total=24.0,
        opponent_implied=21.0,
        spread=-3,
        total=45,
        opponent="CHI",
        gameday="2026-09-10",
        gametime="20:20",
    )
    base.update(kwargs)
    return VegasGame(**base)


def test_upcoming_before_kickoff():
    game = _game()
    now = datetime(2026, 9, 10, 16, 0, tzinfo=timezone.utc)  # 12:00 ET
    phase, progress = game_phase(game, now)
    assert phase == "upcoming"
    assert progress == 0.0


def test_final_when_result_posted():
    phase, progress = game_phase(_game(result="3"), datetime.now(timezone.utc))
    assert phase == "final"
    assert progress == 1.0


def test_remaining_shrinks_with_progress():
    rem0, _ = remaining_projection(20, 6, 0.0, 0)
    rem_half, sig_half = remaining_projection(20, 6, 0.5, 8)
    rem_done, _ = remaining_projection(20, 6, 1.0, 18)
    assert rem0 == 20
    assert rem_half == 6  # (20-8)*0.5
    assert sig_half < 6
    assert rem_done == 0


def test_toast_only_after_final_dud():
    assert is_toast(2.0, 18.0, "final")
    assert not is_toast(2.0, 18.0, "live")
    assert not is_toast(16.0, 18.0, "final")


def test_live_sim_locks_final_to_actual():
    player = PlayerProjection("a", "RB", "A", "KC", None, 20, 5, 0.8, "t", True)
    dists = simulate_live_players(
        [player],
        200,
        actuals={"a": 14.4},
        phases={"a": ("final", 1.0)},
    )
    assert dists["a"].p10 == 14.4
    assert dists["a"].p50 == 14.4
    assert dists["a"].p90 == 14.4
