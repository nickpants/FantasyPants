import type {
  AnalyticsMatchup,
  AnalyticsSide,
  DraftBoardResponse,
  DraftPick,
  DraftPlayer,
  HandcuffHome,
  InjuryDeskResponse,
  InjuryDeskRow,
  League,
  LeagueDetailResponse,
  LeagueUser,
  LineupResponse,
  LiveStarter,
  MatchupAnalyticsResponse,
  NflState,
  Player,
  Roster,
  SundayDeskRow,
  SyncUserResponse,
  TradeDeskResponse,
  TradeGradeResponse,
  TradePlayer,
  WaiverBoardResponse,
} from "@/lib/types";
import {
  currentAssignments,
  deskCall,
  FANTASY_POSITIONS,
  findHandcuff,
  formatInactiveWindow,
  formatLockIn,
  formatReportWindow,
  gradeTrade,
  HANDCUFF_POSITIONS,
  inactiveDeadlineMs,
  MC_ITERS,
  lockSummary,
  onInjuryDesk,
  onSundayDesk,
  NON_STARTER_SLOTS,
  optimizeLineup,
  buildNeedState,
  candidateNeed,
  draftNeedReason,
  projectPlayer,
  recommendScore,
  replacementLevelDelta,
  reportDeadlineMs,
  roundForPick,
  serializeProjected,
  simulateLivePlayers,
  simulatePlayers,
  slotAccepts,
  slotForPick,
  specialistTooEarly,
  starterSlots,
  sundayCall,
  sumSamples,
  summarizeScoring,
  tieredBids,
  type PlayerProjection,
  validateRoster,
  vorForPlayer,
  winProbability,
} from "./engine";
import {
  getDraft,
  getDraftPicks,
  getLeague,
  getLeagueDrafts,
  getLeagueUsers,
  getMatchups,
  getNflState,
  getPlayerCatalog,
  getProjections,
  getRosters,
  getTransactions,
  getUser,
  getUserLeagues,
  hydrateIds,
  lookupPlayers,
  refreshPlayerCatalog,
} from "./sleeper";
import { canonTeam, getPracticeMap, getWeekSlate, lookupGame, slateRows } from "./context";
import { getOpportunityMap } from "./opportunity";
import { getDefenseMap, lookupDefense } from "./defense";
import { loadLeagueSnapshot, saveLeagueSnapshot } from "./store";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asSettings(value: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(asRecord(value))) {
    if (raw == null || typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      out[key] = raw as string | number | boolean | null;
    }
  }
  return out;
}

function asNumberMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(asRecord(value))) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function isDynasty(league: Record<string, unknown>) {
  const settings = asRecord(league.settings);
  if (settings.type === 2) return true;
  if (settings.taxi_slots || settings.taxi_deadline) return true;
  return String(league.name || "")
    .toLowerCase()
    .includes("dynasty");
}

function serializeLeague(raw: Record<string, unknown>): League {
  const scoring = asNumberMap(raw.scoring_settings);
  return {
    sleeper_league_id: String(raw.league_id),
    name: String(raw.name || "Unnamed League"),
    season: String(raw.season || ""),
    total_rosters: Number(raw.total_rosters || 0),
    roster_positions: Array.isArray(raw.roster_positions) ? (raw.roster_positions as string[]) : [],
    scoring_settings: scoring,
    settings: asSettings(raw.settings),
    is_dynasty: isDynasty(raw),
    avatar: (raw.avatar as string | null) ?? null,
    status: (raw.status as string | null) ?? null,
    scoring_summary: summarizeScoring(scoring),
    draft_id: raw.draft_id ? String(raw.draft_id) : undefined,
  };
}

function serializeUser(raw: Record<string, unknown>): LeagueUser {
  const metadata = asRecord(raw.metadata);
  return {
    user_id: String(raw.user_id ?? ""),
    username: (raw.username as string | null) ?? null,
    display_name: (raw.display_name as string | null) ?? null,
    avatar: (raw.avatar as string | null) ?? null,
    team_name: (metadata.team_name as string | null) ?? null,
    is_owner: Boolean(raw.is_owner),
  };
}

function teamName(user: Record<string, unknown> | undefined) {
  if (!user) return null;
  const metadata = asRecord(user.metadata);
  return (metadata.team_name as string) || (user.display_name as string) || (user.username as string) || null;
}

function serializeNflState(raw: Record<string, unknown>): NflState {
  return {
    week: Number(raw.week || 1),
    season: String(raw.season || ""),
    season_type: String(raw.season_type || "regular"),
    display_week: raw.display_week == null ? undefined : Number(raw.display_week),
    league_season: raw.league_season ? String(raw.league_season) : undefined,
    previous_season: raw.previous_season ? String(raw.previous_season) : undefined,
  };
}

