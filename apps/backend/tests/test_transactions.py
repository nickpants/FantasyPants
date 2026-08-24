from services.analytics.faab import grade_trade, replacement_level_delta, tiered_bids
from services.analytics.projections import PlayerProjection
from services.analytics.roster_rules import validate_roster
from services.sleeper.transaction_parser import faab_spent_by_roster, parse_transaction


def test_parse_waiver_bid_and_trade_faab_transfer():
    waiver = parse_transaction(
        {
            "type": "waiver",
            "status": "complete",
            "settings": {"waiver_bid": 21},
            "roster_ids": [1],
            "adds": {"9754": 1},
            "drops": {"12509": 1},
            "leg": 1,
        },
        week=1,
    )
    trade = parse_transaction(
        {
            "type": "trade",
            "status": "complete",
            "roster_ids": [2, 3],
            "waiver_budget": [{"sender": 2, "receiver": 3, "amount": 15}],
            "leg": 4,
        },
        week=4,
    )
    spent = faab_spent_by_roster([waiver, trade])
    assert spent[1] == 21
    assert spent[2] == 15
    assert 3 not in spent


def test_ir_lock_when_healthy_player_occupies_reserve():
    settings = {"reserve_slots": 2, "reserve_allow_out": 1, "reserve_allow_doubtful": 0}
    roster = {"reserve": ["p1"], "taxi": []}
    meta = {"p1": {"full_name": "Star RB", "injury_status": "Questionable", "years_exp": 4}}
    flags = validate_roster(roster, meta, settings, ["QB", "IR"])
    assert flags[0]["code"] == "ir_ineligible"
    assert flags[0]["severity"] == "lock"


def test_taxi_rejects_vet_when_vets_disallowed():
    settings = {"taxi_slots": 3, "taxi_years": 2, "taxi_allow_vets": 0}
    roster = {"reserve": [], "taxi": ["vet"]}
    meta = {"vet": {"full_name": "Old QB", "years_exp": 7}}
    flags = validate_roster(roster, meta, settings, ["QB", "TAXI"])
    assert flags[0]["code"] == "taxi_ineligible"


def test_tiered_bids_are_monotonic_and_capped():
    bids = tiered_bids(rld=4.0, remaining_faab=80, weeks_left=10, min_bid=0)
    assert 0 <= bids["conservative"] <= bids["fair"] <= bids["aggressive"] <= 80


def test_zero_rld_stays_at_min_bid():
    bids = tiered_bids(rld=0, remaining_faab=100, weeks_left=8, min_bid=1)
    assert bids == {"conservative": 1, "fair": 1, "aggressive": 1}


def test_rld_uses_next_best_available_at_position():
    target = PlayerProjection("a", "RB", "A", "KC", None, 18, 4, 0.8, "t", True)
    wire = [
        target,
        PlayerProjection("b", "RB", "B", "NE", None, 12, 4, 0.8, "t", True),
        PlayerProjection("c", "WR", "C", "MIA", None, 20, 4, 0.8, "t", True),
    ]
    roster = [PlayerProjection("d", "RB", "D", "BUF", None, 9, 4, 0.8, "t", True)]
    rld = replacement_level_delta(target, wire, roster)
    assert rld["replacement_wire"] == 12
    assert rld["rld_vs_wire"] == 6
    assert rld["worst_roster_comp"] == 9
    assert rld["rld"] == 9


def test_trade_grade_labels():
    assert grade_trade(10, 16)["grade"] == "steal"
    assert grade_trade(12, 12.2)["grade"] == "fair"
    assert grade_trade(20, 10)["grade"] == "lopsided"
