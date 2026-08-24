from __future__ import annotations

import math
import random
from dataclasses import dataclass

from services.analytics.live_scoring import remaining_projection
from services.analytics.projections import PlayerProjection

SQRT_2_OVER_PI = math.sqrt(2.0 / math.pi)


def sample_skew_normal(
    mu: float,
    sigma: float,
    alpha: float,
    n: int,
    rng: random.Random,
) -> list[float]:
    """Azzalini skew-normal, scaled so mean≈mu and sd≈sigma, floored at 0."""
    if n <= 0:
        return []
    if sigma <= 1e-9:
        return [max(0.0, mu)] * n
    delta = alpha / math.sqrt(1.0 + alpha * alpha)
    var_adj = max(1e-9, 1.0 - 2.0 * delta * delta / math.pi)
    scale = sigma / math.sqrt(var_adj)
    loc = mu - scale * delta * SQRT_2_OVER_PI
    sqrt_rest = math.sqrt(max(0.0, 1.0 - delta * delta))
    samples = []
    for _ in range(n):
        u = rng.gauss(0.0, 1.0)
        v = rng.gauss(0.0, 1.0)
        z = delta * abs(u) + sqrt_rest * v
        samples.append(max(0.0, loc + scale * z))
    return samples


def percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return 0.0
    if p <= 0:
        return sorted_values[0]
    if p >= 100:
        return sorted_values[-1]
    idx = (len(sorted_values) - 1) * (p / 100.0)
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return sorted_values[lo]
    weight = idx - lo
    return sorted_values[lo] * (1 - weight) + sorted_values[hi] * weight


@dataclass
class ScoreDistribution:
    samples: list[float]
    p10: float
    p50: float
    p90: float

    @classmethod
    def from_samples(cls, samples: list[float]) -> ScoreDistribution:
        ordered = sorted(samples)
        return cls(
            samples=samples,
            p10=round(percentile(ordered, 10), 2),
            p50=round(percentile(ordered, 50), 2),
            p90=round(percentile(ordered, 90), 2),
        )


def simulate_players(
    players: list[PlayerProjection],
    n: int,
    rng: random.Random | None = None,
) -> dict[str, ScoreDistribution]:
    rng = rng or random.Random()
    return {
        player.player_id: ScoreDistribution.from_samples(
            sample_skew_normal(player.mu, player.sigma, player.skew, n, rng)
        )
        for player in players
    }


def simulate_live_players(
    players: list[PlayerProjection],
    n: int,
    *,
    actuals: dict[str, float],
    phases: dict[str, tuple[str, float]],
    rng: random.Random | None = None,
) -> dict[str, ScoreDistribution]:
    rng = rng or random.Random()
    out: dict[str, ScoreDistribution] = {}
    for player in players:
        phase, progress = phases.get(player.player_id, ("upcoming", 0.0))
        actual = float(actuals.get(player.player_id) or 0.0)
        if phase == "final":
            samples = [actual] * n
        elif phase == "live":
            rem_mu, rem_sigma = remaining_projection(player.mu, player.sigma, progress, actual)
            residual = sample_skew_normal(rem_mu, rem_sigma, player.skew, n, rng)
            samples = [actual + value for value in residual]
        else:
            samples = sample_skew_normal(player.mu, player.sigma, player.skew, n, rng)
        out[player.player_id] = ScoreDistribution.from_samples(samples)
    return out


def sum_samples(player_ids: list[str], dists: dict[str, ScoreDistribution], n: int) -> ScoreDistribution:
    totals = [0.0] * n
    for player_id in player_ids:
        dist = dists.get(player_id)
        if dist is None:
            continue
        samples = dist.samples
        for i in range(min(n, len(samples))):
            totals[i] += samples[i]
    return ScoreDistribution.from_samples(totals)


def win_probability(left: list[float], right: list[float]) -> float:
    n = min(len(left), len(right))
    if n == 0:
        return 0.5
    wins = sum(1 for i in range(n) if left[i] > right[i])
    return round(wins / n, 3)
