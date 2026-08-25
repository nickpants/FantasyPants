import type { GameSlateRow, Player } from "@/lib/types";
import { cacheGet, cacheSet } from "./cache";
import { normalizePractice, type GameEnv, type PracticeReport } from "./engine";
import {
  loadGames,
  loadPractice,
  metaFresh,
  metaSet,
  saveGames,
  savePractice,
  TTL,
  type NflGameRow,
  type PracticeRow,
} from "./store";

const NFLVERSE_GAMES = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv";
const NFLVERSE_INJURIES = (season: string) =>
  `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${season}.csv`;
const ESPN_EVENTS = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events?limit=50";
const UA = { Accept: "application/json", "User-Agent": "GridironAI/0.2" };

const TEAM_CANON: Record<string, string> = {
  LAR: "LA",
  LA: "LA",
  JAC: "JAX",
  JAX: "JAX",
  WSH: "WAS",
  WAS: "WAS",
  OAK: "LV",
  LV: "LV",
  SD: "LAC",
  STL: "LA",
};

export const ESPN_TEAM: Record<string, string> = {
  "1": "ATL",
  "2": "BUF",
  "3": "CHI",
  "4": "CIN",
  "5": "CLE",
  "6": "DAL",
  "7": "DEN",
  "8": "DET",
  "9": "GB",
  "10": "TEN",
  "11": "IND",
  "12": "KC",
  "13": "LV",
  "14": "LAR",
  "15": "MIA",
  "16": "MIN",
  "17": "NE",
  "18": "NO",
  "19": "NYG",
  "20": "NYJ",
  "21": "PHI",
  "22": "ARI",
  "23": "PIT",
  "24": "LAC",
  "25": "SF",
  "26": "SEA",
  "27": "TB",
  "28": "WAS",
  "29": "CAR",
  "30": "JAX",
  "33": "BAL",
  "34": "HOU",
};

export function canonTeam(team?: string | null) {
  if (!team) return "";
  return TEAM_CANON[team] || team;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.length);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function fetchText(url: string, timeout = 15000) {
  const res = await fetch(url, { headers: { ...UA, Accept: "text/csv,*/*" }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`Fetch ${res.status} ${url}`);
  return res.text();
}

async function fetchJson<T>(url: string, timeout = 6000): Promise<T> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`Fetch ${res.status} ${url}`);
  return (await res.json()) as T;
}

