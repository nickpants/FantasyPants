import type { GameSlateRow, Player, PracticeTag } from "@/lib/types";

export const MC_ITERS = 2000;

export const FLEX_ELIGIBILITY: Record<string, Set<string>> = {
  QB: new Set(["QB"]),
  RB: new Set(["RB"]),
  WR: new Set(["WR"]),
  TE: new Set(["TE"]),
  K: new Set(["K"]),
  DEF: new Set(["DEF"]),
  DL: new Set(["DL", "DE", "DT"]),
  LB: new Set(["LB"]),
  DB: new Set(["DB", "CB", "S", "SS", "FS"]),
  FLEX: new Set(["RB", "WR", "TE"]),
  WRRB_FLEX: new Set(["RB", "WR"]),
  REC_FLEX: new Set(["WR", "TE"]),
  SUPER_FLEX: new Set(["QB", "RB", "WR", "TE"]),
  IDP_FLEX: new Set(["DL", "LB", "DB", "DE", "DT", "CB", "S", "SS", "FS"]),
};

export const NON_STARTER_SLOTS = new Set(["BN", "IR", "TAXI"]);
export const INACTIVE_INJURIES = new Set(["Out", "IR", "PUP", "Suspended", "NA"]);
export const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
export const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);
export const FLEX_SLOTS = new Set(["FLEX", "WRRB_FLEX", "REC_FLEX", "SUPER_FLEX", "IDP_FLEX"]);

const NON_SCORING = new Set([
  "adp_dd_ppr",
  "pos_adp_dd_ppr",
  "gp",
  "gs",
  "gms_active",
  "pts_ppr",
  "pts_std",
  "pts_half_ppr",
  "pos_rank_ppr",
  "pos_rank_std",
  "pos_rank_half_ppr",
  "rank_ppr",
  "rank_std",
  "rank_half_ppr",
  "cmp_pct",
]);

export const POSITION_SIGMA: Record<string, number> = {
  QB: 0.32,
  RB: 0.4,
  WR: 0.45,
  TE: 0.42,
  K: 0.5,
  DEF: 0.55,
};

export const POSITION_SKEW: Record<string, number> = {
  QB: 0.25,
  RB: 0.85,
  WR: 1.15,
  TE: 1.0,
  K: 0.2,
  DEF: 0.45,
};

export type GameEnv = GameSlateRow;

export type PracticeReport = {
  practice_status: PracticeTag | null;
  practice_label: string | null;
  report_status: string | null;
  injury: string | null;
  note: string | null;
  source: string;
};

export type PlayerProjection = Player & {
  mu: number;
  sigma: number;
  skew: number;
  source: string;
  eligible: boolean;
  opponent?: string | null;
  implied_total?: number | null;
  spread?: number | null;
  total?: number | null;
  roof?: string | null;
  wind?: number | null;
  env_mult?: number;
  injury_mult?: number;
};

export type SlotAssignment = {
  index: number;
  slot: string;
  player: PlayerProjection | null;
};

export function starterSlots(rosterPositions: string[]) {
  return rosterPositions.filter((slot) => !NON_STARTER_SLOTS.has(slot));
}

export function slotAccepts(slot: string, position: string) {
  const allowed = FLEX_ELIGIBILITY[slot];
  if (!allowed) return position === slot;
  return allowed.has(position);
}

export function summarizeScoring(scoring: Record<string, number>) {
  const rec = Number(scoring.rec || 0);
  const ppr = rec >= 1 ? "Full PPR" : rec >= 0.5 ? "Half PPR" : "Standard (0 PPR)";
  const parts = [ppr];
  if (scoring.pass_td != null) parts.push(`${scoring.pass_td}pt Pass TD`);
  if (scoring.bonus_rec_te) parts.push(`${scoring.bonus_rec_te} TE Premium`);
  return parts.join(", ");
}

export function prepareStatLine(
  statDict: Record<string, unknown>,
  position: string,
  scoring: Record<string, number>,
) {
  const stats: Record<string, number> = {};
  for (const [key, value] of Object.entries(statDict)) {
    if (NON_SCORING.has(key)) continue;
    const n = Number(value);
    if (Number.isFinite(n)) stats[key] = n;
  }
  const rec = stats.rec || 0;
  if (position === "TE" && "bonus_rec_te" in scoring && stats.bonus_rec_te == null) stats.bonus_rec_te = rec;
  if (position === "RB" && "bonus_rec_rb" in scoring && stats.bonus_rec_rb == null) stats.bonus_rec_rb = rec;
  if (position === "WR" && "bonus_rec_wr" in scoring && stats.bonus_rec_wr == null) stats.bonus_rec_wr = rec;
  return stats;
}

