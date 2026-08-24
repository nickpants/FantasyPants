from services.analytics.scoring_engine import (
    calculate_sleeper_points,
    prepare_stat_line,
    slot_accepts,
    starter_slots,
    summarize_scoring,
)


def test_calculate_sleeper_points_ppr_with_te_premium():
    stats = {
        "pass_yd": 285,
        "pass_td": 2,
        "pass_int": 1,
        "rush_yd": 34,
        "rec": 6,
        "rec_yd": 78,
        "bonus_rec_te": 1,
    }
    scoring = {
        "pass_yd": 0.04,
        "pass_td": 4,
        "pass_int": -1,
        "rush_yd": 0.1,
        "rec": 1.0,
        "rec_yd": 0.1,
        "bonus_rec_te": 0.5,
    }
    assert calculate_sleeper_points(stats, scoring) == 36.1


def test_calculate_sleeper_points_ignores_unknown_and_non_numeric():
    assert calculate_sleeper_points({"rec": 3, "note": "boom"}, {"rec": 1}) == 3.0


def test_summarize_scoring():
    summary = summarize_scoring({"rec": 1, "pass_td": 6, "bonus_rec_te": 0.5})
    assert "Full PPR" in summary
    assert "6pt Pass TD" in summary
    assert "TE Premium" in summary


def test_prepare_stat_line_adds_te_premium_and_drops_adp():
    scoring = {"rec": 1.0, "rec_yd": 0.1, "bonus_rec_te": 0.5}
    stats = prepare_stat_line({"rec": 6, "rec_yd": 70, "adp_dd_ppr": 12, "pts_ppr": 99}, "TE", scoring)
    assert "adp_dd_ppr" not in stats
    assert stats["bonus_rec_te"] == 6
    assert calculate_sleeper_points(stats, scoring) == 16.0


def test_flex_eligibility():
    assert slot_accepts("FLEX", "RB")
    assert slot_accepts("SUPER_FLEX", "QB")
    assert not slot_accepts("FLEX", "QB")
    assert starter_slots(["QB", "FLEX", "BN", "IR"]) == ["QB", "FLEX"]
