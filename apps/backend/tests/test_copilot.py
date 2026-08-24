import pytest

from agents.context import coach_bias, pack_context, pack_trade_context
from agents.heuristic import ceiling_brief, floor_brief, injury_brief, master_brief, trade_brief
from agents.orchestrator import run_debate, run_trade_debate
from services.rag.beat_retriever import classify_impact, format_report, practice_code


LINEUP = {
    "league_id": "1",
    "roster_id": 3,
    "team_name": "NateJones",
    "season": "2025",
    "week": 1,
    "scoring_summary": "Full PPR, 6pt Pass TD",
    "current": {
        "p10": 90,
        "p50": 120,
        "p90": 150,
        "slots": [
            {
                "slot": "QB",
                "player": {
                    "full_name": "Jared Goff",
                    "position": "QB",
                    "nfl_team": "DET",
                    "p10": 12,
                    "p50": 18,
                    "p90": 26,
                    "injury_status": None,
                },
            },
            {
                "slot": "FLEX",
                "player": {
                    "full_name": "Quinshon Judkins",
                    "position": "RB",
                    "nfl_team": "CLE",
                    "p10": 0,
                    "p50": 0,
                    "p90": 8,
                    "injury_status": "Questionable",
                },
            },
        ],
    },
    "optimal": {
        "p10": 100,
        "p50": 135,
        "p90": 170,
        "slots": [
            {
                "slot": "FLEX",
                "player": {
                    "full_name": "Cooper Kupp",
                    "position": "WR",
                    "nfl_team": "SEA",
                    "p10": 6,
                    "p50": 13,
                    "p90": 22,
                    "injury_status": None,
                },
            }
        ],
    },
    "swaps": [
        {
            "slot": "FLEX",
            "delta_p50": 11.7,
            "sit": {"full_name": "Quinshon Judkins"},
            "start": {"full_name": "Cooper Kupp"},
        }
    ],
    "opponent": {
        "team_name": "apandapls",
        "p50": 136,
        "win_probability": 0.32,
        "optimal_win_probability": 0.53,
    },
}


def test_coach_bias_thresholds():
    assert coach_bias(0.30) == "ceiling"
    assert coach_bias(0.70) == "floor"
    assert coach_bias(0.50) == "balanced"
    assert coach_bias(None) == "balanced"


def test_pack_context_includes_swaps_and_bias():
    packed = pack_context(
        LINEUP,
        flags=[{"detail": "Jayden Daniels is in IR with status Healthy."}],
    )
    assert packed["bias"] == "ceiling"
    assert "Cooper Kupp" in packed["text"]
    assert "Jayden Daniels" in packed["text"]
    assert "Win probability (current): 32%" in packed["text"]


def test_heuristic_briefs_name_players():
    packed = pack_context(LINEUP, flags=[{"detail": "IR lock on Jayden Daniels."}])
    assert "Jared Goff" in floor_brief(packed)
    assert "Cooper Kupp" in ceiling_brief(packed)
    assert "LOCKOUT" in injury_brief(packed)
    master = master_brief(packed, "floor", "ceiling", "injury")
    assert "Cooper Kupp" in master
    assert "Head Coach" in master


@pytest.mark.asyncio
async def test_run_debate_emits_all_agents_without_api_key():
    events = []
    async for event in run_debate(LINEUP, flags=[{"detail": "IR lock"}]):
        events.append(event)
    types = [event["type"] for event in events]
    assert types[0] == "status"
    assert events[0]["configured"] is False
    assert events[0]["source"] == "heuristic"
    agents = {event["agent"] for event in events if event["type"] == "agent"}
    assert agents == {"floor", "ceiling", "injury", "master"}
    assert types[-1] == "done"


def test_trade_brief_calls_the_delta():
    packed = pack_trade_context(
        {
            "league_id": "1",
            "week": 1,
            "season": "2025",
            "give": [{"full_name": "Jared Goff", "position": "QB", "p50": 22}],
            "receive": [{"full_name": "Jayden Daniels", "position": "QB", "p50": 25}],
            "delta": 3.0,
            "grade": "win",
        },
        remaining_faab=97,
        win_probability=0.32,
    )
    assert packed["topic"] == "trade"
    assert packed["bias"] == "ceiling"
    text = trade_brief(packed)
    assert "Jayden Daniels" in text
    assert "ACCEPT" in text


@pytest.mark.asyncio
async def test_trade_debate_emits_arbiter():
    grade = {
        "league_id": "1",
        "week": 1,
        "season": "2025",
        "give": [{"player_id": "1", "full_name": "Jared Goff", "position": "QB", "p50": 22}],
        "receive": [{"player_id": "2", "full_name": "Jayden Daniels", "position": "QB", "p50": 25}],
        "delta": 3.0,
        "grade": "win",
    }
    agents = {}
    async for event in run_trade_debate(grade, remaining_faab=40, win_probability=0.31):
        if event["type"] == "agent":
            agents[event["agent"]] = event["text"]
    assert "trade" in agents
    assert "master" in agents
    assert "ACCEPT" in agents["master"] or "Accept" in agents["trade"]


def test_practice_report_classifier():
    assert classify_impact("Out", "") == "High"
    assert classify_impact("Questionable", "Limited Participation in Practice") == "Moderate"
    assert practice_code("Did Not Participate in Practice") == "DNP"
    assert "Ankle" in format_report(
        {
            "full_name": "Amon-Ra St. Brown",
            "team": "DET",
            "week": "3",
            "report_status": "Questionable",
            "practice_status": "Limited Participation in Practice",
            "report_primary_injury": "Ankle",
        }
    )
