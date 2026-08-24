-- Database Schema: Sleeper Engine Implementation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS sleeper_players (
    player_id VARCHAR(32) PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    position VARCHAR(10) NOT NULL,
    nfl_team VARCHAR(10),
    injury_status VARCHAR(50),
    injury_body_part VARCHAR(100),
    injury_notes TEXT,
    depth_chart_order INT,
    depth_chart_position VARCHAR(10),
    years_exp INT,
    age NUMERIC(4,1),
    status VARCHAR(50),
    metadata JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sleeper_players_pos ON sleeper_players(position);
CREATE INDEX IF NOT EXISTS idx_sleeper_players_team ON sleeper_players(nfl_team);

CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE,
    sleeper_username VARCHAR(100),
    sleeper_user_id VARCHAR(64) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sleeper_leagues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sleeper_league_id VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    season VARCHAR(10) NOT NULL,
    total_rosters INT NOT NULL,
    roster_positions JSONB NOT NULL,
    scoring_settings JSONB NOT NULL,
    settings JSONB NOT NULL,
    is_dynasty BOOLEAN DEFAULT FALSE,
    avatar VARCHAR(255),
    status VARCHAR(50),
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sleeper_rosters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id VARCHAR(64) REFERENCES sleeper_leagues(sleeper_league_id) ON DELETE CASCADE,
    roster_id INT NOT NULL,
    owner_id VARCHAR(64),
    team_name VARCHAR(255),
    players JSONB,
    starters JSONB,
    reserve JSONB,
    taxi JSONB,
    waiver_budget_used INT DEFAULT 0,
    total_faab INT DEFAULT 100,
    settings JSONB,
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(league_id, roster_id)
);

CREATE TABLE IF NOT EXISTS sleeper_weekly_matchups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id VARCHAR(64) REFERENCES sleeper_leagues(sleeper_league_id) ON DELETE CASCADE,
    week INT NOT NULL,
    matchup_id INT,
    roster_id INT NOT NULL,
    points NUMERIC(6,2),
    starters JSONB,
    starters_points JSONB,
    players JSONB,
    players_points JSONB,
    projected_median NUMERIC(6,2),
    projected_floor NUMERIC(6,2),
    projected_ceiling NUMERIC(6,2),
    win_probability NUMERIC(4,3),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(league_id, week, roster_id)
);

CREATE TABLE IF NOT EXISTS qualitative_beat_intel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id VARCHAR(32) REFERENCES sleeper_players(player_id),
    source VARCHAR(100),
    report_text TEXT NOT NULL,
    impact_level VARCHAR(20),
    practice_status VARCHAR(20),
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_league_links (
    app_user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
    sleeper_league_id VARCHAR(64) REFERENCES sleeper_leagues(sleeper_league_id) ON DELETE CASCADE,
    PRIMARY KEY (app_user_id, sleeper_league_id)
);