export function calculateSleeperPoints(stats: Record<string, number>, scoring: Record<string, number>) {
  let total = 0;
  for (const [key, value] of Object.entries(stats)) {
    const multiplier = Number(scoring[key] || 0);
    if (!Number.isFinite(value) || !Number.isFinite(multiplier)) continue;
    total += value * multiplier;
  }
  return Math.round(total * 100) / 100;
}

export function normalizePractice(raw?: string | null): PracticeTag | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes("did not") || s === "dnp" || s === "out" || s === "na") return "DNP";
  if (s.includes("limited") || s === "lp") return "LP";
  if (s.includes("full") || s === "fp") return "FP";
  return null;
}

export function injuryMultiplier(status?: string | null, practice?: PracticeTag | null) {
  if (status && INACTIVE_INJURIES.has(status)) return 0;
  if (practice === "DNP") {
    if (status === "Doubtful") return 0.15;
    if (status === "Questionable") return 0.38;
    return 0.55;
  }
  if (practice === "LP") {
    if (status === "Doubtful") return 0.28;
    if (status === "Questionable") return 0.68;
    return 0.9;
  }
  if (practice === "FP") {
    if (status === "Doubtful") return 0.55;
    if (status === "Questionable") return 0.94;
    return 1;
  }
  if (!status) return 1;
  if (status === "Doubtful") return 0.35;
  if (status === "Questionable") return 0.85;
  return 1;
}

const ENV_SCALE: Record<string, number> = {
  QB: 0.012,
  WR: 0.016,
  TE: 0.012,
  RB: 0.006,
  K: 0.008,
  DEF: -0.018,
};

export function environmentMultiplier(position: string, game?: GameEnv | null) {
  if (!game) return 1;
  let mult = 1;
  if (game.implied != null && Number.isFinite(game.implied)) {
    const scale = ENV_SCALE[position] ?? 0.008;
    mult *= Math.min(1.22, Math.max(0.82, 1 + scale * (game.implied - 22.5)));
  }
  const outdoor = !game.roof || game.roof === "outdoors";
  const wind = game.wind ?? 0;
  if (outdoor && wind >= 15) {
    const haircut = Math.min(0.15, 0.01 * (wind - 15));
    if (position === "QB" || position === "WR" || position === "TE" || position === "K") mult *= 1 - haircut;
    else if (position === "RB" || position === "DEF") mult *= 1 + haircut * 0.3;
  }
  return Math.round(mult * 1000) / 1000;
}

export function projectPlayer(
  meta: Player,
  row: Record<string, unknown> | undefined,
  scoring: Record<string, number>,
  source: string,
  extras?: { game?: GameEnv | null; practice?: PracticeReport | null },
): PlayerProjection {
  const position = meta.position || "FLEX";
  const stats = prepareStatLine(row || {}, position, scoring);
  const raw = calculateSleeperPoints(stats, scoring);
  const practiceStatus = extras?.practice?.practice_status ?? normalizePractice(meta.practice_participation);
  const inj = injuryMultiplier(meta.injury_status, practiceStatus);
  const env = environmentMultiplier(position, extras?.game);
  let mu = raw * inj * env;
  const sigmaFrac = POSITION_SIGMA[position] ?? 0.42;
  let skew = POSITION_SKEW[position] ?? 0.7;
  let sigma = mu > 0 ? Math.max(0.35, mu * sigmaFrac) : 0.15;
  const implied = extras?.game?.implied;
  if (implied != null && implied >= 26 && (position === "WR" || position === "QB")) {
    sigma *= 1.1;
    if (implied >= 27 && position === "WR") skew *= 1.15;
  }
  const inactive = INACTIVE_INJURIES.has(meta.injury_status || "");
  const game = extras?.game;
  return {
    ...meta,
    practice_status: practiceStatus,
    practice_label: extras?.practice?.practice_label ?? null,
    beat_note: extras?.practice?.note ?? meta.injury_notes ?? null,
    mu: Math.round(mu * 100) / 100,
    sigma: Math.round((inactive ? 0.05 : sigma) * 1000) / 1000,
    skew: Math.round(skew * 1000) / 1000,
    source: row ? source : "unprojected",
    eligible: !inactive,
    opponent: game?.opponent ?? null,
    implied_total: game?.implied ?? null,
    spread: game?.spread ?? null,
    total: game?.total ?? null,
    roof: game?.roof ?? null,
    wind: game?.wind ?? null,
    env_mult: env,
    injury_mult: inj,
  };
}