export async function syncUser(username: string): Promise<SyncUserResponse> {
  const userPayload = await getUser(username.trim());
  const sleeperUserId = String(userPayload.user_id);
  const sleeperUsername = String(userPayload.username || username);
  const stateRaw = await getNflState();
  const state = serializeNflState(stateRaw as Record<string, unknown>);
  const season = String(state.league_season || state.season || new Date().getFullYear());
  const seasons = [season];
  if (state.previous_season && !seasons.includes(state.previous_season)) seasons.push(state.previous_season);
  const leagues: League[] = [];
  const seen = new Set<string>();
  for (const year of seasons) {
    const rows = await getUserLeagues(sleeperUserId, year);
    for (const league of rows) {
      const id = String(league.league_id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      leagues.push(serializeLeague(league));
    }
  }
  const week = Number(state.display_week || state.week || 1);
  void getWeekSlate(season, week).catch(() => undefined);
  return {
    user: {
      sleeper_user_id: sleeperUserId,
      username: sleeperUsername,
      display_name: (userPayload.display_name as string | null) ?? null,
      avatar: (userPayload.avatar as string | null) ?? null,
    },
    season,
    nfl_state: state,
    leagues,
  };
}

export async function syncLeague(leagueId: string): Promise<LeagueDetailResponse> {
  const cached = await loadLeagueSnapshot(leagueId);
  if (cached) return cached;
  const [leaguePayload, users, rostersPayload] = await Promise.all([
    getLeague(leagueId),
    getLeagueUsers(leagueId),
    getRosters(leagueId),
  ]);
  const league = serializeLeague(leaguePayload);
  const usersById = new Map(users.map((u) => [String(u.user_id), u]));
  const faabTotal = Number(
    asRecord(leaguePayload.settings).waiver_budget || asRecord(leaguePayload.settings).faab || 100,
  );
  const allIds: string[] = [];
  const rosters: Roster[] = rostersPayload.map((roster) => {
    const ownerId = roster.owner_id ? String(roster.owner_id) : null;
    const user = ownerId ? usersById.get(ownerId) : undefined;
    const settings = asRecord(roster.settings);
    const players = Array.isArray(roster.players) ? (roster.players as string[]) : [];
    const starters = Array.isArray(roster.starters) ? (roster.starters as string[]) : [];
    const reserve = Array.isArray(roster.reserve) ? (roster.reserve as string[]) : [];
    const taxi = Array.isArray(roster.taxi) ? (roster.taxi as string[]) : [];
    allIds.push(...players);
    return {
      roster_id: Number(roster.roster_id),
      owner_id: ownerId,
      team_name: teamName(user),
      players,
      starters,
      reserve,
      taxi,
      waiver_budget_used: Number(settings.waiver_budget_used || 0),
      total_faab: faabTotal,
      wins: Number(settings.wins || 0),
      losses: Number(settings.losses || 0),
      ties: Number(settings.ties || 0),
      fpts: settings.fpts == null ? null : Number(settings.fpts),
      owner: user ? serializeUser(user) : null,
    };
  });
  const map = await lookupPlayers(allIds);
  for (const roster of rosters) {
    roster.hydrated_players = hydrateIds(roster.players, map);
    roster.hydrated_starters = hydrateIds(roster.starters, map);
    roster.hydrated_reserve = hydrateIds(roster.reserve, map);
    roster.hydrated_taxi = hydrateIds(roster.taxi, map);
  }
  const payload = { league, users: users.map(serializeUser), rosters, from_cache: false, synced_at: Date.now() };
  await saveLeagueSnapshot(payload);
  return payload;
}

function resolveWeek(league: League, state: NflState, week?: number | null) {
  const season = league.season || state.league_season || state.season;
  if (week != null) return { week, season };
  if (season === (state.league_season || state.season)) {
    if (state.season_type === "pre") return { week: state.display_week || 1, season };
    return { week: state.display_week || state.week || 1, season };
  }
  return { week: 1, season };
}

async function projectIds(
  ids: string[],
  scoring: Record<string, number>,
  season: string,
  week: number,
  seasonType = "regular",
) {
  const unique = [...new Set(ids.filter((id) => id && id !== "0"))];
  const [meta, { rows, source }] = await Promise.all([
    lookupPlayers(unique),
    getProjections(season, week, seasonType),
  ]);
  const players = [...meta.values()];
  const [weekSlate, practice, opportunity, defense] = await Promise.all([
    getWeekSlate(season, week, seasonType).catch(() => ({ byTeam: new Map(), byeTeams: new Set<string>() })),
    getPracticeMap(season, week, players).catch(() => new Map()),
    getOpportunityMap(season, week).catch(() => new Map()),
    getDefenseMap(season, week).catch(() => new Map()),
  ]);
  const now = Date.now();
  const projected = new Map<string, PlayerProjection>();
  for (const pid of unique) {
    const info = meta.get(pid) ?? { player_id: pid, full_name: pid, position: "FLEX" };
    const game = lookupGame(weekSlate.byTeam, info.nfl_team);
    const team = canonTeam(info.nfl_team);
    const bye = Boolean(game?.bye) || (team ? weekSlate.byeTeams.has(team) : false);
    projected.set(
      pid,
      projectPlayer(info, rows[pid], scoring, source, {
        game,
        practice: practice.get(pid) ?? null,
        opportunity: info.gsis_id ? opportunity.get(info.gsis_id) ?? null : null,
        defense: lookupDefense(defense, game?.opponent, info.position),
        bye,
        week,
        now,
      }),
    );
  }
  return { projected, source, rows, meta, slate: weekSlate.byTeam };
}

function actualsFromMatchup(matchup: Record<string, unknown>) {
  const pts: Record<string, number> = {};
  const raw = asRecord(matchup.players_points);
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v);
    if (Number.isFinite(n)) pts[k] = n;
  }
  const starters = Array.isArray(matchup.starters) ? (matchup.starters as string[]) : [];
  const starterPts = Array.isArray(matchup.starters_points) ? (matchup.starters_points as unknown[]) : [];
  starters.forEach((id, i) => {
    if (!id || pts[id] != null) return;
    const n = Number(starterPts[i]);
    if (Number.isFinite(n)) pts[id] = n;
  });
  return pts;
}

function deskAlertFromStarters(current: { player: PlayerProjection | null }[]) {
  const now = Date.now();
  let sit = 0;
  let watch = 0;
  let out = 0;
  for (const slot of current) {
    const player = slot.player;
    if (!player || !onInjuryDesk(player)) continue;
    const deadline = reportDeadlineMs(player.kickoff_ms, now);
    const call = deskCall({
      injury_status: player.injury_status,
      status: player.status,
      practice_status: player.practice_status,
      bye: player.bye,
      locked: player.locked,
      starting: true,
      deadline_ms: deadline,
      now,
    }).call;
    if (call === "SIT") sit += 1;
    else if (call === "WATCH") watch += 1;
    else if (call === "OUT" || call === "INACTIVE") out += 1;
  }
  return { sit, watch, out };
}

function sundayAlertFromStarters(current: { player: PlayerProjection | null }[]) {
  const now = Date.now();
  let inactive = 0;
  let sit = 0;
  let watch = 0;
  for (const slot of current) {
    const player = slot.player;
    if (!player || !onSundayDesk(player)) continue;
    const call = sundayCall({
      injury_status: player.injury_status,
      status: player.status,
      practice_status: player.practice_status,
      bye: player.bye,
      locked: player.locked,
      starting: true,
      inactive_ms: player.inactive_ms ?? inactiveDeadlineMs(player.kickoff_ms),
      now,
    }).call;
    if (call === "INACTIVE") inactive += 1;
    else if (call === "SIT") sit += 1;
    else if (call === "WATCH") watch += 1;
  }
  return { inactive, sit, watch };
}

function withSlateKickoff(
  summary: ReturnType<typeof lockSummary>,
  slate: Map<string, { kickoff_ms?: number | null; bye?: boolean }>,
) {
  if (summary.next_kickoff_ms != null) return summary;
  let next: number | null = null;
  const now = Date.now();
  for (const env of slate.values()) {
    if (env.bye) continue;
    const kick = env.kickoff_ms;
    if (kick != null && kick > now && (next == null || kick < next)) next = kick;
  }
  if (next == null) return summary;
  return { ...summary, next_kickoff_ms: next, next_label: formatLockIn(next, now) };
}

