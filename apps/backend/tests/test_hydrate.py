from services.sleeper.sync_manager import hydrate_ids


def test_hydrate_ids_skips_empty_sleeper_slots():
    players = {
        "4034": {
            "player_id": "4034",
            "full_name": "Christian McCaffrey",
            "position": "RB",
            "nfl_team": "SF",
            "injury_status": None,
            "status": "Active",
        }
    }
    hydrated = hydrate_ids(["4034", "0", ""], players)
    assert hydrated[0]["full_name"] == "Christian McCaffrey"
    assert hydrated[1]["full_name"] == "Empty"
    assert hydrated[2]["full_name"] == "Empty"
