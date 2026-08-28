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
export const SLEEPER_INACTIVE_STATUS = new Set(["Inactive", "Injured Reserve"]);
export const HANDCUFF_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
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

export type Opportunity = {
  gsis_id: string;
  games: number;
  target_share: number | null;
  rush_share: number | null;
  pass_share: number | null;
  source: string;
};

export type DefenseProfile = {
  team: string;
  position: string;
  fpa: number;
  league_avg: number;
  games: number;
  rank: number;
  teams: number;
  index: number;
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
  opp_mult?: number;
  def_mult?: number;
  def_rank?: number | null;
  def_fpa?: number | null;
  bye?: boolean;
  locked?: boolean;
  kickoff_ms?: number | null;
  kickoff_label?: string | null;
  inactive_ms?: number | null;
  inactive_label?: string | null;
  designated_inactive?: boolean;
  target_share?: number | null;
  rush_share?: number | null;
  pass_share?: number | null;
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

export function isDesignatedInactive(injury?: string | null, sleeperStatus?: string | null) {
  if (injury && INACTIVE_INJURIES.has(injury)) return true;
  if (sleeperStatus && SLEEPER_INACTIVE_STATUS.has(sleeperStatus)) return true;
  return false;
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

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function etParts(ms: number) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(
    new Date(ms),
  );
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
  return { iso, weekday };
}

function shiftIsoDate(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Final NFL injury-report posting: Friday 4pm ET for Sunday, Saturday 4pm for Monday, day-before 4pm otherwise. */
export function reportDeadlineMs(kickoffMs?: number | null, now = Date.now()): number | null {
  if (kickoffMs == null || !Number.isFinite(kickoffMs)) {
    const { iso, weekday } = etParts(now);
    const idx = WD[weekday] ?? 0;
    const daysUntilFri = (5 - idx + 7) % 7;
    let friday = shiftIsoDate(iso, daysUntilFri);
    let ms = parseEasternMs(friday, "16:00");
    if (ms != null && ms <= now) {
      friday = shiftIsoDate(friday, 7);
      ms = parseEasternMs(friday, "16:00");
    }
    return ms;
  }
  const { iso, weekday } = etParts(kickoffMs);
  const back = weekday === "Sun" || weekday === "Mon" ? 2 : 1;
  return parseEasternMs(shiftIsoDate(iso, -back), "16:00");
}

export function formatReportWindow(ms: number, now = Date.now()) {
  if (now >= ms) return "window closed";
  const mins = Math.round((ms - now) / 60000);
  if (mins < 60) return `closes in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 48) return rem ? `closes in ${hours}h ${rem}m` : `closes in ${hours}h`;
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ms)) + " ET"
  );
}

/** Official inactives typically post 90 minutes before kickoff. */
export function inactiveDeadlineMs(kickoffMs?: number | null): number | null {
  if (kickoffMs == null || !Number.isFinite(kickoffMs)) return null;
  return kickoffMs - 90 * 60 * 1000;
}

export function formatInactiveWindow(ms: number, now = Date.now()) {
  if (now >= ms) return "inactives posted";
  const mins = Math.round((ms - now) / 60000);
  if (mins < 60) return `inactives in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 48) return rem ? `inactives in ${hours}h ${rem}m` : `inactives in ${hours}h`;
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ms)) + " ET"
  );
}

export type DeskCallKind = "OUT" | "SIT" | "WATCH" | "START" | "INACTIVE";

