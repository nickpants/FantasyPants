from services.analytics.draft_math import (
    picks_until_roster,
    position_need,
    recommend_score,
    slot_for_pick,
    vor_for_player,
)
from services.analytics.projections import PlayerProjection


def test_snake_slot_first_round_left_to_right():
    assert [slot_for_pick(n, 10, "snake") for n in range(1, 11)] == list(range(1, 11))


def test_snake_slot_second_round_reverses():
    # pick 11 is slot 10, pick 12 is slot 9
    assert slot_for_pick(11, 10, "snake") == 10
    assert slot_for_pick(12, 10, "snake") == 9
    assert slot_for_pick(20, 10, "snake") == 1


def test_linear_does_not_reverse():
    assert slot_for_pick(11, 10, "linear") == 1
    assert slot_for_pick(12, 10, "linear") == 2


def test_picks_until_your_turn_on_snake():
    slot_to_roster = {str(i): i for i in range(1, 11)}
    # roster 1 has slot 1: picks 1, 20, 21...
    assert picks_until_roster(1, 1, 10, 14, "snake", slot_to_roster) == 0
    assert picks_until_roster(2, 1, 10, 14, "snake", slot_to_roster) == 18


def test_position_need_fills_starter_then_flex():
    positions = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"]
    assert position_need(["RB"], positions, "RB") == "starter"
    assert position_need(["RB", "RB"], positions, "RB") == "flex"
    assert position_need(["RB", "RB", "WR"], positions, "RB") == "flex"
    assert position_need(["RB", "RB", "WR", "WR", "TE"], positions, "RB") == "flex"
    assert position_need(["RB", "RB", "WR", "WR", "TE", "WR"], positions, "RB") == "bench"


def test_vor_vs_replacement_at_position():
    players = [
        PlayerProjection("a", "RB", "A", "KC", None, 20, 4, 0.8, "t", True),
        PlayerProjection("b", "RB", "B", "NE", None, 12, 4, 0.8, "t", True),
        PlayerProjection("c", "RB", "C", "BUF", None, 8, 4, 0.8, "t", True),
    ]
    vor = vor_for_player(players[0], players, starter_slots_at_pos=1, teams=2, already_drafted_at_pos=0)
    # remaining starters = 2, replacement index 1 among others -> player b (12) 
    # others sorted: b=12, c=8; idx = min(max(2,1)-1, 1) = 1 -> c=8
    assert vor == 12.0
    assert recommend_score(vor, "starter") > recommend_score(vor, "bench")
