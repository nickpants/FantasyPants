import { cacheDel, cacheGet, cacheSet } from "./cache";
import { loadCatalog, saveCatalog } from "./store";
import type { Player } from "@/lib/types";

const BASE = "https://api.sleeper.app/v1";
const STATE_TTL = 5 * 60 * 1000;
const PROJ_TTL = 30 * 60 * 1000;
const CATALOG_TTL = 24 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SleeperError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function sleeperGet<T>(path: string): Promise<T> {
  let last: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Accept: "application/json", "User-Agent": "GridironAI/0.1" },
      });
      if (res.status === 404) throw new SleeperError(`Not found: ${path}`, 404);
      if (res.status === 429 || res.status >= 500) {
        last = new SleeperError(`Sleeper ${res.status} on ${path}`, res.status);
        await sleep(400 * 2 ** attempt + Math.random() * 200);
        continue;
      }
      if (!res.ok) throw new SleeperError(`Sleeper ${res.status}: ${path}`, res.status);
      if (res.status === 204) return null as T;
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof SleeperError && err.status === 404) throw err;
      last = err instanceof Error ? err : new Error(String(err));
      if (attempt < 3) await sleep(400 * 2 ** attempt);
    }
  }
  throw last ?? new SleeperError(`Exhausted retries for ${path}`);
}

export type NflStateRaw = {
  week?: number;
  season?: string;
  season_type?: string;
  display_week?: number;
  league_season?: string;
  previous_season?: string;
};

export async function getNflState() {
  const cached = cacheGet<NflStateRaw>("sleeper:state:nfl");
  if (cached) return cached;
  const state = await sleeperGet<NflStateRaw>("/state/nfl");
  cacheSet("sleeper:state:nfl", state, STATE_TTL);
  return state;
}

export async function getUser(username: string) {
  const payload = await sleeperGet<Record<string, unknown> | null>(`/user/${encodeURIComponent(username)}`);
  if (!payload || !payload.user_id) {
    throw new SleeperError(`Sleeper user '${username}' not found`, 404);
  }
  return payload;
}

export async function getUserLeagues(userId: string, season: string) {
  const rows = await sleeperGet<Record<string, unknown>[] | null>(
    `/user/${userId}/leagues/nfl/${season}`,
  );
  return rows ?? [];
}

export async function getLeague(leagueId: string) {
  return sleeperGet<Record<string, unknown>>(`/league/${leagueId}`);
}

export async function getRosters(leagueId: string) {
  return (await sleeperGet<Record<string, unknown>[] | null>(`/league/${leagueId}/rosters`)) ?? [];
}

export async function getLeagueUsers(leagueId: string) {
  return (await sleeperGet<Record<string, unknown>[] | null>(`/league/${leagueId}/users`)) ?? [];
}

export async function getMatchups(leagueId: string, week: number) {
  return (await sleeperGet<Record<string, unknown>[] | null>(`/league/${leagueId}/matchups/${week}`)) ?? [];
}

export async function getTransactions(leagueId: string, week: number) {
  return (await sleeperGet<Record<string, unknown>[] | null>(`/league/${leagueId}/transactions/${week}`)) ?? [];
}

export async function getLeagueDrafts(leagueId: string) {
  return (await sleeperGet<Record<string, unknown>[] | null>(`/league/${leagueId}/drafts`)) ?? [];
}

export async function getDraft(draftId: string) {
  return (await sleeperGet<Record<string, unknown> | null>(`/draft/${draftId}`)) ?? {};
}

export async function getDraftPicks(draftId: string) {
  return (await sleeperGet<Record<string, unknown>[] | null>(`/draft/${draftId}/picks`)) ?? [];
}

export async function getProjections(season: string, week: number, seasonType = "regular") {
  const key = `sleeper:proj:${seasonType}:${season}:${week}`;
  const cached = cacheGet<{ rows: Record<string, Record<string, unknown>>; source: string }>(key);
  if (cached) return cached;
  const projections =
    (await sleeperGet<Record<string, Record<string, unknown>> | null>(
      `/projections/nfl/${seasonType}/${season}/${week}`,
    )) ?? {};
  const usable: Record<string, Record<string, unknown>> = {};
  for (const [pid, row] of Object.entries(projections)) {
    if (!row || typeof row !== "object") continue;
    if ("pass_yd" in row || "rush_yd" in row || "rec" in row || "rec_yd" in row || "fgm" in row || "pts_ppr" in row) {
      usable[pid] = row;
    }
  }
  let source = "sleeper_projections";
  if (Object.keys(usable).length < 50) {
    const seasonStats =
      (await sleeperGet<Record<string, Record<string, unknown>> | null>(
        `/stats/nfl/${seasonType}/${season}`,
      )) ?? {};
    for (const [pid, row] of Object.entries(seasonStats)) {
      if (!row || typeof row !== "object") continue;
      const gp = Number(row.gp || 0) || 1;
      if (gp <= 0) continue;
      const weekly: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        weekly[k] = k === "gp" ? 1 : n / gp;
      }
      usable[pid] = weekly;
    }
    source = "season_per_game";
  }
  const payload = { rows: usable, source };
  cacheSet(key, payload, PROJ_TTL);
  return payload;
}

