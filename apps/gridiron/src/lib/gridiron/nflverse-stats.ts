import { cacheDel, cacheGet, cacheSet } from "./cache";

const UA = { Accept: "text/csv,*/*", "User-Agent": "GridironAI/0.2" };
const TTL = 6 * 60 * 60 * 1000;
const STATS_URL = (season: string) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

export function splitCsvLine(line: string): string[] {
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

/** One download per season, shared by opportunity and FPA. */
export async function fetchPlayerWeekCsv(season: string): Promise<string> {
  const key = `nv:pwcsv:${season}`;
  const cached = cacheGet<string>(key);
  if (cached) return cached;
  const inflightKey = `nv:pwcsv:inflight:${season}`;
  const inflight = cacheGet<Promise<string>>(inflightKey);
  if (inflight) return inflight;
  const job = (async () => {
    try {
      const res = await fetch(STATS_URL(season), { headers: UA, signal: AbortSignal.timeout(18000) });
      if (!res.ok) throw new Error(`stats ${res.status}`);
      const text = await res.text();
      cacheSet(key, text, TTL);
      return text;
    } finally {
      cacheDel(inflightKey);
    }
  })();
  cacheSet(inflightKey, job, 60_000);
  return job;
}
