import { getSql, type Sql } from "@/lib/db";
import type { League, LeagueDetailResponse, LeagueUser, Player, Roster } from "@/lib/types";
import { cacheGet, cacheSet } from "./cache";

const LEAGUE_TTL_MS = 3 * 60 * 1000;
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const GAMES_TTL_MS = 6 * 60 * 60 * 1000;
const PRACTICE_TTL_MS = 30 * 60 * 1000;

export type NflGameRow = {
  game_id: string;
  season: string;
  week: number;
  game_type: string | null;
  gameday: string | null;
  away_team: string;
  home_team: string;
  spread_line: number | null;
  total_line: number | null;
  roof: string | null;
  surface: string | null;
  temp: number | null;
  wind: number | null;
  stadium: string | null;
  source: string;
};

export type PracticeRow = {
  season: string;
  week: number;
  player_key: string;
  gsis_id: string | null;
  espn_id: string | null;
  full_name: string | null;
  team: string | null;
  position: string | null;
  practice_status: string | null;
  report_status: string | null;
  injury: string | null;
  note: string | null;
  source: string;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function withSql<T>(fn: (sql: Sql) => Promise<T>): Promise<T | null> {
  try {
    const sql = await getSql();
    return await fn(sql);
  } catch {
    return null;
  }
}

export async function metaGet(key: string): Promise<{ fetched_at: number; extra: string | null } | null> {
  const mem = cacheGet<{ fetched_at: number; extra: string | null }>(`meta:${key}`);
  if (mem) return mem;
  const row = await withSql(async (sql) => {
    const rows = await sql<{ fetched_at: number; extra: string | null }>`
      select fetched_at, extra from ingest_meta where key = ${key}
    `;
    return rows[0] ?? null;
  });
  if (row) cacheSet(`meta:${key}`, row, 60_000);
  return row;
}

export async function metaFresh(key: string, ttlMs: number) {
  const row = await metaGet(key);
  if (!row) return false;
  return Date.now() - Number(row.fetched_at) < ttlMs;
}

export async function metaSet(key: string, extra?: string | null) {
  const fetched = Date.now();
  cacheSet(`meta:${key}`, { fetched_at: fetched, extra: extra ?? null }, 60_000);
  await withSql(async (sql) => {
    await sql`
      insert into ingest_meta (key, fetched_at, extra)
      values (${key}, ${fetched}, ${extra ?? null})
      on conflict (key) do update set fetched_at = excluded.fetched_at, extra = excluded.extra
    `;
  });
}

export async function loadCatalog(): Promise<Map<string, Player> | null> {
  const mem = cacheGet<Map<string, Player>>("sleeper:players");
  if (mem) return mem;
  const row = await withSql(async (sql) => {
    const rows = await sql<{ players: unknown; fetched_at: number }>`
      select players, fetched_at from sleeper_players_catalog where id = 'nfl'
    `;
    return rows[0] ?? null;
  });
  if (!row) return null;
  if (Date.now() - Number(row.fetched_at) > CATALOG_TTL_MS) return null;
  const list = parseJson<Player[]>(row.players, []);
  const map = new Map<string, Player>();
  for (const player of list) if (player?.player_id) map.set(player.player_id, player);
  cacheSet("sleeper:players", map, CATALOG_TTL_MS);
  return map;
}

export async function saveCatalog(map: Map<string, Player>) {
  cacheSet("sleeper:players", map, CATALOG_TTL_MS);
  const list = [...map.values()];
  await withSql(async (sql) => {
    await sql`
      insert into sleeper_players_catalog (id, fetched_at, players)
      values ('nfl', ${Date.now()}, ${JSON.stringify(list)}::jsonb)
      on conflict (id) do update set fetched_at = excluded.fetched_at, players = excluded.players
    `;
  });
}

export async function loadLeagueSnapshot(leagueId: string): Promise<LeagueDetailResponse | null> {
  const mem = cacheGet<LeagueDetailResponse>(`league:${leagueId}`);
  if (mem) return { ...mem, from_cache: true };
  const packed = await withSql(async (sql) => {
    const leagues = await sql<{
      sleeper_league_id: string;
      name: string;
      season: string;
      total_rosters: number;
      roster_positions: unknown;
      scoring_settings: unknown;
      settings: unknown;
      is_dynasty: boolean;
      avatar: string | null;
      status: string | null;
      draft_id: string | null;
      synced_at: number;
    }>`select * from sleeper_leagues where sleeper_league_id = ${leagueId}`;
    const leagueRow = leagues[0];
    if (!leagueRow) return null;
    if (Date.now() - Number(leagueRow.synced_at) > LEAGUE_TTL_MS) return { stale: true, synced_at: Number(leagueRow.synced_at), leagueRow };
    const users = await sql<{
      user_id: string;
      username: string | null;
      display_name: string | null;
      avatar: string | null;
      team_name: string | null;
      is_owner: boolean;
    }>`select user_id, username, display_name, avatar, team_name, is_owner from sleeper_league_users where league_id = ${leagueId}`;
    const rosters = await sql<{
      roster_id: number;
      owner_id: string | null;
      team_name: string | null;
      players: unknown;
      starters: unknown;
      reserve: unknown;
      taxi: unknown;
      waiver_budget_used: number;
      total_faab: number;
      wins: number;
      losses: number;
      ties: number;
      fpts: number | null;
      owner: unknown;
    }>`select * from sleeper_rosters where league_id = ${leagueId}`;
    return { stale: false, synced_at: Number(leagueRow.synced_at), leagueRow, users, rosters };
  });
  if (!packed || packed.stale) return null;
  const userRows = packed.users;
  const rosterRows = packed.rosters;
  if (!userRows || !rosterRows) return null;
  const league: League = {
    sleeper_league_id: packed.leagueRow.sleeper_league_id,
    name: packed.leagueRow.name,
    season: packed.leagueRow.season,
    total_rosters: packed.leagueRow.total_rosters,
    roster_positions: parseJson(packed.leagueRow.roster_positions, []),
    scoring_settings: parseJson(packed.leagueRow.scoring_settings, {}),
    settings: parseJson(packed.leagueRow.settings, {}),
    is_dynasty: Boolean(packed.leagueRow.is_dynasty),
    avatar: packed.leagueRow.avatar,
    status: packed.leagueRow.status,
    draft_id: packed.leagueRow.draft_id ?? undefined,
  };
  const users: LeagueUser[] = userRows.map((u) => ({
    user_id: u.user_id,
    username: u.username,
    display_name: u.display_name,
    avatar: u.avatar,
    team_name: u.team_name,
    is_owner: Boolean(u.is_owner),
  }));
  const rosters: Roster[] = rosterRows.map((r) => ({
    roster_id: Number(r.roster_id),
    owner_id: r.owner_id,
    team_name: r.team_name,
    players: parseJson(r.players, []),
    starters: parseJson(r.starters, []),
    reserve: parseJson(r.reserve, []),
    taxi: parseJson(r.taxi, []),
    waiver_budget_used: Number(r.waiver_budget_used || 0),
    total_faab: Number(r.total_faab || 100),
    wins: Number(r.wins || 0),
    losses: Number(r.losses || 0),
    ties: Number(r.ties || 0),
    fpts: r.fpts == null ? null : Number(r.fpts),
    owner: parseJson(r.owner, null),
  }));
  const payload: LeagueDetailResponse = {
    league,
    users,
    rosters,
    from_cache: true,
    synced_at: packed.synced_at,
  };
  cacheSet(`league:${leagueId}`, payload, LEAGUE_TTL_MS);
  return payload;
}

export async function saveLeagueSnapshot(detail: LeagueDetailResponse) {
  const synced = Date.now();
  const payload: LeagueDetailResponse = { ...detail, from_cache: true, synced_at: synced };
  cacheSet(`league:${detail.league.sleeper_league_id}`, { ...payload, from_cache: false }, LEAGUE_TTL_MS);
  const league = detail.league;
  await withSql(async (sql) => {
    await sql`
      insert into sleeper_leagues (
        sleeper_league_id, name, season, total_rosters, roster_positions, scoring_settings,
        settings, is_dynasty, avatar, status, draft_id, synced_at
      ) values (
        ${league.sleeper_league_id}, ${league.name}, ${league.season}, ${league.total_rosters},
        ${JSON.stringify(league.roster_positions)}::jsonb, ${JSON.stringify(league.scoring_settings)}::jsonb,
        ${JSON.stringify(league.settings)}::jsonb, ${league.is_dynasty}, ${league.avatar ?? null},
        ${league.status ?? null}, ${league.draft_id ?? null}, ${synced}
      )
      on conflict (sleeper_league_id) do update set
        name = excluded.name, season = excluded.season, total_rosters = excluded.total_rosters,
        roster_positions = excluded.roster_positions, scoring_settings = excluded.scoring_settings,
        settings = excluded.settings, is_dynasty = excluded.is_dynasty, avatar = excluded.avatar,
        status = excluded.status, draft_id = excluded.draft_id, synced_at = excluded.synced_at
    `;
    await sql`delete from sleeper_league_users where league_id = ${league.sleeper_league_id}`;
    await sql`delete from sleeper_rosters where league_id = ${league.sleeper_league_id}`;
    for (const user of detail.users) {
      await sql`
        insert into sleeper_league_users (league_id, user_id, username, display_name, avatar, team_name, is_owner)
        values (
          ${league.sleeper_league_id}, ${user.user_id}, ${user.username ?? null}, ${user.display_name ?? null},
          ${user.avatar ?? null}, ${user.team_name ?? null}, ${Boolean(user.is_owner)}
        )
      `;
    }
    for (const roster of detail.rosters) {
      await sql`
        insert into sleeper_rosters (
          league_id, roster_id, owner_id, team_name, players, starters, reserve, taxi,
          waiver_budget_used, total_faab, wins, losses, ties, fpts, owner
        ) values (
          ${league.sleeper_league_id}, ${roster.roster_id}, ${roster.owner_id ?? null}, ${roster.team_name ?? null},
          ${JSON.stringify(roster.players)}::jsonb, ${JSON.stringify(roster.starters)}::jsonb,
          ${JSON.stringify(roster.reserve ?? [])}::jsonb, ${JSON.stringify(roster.taxi ?? [])}::jsonb,
          ${roster.waiver_budget_used}, ${roster.total_faab}, ${roster.wins}, ${roster.losses}, ${roster.ties},
          ${roster.fpts ?? null}, ${JSON.stringify(roster.owner ?? null)}::jsonb
        )
      `;
    }
  });
}

export async function loadGames(season: string, week: number): Promise<NflGameRow[]> {
  const key = `games:${season}:${week}`;
  const mem = cacheGet<NflGameRow[]>(key);
  if (mem) return mem;
  const rows = await withSql(async (sql) => {
    return sql<{
      game_id: string;
      season: string;
      week: number;
      game_type: string | null;
      gameday: string | null;
      away_team: string;
      home_team: string;
      spread_line: number | string | null;
      total_line: number | string | null;
      roof: string | null;
      surface: string | null;
      temp: number | string | null;
      wind: number | string | null;
      stadium: string | null;
      source: string;
    }>`select * from nfl_games where season = ${season} and week = ${week}`;
  });
  const games: NflGameRow[] = (rows ?? []).map((row) => ({
    game_id: row.game_id,
    season: row.season,
    week: Number(row.week),
    game_type: row.game_type,
    gameday: row.gameday,
    away_team: row.away_team,
    home_team: row.home_team,
    spread_line: num(row.spread_line),
    total_line: num(row.total_line),
    roof: row.roof,
    surface: row.surface,
    temp: num(row.temp),
    wind: num(row.wind),
    stadium: row.stadium,
    source: row.source,
  }));
  if (games.length) cacheSet(key, games, 10 * 60 * 1000);
  return games;
}

export async function saveGames(games: NflGameRow[]) {
  if (!games.length) return;
  for (const game of games) {
    cacheSet(`games:${game.season}:${game.week}`, games.filter((g) => g.week === game.week && g.season === game.season), 10 * 60 * 1000);
  }
  await withSql(async (sql) => {
    for (const game of games) {
      await sql`
        insert into nfl_games (
          game_id, season, week, game_type, gameday, away_team, home_team, spread_line, total_line,
          roof, surface, temp, wind, stadium, source, updated_at
        ) values (
          ${game.game_id}, ${game.season}, ${game.week}, ${game.game_type}, ${game.gameday},
          ${game.away_team}, ${game.home_team}, ${game.spread_line}, ${game.total_line},
          ${game.roof}, ${game.surface}, ${game.temp}, ${game.wind}, ${game.stadium},
          ${game.source}, ${Date.now()}
        )
        on conflict (game_id) do update set
          spread_line = excluded.spread_line, total_line = excluded.total_line,
          roof = excluded.roof, temp = excluded.temp, wind = excluded.wind,
          stadium = excluded.stadium, source = excluded.source, updated_at = excluded.updated_at
      `;
    }
  });
}

export async function loadPractice(season: string, week: number): Promise<PracticeRow[]> {
  const key = `practice:${season}:${week}`;
  const mem = cacheGet<PracticeRow[]>(key);
  if (mem) return mem;
  const rows = await withSql(async (sql) => {
    return sql<PracticeRow>`select * from nfl_practice where season = ${season} and week = ${week}`;
  });
  const list = rows ?? [];
  if (list.length) cacheSet(key, list, PRACTICE_TTL_MS);
  return list;
}

export async function savePractice(rows: PracticeRow[]) {
  if (!rows.length) return;
  const key = `practice:${rows[0].season}:${rows[0].week}`;
  cacheSet(key, rows, PRACTICE_TTL_MS);
  await withSql(async (sql) => {
    for (const row of rows) {
      await sql`
        insert into nfl_practice (
          season, week, player_key, gsis_id, espn_id, full_name, team, position,
          practice_status, report_status, injury, note, source, updated_at
        ) values (
          ${row.season}, ${row.week}, ${row.player_key}, ${row.gsis_id}, ${row.espn_id},
          ${row.full_name}, ${row.team}, ${row.position}, ${row.practice_status},
          ${row.report_status}, ${row.injury}, ${row.note}, ${row.source}, ${Date.now()}
        )
        on conflict (season, week, player_key) do update set
          practice_status = excluded.practice_status, report_status = excluded.report_status,
          injury = excluded.injury, note = excluded.note, source = excluded.source,
          updated_at = excluded.updated_at
      `;
    }
  });
}

export const TTL = {
  league: LEAGUE_TTL_MS,
  catalog: CATALOG_TTL_MS,
  games: GAMES_TTL_MS,
  practice: PRACTICE_TTL_MS,
};
