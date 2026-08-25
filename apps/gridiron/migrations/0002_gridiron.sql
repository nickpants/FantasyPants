-- Public Sleeper + nflverse snapshots (unowned — same data the APIs already expose).
create table if not exists ingest_meta (
  key text primary key,
  fetched_at bigint not null,
  extra text
);

create table if not exists sleeper_players_catalog (
  id text primary key,
  fetched_at bigint not null,
  players jsonb not null
);

create table if not exists sleeper_leagues (
  sleeper_league_id text primary key,
  name text not null,
  season text not null,
  total_rosters int not null,
  roster_positions jsonb not null,
  scoring_settings jsonb not null,
  settings jsonb not null,
  is_dynasty boolean not null default false,
  avatar text,
  status text,
  draft_id text,
  synced_at bigint not null
);

create table if not exists sleeper_league_users (
  league_id text not null,
  user_id text not null,
  username text,
  display_name text,
  avatar text,
  team_name text,
  is_owner boolean not null default false,
  primary key (league_id, user_id)
);

create table if not exists sleeper_rosters (
  league_id text not null,
  roster_id int not null,
  owner_id text,
  team_name text,
  players jsonb not null,
  starters jsonb not null,
  reserve jsonb not null,
  taxi jsonb not null,
  waiver_budget_used int not null default 0,
  total_faab int not null default 100,
  wins int not null default 0,
  losses int not null default 0,
  ties int not null default 0,
  fpts double precision,
  owner jsonb,
  primary key (league_id, roster_id)
);

create table if not exists nfl_games (
  game_id text primary key,
  season text not null,
  week int not null,
  game_type text,
  gameday text,
  away_team text not null,
  home_team text not null,
  spread_line double precision,
  total_line double precision,
  roof text,
  surface text,
  temp double precision,
  wind double precision,
  stadium text,
  source text not null,
  updated_at bigint not null
);
create index if not exists nfl_games_season_week on nfl_games (season, week);

create table if not exists nfl_practice (
  season text not null,
  week int not null,
  player_key text not null,
  gsis_id text,
  espn_id text,
  full_name text,
  team text,
  position text,
  practice_status text,
  report_status text,
  injury text,
  note text,
  source text not null,
  updated_at bigint not null,
  primary key (season, week, player_key)
);