export async function analyzeRoster(leagueId: string, rosterId: number, week?: number | null): Promise<LineupResponse> {
  const [detail, stateRaw] = await Promise.all([syncLeague(leagueId), getNflState()]);
  const state = serializeNflState(stateRaw as Record<string, unknown>);
  const roster = detail.rosters.find((r) => r.roster_id === rosterId);
  if (!roster) throw new Error(`Roster ${rosterId} not in league ${leagueId}`);
  const { week: weekNum, season } = resolveWeek(detail.league, state, week);
  const scoring = detail.league.scoring_settings;
  const { projected, source, slate } = await projectIds(roster.players, scoring, season, weekNum);
  const pool = [...projected.values()];
  const n = MC_ITERS;
  const dists = simulatePlayers(pool, n);
  const current = currentAssignments(detail.league.roster_positions, roster.starters, projected);
  const pinned = current
    .filter((slot) => slot.player?.locked && slot.player.player_id)
    .map((slot) => ({ index: slot.index, playerId: slot.player!.player_id }));
  const optimal = optimizeLineup(detail.league.roster_positions, pool, pinned);
  const currentIds = current.map((s) => s.player?.player_id).filter((id): id is string => Boolean(id));
  const optimalIds = optimal.map((s) => s.player?.player_id).filter((id): id is string => Boolean(id));
  const currentTeam = sumSamples(currentIds, dists, n);
  const optimalTeam = sumSamples(optimalIds, dists, n);

  const currentIdSet = new Set(currentIds);
  const optimalIdSet = new Set(optimalIds);
  const sits = current.filter((s) => s.player && !optimalIdSet.has(s.player.player_id)).map((s) => s.player);
  const starts = optimal.filter((s) => s.player && !currentIdSet.has(s.player.player_id));
  const swaps = sits.map((sit, i) => {
    const start = starts[i];
    return {
      slot: start?.slot ?? "FLEX",
      sit: serializeProjected(sit),
      start: serializeProjected(start?.player ?? null),
      delta_p50: Math.round(((start?.player?.mu ?? 0) - (sit?.mu ?? 0)) * 100) / 100,
    };
  });

  let opponent: LineupResponse["opponent"] = null;
  const matchups = await getMatchups(leagueId, weekNum);
  const mine = matchups.find((m) => Number(m.roster_id) === rosterId);
  if (mine && mine.matchup_id != null) {
    const other = matchups.find((m) => m.matchup_id === mine.matchup_id && Number(m.roster_id) !== rosterId);
    if (other) {
      const oppRoster = detail.rosters.find((r) => r.roster_id === Number(other.roster_id));
      const oppIds = (
        (Array.isArray(other.starters) ? (other.starters as string[]) : oppRoster?.starters) || []
      ).filter((id) => id && id !== "0");
      const oppProj = await projectIds(oppIds, scoring, season, weekNum);
      const oppDists = simulatePlayers([...oppProj.projected.values()], n);
      const oppTeam = sumSamples(oppIds, oppDists, n);
      opponent = {
        roster_id: Number(other.roster_id),
        team_name: oppRoster?.team_name,
        p10: oppTeam.p10,
        p50: oppTeam.p50,
        p90: oppTeam.p90,
        win_probability: winProbability(currentTeam.samples, oppTeam.samples),
        optimal_win_probability: winProbability(optimalTeam.samples, oppTeam.samples),
      };
    }
  }

  return {
    league_id: leagueId,
    roster_id: rosterId,
    team_name: roster.team_name,
    week: weekNum,
    season,
    scoring_summary: summarizeScoring(scoring),
    source,
    iterations: n,
    solver: "hungarian",
    current: {
      slots: current.map((slot) => ({
        slot: slot.slot,
        player: serializeProjected(slot.player, slot.player ? dists.get(slot.player.player_id) : null),
      })),
      p10: currentTeam.p10,
      p50: currentTeam.p50,
      p90: currentTeam.p90,
    },
    optimal: {
      slots: optimal.map((slot) => ({
        slot: slot.slot,
        player: serializeProjected(slot.player, slot.player ? dists.get(slot.player.player_id) : null),
      })),
      p10: optimalTeam.p10,
      p50: optimalTeam.p50,
      p90: optimalTeam.p90,
    },
    swaps,
    opponent,
    slate: slateRows(slate),
    locks: withSlateKickoff(lockSummary(pool), slate),
    desk_alert: deskAlertFromStarters(current),
    sunday_alert: sundayAlertFromStarters(current),
  };
}

