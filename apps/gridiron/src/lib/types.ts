export type JsonScalar = string | number | boolean | null;
export type SettingsMap = Record<string, JsonScalar>;

export type SleeperUser = {
  sleeper_user_id: string;
  username: string;
  display_name?: string | null;
  avatar?: string | null;
};

export type NflState = {
  week: number;
  season: string;
  season_type: string;
  display_week?: number;
  league_season?: string;
  previous_season?: string;
};

export type League = {
  sleeper_league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: SettingsMap;
  is_dynasty: boolean;
  avatar?: string | null;
  status?: string | null;
  scoring_summary?: string;
  draft_id?: string;
};

export type PracticeTag = "FP" | "LP" | "DNP";

export type Player = {
  player_id: string;
  full_name: string;
  position: string;
  nfl_team?: string | null;
  injury_status?: string | null;
  status?: string | null;
  years_exp?: number | null;
  gsis_id?: string | null;
  espn_id?: string | null;
  injury_body_part?: string | null;
  injury_notes?: string | null;
  practice_participation?: string | null;
  practice_status?: PracticeTag | null;
  practice_label?: string | null;
  beat_note?: string | null;
};

export type LeagueUser = {
  user_id: string;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
  team_name?: string | null;
  is_owner?: boolean;
};

export type Roster = {
  roster_id: number;
  owner_id?: string | null;
  team_name?: string | null;
  players: string[];
  starters: string[];
  reserve: string[];
  taxi: string[];
  waiver_budget_used: number;
  total_faab: number;
  wins: number;
  losses: number;
  ties: number;
  fpts?: number | null;
  owner?: LeagueUser | null;
  hydrated_players?: Player[];
  hydrated_starters?: Player[];
  hydrated_reserve?: Player[];
  hydrated_taxi?: Player[];
};

export type SyncUserResponse = {
  user: SleeperUser;
  season: string;
  nfl_state: NflState;
  leagues: League[];
};

export type LeagueDetailResponse = {
  league: League;
  users: LeagueUser[];
  rosters: Roster[];
  from_cache?: boolean;
  synced_at?: number;
};

export type Matchup = {
  week: number;
  matchup_id: number | null;
  roster_id: number;
  points: number | null;
  starters: string[];
  players_points?: Record<string, number> | null;
};

export type GameSlateRow = {
  team: string;
  opponent: string;
  home: boolean;
  spread: number | null;
  total: number | null;
  implied: number | null;
  roof: string | null;
  temp: number | null;
  wind: number | null;
  stadium?: string | null;
  source: string;
};

export type ProjectedPlayer = Player & {
  mu: number;
  sigma?: number;
  p10?: number;
  p50?: number;
  p90?: number;
  eligible?: boolean;
  opponent?: string | null;
  implied_total?: number | null;
  spread?: number | null;
  total?: number | null;
  roof?: string | null;
  wind?: number | null;
  env_mult?: number;
  injury_mult?: number;
};

export type LineupSlot = {
  slot: string;
  player: ProjectedPlayer | null;
};

export type LineupSide = {
  slots: LineupSlot[];
  p10: number;
  p50: number;
  p90: number;
};

export type LineupResponse = {
  league_id: string;
  roster_id: number;
  team_name?: string | null;
  week: number;
  season: string;
  scoring_summary: string;
  source: string;
  iterations: number;
  solver?: string;
  current: LineupSide;
  optimal: LineupSide;
  swaps: {
    slot: string;
    sit: ProjectedPlayer | null;
    start: ProjectedPlayer | null;
    delta_p50: number;
  }[];
  opponent: {
    roster_id: number;
    team_name?: string | null;
    p10: number;
    p50: number;
    p90: number;
    win_probability: number;
    optimal_win_probability: number;
  } | null;
  slate?: GameSlateRow[];
};

export type LiveStarter = {
  player_id: string;
  full_name: string;
  position?: string | null;
  nfl_team?: string | null;
  actual: number;
  projected: number;
  remaining: number;
  phase: "upcoming" | "live" | "final";
  progress: number;
  toast: boolean;
  practice_status?: PracticeTag | null;
  opponent?: string | null;
  implied_total?: number | null;
};

