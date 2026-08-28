import type { DefenseProfile } from "./engine";
import { fpaPosition } from "./engine";
import { cacheDel, cacheGet, cacheSet } from "./cache";
import { canonTeam } from "./context";
import { fetchPlayerWeekCsv, splitCsvLine } from "./nflverse-stats";

const TTL = 6 * 60 * 60 * 1000;

type WeekBucket = { points: number };

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function aggregate(rows: { week: number; opp: string; pos: string; pts: number }[], source: string) {
  const game = new Map<string, WeekBucket>();
  for (const row of rows) {
    const key = `${row.opp}|${row.pos}|${row.week}`;
    const cur = game.get(key) || { points: 0 };
    cur.points += row.pts;
    game.set(key, cur);
  }
  const byTeamPos = new Map<string, number[]>();
  for (const [key, bucket] of game) {
    const [opp, pos] = key.split("|");
    const id = `${opp}|${pos}`;
    const list = byTeamPos.get(id) || [];
    list.push(bucket.points);
    byTeamPos.set(id, list);
  }
  const avgs = new Map<string, { team: string; pos: string; fpa: number; games: number }>();
  const posLeague: Record<string, number[]> = {};
  for (const [id, weeks] of byTeamPos) {
    const [team, pos] = id.split("|");
    const fpa = mean(weeks);
    avgs.set(id, { team, pos, fpa, games: weeks.length });
    (posLeague[pos] ||= []).push(fpa);
  }
  const leagueAvg: Record<string, number> = {};
  for (const [pos, vals] of Object.entries(posLeague)) leagueAvg[pos] = mean(vals);

  const ranked = new Map<string, DefenseProfile>();
  const byPos = new Map<string, { id: string; fpa: number }[]>();
  for (const [id, row] of avgs) {
    const list = byPos.get(row.pos) || [];
    list.push({ id, fpa: row.fpa });
    byPos.set(row.pos, list);
  }
  for (const list of byPos.values()) list.sort((a, b) => b.fpa - a.fpa);
  for (const [pos, list] of byPos) {
    list.forEach((item, i) => {
      const row = avgs.get(item.id)!;
      const avg = leagueAvg[pos] || row.fpa;
      ranked.set(item.id, {
        team: row.team,
        position: pos,
        fpa: Math.round(row.fpa * 100) / 100,
        league_avg: Math.round(avg * 100) / 100,
        games: row.games,
        rank: i + 1,
        teams: list.length,
        index: avg > 0 ? Math.round((row.fpa / avg) * 1000) / 1000 : 1,
        source,
      });
    });
  }
  return ranked;
}

async function ingestSeason(season: string): Promise<Map<string, DefenseProfile>> {
  const key = `fpa:${season}`;
  const cached = cacheGet<Map<string, DefenseProfile>>(key);
  if (cached) return cached;
  const inflightKey = `fpa:inflight:${season}`;
  const inflight = cacheGet<Promise<Map<string, DefenseProfile>>>(inflightKey);
  if (inflight) return inflight;
  const job = (async () => {
    try {
      const text = await fetchPlayerWeekCsv(season);
      const lines = text.split(/\r?\n/).filter((l) => l.length);
      if (lines.length < 2) return new Map<string, DefenseProfile>();
      const headers = splitCsvLine(lines[0]);
      const idx = {
        week: headers.indexOf("week"),
        type: headers.indexOf("season_type"),
        pos: headers.indexOf("position"),
        opp: headers.indexOf("opponent_team"),
        ppr: headers.indexOf("fantasy_points_ppr"),
        std: headers.indexOf("fantasy_points"),
      };
      if (idx.week < 0 || idx.opp < 0 || idx.pos < 0) return new Map<string, DefenseProfile>();
      const weekly: { week: number; opp: string; pos: string; pts: number }[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]);
        if (cols[idx.type] && cols[idx.type] !== "REG") continue;
        const week = Number(cols[idx.week] || 0);
        if (week < 1 || week > 18) continue;
        const pos = fpaPosition(cols[idx.pos] || "");
        if (!pos) continue;
        const opp = canonTeam(cols[idx.opp] || "");
        if (!opp) continue;
        const pts = Number((cols[idx.ppr] ?? cols[idx.std]) || 0);
        if (!Number.isFinite(pts)) continue;
        weekly.push({ week, opp, pos, pts });
      }
      const map = aggregate(weekly, `nflverse_${season}`);
      cacheSet(key, map, TTL);
      return map;
    } catch {
      const empty = new Map<string, DefenseProfile>();
      cacheSet(key, empty, 5 * 60 * 1000);
      return empty;
    } finally {
      cacheDel(inflightKey);
    }
  })();
  cacheSet(inflightKey, job, 60_000);
  return job;
}

export async function getDefenseMap(season: string, week: number): Promise<Map<string, DefenseProfile>> {
  const prior = String(Number(season) - 1);
  const useCurrent = week > 4;
  const priorMap = await ingestSeason(prior);
  if (!useCurrent) return priorMap;
  const current = await ingestSeason(season);
  if (!current.size) return priorMap;
  if (!priorMap.size) return current;
  const out = new Map<string, DefenseProfile>();
  const ids = new Set([...current.keys(), ...priorMap.keys()]);
  for (const id of ids) {
    const a = current.get(id);
    const b = priorMap.get(id);
    if (a && !b) {
      out.set(id, a);
      continue;
    }
    if (!a && b) {
      out.set(id, b);
      continue;
    }
    if (!a || !b) continue;
    const fpa = 0.7 * a.fpa + 0.3 * b.fpa;
    const avg = 0.7 * a.league_avg + 0.3 * b.league_avg;
    out.set(id, {
      team: a.team,
      position: a.position,
      fpa: Math.round(fpa * 100) / 100,
      league_avg: Math.round(avg * 100) / 100,
      games: a.games,
      rank: a.rank,
      teams: a.teams,
      index: avg > 0 ? Math.round((fpa / avg) * 1000) / 1000 : 1,
      source: `${a.source}+${b.source}`,
    });
  }
  const byPos = new Map<string, { id: string; fpa: number }[]>();
  for (const [id, row] of out) {
    const list = byPos.get(row.position) || [];
    list.push({ id, fpa: row.fpa });
    byPos.set(row.position, list);
  }
  for (const list of byPos.values()) list.sort((a, b) => b.fpa - a.fpa);
  for (const list of byPos.values()) {
    list.forEach((item, i) => {
      const row = out.get(item.id);
      if (row) row.rank = i + 1;
    });
  }
  return out;
}

export function lookupDefense(
  map: Map<string, DefenseProfile>,
  opponent: string | null | undefined,
  position: string,
) {
  const pos = fpaPosition(position);
  const team = canonTeam(opponent);
  if (!pos || !team) return null;
  return map.get(`${team}|${pos}`) ?? null;
}