/** Hungarian / Kuhn-Munkres min-cost assignment. `cost` must be square. */
export function hungarianMin(cost: number[][]): number[] {
  const n = cost.length;
  if (!n) return [];
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const assignment = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) assignment[p[j] - 1] = j - 1;
  return assignment;
}

export function optimizeLineupGreedy(rosterPositions: string[], players: PlayerProjection[]): SlotAssignment[] {
  const slots = starterSlots(rosterPositions).map((slot, index) => ({ index, slot }));
  if (!slots.length) return [];
  const remaining = [...players]
    .filter((p) => p.eligible && p.player_id && p.player_id !== "0")
    .sort((a, b) => b.mu - a.mu);
  const used = new Set<string>();
  const picked = new Map<number, PlayerProjection>();
  const order = [...slots].sort((a, b) => {
    const af = FLEX_SLOTS.has(a.slot) ? 1 : 0;
    const bf = FLEX_SLOTS.has(b.slot) ? 1 : 0;
    return af - bf || a.index - b.index;
  });
  for (const { index, slot } of order) {
    const choice = remaining.find((p) => !used.has(p.player_id) && slotAccepts(slot, p.position));
    if (choice) {
      used.add(choice.player_id);
      picked.set(index, choice);
    }
  }
  return slots.map(({ index, slot }) => ({ index, slot, player: picked.get(index) ?? null }));
}

/** Exact max-μ assignment (Hungarian). Handles overlapping FLEX / SUPER_FLEX / WRRB / REC. */
export function optimizeLineup(rosterPositions: string[], players: PlayerProjection[]): SlotAssignment[] {
  const slots = starterSlots(rosterPositions).map((slot, index) => ({ index, slot }));
  if (!slots.length) return [];
  const pool = players.filter((p) => p.eligible && p.player_id && p.player_id !== "0");
  if (!pool.length) return slots.map(({ index, slot }) => ({ index, slot, player: null }));

  const nS = slots.length;
  const nP = pool.length;
  const n = Math.max(nS, nP);
  const INELIGIBLE = 1e6;
  const cost: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < nS; i++) {
    for (let j = 0; j < nP; j++) {
      cost[i][j] = slotAccepts(slots[i].slot, pool[j].position) ? -pool[j].mu : INELIGIBLE;
    }
  }
  const assign = hungarianMin(cost);
  const picked = new Map<number, PlayerProjection>();
  for (let i = 0; i < nS; i++) {
    const j = assign[i];
    if (j == null || j < 0 || j >= nP) continue;
    if (cost[i][j] >= INELIGIBLE / 2) continue;
    picked.set(slots[i].index, pool[j]);
  }
  return slots.map(({ index, slot }) => ({ index, slot, player: picked.get(index) ?? null }));
}

export function currentAssignments(
  rosterPositions: string[],
  starters: string[],
  projections: Map<string, PlayerProjection>,
): SlotAssignment[] {
  return starterSlots(rosterPositions).map((slot, index) => {
    const id = starters[index];
    const player = id && id !== "0" ? projections.get(id) ?? null : null;
    return { index, slot, player };
  });
}

export type ScoreDist = { samples: number[]; p10: number; p50: number; p90: number };

function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI);