function normalizePlayer(playerId: string, raw: Record<string, unknown>): Player {
  const first = String(raw.first_name || "").trim();
  const last = String(raw.last_name || "").trim();
  const full = String(raw.full_name || `${first} ${last}`).trim() || playerId;
  const fantasy = Array.isArray(raw.fantasy_positions) ? (raw.fantasy_positions as string[]) : [];
  const position = String(raw.position || fantasy[0] || "UNK");
  const espn = raw.espn_id == null ? null : String(raw.espn_id);
  const gsis = raw.gsis_id == null ? null : String(raw.gsis_id);
  const depth = raw.depth_chart_order == null ? null : Number(raw.depth_chart_order);
  return {
    player_id: String(raw.player_id || playerId),
    full_name: full.slice(0, 255),
    position: position.slice(0, 10),
    nfl_team: (raw.team as string | null) ?? null,
    injury_status: (raw.injury_status as string | null) ?? null,
    status: (raw.status as string | null) ?? null,
    years_exp: raw.years_exp == null ? null : Number(raw.years_exp),
    gsis_id: gsis && gsis !== "null" ? gsis : null,
    espn_id: espn && espn !== "null" ? espn : null,
    injury_body_part: (raw.injury_body_part as string | null) ?? null,
    injury_notes: (raw.injury_notes as string | null) ?? null,
    practice_participation: (raw.practice_participation as string | null) ?? null,
    depth_chart_order: depth != null && Number.isFinite(depth) ? depth : null,
    depth_chart_position: (raw.depth_chart_position as string | null) ?? null,
  };
}

export async function getPlayerCatalog() {
  const cached = cacheGet<Map<string, Player>>("sleeper:players:v2");
  if (cached) return cached;
  const persisted = await loadCatalog();
  if (persisted) {
    const sample = [...persisted.values()].slice(0, 40);
    if (sample.some((p) => p.depth_chart_order != null)) {
      cacheSet("sleeper:players:v2", persisted, CATALOG_TTL);
      return persisted;
    }
  }
  const payload =
    (await sleeperGet<Record<string, Record<string, unknown>> | null>("/players/nfl")) ?? {};
  const map = new Map<string, Player>();
  for (const [id, raw] of Object.entries(payload)) {
    if (!raw || typeof raw !== "object") continue;
    map.set(id, normalizePlayer(id, raw));
  }
  await saveCatalog(map);
  cacheSet("sleeper:players:v2", map, CATALOG_TTL);
  return map;
}

export async function refreshPlayerCatalog() {
  cacheDel("sleeper:players");
  cacheDel("sleeper:players:v2");
  const payload =
    (await sleeperGet<Record<string, Record<string, unknown>> | null>("/players/nfl")) ?? {};
  const map = new Map<string, Player>();
  for (const [id, raw] of Object.entries(payload)) {
    if (!raw || typeof raw !== "object") continue;
    map.set(id, normalizePlayer(id, raw));
  }
  await saveCatalog(map);
  cacheSet("sleeper:players:v2", map, CATALOG_TTL);
  return map;
}

export async function lookupPlayers(ids: string[]) {
  const catalog = await getPlayerCatalog();
  const out = new Map<string, Player>();
  for (const id of ids) {
    if (!id || id === "0") continue;
    const hit = catalog.get(id);
    if (hit) out.set(id, hit);
    else out.set(id, { player_id: id, full_name: id, position: "UNK" });
  }
  return out;
}

export function hydrateIds(ids: string[], map: Map<string, Player>): Player[] {
  return ids.map((id) => {
    if (!id || id === "0") {
      return { player_id: "", full_name: "Empty", position: "UNK" };
    }
    return map.get(id) ?? { player_id: id, full_name: id, position: "UNK" };
  });
}