export async function injuryDesk(leagueId: string, rosterId: number, week?: number | null): Promise<InjuryDeskResponse> {
  const [detail, stateRaw] = await Promise.all([syncLeague(leagueId), getNflState()]);
  const state = serializeNflState(stateRaw as Record<string, unknown>);
  const roster = detail.rosters.find((r) => r.roster_id === rosterId);
  if (!roster) throw new Error(`Roster ${rosterId} not in league ${leagueId}`);
  const { week: weekNum, season } = resolveWeek(detail.league, state, week);
  const scoring = detail.league.scoring_settings;
  const catalog = await getPlayerCatalog();
  const extraIds: string[] = [];
  for (const id of roster.players) {
    const meta = catalog.get(id);
    if (!meta || !HANDCUFF_POSITIONS.has(meta.position)) continue;
    const hc = findHandcuff(meta, catalog);
    if (hc && !roster.players.includes(hc.player_id)) extraIds.push(hc.player_id);
  }
  const { projected } = await projectIds([...roster.players, ...extraIds], scoring, season, weekNum);
  const pool = [...projected.values()];
  const current = currentAssignments(detail.league.roster_positions, roster.starters, projected);
  const starterIds = new Set(current.map((s) => s.player?.player_id).filter((id): id is string => Boolean(id)));
  const slotById = new Map<string, string>();
  for (const row of current) {
    if (row.player?.player_id) slotById.set(row.player.player_id, row.slot);
  }
  const now = Date.now();
  const kicks = pool.map((p) => p.kickoff_ms).filter((k): k is number => k != null && Number.isFinite(k));
  const sampleKick = (kicks.filter((k) => k > now).sort((a, b) => a - b)[0] ?? kicks.sort((a, b) => a - b)[0]) ?? null;
  const weekDeadline = reportDeadlineMs(sampleKick, now);
  const weekInactive = inactiveDeadlineMs(sampleKick);
  const reserve = new Set(roster.reserve || []);
  const taxi = new Set(roster.taxi || []);

  const ownerOf = new Map<string, { roster_id: number; team_name?: string | null; starters: string[] }>();
  for (const row of detail.rosters) {
    for (const pid of row.players) {
      ownerOf.set(pid, { roster_id: row.roster_id, team_name: row.team_name, starters: row.starters });
    }
  }

  function slotOf(player: PlayerProjection) {
    if (slotById.has(player.player_id)) return slotById.get(player.player_id)!;
    if (reserve.has(player.player_id)) return "IR";
    if (taxi.has(player.player_id)) return "TAXI";
    return "BN";
  }

  function replacementFor(player: PlayerProjection, slot: string) {
    if (NON_STARTER_SLOTS.has(slot)) return null;
    const safe = pool
      .filter((p) => p.player_id !== player.player_id && !starterIds.has(p.player_id) && p.eligible && !p.bye)
      .filter((p) => slotAccepts(slot, p.position))
      .filter((p) => !reserve.has(p.player_id) && !taxi.has(p.player_id))
      .filter((p) => {
        const d = reportDeadlineMs(p.kickoff_ms, now);
        const call = deskCall({
          injury_status: p.injury_status,
          status: p.status,
          practice_status: p.practice_status,
          bye: p.bye,
          locked: p.locked,
          starting: false,
          deadline_ms: d,
          now,
        }).call;
        return call === "START";
      })
      .sort((a, b) => b.mu - a.mu);
    const pick = safe[0];
    if (!pick) return null;
    return {
      player_id: pick.player_id,
      full_name: pick.full_name,
      position: pick.position,
      slot,
      p50: pick.mu,
    };
  }

  function locateHandcuff(player: Player): SundayDeskRow["handcuff"] {
    if (!HANDCUFF_POSITIONS.has(player.position)) return null;
    const hc = findHandcuff(player, catalog);
    if (!hc) return null;
    const owned = ownerOf.get(hc.player_id);
    const proj = projected.get(hc.player_id);
    let home: HandcuffHome = "wire";
    let action = `Add ${hc.full_name} off waivers`;
    let owner_name: string | null = null;
    if (owned) {
      if (owned.roster_id === rosterId) {
        if (owned.starters.includes(hc.player_id)) {
          home = "starter";
          action = `${hc.full_name} is already in your lineup`;
        } else {
          home = "bench";
          action = `Start ${hc.full_name} from your bench`;
        }
      } else {
        home = "other";
        owner_name = owned.team_name ?? `Roster ${owned.roster_id}`;
        action = `${hc.full_name} is rostered by ${owner_name}`;
      }
    }
    return {
      player_id: hc.player_id,
      full_name: hc.full_name,
      position: hc.position,
      nfl_team: hc.nfl_team,
      home,
      owner_name,
      p50: proj?.mu ?? null,
      action,
    };
  }

  const rows: InjuryDeskRow[] = [];
  for (const player of pool) {
    if (!roster.players.includes(player.player_id)) continue;
    if (!onInjuryDesk(player)) continue;
    const starting = starterIds.has(player.player_id);
    const slot = slotOf(player);
    const deadline = player.kickoff_ms != null ? reportDeadlineMs(player.kickoff_ms, now) : weekDeadline;
    let decision = deskCall({
      injury_status: player.injury_status,
      status: player.status,
      practice_status: player.practice_status,
      bye: player.bye,
      locked: player.locked,
      starting,
      deadline_ms: deadline,
      now,
    });
    if (reserve.has(player.player_id) || taxi.has(player.player_id)) {
      decision = {
        call: "OUT",
        headline: reserve.has(player.player_id) ? "On IR" : "On taxi",
        reason: reserve.has(player.player_id)
          ? "Cannot start from IR. Activate him first, then re-check the Friday report."
          : "Taxi squad. Cannot start.",
      };
    }
    const startable = starting && !player.locked && !NON_STARTER_SLOTS.has(slot);
    rows.push({
      slot,
      starting,
      call: decision.call,
      headline: decision.headline,
      reason: decision.reason,
      deadline_ms: deadline,
      deadline_label: deadline != null ? formatReportWindow(deadline, now) : null,
      window_open: deadline == null ? true : now < deadline,
      player: serializeProjected(player)!,
      replacement:
        startable && (decision.call === "SIT" || decision.call === "OUT" || decision.call === "WATCH")
          ? replacementFor(player, slot)
          : null,
    });
  }

  const rankCall = (row: { starting: boolean; call: string; player: { mu: number } }) => {
    const callRank =
      row.call === "OUT" || row.call === "INACTIVE" ? 0 : row.call === "SIT" ? 1 : row.call === "WATCH" ? 2 : 3;
    return (row.starting ? 0 : 10) + callRank;
  };
  rows.sort((a, b) => rankCall(a) - rankCall(b) || b.player.mu - a.player.mu);

  const calls = rows.filter((r) => r.call === "SIT" || r.call === "WATCH");
  const cleared = rows.filter((r) => r.call === "START");
  const out = rows.filter((r) => r.call === "OUT" || r.call === "INACTIVE");
  const startersInQuestion = rows.filter((r) => r.starting && r.call !== "START").length;
  const practice_tally = {
    fp: rows.filter((r) => r.player.practice_status === "FP").length,
    lp: rows.filter((r) => r.player.practice_status === "LP").length,
    dnp: rows.filter((r) => r.player.practice_status === "DNP").length,
    none: rows.filter((r) => !r.player.practice_status).length,
  };

  const sundayRows: SundayDeskRow[] = [];
  for (const player of pool) {
    if (!roster.players.includes(player.player_id)) continue;
    if (!onSundayDesk(player)) continue;
    const starting = starterIds.has(player.player_id);
    const slot = slotOf(player);
    const inactiveMs = player.inactive_ms ?? (player.kickoff_ms != null ? inactiveDeadlineMs(player.kickoff_ms) : weekInactive);
    let decision = sundayCall({
      injury_status: player.injury_status,
      status: player.status,
      practice_status: player.practice_status,
      bye: player.bye,
      locked: player.locked,
      starting,
      inactive_ms: inactiveMs,
      now,
    });
    if (reserve.has(player.player_id) || taxi.has(player.player_id)) {
      decision = {
        call: "INACTIVE",
        headline: reserve.has(player.player_id) ? "On IR" : "On taxi",
        reason: "Cannot start from IR or taxi. Activate first.",
      };
    }
    const showCuff =
      starting && !player.locked && !NON_STARTER_SLOTS.has(slot) && decision.call !== "START";
    sundayRows.push({
      slot,
      starting,
      call: decision.call,
      headline: decision.headline,
      reason: decision.reason,
      inactive_ms: inactiveMs,
      inactive_label: inactiveMs != null ? formatInactiveWindow(inactiveMs, now) : null,
      window_open: inactiveMs == null ? false : now < inactiveMs,
      player: serializeProjected(player)!,
      handcuff: showCuff ? locateHandcuff(player) : null,
    });
  }
  sundayRows.sort((a, b) => rankCall(a) - rankCall(b) || b.player.mu - a.player.mu);

  let bannerDeadline: number | null = weekDeadline;
  if (bannerDeadline == null) bannerDeadline = reportDeadlineMs(null, now);

  return {
    league_id: leagueId,
    roster_id: rosterId,
    team_name: roster.team_name,
    week: weekNum,
    season,
    scoring_summary: summarizeScoring(scoring),
    deadline_ms: bannerDeadline,
    deadline_label: bannerDeadline != null ? formatReportWindow(bannerDeadline, now) : null,
    window_open: bannerDeadline == null ? false : now < bannerDeadline,
    counts: {
      starters_in_question: startersInQuestion,
      sit: calls.filter((r) => r.call === "SIT").length,
      watch: calls.filter((r) => r.call === "WATCH").length,
      out: out.length,
      cleared: cleared.length,
    },
    practice_tally,
    calls,
    cleared,
    out,
    sunday: {
      deadline_ms: weekInactive,
      deadline_label: weekInactive != null ? formatInactiveWindow(weekInactive, now) : null,
      window_open: weekInactive == null ? false : now < weekInactive,
      counts: {
        inactive: sundayRows.filter((r) => r.call === "INACTIVE").length,
        sit: sundayRows.filter((r) => r.call === "SIT").length,
        watch: sundayRows.filter((r) => r.call === "WATCH").length,
        handcuffs: sundayRows.filter((r) => r.handcuff).length,
      },
      rows: sundayRows,
    },
  };
}