function sampleSkewNormal(mu: number, sigma: number, alpha: number, n: number) {
  if (n <= 0) return [];
  if (sigma <= 1e-9) return Array.from({ length: n }, () => Math.max(0, mu));
  const delta = alpha / Math.sqrt(1 + alpha * alpha);
  const varAdj = Math.max(1e-9, 1 - (2 * delta * delta) / Math.PI);
  const scale = sigma / Math.sqrt(varAdj);
  const loc = mu - scale * delta * SQRT_2_OVER_PI;
  const sqrtRest = Math.sqrt(Math.max(0, 1 - delta * delta));
  const samples = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const u = gauss();
    const v = gauss();
    const z = delta * Math.abs(u) + sqrtRest * v;
    samples[i] = Math.max(0, loc + scale * z);
  }
  return samples;
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];
  const idx = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

export function distFromSamples(samples: number[]): ScoreDist {
  const ordered = [...samples].sort((a, b) => a - b);
  return {
    samples,
    p10: Math.round(percentile(ordered, 10) * 100) / 100,
    p50: Math.round(percentile(ordered, 50) * 100) / 100,
    p90: Math.round(percentile(ordered, 90) * 100) / 100,
  };
}

export function simulatePlayers(players: PlayerProjection[], n = MC_ITERS) {
  const out = new Map<string, ScoreDist>();
  for (const player of players) {
    out.set(player.player_id, distFromSamples(sampleSkewNormal(player.mu, player.sigma, player.skew, n)));
  }
  return out;
}

export function simulateLivePlayers(
  players: PlayerProjection[],
  actuals: Record<string, number>,
  phases: Record<string, { phase: "upcoming" | "live" | "final"; progress: number }>,
  n = MC_ITERS,
) {
  const out = new Map<string, ScoreDist>();
  for (const player of players) {
    const info = phases[player.player_id] ?? { phase: "upcoming" as const, progress: 0 };
    const actual = actuals[player.player_id] || 0;
    if (info.phase === "final") {
      out.set(player.player_id, distFromSamples(Array.from({ length: n }, () => actual)));
    } else if (info.phase === "live") {
      const leftover = Math.max(0, Math.min(1, 1 - info.progress));
      const remMu = actual >= player.mu ? player.mu * 0.12 * leftover : (player.mu - actual) * leftover;
      const remSigma = Math.max(0.15, player.sigma * leftover);
      const residual = sampleSkewNormal(remMu, remSigma, player.skew, n);
      out.set(player.player_id, distFromSamples(residual.map((v) => actual + v)));
    } else {
      out.set(player.player_id, distFromSamples(sampleSkewNormal(player.mu, player.sigma, player.skew, n)));
    }
  }
  return out;
}

export function sumSamples(ids: string[], dists: Map<string, ScoreDist>, n: number): ScoreDist {
  const totals = new Array<number>(n).fill(0);
  for (const id of ids) {
    const dist = dists.get(id);
    if (!dist) continue;
    const len = Math.min(n, dist.samples.length);
    for (let i = 0; i < len; i++) totals[i] += dist.samples[i];
  }
  return distFromSamples(totals);
}

export function winProbability(left: number[], right: number[]) {
  const n = Math.min(left.length, right.length);
  if (!n) return 0.5;
  let wins = 0;
  for (let i = 0; i < n; i++) if (left[i] > right[i]) wins++;
  return Math.round((wins / n) * 1000) / 1000;
}

export function replacementMu(available: PlayerProjection[], position: string, excludeId?: string) {
  let best = 0;
  for (const player of available) {
    if (player.position !== position || player.player_id === excludeId) continue;
    if (player.mu > best) best = player.mu;
  }
  return best;
}

export function replacementLevelDelta(
  target: PlayerProjection,
  available: PlayerProjection[],
  rosterPlayers: PlayerProjection[],
) {
  const wire = replacementMu(available, target.position, target.player_id);
  const samePos = rosterPlayers.filter((p) => p.position === target.position && p.eligible && p.mu > 1);
  const flexEligible = FLEX_POSITIONS.has(target.position);
  const rosterCmp = samePos.length
    ? samePos
    : flexEligible
      ? rosterPlayers.filter((p) => FLEX_POSITIONS.has(p.position) && p.eligible && p.mu > 1)
      : rosterPlayers.filter((p) => p.eligible && p.mu > 1);
  const worst = rosterCmp.reduce((min, p) => Math.min(min, p.mu), rosterCmp[0]?.mu ?? 0);
  const rldWire = Math.round((target.mu - wire) * 100) / 100;
  const rldRoster = Math.round((target.mu - worst) * 100) / 100;
  return {
    replacement_wire: Math.round(wire * 100) / 100,
    rld_vs_wire: rldWire,
    rld_vs_roster: rldRoster,
    rld: Math.round(Math.max(rldWire, rldRoster, 0) * 100) / 100,
  };
}