export function deskCall(input: {
  injury_status?: string | null;
  status?: string | null;
  practice_status?: PracticeTag | null;
  bye?: boolean;
  locked?: boolean;
  starting?: boolean;
  deadline_ms?: number | null;
  now?: number;
}): { call: DeskCallKind; headline: string; reason: string } {
  const now = input.now ?? Date.now();
  const status = input.injury_status || "";
  const prac = input.practice_status ?? null;
  const windowOpen = input.deadline_ms == null || now < input.deadline_ms;
  const lockedStart = Boolean(input.locked && input.starting);

  if (input.bye) return { call: "SIT", headline: "Bye week", reason: "Not playing. Sit." };

  if (isDesignatedInactive(status, input.status)) {
    return {
      call: "OUT",
      headline: lockedStart ? "Out · locked in" : "Out",
      reason: lockedStart
        ? "Designated out and the game has started. You cannot swap."
        : "Designated out. Sit and start the replacement.",
    };
  }

  if (status === "Doubtful") {
    return {
      call: "SIT",
      headline: lockedStart ? "Sit · locked in" : "Sit",
      reason: prac === "FP" ? "Doubtful even on a full practice. Do not start." : "Doubtful. Sit. Almost never active.",
    };
  }

  if (status === "Questionable") {
    if (prac === "FP") {
      return {
        call: "START",
        headline: "Cleared",
        reason: "Questionable with Friday full practice. Treat as active.",
      };
    }
    if (!windowOpen) {
      return {
        call: "SIT",
        headline: lockedStart ? "Window closed · locked" : "Window closed · sit",
        reason: "No Friday FP. Sit.",
      };
    }
    const headline = "Sit unless FP by 4pm";
    if (prac === "DNP") {
      return { call: "SIT", headline, reason: "Questionable and DNP. Only start if upgraded to FP before 4pm ET." };
    }
    if (prac === "LP") {
      return { call: "WATCH", headline, reason: "Questionable and limited. Sit unless Friday’s report is FP." };
    }
    return { call: "WATCH", headline, reason: "Questionable. Default sit until Friday full practice posts." };
  }

  if (prac === "DNP") {
    return {
      call: windowOpen ? "WATCH" : "SIT",
      headline: windowOpen ? "DNP — wait for Friday" : "DNP after 4pm",
      reason: windowOpen
        ? "Did not practice. Wait for Friday’s report before starting."
        : "DNP and the Friday window is closed. Sit.",
    };
  }
  if (prac === "LP") {
    return { call: "WATCH", headline: "Limited", reason: "Limited practice. Prefer a healthier option if you have one." };
  }
  if (prac === "FP") {
    return { call: "START", headline: "Full practice", reason: "On the report but fully practiced. Start as usual." };
  }

  return { call: "START", headline: "Clear", reason: "No injury designation." };
}

export function sundayCall(input: {
  injury_status?: string | null;
  status?: string | null;
  practice_status?: PracticeTag | null;
  bye?: boolean;
  locked?: boolean;
  starting?: boolean;
  inactive_ms?: number | null;
  now?: number;
}): { call: DeskCallKind; headline: string; reason: string } {
  const now = input.now ?? Date.now();
  const status = input.injury_status || "";
  const prac = input.practice_status ?? null;
  const posted = input.inactive_ms != null && now >= input.inactive_ms;
  const lockedStart = Boolean(input.locked && input.starting);

  if (input.bye) return { call: "SIT", headline: "Bye week", reason: "Not playing. Sit." };

  if (isDesignatedInactive(status, input.status)) {
    return {
      call: "INACTIVE",
      headline: lockedStart ? "Inactive · locked" : "Inactive",
      reason: lockedStart
        ? "Inactive and the game has started. You cannot swap."
        : "Officially inactive. Sit and start the handcuff.",
    };
  }

  if (status === "Doubtful") {
    return {
      call: "SIT",
      headline: posted ? "Still doubtful · sit" : "Doubtful · expect inactive",
      reason: "Doubtful almost never suits up. Plan the handcuff.",
    };
  }

  if (status === "Questionable") {
    if (prac === "FP") {
      return {
        call: posted ? "START" : "WATCH",
        headline: posted ? "No inactive tag" : "Q with FP — wait for inactives",
        reason: posted
          ? "Questionable, Friday FP, not on the inactive list. Start."
          : "Likely active. Confirm 90 minutes before kickoff.",
      };
    }
    if (posted) {
      return {
        call: "SIT",
        headline: lockedStart ? "No upgrade · locked" : "No upgrade · sit",
        reason: "Inactives are out and he is still Questionable without a clear. Sit.",
      };
    }
    return {
      call: "WATCH",
      headline: "Inactives in 90 min",
      reason: "Questionable. Default sit until the inactive list posts.",
    };
  }

  if (prac === "DNP") {
    return {
      call: posted ? "SIT" : "WATCH",
      headline: posted ? "DNP · sit" : "DNP — wait for inactives",
      reason: posted ? "Did not practice and is not cleared. Sit." : "DNP. Expect inactive unless upgraded.",
    };
  }

  return { call: "START", headline: "Active", reason: "Not on the report. Start as usual." };
}