export async function analyzeMatchups(leagueId: string, week?: number | null): Promise<MatchupAnalyticsResponse> {
  const [detail, stateRaw] = await Promise.all([syncLeague(leagueId), getNflState()]);
  const state = serializeNflState(stateRaw as Record<string, unknown>);
  const { week: weekNum, season } = resolveWeek(detail.league, state, week);
  const scoring = detail.league.scoring_settings;
  const matchups = await getMatchups(leagueId, weekNum);
  const allIds = [
    ...detail.rosters.flatMap((r) => r.starters),
    ...matchups.flatMap((m) => (Array.isArray(m.starters) ? (m.starters as string[]) : [])),
  ];
  const { projected, source, slate } = await projectIds(allIds, scoring, season, weekNum);
  const n = MC_ITERS;
  const pregame = simulatePlayers([...projected.values()], n);
  const allActuals: Record<string, number> = {};
  for (const matchup of matchups) Object.assign(allActuals, actualsFromMatchup(matchup));
  const phases: Record<string, { phase: "upcoming" | "live" | "final"; progress: number }> = {};
  for (const [pid, player] of projected) {
    const actual = allActuals[pid];
    if (actual == null) phases[pid] = { phase: "upcoming", progress: 0 };
    else if (actual >= player.mu * 0.9 && player.mu > 1) phases[pid] = { phase: "final", progress: 1 };
    else {
      const progress = Math.max(0.08, Math.min(0.95, actual / Math.max(player.mu, 1)));
      phases[pid] = { phase: "live", progress };
    }
  }
  const liveDists = simulateLivePlayers([...projected.values()], allActuals, phases, n);
  for (const [pid, actual] of Object.entries(allActuals)) {
    if (!liveDists.has(pid)) {
      liveDists.set(pid, { samples: Array.from({ length: n }, () => actual), p10: actual, p50: actual, p90: actual });
      phases[pid] = { phase: "final", progress: 1 };
    }
  }
  const phaseNames = new Set(Object.values(phases).map((p) => p.phase));
  const mode: "pregame" | "live" | "final" =
    phaseNames.size === 1 && phaseNames.has("final")
      ? "final"
      : phaseNames.has("live") || (phaseNames.has("final") && phaseNames.has("upcoming"))
        ? "live"
        : "pregame";

  const byRoster = new Map(detail.rosters.map((r) => [r.roster_id, r]));
  type Card = AnalyticsSide & { samples: number[]; pregameSamples: number[] };
  const cards: Card[] = matchups.map((matchup) => {
    const rosterId = Number(matchup.roster_id);
    const roster = byRoster.get(rosterId);
    const starterIds = (
      (Array.isArray(matchup.starters) ? (matchup.starters as string[]) : roster?.starters) || []
    ).filter((id) => id && id !== "0");
    const team = sumSamples(starterIds, liveDists, n);
    const pre = sumSamples(starterIds, pregame, n);
    let actualTotal = matchup.points == null ? null : Number(matchup.points);
    if (actualTotal == null) {
      const sum = starterIds.reduce((acc, id) => acc + (allActuals[id] || 0), 0);
      actualTotal = sum > 0 ? Math.round(sum * 100) / 100 : null;
    }
    const liveStarters: LiveStarter[] = starterIds.map((pid) => {
      const player = projected.get(pid);
      const actual = allActuals[pid] || 0;
      const info = phases[pid] ?? { phase: "upcoming" as const, progress: 0 };
      const mu = player?.mu ?? 0;
      let remaining = mu;
      if (info.phase === "final") remaining = 0;
      else if (info.phase === "live") remaining = Math.max(0, (mu - actual) * (1 - info.progress));
      return {
        player_id: pid,
        full_name: player?.full_name ?? pid,
        position: player?.position,
        nfl_team: player?.nfl_team,
        actual: Math.round(actual * 100) / 100,
        projected: mu,
        remaining: Math.round(remaining * 100) / 100,
        phase: info.phase,
        progress: Math.round(info.progress * 1000) / 1000,
        toast: info.phase === "final" && mu >= 6 && actual < 0.45 * mu,
        practice_status: player?.practice_status ?? null,
        opponent: player?.opponent ?? null,
        implied_total: player?.implied_total ?? null,
        bye: player?.bye ?? false,
        locked: player?.locked ?? false,
        kickoff_label: player?.kickoff_label ?? null,
      };
    });
    return {
      week: weekNum,
      matchup_id: matchup.matchup_id == null ? null : Number(matchup.matchup_id),
      roster_id: rosterId,
      points: actualTotal,
      starters: starterIds,
      players_points: actualsFromMatchup(matchup),
      team_name: roster?.team_name,
      owner_id: roster?.owner_id,
      projected_floor: team.p10,
      projected_median: team.p50,
      projected_ceiling: team.p90,
      win_probability: 0.5,
      pregame_median: pre.p50,
      live_starters: liveStarters,
      samples: team.samples,
      pregameSamples: pre.samples,
    };
  });

  const grouped = new Map<number | null, Card[]>();
  for (const card of cards) {
    const list = grouped.get(card.matchup_id) ?? [];
    list.push(card);
    grouped.set(card.matchup_id, list);
  }
  const results: AnalyticsMatchup[] = [];
  for (const [matchupId, group] of grouped) {
    const homeCard = group[0];
    const awayCard = group[1] ?? null;
    const wp = winProbability(homeCard.samples, awayCard ? awayCard.samples : Array.from({ length: n }, () => 0));
    const preWp = winProbability(
      homeCard.pregameSamples,
      awayCard ? awayCard.pregameSamples : Array.from({ length: n }, () => 0),
    );
    const home: AnalyticsSide = {
      week: homeCard.week,
      matchup_id: homeCard.matchup_id,
      roster_id: homeCard.roster_id,
      points: homeCard.points,
      starters: homeCard.starters,
      players_points: homeCard.players_points,
      team_name: homeCard.team_name,
      owner_id: homeCard.owner_id,
      projected_floor: homeCard.projected_floor,
      projected_median: homeCard.projected_median,
      projected_ceiling: homeCard.projected_ceiling,
      win_probability: wp,
      pregame_win_probability: preWp,
      pregame_median: homeCard.pregame_median,
      live_starters: homeCard.live_starters,
    };
    let away: AnalyticsSide | null = null;
    if (awayCard) {
      away = {
        week: awayCard.week,
        matchup_id: awayCard.matchup_id,
        roster_id: awayCard.roster_id,
        points: awayCard.points,
        starters: awayCard.starters,
        players_points: awayCard.players_points,
        team_name: awayCard.team_name,
        owner_id: awayCard.owner_id,
        projected_floor: awayCard.projected_floor,
        projected_median: awayCard.projected_median,
        projected_ceiling: awayCard.projected_ceiling,
        win_probability: Math.round((1 - wp) * 1000) / 1000,
        pregame_win_probability: Math.round((1 - preWp) * 1000) / 1000,
        pregame_median: awayCard.pregame_median,
        live_starters: awayCard.live_starters,
      };
    }
    results.push({ matchup_id: matchupId, home, away });
  }

  return {
    league_id: leagueId,
    week: weekNum,
    season,
    source,
    mode,
    scoring_summary: summarizeScoring(scoring),
    matchups: results,
    slate: slateRows(slate),
  };
}

