from services.analytics.enrichment import (
    UsageFeatures,
    VegasGame,
    apply_enrichment,
    implied_scores,
    vegas_mu_multiplier,
    weather_mu_multiplier,
)


def test_implied_scores_home_favorite():
    home, away = implied_scores(-6.5, 48.0)
    assert round(home, 2) == 27.25
    assert round(away, 2) == 20.75


def test_pass_catchers_boost_in_shootout():
    shootout = VegasGame(implied_total=29.0, opponent_implied=20.0, spread=-9, total=49, opponent="LV")
    dog = VegasGame(implied_total=17.0, opponent_implied=28.0, spread=11, total=45, opponent="KC")
    wr_hi = vegas_mu_multiplier(shootout, "WR")
    wr_lo = vegas_mu_multiplier(dog, "WR")
    assert wr_hi > 1.0
    assert wr_lo < 1.0
    def_vs_shootout = vegas_mu_multiplier(
        VegasGame(implied_total=20.0, opponent_implied=29.0, spread=9, total=49, opponent="KC"),
        "DEF",
    )
    assert def_vs_shootout < 1.0


def test_wind_hurts_passing():
    windy = VegasGame(
        implied_total=22.5,
        opponent_implied=22.5,
        spread=0,
        total=45,
        opponent="CHI",
        roof="outdoors",
        wind=18,
    )
    assert weather_mu_multiplier(windy, "WR") < 1.0
    assert weather_mu_multiplier(windy, "RB") > 1.0


def test_apply_enrichment_lifts_high_usage_wr_in_good_game():
    features = UsageFeatures(target_share=0.28, air_yards_share=0.32, wopr=0.7, snap_share=0.92, games=16, team="DET")
    game = VegasGame(implied_total=28.0, opponent_implied=21.0, spread=-7, total=49, opponent="CHI")
    mu, sigma_frac, skew, tag = apply_enrichment(15.0, "WR", features, game)
    assert mu > 15.0
    assert sigma_frac > 0.45
    assert skew > 1.15
    assert "vegas" in tag and "nflverse" in tag


def test_apply_enrichment_noop_without_context():
    mu, sigma_frac, skew, tag = apply_enrichment(15.0, "WR", None, None)
    assert mu == 15.0
    assert tag == ""
    assert sigma_frac == 0.45
