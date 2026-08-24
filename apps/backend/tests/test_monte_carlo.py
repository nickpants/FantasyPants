import random

from services.analytics.monte_carlo import sample_skew_normal, simulate_players, sum_samples, win_probability
from services.analytics.projections import PlayerProjection


def test_skew_normal_mean_is_near_mu():
    rng = random.Random(0)
    samples = sample_skew_normal(20.0, 6.0, 0.8, 8000, rng)
    mean = sum(samples) / len(samples)
    assert 18.0 < mean < 22.0
    assert min(samples) >= 0


def test_favorite_wins_most_simulations():
    rng = random.Random(1)
    strong = PlayerProjection("a", "RB", "A", "KC", None, 22, 5, 0.8, "t", True)
    weak = PlayerProjection("b", "RB", "B", "NE", None, 8, 4, 0.8, "t", True)
    dists = simulate_players([strong, weak], 4000, rng)
    wp = win_probability(dists["a"].samples, dists["b"].samples)
    assert wp > 0.85
    stacked = sum_samples(["a", "b"], dists, 4000)
    assert stacked.p10 < stacked.p50 < stacked.p90
