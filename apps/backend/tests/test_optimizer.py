from services.analytics.lp_optimizer import optimize_lineup
from services.analytics.projections import PlayerProjection


def _player(player_id: str, position: str, mu: float, eligible: bool = True) -> PlayerProjection:
    return PlayerProjection(
        player_id=player_id,
        position=position,
        full_name=player_id,
        nfl_team="DET",
        injury_status=None,
        mu=mu,
        sigma=mu * 0.4,
        skew=0.8,
        source="test",
        eligible=eligible,
    )


def test_optimizer_fills_flex_with_best_remaining_skill_player():
    players = [
        _player("qb1", "QB", 18),
        _player("rb1", "RB", 16),
        _player("rb2", "RB", 19),
        _player("wr1", "WR", 12),
        _player("te1", "TE", 9),
    ]
    lineup = optimize_lineup(["QB", "RB", "FLEX", "BN"], players)
    ids = [slot.player.player_id for slot in lineup if slot.player]
    assert set(ids) == {"qb1", "rb1", "rb2"}
    assert lineup[0].player and lineup[0].player.player_id == "qb1"
    assert lineup[1].player and lineup[1].player.position == "RB"


def test_optimizer_skips_inactive_and_respects_superflex():
    players = [
        _player("qb1", "QB", 22),
        _player("qb2", "QB", 17),
        _player("rb1", "RB", 14),
        _player("wr1", "WR", 11),
        _player("out", "RB", 40, eligible=False),
    ]
    lineup = optimize_lineup(["QB", "SUPER_FLEX"], players)
    ids = [slot.player.player_id for slot in lineup if slot.player]
    assert set(ids) == {"qb1", "qb2"}
    assert "out" not in ids