export function tieredBids(rld: number, remainingFaab: number, weeksLeft: number, minBid = 0) {
  if (remainingFaab <= 0) return { conservative: 0, fair: 0, aggressive: 0 };
  if (rld <= 0) {
    const floor = Math.min(minBid, remainingFaab);
    return { conservative: floor, fair: floor, aggressive: floor };
  }
  const seasonValue = rld * Math.max(1, Math.min(weeksLeft, 12));
  const frac = Math.min(1, seasonValue / 40);
  let conservative = Math.max(minBid, Math.round(frac * remainingFaab * 0.4));
  let fair = Math.max(conservative, Math.round(frac * remainingFaab * 0.7));
  let aggressive = Math.max(fair, Math.round(frac * remainingFaab * 0.95));
  aggressive = Math.min(remainingFaab, aggressive);
  if (aggressive >= remainingFaab && remainingFaab > 1 && frac < 0.98) aggressive = remainingFaab - 1;
  fair = Math.min(fair, aggressive);
  conservative = Math.min(conservative, fair);
  return { conservative, fair, aggressive };
}

export function gradeTrade(giveMu: number, receiveMu: number) {
  const delta = Math.round((receiveMu - giveMu) * 100) / 100;
  let grade = "lopsided";
  if (delta >= 4) grade = "steal";
  else if (delta >= 1.5) grade = "win";
  else if (delta > -1.5) grade = "fair";
  else if (delta > -4) grade = "loss";
  return {
    give_p50: Math.round(giveMu * 100) / 100,
    receive_p50: Math.round(receiveMu * 100) / 100,
    delta,
    grade,
  };
}

export function slotForPick(pickNo: number, teams: number, draftType = "snake") {
  const index = pickNo - 1;
  const pos = index % teams;
  const roundIndex = Math.floor(index / teams);
  if (draftType === "linear") return pos + 1;
  if (roundIndex % 2 === 1) return teams - pos;
  return pos + 1;
}

export function roundForPick(pickNo: number, teams: number) {
  return Math.floor((pickNo - 1) / teams) + 1;
}

export function positionNeed(draftedPositions: string[], rosterPositions: string[], candidate: string) {
  const counts = new Map<string, number>();
  for (const slot of rosterPositions) {
    if (NON_STARTER_SLOTS.has(slot)) continue;
    counts.set(slot, (counts.get(slot) || 0) + 1);
  }
  const have = new Map<string, number>();
  for (const pos of draftedPositions) have.set(pos, (have.get(pos) || 0) + 1);
  const hard = have.get(candidate) || 0;
  const starters = counts.get(candidate) || 0;
  if (hard < starters) return "starter";
  const flex = (counts.get("FLEX") || 0) + (counts.get("WRRB_FLEX") || 0) + (counts.get("REC_FLEX") || 0);
  let usedFlex = 0;
  for (const pos of FLEX_POSITIONS) usedFlex += Math.max(0, (have.get(pos) || 0) - (counts.get(pos) || 0));
  if (FLEX_POSITIONS.has(candidate) && usedFlex < flex) return "flex";
  const superflex = counts.get("SUPER_FLEX") || 0;
  if (superflex && (FLEX_POSITIONS.has(candidate) || candidate === "QB")) {
    if (candidate === "QB" && (have.get("QB") || 0) < (counts.get("QB") || 0) + superflex) return "superflex";
  }
  return "bench";
}

export function vorForPlayer(
  player: PlayerProjection,
  available: PlayerProjection[],
  starterSlotsAtPos: number,
  teams: number,
  alreadyDraftedAtPos: number,
) {
  const others = available
    .filter((item) => item.position === player.position && item.player_id !== player.player_id)
    .sort((a, b) => b.mu - a.mu);
  const remainingStarters = Math.max(starterSlotsAtPos * teams - alreadyDraftedAtPos, 0);
  if (!others.length) return Math.round(player.mu * 100) / 100;
  const idx = Math.min(Math.max(remainingStarters, 1) - 1, others.length - 1);
  return Math.round((player.mu - others[idx].mu) * 100) / 100;
}