function finite(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function impliedTotals(spreadHome: number | null, total: number | null) {
  if (spreadHome == null || total == null) return { home: null, away: null };
  return {
    home: Math.round(((total + spreadHome) / 2) * 10) / 10,
    away: Math.round(((total - spreadHome) / 2) * 10) / 10,
  };
}

function gameToEnv(game: NflGameRow, team: string): GameEnv | null {
  const canon = canonTeam(team);
  const home = canonTeam(game.home_team) === canon;
  const away = canonTeam(game.away_team) === canon;
  if (!home && !away) return null;
  const implied = impliedTotals(game.spread_line, game.total_line);
  const spread = game.spread_line == null ? null : home ? game.spread_line : -game.spread_line;
  return {
    team,
    opponent: home ? game.away_team : game.home_team,
    home,
    spread,
    total: game.total_line,
    implied: home ? implied.home : implied.away,
    roof: game.roof,
    temp: game.temp,
    wind: game.wind,
    stadium: game.stadium,
    source: game.source,
  };
}

function rowToGame(row: Record<string, string>, source: string): NflGameRow {
  return {
    game_id: row.game_id || `${row.season}_${row.week}_${row.away_team}_${row.home_team}`,
    season: row.season,
    week: Number(row.week || 0),
    game_type: row.game_type || null,
    gameday: row.gameday || null,
    away_team: canonTeam(row.away_team),
    home_team: canonTeam(row.home_team),
    spread_line: finite(row.spread_line),
    total_line: finite(row.total_line),
    roof: row.roof || null,
    surface: row.surface || null,
    temp: finite(row.temp),
    wind: finite(row.wind),
    stadium: row.stadium || null,
    source,
  };
}

async function ingestNflverseGames(season: string, week: number): Promise<NflGameRow[]> {
  const memKey = `nv:games:${season}`;
  const all = cacheGet<NflGameRow[]>(memKey);
  if (all?.length) return all.filter((g) => g.week === week);
  try {
    const csv = await fetchText(NFLVERSE_GAMES, 18000);
    const games = parseCsv(csv).filter((row) => row.season === season).map((row) => rowToGame(row, "nflverse"));
    cacheSet(memKey, games, TTL.games);
    const weekGames = games.filter((g) => g.week === week);
    void saveGames(weekGames).then(() => metaSet(`nflverse:games:${season}`, String(games.length)));
    return weekGames;
  } catch {
    return [];
  }
}

type EspnRefList = { items?: { $ref?: string; id?: string; [k: string]: unknown }[]; count?: number };

async function ingestEspnOdds(season: string, week: number): Promise<NflGameRow[]> {
  if (await metaFresh(`espn:odds:${season}:${week}`, TTL.practice)) {
    return loadGames(season, week);
  }
  try {
    const list = await fetchJson<EspnRefList>(ESPN_EVENTS, 6000);
    const refs = (list.items || []).map((item) => item.$ref).filter(Boolean) as string[];
    const games: NflGameRow[] = [];
    for (const ref of refs.slice(0, 12)) {
      try {
        const event = await fetchJson<{
          id?: string;
          date?: string;
          competitions?: {
            id?: string;
            date?: string;
            competitors?: { id?: string; homeAway?: string }[];
            odds?: { $ref?: string };
          }[];
        }>(ref.replace("http://", "https://"), 5000);
        const comp = event.competitions?.[0];
        if (!comp) continue;
        const home = (comp.competitors || []).find((c) => c.homeAway === "home");
        const away = (comp.competitors || []).find((c) => c.homeAway === "away");
        const homeAbbr = ESPN_TEAM[String(home?.id || "")] || "";
        const awayAbbr = ESPN_TEAM[String(away?.id || "")] || "";
        if (!homeAbbr || !awayAbbr) continue;
        let spreadHome: number | null = null;
        let total: number | null = null;
        if (comp.odds?.$ref) {
          const odds = await fetchJson<{
            items?: { details?: string; overUnder?: number; spread?: number; awayTeamOdds?: { favorite?: boolean } }[];
          }>(comp.odds.$ref.replace("http://", "https://"), 5000);
          const book = odds.items?.[0];
          if (book) {
            total = finite(book.overUnder);
            const details = String(book.details || "");
            const m = details.match(/([A-Z]{2,3})\s*([+-]?\d+(?:\.\d+)?)/);
            if (m) {
              const favTeam = canonTeam(m[1]);
              const line = Number(m[2]);
              if (favTeam === canonTeam(homeAbbr)) spreadHome = Math.abs(line);
              else if (favTeam === canonTeam(awayAbbr)) spreadHome = -Math.abs(line);
            } else if (book.spread != null) {
              spreadHome = book.awayTeamOdds?.favorite ? -Math.abs(Number(book.spread)) : Math.abs(Number(book.spread));
            }
          }
        }
        games.push({
          game_id: `espn_${event.id || comp.id}`,
          season,
          week,
          game_type: "ESPN",
          gameday: (event.date || comp.date || "").slice(0, 10),
          away_team: canonTeam(awayAbbr),
          home_team: canonTeam(homeAbbr),
          spread_line: spreadHome,
          total_line: total,
          roof: null,
          surface: null,
          temp: null,
          wind: null,
          stadium: null,
          source: "espn",
        });
      } catch {
        // skip a single event
      }
    }
    if (games.length) void saveGames(games).then(() => metaSet(`espn:odds:${season}:${week}`, String(games.length)));
    return games;
  } catch {
    return [];
  }
}

export async function getWeekSlate(season: string, week: number, _seasonType = "regular"): Promise<Map<string, GameEnv>> {
  let games = await loadGames(season, week);
  if (games.length < 8) {
    const nv = await ingestNflverseGames(season, week);
    if (nv.length) games = nv;
  }
  if (games.length < 8) {
    const espn = await ingestEspnOdds(season, week);
    if (espn.length) games = espn;
  }
  const map = new Map<string, GameEnv>();
  for (const game of games) {
    const home = gameToEnv(game, game.home_team);
    const away = gameToEnv(game, game.away_team);
    if (home) map.set(canonTeam(game.home_team), home);
    if (away) map.set(canonTeam(game.away_team), away);
  }
  return map;
}

export function slateRows(map: Map<string, GameEnv>): GameSlateRow[] {
  const seen = new Set<string>();
  const rows: GameSlateRow[] = [];
  for (const env of map.values()) {
    const key = [canonTeam(env.team), canonTeam(env.opponent)].sort().join("-");
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(env);
  }
  rows.sort((a, b) => (b.implied ?? 0) - (a.implied ?? 0));
  return rows;
}

async function ingestNflverseInjuries(season: string, week: number): Promise<PracticeRow[]> {
  const memKey = `nv:inj:${season}:${week}`;
  const cached = cacheGet<PracticeRow[]>(memKey);
  if (cached) return cached;
  try {
    const csv = await fetchText(NFLVERSE_INJURIES(season), 15000);
    const packed: PracticeRow[] = parseCsv(csv)
      .filter((row) => Number(row.week || 0) === week && row.gsis_id)
      .map((row) => ({
        season,
        week,
        player_key: `gsis:${row.gsis_id}`,
        gsis_id: row.gsis_id,
        espn_id: null,
        full_name: row.full_name || null,
        team: row.team || null,
        position: row.position || null,
        practice_status: row.practice_status || null,
        report_status: row.report_status || null,
        injury: row.report_primary_injury || row.practice_primary_injury || null,
        note: null,
        source: "nflverse",
      }));
    cacheSet(memKey, packed, TTL.practice);
    if (packed.length) void savePractice(packed).then(() => metaSet(`nflverse:inj:${season}:${week}`, String(packed.length)));
    return packed;
  } catch {
    cacheSet(memKey, [], 60_000);
    return [];
  }
}

type EspnInjury = {
  status?: string;
  shortComment?: string;
  longComment?: string;
  details?: { type?: string; detail?: string; fantasyStatus?: { description?: string } };
  type?: { description?: string };
};

async function ingestEspnBeat(season: string, week: number, players: Player[]): Promise<PracticeRow[]> {
  const injured = players.filter((p) => p.espn_id && (p.injury_status || p.practice_participation)).slice(0, 8);
  if (!injured.length) return [];
  const key = `espn:beat:${season}:${week}`;
  const cached = cacheGet<PracticeRow[]>(key);
  if (cached) return cached;
  const rows: PracticeRow[] = [];
  await Promise.all(
    injured.map(async (player) => {
      try {
        const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/athletes/${player.espn_id}/injuries`;
        const payload = await fetchJson<{ items?: EspnInjury[] }>(url, 5000);
        const item = payload.items?.[0];
        if (!item) return;
        const note = (item.shortComment || item.longComment || "").slice(0, 280) || null;
        rows.push({
          season,
          week,
          player_key: `espn:${player.espn_id}`,
          gsis_id: player.gsis_id ?? null,
          espn_id: player.espn_id ?? null,
          full_name: player.full_name,
          team: player.nfl_team ?? null,
          position: player.position,
          practice_status: null,
          report_status: item.status || item.details?.fantasyStatus?.description || item.type?.description || null,
          injury: item.details?.type || item.details?.detail || null,
          note,
          source: "espn",
        });
      } catch {
        // skip
      }
    }),
  );
  cacheSet(key, rows, TTL.practice);
  if (rows.length) void savePractice(rows);
  return rows;
}

export async function getPracticeMap(
  season: string,
  week: number,
  players: Player[],
): Promise<Map<string, PracticeReport>> {
  const fromDb = await loadPractice(season, week);
  const nv = fromDb.length ? fromDb : await ingestNflverseInjuries(season, week);
  const espn = nv.some((row) => row.practice_status) ? [] : await ingestEspnBeat(season, week, players);
  const rows = [...nv, ...espn];
  const byGsis = new Map<string, PracticeRow>();
  const byEspn = new Map<string, PracticeRow>();
  const byName = new Map<string, PracticeRow>();
  for (const row of rows) {
    if (row.gsis_id) byGsis.set(row.gsis_id, row);
    if (row.espn_id) byEspn.set(String(row.espn_id), row);
    if (row.full_name) byName.set(row.full_name.toLowerCase(), row);
  }
  const out = new Map<string, PracticeReport>();
  for (const player of players) {
    const nvRow = (player.gsis_id && byGsis.get(player.gsis_id)) || null;
    const espnRow = (player.espn_id && byEspn.get(String(player.espn_id))) || null;
    const named = byName.get(player.full_name.toLowerCase()) || null;
    const hit = nvRow || espnRow || named;
    const practiceStatus =
      normalizePractice(hit?.practice_status) ||
      normalizePractice(player.practice_participation);
    const report = espnRow?.report_status || nvRow?.report_status || player.injury_status || null;
    const injury = nvRow?.injury || espnRow?.injury || player.injury_body_part || null;
    const note = espnRow?.note || player.injury_notes || null;
    const label = nvRow?.practice_status || player.practice_participation || null;
    if (!practiceStatus && !report && !note && !injury) continue;
    out.set(player.player_id, {
      practice_status: practiceStatus,
      practice_label: label,
      report_status: report,
      injury,
      note,
      source: espnRow?.note ? "espn+sleeper" : nvRow ? "nflverse" : "sleeper",
    });
  }
  return out;
}

export function lookupGame(slate: Map<string, GameEnv>, team?: string | null) {
  if (!team) return null;
  return slate.get(canonTeam(team)) ?? slate.get(team) ?? null;
}