export function onInjuryDesk(player: {
  injury_status?: string | null;
  status?: string | null;
  practice_status?: PracticeTag | null;
  beat_note?: string | null;
  bye?: boolean;
}) {
  if (player.bye) return Boolean(player.injury_status || player.practice_status);
  if (isDesignatedInactive(player.injury_status, player.status)) return true;
  const status = player.injury_status || "";
  if (status === "Questionable" || status === "Doubtful") return true;
  if (player.practice_status) return true;
  if (player.beat_note) return true;
  return false;
}

export function onSundayDesk(player: {
  injury_status?: string | null;
  status?: string | null;
  practice_status?: PracticeTag | null;
  bye?: boolean;
}) {
  if (player.bye) return Boolean(player.injury_status);
  if (isDesignatedInactive(player.injury_status, player.status)) return true;
  const status = player.injury_status || "";
  if (status === "Questionable" || status === "Doubtful") return true;
  if (player.practice_status === "DNP" || player.practice_status === "LP") return true;
  return false;
}

export function findHandcuff(player: Player, catalog: Map<string, Player>): Player | null {
  const team = player.nfl_team;
  const pos = player.position;
  if (!team || !HANDCUFF_POSITIONS.has(pos)) return null;
  const pool = [...catalog.values()].filter(
    (p) =>
      p.nfl_team === team &&
      p.position === pos &&
      p.player_id !== player.player_id &&
      !isDesignatedInactive(p.injury_status, p.status),
  );
  if (!pool.length) return null;
  const myOrder = player.depth_chart_order ?? 1;
  pool.sort((a, b) => {
    const da = a.depth_chart_order ?? 99;
    const db = b.depth_chart_order ?? 99;
    if (da !== db) return da - db;
    return (b.years_exp ?? 0) - (a.years_exp ?? 0);
  });
  return pool.find((p) => (p.depth_chart_order ?? 99) > myOrder) ?? pool[0] ?? null;
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

export function fpaPosition(position: string) {
  const p = (position || "").toUpperCase();
  if (p === "FB" || p === "HB") return "RB";
  if (p === "DST" || p === "DEF") return "DEF";
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K") return p;
  return null;
}

export function defenseMultiplier(profile?: DefenseProfile | null) {
  if (!profile || profile.games < 4) return 1;
  const clamped = Math.min(1.28, Math.max(0.75, profile.index || 1));
  return Math.round((1 + (clamped - 1) * 0.55) * 1000) / 1000;
}

export function firstWeekdayOnOrAfter(year: number, month: number, day: number, weekday: number) {
  const wd = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return day + ((weekday - wd + 7) % 7);
}

export function isEasternDst(year: number, month: number, day: number) {
  const dstStart = firstWeekdayOnOrAfter(year, 3, 8, 0);
  const dstEnd = firstWeekdayOnOrAfter(year, 11, 1, 0);
  if (month > 3 && month < 11) return true;
  if (month === 3) return day >= dstStart;
  if (month === 11) return day < dstEnd;
  return false;
}

export function parseEasternMs(gameday?: string | null, gametime?: string | null): number | null {
  if (!gameday) return null;
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(gameday);
  if (!date) return null;
  const y = Number(date[1]);
  const m = Number(date[2]);
  const d = Number(date[3]);
  const tm = /^(\d{1,2}):(\d{2})/.exec(gametime || "13:00");
  if (!tm) return null;
  const offset = isEasternDst(y, m, d) ? 4 : 5;
  return Date.UTC(y, m - 1, d, Number(tm[1]) + offset, Number(tm[2]), 0);
}

export function formatKickoff(ms: number) {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ms)) + " ET"
  );
}