export async function leagueCompliance(leagueId: string) {
  const detail = await syncLeague(leagueId);
  const ids = detail.rosters.flatMap((r) => [...(r.reserve || []), ...(r.taxi || [])]);
  const meta = await lookupPlayers(ids);
  const reports = [];
  for (const roster of detail.rosters) {
    const flags = validateRoster(roster, meta, detail.league.settings, detail.league.roster_positions);
    if (flags.length) reports.push({ roster_id: roster.roster_id, team_name: roster.team_name, flags });
  }
  return { league_id: leagueId, compliance: reports };
}

export async function waiverBoard(leagueId: string, rosterId?: number | null): Promise<WaiverBoardResponse> {
  const [detail, stateRaw] = await Promise.all([syncLeague(leagueId), getNflState()]);
  const state = serializeNflState(stateRaw as Record<string, unknown>);
  const { week: weekNum, season } = resolveWeek(detail.league, state);
  const scoring = detail.league.scoring_settings;
  const settings = detail.league.settings;
  const playoffStart = Number(settings.playoff_week_start || 15);
  const weeksLeft = Math.max(1, playoffStart - weekNum + 3);
  const totalFaab = Number(settings.waiver_budget || 100);
  const minBid = Number(settings.waiver_bid_min || 0);
  const isFaab = Number(settings.waiver_type || 0) === 2;

  const rostered = new Set<string>();
  for (const roster of detail.rosters) {
    for (const id of roster.players) if (id && id !== "0") rostered.add(id);
  }
  const { rows } = await getProjections(season, weekNum);
  const ranked = Object.entries(rows)
    .filter(([pid]) => !rostered.has(pid))
    .map(([pid, row]) => ({ pid, pts: Number(row.pts_ppr || row.pts_half_ppr || row.pts_std || 0) }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 120)
    .map((r) => r.pid);
  const { projected, meta } = await projectIds([...ranked, ...rostered], scoring, season, weekNum);
  const available: PlayerProjection[] = [];
  for (const pid of ranked) {
    const player = projected.get(pid);
    if (player && FANTASY_POSITIONS.has(player.position) && player.mu > 0) available.push(player);
  }
  available.sort((a, b) => b.mu - a.mu);

  const focus = rosterId ?? detail.rosters[0]?.roster_id;
  const focusRoster = detail.rosters.find((r) => r.roster_id === focus);
  const rosterPlayers: PlayerProjection[] = [];
  for (const pid of focusRoster?.players || []) {
    const player = projected.get(pid);
    if (player) rosterPlayers.push(player);
  }
  const remaining = focusRoster
    ? Math.max(0, (focusRoster.total_faab || totalFaab) - (focusRoster.waiver_budget_used || 0))
    : 0;

  const targets = available.map((player) => {
    const rld = replacementLevelDelta(player, available, rosterPlayers);
    return {
      player_id: player.player_id,
      full_name: player.full_name,
      position: player.position,
      nfl_team: player.nfl_team,
      injury_status: player.injury_status,
      p50: player.mu,
      ...rld,
      bids: isFaab ? tieredBids(rld.rld, remaining, weeksLeft, minBid) : null,
      practice_status: player.practice_status ?? null,
      implied_total: player.implied_total ?? null,
    };
  });
  targets.sort((a, b) => b.rld - a.rld || b.p50 - a.p50);

  const faabTable = detail.rosters.map((roster) => ({
    roster_id: roster.roster_id,
    team_name: roster.team_name,
    owner_id: roster.owner_id,
    total_faab: roster.total_faab,
    used: roster.waiver_budget_used,
    remaining: Math.max(0, roster.total_faab - roster.waiver_budget_used),
    parsed_spent: roster.waiver_budget_used,
  }));
  faabTable.sort((a, b) => a.remaining - b.remaining);

  const allMeta = new Map<string, Player>(meta);
  const compliance = [];
  for (const roster of detail.rosters) {
    const flags = validateRoster(roster, allMeta, settings, detail.league.roster_positions);
    if (flags.length) compliance.push({ roster_id: roster.roster_id, team_name: roster.team_name, flags });
  }

  let transactions: WaiverBoardResponse["transactions"] = [];
  try {
    const raw = await getTransactions(leagueId, weekNum);
    transactions = raw.slice(0, 40).map((txn) => ({
      week: weekNum,
      type: String(txn.type || ""),
      status: String(txn.status || ""),
      bid: txn.settings && typeof txn.settings === "object" ? Number(asRecord(txn.settings).waiver_bid) || null : null,
      adds: asNumberMap(txn.adds),
      drops: asNumberMap(txn.drops),
      roster_ids: Array.isArray(txn.roster_ids) ? (txn.roster_ids as number[]) : [],
    }));
  } catch {
    transactions = [];
  }

  return {
    league_id: leagueId,
    week: weekNum,
    season,
    is_faab: isFaab,
    remaining_faab: remaining,
    roster_id: focus ?? 0,
    faab_table: faabTable,
    available: targets,
    compliance,
    transactions,
  };
}

export async function tradeDesk(leagueId: string): Promise<TradeDeskResponse> {
  const [detail, stateRaw] = await Promise.all([syncLeague(leagueId), getNflState()]);
  const state = serializeNflState(stateRaw as Record<string, unknown>);
  const { week: weekNum, season } = resolveWeek(detail.league, state);
  const ids = detail.rosters.flatMap((r) => r.players);
  const { projected } = await projectIds(ids, detail.league.scoring_settings, season, weekNum);
  return {
    league_id: leagueId,
    week: weekNum,
    season,
    rosters: detail.rosters.map((roster) => ({
      roster_id: roster.roster_id,
      team_name: roster.team_name,
      owner_id: roster.owner_id,
      players: roster.players
        .map((pid) => projected.get(pid))
        .filter((p): p is PlayerProjection => Boolean(p))
        .sort((a, b) => b.mu - a.mu)
        .map(
          (p): TradePlayer => ({
            player_id: p.player_id,
            full_name: p.full_name,
            position: p.position,
            nfl_team: p.nfl_team,
            p50: p.mu,
          }),
        ),
    })),
    recent_trades: [],
  };
}

export async function evaluateTrade(leagueId: string, give: string[], receive: string[]): Promise<TradeGradeResponse> {
  const desk = await tradeDesk(leagueId);
  const all = new Map<string, TradePlayer>();
  for (const roster of desk.rosters) for (const player of roster.players) all.set(player.player_id, player);
  const givePlayers = give.map((id) => all.get(id)).filter((p): p is TradePlayer => Boolean(p));
  const receivePlayers = receive.map((id) => all.get(id)).filter((p): p is TradePlayer => Boolean(p));
  const giveP50 = givePlayers.reduce((s, p) => s + p.p50, 0);
  const receiveP50 = receivePlayers.reduce((s, p) => s + p.p50, 0);
  return { give: givePlayers, receive: receivePlayers, ...gradeTrade(giveP50, receiveP50) };
}

export async function draftBoard(
  leagueId: string,
  sleeperUserId?: string | null,
  rosterId?: number | null,
): Promise<DraftBoardResponse> {
  const detail = await syncLeague(leagueId);
  const drafts = await getLeagueDrafts(leagueId);
  if (!drafts.length) throw new Error("No drafts for this league yet.");
  const sorted = [...drafts].sort((a, b) => Number(b.created || 0) - Number(a.created || 0));
  const selected =
    sorted.find((d) => d.status === "drafting") || sorted.find((d) => d.status === "pre_draft") || sorted[0];
  const draft = await getDraft(String(selected.draft_id));
  const picks = [...(await getDraftPicks(String(draft.draft_id)))].sort(
    (a, b) => Number(a.pick_no || 0) - Number(b.pick_no || 0),
  );
  const settings = asRecord(draft.settings);
  const teams = Number(settings.teams || detail.league.total_rosters || 1) || 1;
  const rounds = Number(settings.rounds || 15);
  const draftType = String(draft.type || "snake");
  const slotToRoster = asNumberMap(draft.slot_to_roster_id);
  const draftOrder = asNumberMap(draft.draft_order);
  const scoring = detail.league.scoring_settings;
  const positions = detail.league.roster_positions;
  const season = String(draft.season || detail.league.season);
  const users = new Map(detail.users.map((u) => [u.user_id, u]));
  const rosterById = new Map(detail.rosters.map((r) => [r.roster_id, r]));

  let myRosterId = rosterId ?? null;
  if (myRosterId == null && sleeperUserId) {
    const mine = detail.rosters.find((r) => r.owner_id === sleeperUserId);
    if (mine) myRosterId = mine.roster_id;
    else if (sleeperUserId in draftOrder) {
      const slot = draftOrder[sleeperUserId];
      const rid = slotToRoster[String(slot)] ?? slotToRoster[slot];
      if (rid) myRosterId = rid;
    }
  }

  const draftedIds = new Set(picks.map((p) => String(p.player_id || "")).filter(Boolean));
  const { rows, source } = await getProjections(season, 1);
  const ranked = Object.entries(rows)
    .filter(([pid]) => !draftedIds.has(pid))
    .map(([pid, row]) => ({ pid, pts: Number(row.pts_ppr || row.pts_half_ppr || 0) }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 250)
    .map((r) => r.pid);
  const lookupIds = [...ranked, ...draftedIds];
  const catalog = await getPlayerCatalog();
  const projected = new Map<string, PlayerProjection>();
  for (const pid of lookupIds) {
    let info = catalog.get(pid);
    if (!info && draftedIds.has(pid)) {
      const pick = picks.find((p) => String(p.player_id) === pid);
      const md = asRecord(pick?.metadata);
      info = {
        player_id: pid,
        full_name: `${md.first_name || ""} ${md.last_name || ""}`.trim() || pid,
        position: String(md.position || "FLEX"),
        nfl_team: (md.team as string | null) ?? null,
        injury_status: (md.injury_status as string | null) ?? null,
      };
    }
    if (!info) continue;
    if (!FANTASY_POSITIONS.has(info.position) && !draftedIds.has(pid)) continue;
    projected.set(pid, projectPlayer(info, rows[pid], scoring, source));
  }

  const available = [...projected.values()]
    .filter((p) => !draftedIds.has(p.player_id) && FANTASY_POSITIONS.has(p.position) && p.mu > 0)
    .sort((a, b) => b.mu - a.mu);

  const draftedPos = new Map<string, number>();
  for (const pick of picks) {
    const pid = String(pick.player_id || "");
    const pos = projected.get(pid)?.position || String(asRecord(pick.metadata).position || "");
    if (pos) draftedPos.set(pos, (draftedPos.get(pos) || 0) + 1);
  }
  const slotCounts = new Map<string, number>();
  for (const slot of starterSlots(positions)) slotCounts.set(slot, (slotCounts.get(slot) || 0) + 1);

  const yourPicksRaw = picks.filter((pick) => {
    if (myRosterId != null) return Number(pick.roster_id || 0) === myRosterId;
    if (sleeperUserId) return String(pick.picked_by || "") === sleeperUserId;
    return false;
  });
  const yourPositions = yourPicksRaw
    .map((pick) => projected.get(String(pick.player_id))?.position || String(asRecord(pick.metadata).position || ""))
    .filter(Boolean);

  const needState = buildNeedState(yourPositions, positions);
  const picksLeft = Math.max(0, rounds - yourPicksRaw.length);
  const currentRound = Math.min(rounds, yourPicksRaw.length + 1);

  const draftedBefore = new Set<string>();
  const pickGrades = new Map<string, number>();
  for (const pick of picks) {
    const pid = String(pick.player_id || "");
    const isYours = myRosterId != null && Number(pick.roster_id || 0) === myRosterId;
    if (pid && isYours) {
      const remainingThen = [...projected.values()].filter(
        (p) => !draftedBefore.has(p.player_id) && FANTASY_POSITIONS.has(p.position),
      );
      const bpa = remainingThen.reduce((max, p) => Math.max(max, p.mu), 0);
      const taken = projected.get(pid);
      if (taken) pickGrades.set(pid, Math.round((taken.mu - bpa) * 100) / 100);
    }
    if (pid) draftedBefore.add(pid);
  }

  const recommendations: DraftPlayer[] = available.map((player) => {
    const need = candidateNeed(needState, player.position);
    const vor = vorForPlayer(
      player,
      available,
      slotCounts.get(player.position) || 1,
      teams,
      draftedPos.get(player.position) || 0,
    );
    const adp = rows[player.player_id]?.adp_dd_ppr;
    const early = specialistTooEarly(player.position, needState.skillHoles, picksLeft, currentRound, rounds);
    return {
      player_id: player.player_id,
      full_name: player.full_name,
      position: player.position,
      nfl_team: player.nfl_team,
      injury_status: player.injury_status,
      p50: player.mu,
      vor,
      need,
      score: recommendScore({
        vor,
        mu: player.mu,
        need,
        position: player.position,
        picksLeft,
        skillHoles: needState.skillHoles,
        round: currentRound,
        totalRounds: rounds,
      }),
      reason: draftNeedReason({
        need,
        position: player.position,
        holes: needState.dedicatedHoles[player.position] || 0,
        skillHoles: needState.skillHoles,
        picksLeft,
        earlySpecialist: early,
        vor,
      }),
      adp: adp == null ? null : Number(adp),
    };
  });
  recommendations.sort((a, b) => (b.score || 0) - (a.score || 0) || b.p50 - a.p50);

  const nextPickNo = picks.length ? Number(picks[picks.length - 1].pick_no) + 1 : 1;
  const totalPicks = teams * rounds;
  let onTheClock: DraftBoardResponse["on_the_clock"] = null;
  let untilYou: number | null = null;
  if (nextPickNo <= totalPicks) {
    const slot = slotForPick(nextPickNo, teams, draftType);
    const clockRoster = slotToRoster[String(slot)] ?? slotToRoster[slot] ?? null;
    const clockUser = Object.entries(draftOrder).find(([, orderSlot]) => orderSlot === slot)?.[0] ?? null;
    const clockTeam = clockRoster ? rosterById.get(clockRoster)?.team_name : null;
    const clockName = clockUser ? users.get(clockUser)?.display_name || users.get(clockUser)?.username : null;
    onTheClock = {
      pick_no: nextPickNo,
      round: roundForPick(nextPickNo, teams),
      draft_slot: slot,
      roster_id: clockRoster,
      user_id: clockUser,
      team_name: clockTeam,
      display_name: clockName ?? null,
      is_you: Boolean(
        (myRosterId != null && clockRoster === myRosterId) || (sleeperUserId && clockUser === sleeperUserId),
      ),
    };
    if (myRosterId != null) {
      for (let pickNo = nextPickNo; pickNo <= totalPicks; pickNo++) {
        const s = slotForPick(pickNo, teams, draftType);
        const rid = slotToRoster[String(s)] ?? slotToRoster[s];
        if (rid === myRosterId) {
          untilYou = pickNo - nextPickNo;
          break;
        }
      }
    }
  }

  const packPick = (pick: Record<string, unknown>): DraftPick => {
    const pid = String(pick.player_id || "");
    const player = projected.get(pid);
    const md = asRecord(pick.metadata);
    return {
      pick_no: Number(pick.pick_no || 0),
      round: Number(pick.round || 0),
      draft_slot: pick.draft_slot == null ? undefined : Number(pick.draft_slot),
      roster_id: pick.roster_id == null ? undefined : Number(pick.roster_id),
      player_id: pid,
      full_name: player?.full_name || `${md.first_name || ""} ${md.last_name || ""}`.trim() || pid,
      position: player?.position || (md.position as string | null),
      nfl_team: player?.nfl_team || (md.team as string | null),
      p50: player?.mu ?? null,
      grade: pickGrades.get(pid) ?? null,
    };
  };

  return {
    league_id: leagueId,
    scoring_summary: summarizeScoring(scoring),
    source,
    draft: {
      draft_id: String(draft.draft_id),
      status: String(draft.status || ""),
      type: draftType,
      season,
      teams,
      rounds,
      pick_timer: settings.pick_timer == null ? undefined : Number(settings.pick_timer),
      picks_made: picks.length,
      total_picks: totalPicks,
    },
    on_the_clock: onTheClock,
    picks_until_you: untilYou,
    roster_id: myRosterId,
    your_roster: yourPicksRaw.map(packPick),
    recommendations: recommendations.slice(0, 12),
    need_board: {
      holes: needState.holes,
      skill_holes: needState.skillHoles,
      specialist_holes: needState.specialistHoles,
      picks_left: picksLeft,
    },
    available: available.slice(0, 200).map((p) => ({
      player_id: p.player_id,
      full_name: p.full_name,
      position: p.position,
      nfl_team: p.nfl_team,
      injury_status: p.injury_status,
      p50: p.mu,
      adp: rows[p.player_id]?.adp_dd_ppr == null ? null : Number(rows[p.player_id].adp_dd_ppr),
    })),
    recent_picks: picks.slice(-12).map(packPick),
  };
}

export async function refreshPlayers() {
  await refreshPlayerCatalog();
  return { cached: true };
}