export type AnalyticsSide = Matchup & {
  team_name?: string | null;
  owner_id?: string | null;
  projected_floor: number;
  projected_median: number;
  projected_ceiling: number;
  win_probability: number;
  pregame_win_probability?: number;
  pregame_median?: number;
  live_starters?: LiveStarter[];
};

export type AnalyticsMatchup = {
  matchup_id: number | null;
  home: AnalyticsSide;
  away: AnalyticsSide | null;
};

export type MatchupAnalyticsResponse = {
  league_id: string;
  week: number;
  season: string;
  source: string;
  mode?: "pregame" | "live" | "final";
  scoring_summary: string;
  matchups: AnalyticsMatchup[];
  slate?: GameSlateRow[];
};

export type RosterFlag = {
  code: string;
  severity: string;
  player_id: string;
  full_name: string;
  detail: string;
};

export type FaabRow = {
  roster_id: number;
  team_name?: string | null;
  owner_id?: string | null;
  total_faab: number;
  used: number;
  remaining: number;
  parsed_spent: number;
};

export type WaiverTarget = {
  player_id: string;
  full_name: string;
  position: string;
  nfl_team?: string | null;
  injury_status?: string | null;
  p50: number;
  replacement_wire: number;
  rld_vs_wire: number;
  rld_vs_roster: number;
  rld: number;
  bids: { conservative: number; fair: number; aggressive: number } | null;
  practice_status?: PracticeTag | null;
  implied_total?: number | null;
};

export type WaiverBoardResponse = {
  league_id: string;
  week: number;
  season: string;
  is_faab: boolean;
  remaining_faab: number;
  roster_id: number;
  faab_table: FaabRow[];
  available: WaiverTarget[];
  compliance: { roster_id: number; team_name?: string | null; flags: RosterFlag[] }[];
  transactions: {
    week: number;
    type: string;
    status: string;
    bid: number | null;
    adds: Record<string, number>;
    drops: Record<string, number>;
    roster_ids: number[];
  }[];
};

export type TradePlayer = {
  player_id: string;
  full_name: string;
  position: string;
  nfl_team?: string | null;
  p50: number;
};

export type TradeDeskResponse = {
  league_id: string;
  week: number;
  season: string;
  rosters: {
    roster_id: number;
    team_name?: string | null;
    owner_id?: string | null;
    players: TradePlayer[];
  }[];
  recent_trades: { week: number; roster_ids: number[]; adds: Record<string, number>; drops: Record<string, number> }[];
};

export type TradeGradeResponse = {
  give: TradePlayer[];
  receive: TradePlayer[];
  give_p50: number;
  receive_p50: number;
  delta: number;
  grade: string;
};

export type DraftPlayer = {
  player_id: string;
  full_name: string;
  position: string;
  nfl_team?: string | null;
  injury_status?: string | null;
  p50: number;
  vor?: number;
  need?: string;
  score?: number;
  reason?: string;
  adp?: number | null;
};

export type DraftPick = {
  pick_no: number;
  round: number;
  draft_slot?: number;
  roster_id?: number;
  player_id: string;
  full_name: string;
  position?: string | null;
  nfl_team?: string | null;
  p50?: number | null;
  grade?: number | null;
};

export type DraftBoardResponse = {
  league_id: string;
  scoring_summary: string;
  source: string;
  draft: {
    draft_id: string;
    status: string;
    type: string;
    season: string;
    teams: number;
    rounds: number;
    pick_timer?: number;
    picks_made: number;
    total_picks: number;
  };
  on_the_clock: {
    pick_no: number;
    round: number;
    draft_slot: number;
    roster_id?: number | null;
    user_id?: string | null;
    team_name?: string | null;
    display_name?: string | null;
    is_you: boolean;
  } | null;
  picks_until_you: number | null;
  roster_id?: number | null;
  your_roster: DraftPick[];
  recommendations: DraftPlayer[];
  available: DraftPlayer[];
  recent_picks: DraftPick[];
};

export type CopilotResult = {
  configured: boolean;
  model: string;
  source: string;
  bias: string;
  agents: Partial<Record<"floor" | "ceiling" | "injury" | "trade" | "master", string>>;
};
