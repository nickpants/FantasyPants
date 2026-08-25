import { createServerFn } from "@tanstack/react-start";
import { copilotConfigured, runDebate } from "./copilot";
import {
  analyzeMatchups,
  analyzeRoster,
  draftBoard,
  evaluateTrade,
  leagueCompliance,
  refreshPlayers,
  syncLeague,
  syncUser,
  tradeDesk,
  waiverBoard,
} from "./services";

export const syncSleeperUserFn = createServerFn({ method: "POST" })
  .validator((data: { username: string }) => data)
  .handler(async ({ data }) => {
    if (!data.username?.trim()) throw new Error("Enter a Sleeper username");
    return syncUser(data.username);
  });

export const syncLeagueFn = createServerFn({ method: "GET" })
  .validator((data: { leagueId: string }) => data)
  .handler(async ({ data }) => syncLeague(data.leagueId));

export const optimizeLineupFn = createServerFn({ method: "POST" })
  .validator((data: { leagueId: string; rosterId: number; week?: number }) => data)
  .handler(async ({ data }) => analyzeRoster(data.leagueId, data.rosterId, data.week));

export const matchupAnalyticsFn = createServerFn({ method: "GET" })
  .validator((data: { leagueId: string; week: number }) => data)
  .handler(async ({ data }) => analyzeMatchups(data.leagueId, data.week));

export const waiverBoardFn = createServerFn({ method: "GET" })
  .validator((data: { leagueId: string; rosterId?: number }) => data)
  .handler(async ({ data }) => waiverBoard(data.leagueId, data.rosterId));

export const tradeDeskFn = createServerFn({ method: "GET" })
  .validator((data: { leagueId: string }) => data)
  .handler(async ({ data }) => tradeDesk(data.leagueId));

export const gradeTradeFn = createServerFn({ method: "POST" })
  .validator((data: { leagueId: string; give: string[]; receive: string[] }) => data)
  .handler(async ({ data }) => evaluateTrade(data.leagueId, data.give, data.receive));

export const draftBoardFn = createServerFn({ method: "GET" })
  .validator((data: { leagueId: string; sleeperUserId?: string; rosterId?: number }) => data)
  .handler(async ({ data }) => draftBoard(data.leagueId, data.sleeperUserId, data.rosterId));

export const leagueComplianceFn = createServerFn({ method: "GET" })
  .validator((data: { leagueId: string }) => data)
  .handler(async ({ data }) => leagueCompliance(data.leagueId));

export const refreshPlayersFn = createServerFn({ method: "POST" }).handler(async () => refreshPlayers());

export const copilotStatusFn = createServerFn({ method: "GET" }).handler(async () => ({
  configured: copilotConfigured(),
  model: "grok-4.5",
  provider: "xAI",
}));

export const runCopilotFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      leagueId: string;
      rosterId: number;
      week?: number;
      question?: string;
      give?: string[];
      receive?: string[];
      useGrok?: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    const lineup = await analyzeRoster(data.leagueId, data.rosterId, data.week);
    const compliance = await leagueCompliance(data.leagueId);
    const flags = compliance.compliance.find((row) => row.roster_id === data.rosterId)?.flags ?? [];
    const isTrade = Boolean(data.give?.length || data.receive?.length);
    const trade = isTrade ? await evaluateTrade(data.leagueId, data.give || [], data.receive || []) : undefined;
    const waivers = isTrade ? await waiverBoard(data.leagueId, data.rosterId) : null;
    return runDebate({
      lineup,
      flags,
      question: data.question,
      trade,
      remainingFaab: waivers?.remaining_faab,
      useGrok: data.useGrok,
    });
  });