export function recommendScore(vor: number, need: string) {
  const bonus: Record<string, number> = { starter: 4, flex: 2, superflex: 2.5, bench: 0 };
  return Math.round((vor + (bonus[need] ?? 0)) * 1000) / 1000;
}

const IR_FLAGS: Record<string, string | null> = {
  Out: "reserve_allow_out",
  IR: "reserve_allow_out",
  PUP: "reserve_allow_out",
  Doubtful: "reserve_allow_doubtful",
  Questionable: null,
  NA: "reserve_allow_na",
  Suspended: "reserve_allow_sus",
  COV: "reserve_allow_cov",
  COVID: "reserve_allow_cov",
  "COVID-19": "reserve_allow_cov",
  DNR: "reserve_allow_dnr",
};

export function validateRoster(
  roster: { reserve?: string[]; taxi?: string[] },
  meta: Map<string, Player>,
  settings: Record<string, string | number | boolean | null>,
  rosterPositions: string[],
) {
  const flags: { code: string; severity: string; player_id: string; full_name: string; detail: string }[] = [];
  const hasIr = rosterPositions.includes("IR") || Number(settings.reserve_slots || 0) > 0;
  if (hasIr) {
    for (const playerId of roster.reserve || []) {
      if (!playerId || playerId === "0") continue;
      const player = meta.get(playerId);
      const status = player?.injury_status;
      const flag = status ? IR_FLAGS[status] : null;
      const allowed = Boolean(flag && settings[flag]);
      if (!allowed) {
        const name = player?.full_name || playerId;
        flags.push({
          code: "ir_ineligible",
          severity: "lock",
          player_id: playerId,
          full_name: name,
          detail: `${name} is in IR with status ${status || "Healthy"}. Sleeper freezes adds until you move them out.`,
        });
      }
    }
  }
  if (Number(settings.taxi_slots || 0) > 0 && !settings.taxi_allow_vets) {
    const limit = Number(settings.taxi_years || 0);
    if (limit > 0) {
      for (const playerId of roster.taxi || []) {
        if (!playerId || playerId === "0") continue;
        const player = meta.get(playerId);
        const exp = player?.years_exp ?? 0;
        if (exp >= limit) {
          const name = player?.full_name || playerId;
          flags.push({
            code: "taxi_ineligible",
            severity: "lock",
            player_id: playerId,
            full_name: name,
            detail: `${name} exceeds taxi year limit (${exp} exp).`,
          });
        }
      }
    }
  }
  return flags;
}

export function serializeProjected(player: PlayerProjection | null, dist?: ScoreDist | null) {
  if (!player) return null;
  return {
    player_id: player.player_id,
    full_name: player.full_name,
    position: player.position,
    nfl_team: player.nfl_team,
    injury_status: player.injury_status,
    status: player.status,
    years_exp: player.years_exp,
    practice_status: player.practice_status ?? null,
    practice_label: player.practice_label ?? null,
    beat_note: player.beat_note ?? null,
    mu: player.mu,
    sigma: player.sigma,
    eligible: player.eligible,
    p10: dist?.p10,
    p50: dist?.p50 ?? player.mu,
    p90: dist?.p90,
    opponent: player.opponent ?? null,
    implied_total: player.implied_total ?? null,
    spread: player.spread ?? null,
    total: player.total ?? null,
    roof: player.roof ?? null,
    wind: player.wind ?? null,
    env_mult: player.env_mult,
    injury_mult: player.injury_mult,
  };
}

export function uniqueSlate(players: PlayerProjection[]): GameSlateRow[] {
  const seen = new Set<string>();
  const rows: GameSlateRow[] = [];
  for (const player of players) {
    const team = player.nfl_team;
    if (!team || seen.has(team) || (player.implied_total == null && !player.opponent)) continue;
    seen.add(team);
    rows.push({
      team,
      opponent: player.opponent || "—",
      home: false,
      spread: player.spread ?? null,
      total: player.total ?? null,
      implied: player.implied_total ?? null,
      roof: player.roof ?? null,
      temp: null,
      wind: player.wind ?? null,
      source: "slate",
    });
  }
  rows.sort((a, b) => (b.implied ?? 0) - (a.implied ?? 0));
  return rows;
}
