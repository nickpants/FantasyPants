import { cacheDel, cacheGet, cacheSet } from "./cache";
import type { Opportunity } from "./engine";
import { fetchPlayerWeekCsv, splitCsvLine } from "./nflverse-stats";

const TTL = 6 * 60 * 60 * 1000;

type Weekly = {
  id: string;
  week: number;
  team: string;
  targets: number;
  target_share: number | null;
  carries: number;
  attempts: number;
};

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function lastN<T>(rows: T[], n: number) {
  return rows.length <= n ? rows : rows.slice(rows.length - n);
}

function aggregate(rows: Weekly[], source: string): Map<string, Opportunity> {
  const teamWeek = new Map<string, { att: number; car: number }>();
  for (const row of rows) {
    const key = `${row.week}|${row.team}`;
    const cur = teamWeek.get(key) || { att: 0, car: 0 };
    cur.att += row.attempts;
    cur.car += row.carries;
    teamWeek.set(key, cur);
  }
  const byId = new Map<string, Weekly[]>();
  for (const row of rows) {
    const list = byId.get(row.id) || [];
    list.push(row);
    byId.set(row.id, list);
  }
  const out = new Map<string, Opportunity>();
  for (const [id, list] of byId) {
    const ordered = [...list].sort((a, b) => a.week - b.week);
    const recent = lastN(ordered, 6);
    const tgt = mean(recent.map((r) => r.target_share).filter((n): n is number => n != null && n > 0));
    const rush: number[] = [];
    const pass: number[] = [];
    for (const row of recent) {
      const team = teamWeek.get(`${row.week}|${row.team}`);
      if (team && team.car > 0 && row.carries > 0) rush.push(row.carries / team.car);
      if (team && team.att > 0 && row.attempts > 0) pass.push(row.attempts / team.att);
    }
    out.set(id, {
      gsis_id: id,
      games: recent.length,
      target_share: tgt,
      rush_share: mean(rush),
      pass_share: mean(pass),
      source,
    });
  }
  return out;
}

async function ingestSeason(season: string): Promise<Map<string, Opportunity>> {
  const key = `opp:${season}`;
  const cached = cacheGet<Map<string, Opportunity>>(key);
  if (cached) return cached;
  const inflightKey = `opp:inflight:${season}`;
  const inflight = cacheGet<Promise<Map<string, Opportunity>>>(inflightKey);
  if (inflight) return inflight;
  const job = (async () => {
    try {
      const text = await fetchPlayerWeekCsv(season);
      const lines = text.split(/\r?\n/).filter((l) => l.length);
      if (lines.length < 2) return new Map<string, Opportunity>();
      const headers = splitCsvLine(lines[0]);
      const idx = {
        id: headers.indexOf("player_id"),
        week: headers.indexOf("week"),
        type: headers.indexOf("season_type"),
        team: headers.indexOf("team"),
        targets: headers.indexOf("targets"),
        share: headers.indexOf("target_share"),
        carries: headers.indexOf("carries"),
        attempts: headers.indexOf("attempts"),
      };
      const weekly: Weekly[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]);
        if (cols[idx.type] && cols[idx.type] !== "REG") continue;
        const week = Number(cols[idx.week] || 0);
        if (week < 1 || week > 18) continue;
        const id = cols[idx.id];
        if (!id) continue;
        const share = Number(cols[idx.share]);
        weekly.push({
          id,
          week,
          team: cols[idx.team] || "",
          targets: Number(cols[idx.targets] || 0) || 0,
          target_share: Number.isFinite(share) ? share : null,
          carries: Number(cols[idx.carries] || 0) || 0,
          attempts: Number(cols[idx.attempts] || 0) || 0,
        });
      }
      const map = aggregate(weekly, `nflverse_${season}`);
      cacheSet(key, map, TTL);
      return map;
    } catch {
      const empty = new Map<string, Opportunity>();
      cacheSet(key, empty, 5 * 60 * 1000);
      return empty;
    } finally {
      cacheDel(inflightKey);
    }
  })();
  cacheSet(inflightKey, job, 60_000);
  return job;
}

export async function getOpportunityMap(season: string, week: number): Promise<Map<string, Opportunity>> {
  const prior = String(Number(season) - 1);
  const useCurrent = week > 4;
  const priorMap = await ingestSeason(prior);
  if (!useCurrent) return priorMap;
  const current = await ingestSeason(season);
  if (!current.size) return priorMap;
  if (!priorMap.size) return current;
  const out = new Map<string, Opportunity>();
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
    const mix = (x: number | null, y: number | null) => {
      if (x == null) return y;
      if (y == null) return x;
      return 0.7 * x + 0.3 * y;
    };
    out.set(id, {
      gsis_id: id,
      games: a.games,
      target_share: mix(a.target_share, b.target_share),
      rush_share: mix(a.rush_share, b.rush_share),
      pass_share: mix(a.pass_share, b.pass_share),
      source: `${a.source}+${b.source}`,
    });
  }
  return out;
}