export function formatLockIn(ms: number, now = Date.now()) {
  const delta = ms - now;
  if (delta <= 0) return "LOCKED";
  const mins = Math.round(delta / 60000);
  if (mins < 60) return `locks in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 48) return rem ? `locks in ${hours}h ${rem}m` : `locks in ${hours}h`;
  return formatKickoff(ms);
}

export function lockSummary(players: PlayerProjection[], now = Date.now()) {
  let locked_count = 0;
  let bye_count = 0;
  let next: number | null = null;
  for (const player of players) {
    if (player.bye) bye_count += 1;
    if (player.locked) locked_count += 1;
    const kick = player.kickoff_ms;
    if (kick != null && kick > now && (next == null || kick < next)) next = kick;
  }
  return {
    next_kickoff_ms: next,
    next_label: next != null ? formatLockIn(next, now) : locked_count ? "LOCKED" : null,
    locked_count,
    bye_count,
  };
}

export function opportunityMultiplier(position: string, opp?: Opportunity | null, week = 1) {
  if (!opp || opp.games < 2) return 1;
  let raw = 1;
  if (position === "WR" && opp.target_share != null) raw = opp.target_share / 0.2;
  else if (position === "TE" && opp.target_share != null) raw = opp.target_share / 0.14;
  else if (position === "RB") {
    const rush = opp.rush_share != null ? opp.rush_share / 0.42 : 1;
    const tgt = opp.target_share != null ? opp.target_share / 0.08 : 1;
    raw = 0.75 * rush + 0.25 * tgt;
  } else if (position === "QB" && opp.pass_share != null) raw = opp.pass_share / 0.92;
  else return 1;
  const clamped = Math.min(1.18, Math.max(0.55, raw));
  const weight = week <= 4 ? 0.65 : 0.4;
  return Math.round((1 + (clamped - 1) * weight) * 1000) / 1000;
}

export function projectPlayer(
  meta: Player,
  row: Record<string, unknown> | undefined,
  scoring: Record<string, number>,
  source: string,
  extras?: {
    game?: GameEnv | null;
    practice?: PracticeReport | null;
    opportunity?: Opportunity | null;
    defense?: DefenseProfile | null;
    bye?: boolean;
    week?: number;
    now?: number;
  },
): PlayerProjection {
  const position = meta.position || "FLEX";
  const bye = Boolean(extras?.bye || extras?.game?.bye);
  const now = extras?.now ?? Date.now();
  const kickoffMs = extras?.game?.kickoff_ms ?? null;
  const locked = Boolean(!bye && kickoffMs != null && now >= kickoffMs);
  const stats = prepareStatLine(row || {}, position, scoring);
  const raw = calculateSleeperPoints(stats, scoring);
  const practiceStatus = extras?.practice?.practice_status ?? normalizePractice(meta.practice_participation);
  const designated = isDesignatedInactive(meta.injury_status, meta.status);
  const inj = bye || designated ? 0 : injuryMultiplier(meta.injury_status, practiceStatus);
  const env = bye ? 1 : environmentMultiplier(position, extras?.game);
  const opp = bye ? 1 : opportunityMultiplier(position, extras?.opportunity, extras?.week ?? 1);
  const def = bye ? 1 : defenseMultiplier(extras?.defense);
  let mu = raw * inj * env * opp * def;
  const sigmaFrac = POSITION_SIGMA[position] ?? 0.42;
  let skew = POSITION_SKEW[position] ?? 0.7;
  let sigma = mu > 0 ? Math.max(0.35, mu * sigmaFrac) : 0.15;
  const implied = extras?.game?.implied;
  if (implied != null && implied >= 26 && (position === "WR" || position === "QB")) {
    sigma *= 1.1;
    if (implied >= 27 && position === "WR") skew *= 1.15;
  }
  const inactive = bye || designated;
  const game = extras?.game;
  const inactiveMs = inactiveDeadlineMs(kickoffMs);
  let inactiveLabel: string | null = null;
  if (!bye && designated) inactiveLabel = "INACTIVE";
  else if (!bye && inactiveMs != null && kickoffMs != null && !locked) {
    const untilKick = kickoffMs - now;
    if (untilKick <= 3 * 3600 * 1000) inactiveLabel = formatInactiveWindow(inactiveMs, now);
  }
  const kickoffLabel = bye ? "BYE" : kickoffMs != null ? (locked ? "LOCKED" : formatLockIn(kickoffMs, now)) : null;
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
    opponent: bye ? "BYE" : (game?.opponent ?? null),
    implied_total: bye ? null : (game?.implied ?? null),
    spread: game?.spread ?? null,
    total: game?.total ?? null,
    roof: game?.roof ?? null,
    wind: game?.wind ?? null,
    env_mult: env,
    injury_mult: inj,
    opp_mult: opp,
    def_mult: def,
    def_rank: extras?.defense?.rank ?? null,
    def_fpa: extras?.defense?.fpa ?? null,
    bye,
    locked,
    kickoff_ms: kickoffMs,
    kickoff_label: kickoffLabel,
    inactive_ms: inactiveMs,
    inactive_label: inactiveLabel,
    designated_inactive: designated,
    target_share: extras?.opportunity?.target_share ?? null,
    rush_share: extras?.opportunity?.rush_share ?? null,
    pass_share: extras?.opportunity?.pass_share ?? null,
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

/** Exact max-μ assignment (Hungarian). Pins locked starters; locked bench cannot enter. */
export function optimizeLineup(
  rosterPositions: string[],
  players: PlayerProjection[],
  pinned: { index: number; playerId: string }[] = [],
): SlotAssignment[] {
  const slots = starterSlots(rosterPositions).map((slot, index) => ({ index, slot }));
  if (!slots.length) return [];
  const pinByIndex = new Map(pinned.map((row) => [row.index, row.playerId]));
  const pinnedIds = new Set(pinned.map((row) => row.playerId));
  const byId = new Map(players.map((p) => [p.player_id, p]));
  const pool = players.filter((p) => {
    if (!p.player_id || p.player_id === "0") return false;
    if (pinnedIds.has(p.player_id)) return true;
    if (!p.eligible) return false;
    if (p.locked) return false;
    return true;
  });
  if (!pool.length) return slots.map(({ index, slot }) => ({ index, slot, player: byId.get(pinByIndex.get(index) || "") ?? null }));

  const nS = slots.length;
  const nP = pool.length;
  const n = Math.max(nS, nP);
  const INELIGIBLE = 1e6;
  const cost: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < nS; i++) {
    const pinId = pinByIndex.get(slots[i].index);
    for (let j = 0; j < nP; j++) {
      if (pinId) {
        cost[i][j] = pool[j].player_id === pinId ? -pool[j].mu : INELIGIBLE;
        continue;
      }
      if (pinnedIds.has(pool[j].player_id)) {
        cost[i][j] = INELIGIBLE;
        continue;
      }
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

export type NeedState = {
  holes: { slot: string; remaining: number; kind: "starter" | "flex" | "superflex" }[];
  skillHoles: number;
  specialistHoles: number;
  dedicatedHoles: Record<string, number>;
};

export function buildNeedState(draftedPositions: string[], rosterPositions: string[]): NeedState {
  const counts = new Map<string, number>();
  for (const slot of rosterPositions) {
    if (NON_STARTER_SLOTS.has(slot)) continue;
    counts.set(slot, (counts.get(slot) || 0) + 1);
  }
  const have = new Map<string, number>();
  for (const pos of draftedPositions) have.set(pos, (have.get(pos) || 0) + 1);

  const dedicatedHoles: Record<string, number> = {};
  const holes: NeedState["holes"] = [];
  let skillHoles = 0;
  let specialistHoles = 0;

  for (const pos of ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"]) {
    const need = counts.get(pos) || 0;
    const got = have.get(pos) || 0;
    const remaining = Math.max(0, need - got);
    dedicatedHoles[pos] = remaining;
    if (remaining) {
      holes.push({ slot: pos, remaining, kind: "starter" });
      if (pos === "K" || pos === "DEF") specialistHoles += remaining;
      else skillHoles += remaining;
    }
  }

  let extraSkill = 0;
  for (const pos of FLEX_POSITIONS) extraSkill += Math.max(0, (have.get(pos) || 0) - (counts.get(pos) || 0));
  const flexSlots = (counts.get("FLEX") || 0) + (counts.get("WRRB_FLEX") || 0) + (counts.get("REC_FLEX") || 0);
  const flexRemain = Math.max(0, flexSlots - extraSkill);
  if (flexRemain) {
    holes.push({ slot: "FLEX", remaining: flexRemain, kind: "flex" });
    skillHoles += flexRemain;
  }
  extraSkill = Math.max(0, extraSkill - flexSlots);

  const extraQb = Math.max(0, (have.get("QB") || 0) - (counts.get("QB") || 0));
  const sf = counts.get("SUPER_FLEX") || 0;
  const sfRemain = Math.max(0, sf - extraQb - extraSkill);
  if (sfRemain) {
    holes.push({ slot: "SUPER_FLEX", remaining: sfRemain, kind: "superflex" });
    skillHoles += sfRemain;
  }

  return { holes, skillHoles, specialistHoles, dedicatedHoles };
}

export function candidateNeed(state: NeedState, position: string) {
  if ((state.dedicatedHoles[position] || 0) > 0) return "starter";
  if (position === "QB" && state.holes.some((h) => h.kind === "superflex")) return "superflex";
  if (FLEX_POSITIONS.has(position) && state.holes.some((h) => h.kind === "flex" || h.kind === "superflex")) {
    return state.holes.some((h) => h.kind === "flex") ? "flex" : "superflex";
  }
  return "depth";
}

export function specialistTooEarly(
  position: string,
  skillHoles: number,
  _picksLeft: number,
  currentRound: number,
  totalRounds: number,
) {
  if (position !== "K" && position !== "DEF") return false;
  if (currentRound >= Math.max(1, totalRounds - 1)) return false;
  return skillHoles > 0;
}

export function recommendScore(input: {
  vor: number;
  mu: number;
  need: string;
  position: string;
  picksLeft: number;
  skillHoles: number;
  round: number;
  totalRounds: number;
}) {
  const bonus: Record<string, number> = { starter: 4, flex: 2, superflex: 2.5, depth: 0 };
  let score = input.vor + (bonus[input.need] ?? 0) + input.mu * 0.02;
  if (specialistTooEarly(input.position, input.skillHoles, input.picksLeft, input.round, input.totalRounds)) {
    score -= 8;
  }
  return Math.round(score * 1000) / 1000;
}

export function draftNeedReason(input: {
  need: string;
  position: string;
  holes: number;
  skillHoles: number;
  picksLeft: number;
  earlySpecialist: boolean;
  vor: number;
}) {
  if (input.earlySpecialist) return `${input.position} waits — ${input.skillHoles} skill hole${input.skillHoles === 1 ? "" : "s"} still open`;
  if (input.need === "starter") {
    return input.holes > 1 ? `Fills a ${input.position} hole (${input.holes} left)` : `Fills the ${input.position} hole`;
  }
  if (input.need === "flex") return "FLEX still open";
  if (input.need === "superflex") return "SUPER_FLEX still open";
  if (input.vor > 0) return `Best remaining value · VOR ${input.vor.toFixed(1)}`;
  return "Depth";
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
    injury_body_part: player.injury_body_part ?? null,
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
    opp_mult: player.opp_mult,
    def_mult: player.def_mult,
    def_rank: player.def_rank ?? null,
    def_fpa: player.def_fpa ?? null,
    bye: player.bye ?? false,
    locked: player.locked ?? false,
    kickoff_ms: player.kickoff_ms ?? null,
    kickoff_label: player.kickoff_label ?? null,
    inactive_ms: player.inactive_ms ?? null,
    inactive_label: player.inactive_label ?? null,
    designated_inactive: player.designated_inactive ?? false,
    target_share: player.target_share ?? null,
    rush_share: player.rush_share ?? null,
    pass_share: player.pass_share ?? null,
  };
}

export function uniqueSlate(players: PlayerProjection[]): GameSlateRow[] {
  const seen = new Set<string>();
  const rows: GameSlateRow[] = [];
  for (const player of players) {
    const team = player.nfl_team;
    if (!team || seen.has(team) || (player.implied_total == null && !player.opponent && !player.bye)) continue;
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
      kickoff_ms: player.kickoff_ms ?? null,
      kickoff_label: player.kickoff_label ?? null,
      bye: player.bye ?? false,
    });
  }
  rows.sort((a, b) => (b.implied ?? 0) - (a.implied ?? 0));
  return rows;
}
