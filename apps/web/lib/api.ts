import type {
  DraftBoardResponse,
  LeagueDetailResponse,
  LineupResponse,
  MatchupAnalyticsResponse,
  MatchupResponse,
  SyncUserResponse,
  TradeDeskResponse,
  TradeGradeResponse,
  WaiverBoardResponse,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export function syncSleeperUser(username: string) {
  return request<SyncUserResponse>("/api/v1/sync/sleeper", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

export function syncLeague(leagueId: string) {
  return request<LeagueDetailResponse>(`/api/v1/leagues/${leagueId}`);
}

export function syncMatchups(leagueId: string, week: number) {
  return request<MatchupResponse>(`/api/v1/leagues/${leagueId}/matchups/${week}`);
}

export function refreshPlayers() {
  return request<{ cached: boolean; count?: number }>("/api/v1/sync/players", {
    method: "POST",
    body: JSON.stringify({ force: false }),
  });
}

export function optimizeLineup(leagueId: string, rosterId: number, week?: number) {
  return request<LineupResponse>("/api/v1/optimizer/lineup", {
    method: "POST",
    body: JSON.stringify({ league_id: leagueId, roster_id: rosterId, week }),
  });
}

export function matchupAnalytics(leagueId: string, week: number) {
  return request<MatchupAnalyticsResponse>(`/api/v1/leagues/${leagueId}/analytics/${week}`);
}

export function waiverBoard(leagueId: string, rosterId?: number) {
  const query = rosterId != null ? `?roster_id=${rosterId}` : "";
  return request<WaiverBoardResponse>(`/api/v1/leagues/${leagueId}/waivers${query}`);
}

export function tradeDesk(leagueId: string) {
  return request<TradeDeskResponse>(`/api/v1/leagues/${leagueId}/trades`);
}

export function gradeTrade(leagueId: string, give: string[], receive: string[]) {
  return request<TradeGradeResponse>("/api/v1/optimizer/trade", {
    method: "POST",
    body: JSON.stringify({ league_id: leagueId, give, receive }),
  });
}

export function draftBoard(leagueId: string, sleeperUserId?: string, rosterId?: number) {
  const params = new URLSearchParams();
  if (sleeperUserId) params.set("sleeper_user_id", sleeperUserId);
  if (rosterId != null) params.set("roster_id", String(rosterId));
  const query = params.toString();
  return request<DraftBoardResponse>(`/api/v1/leagues/${leagueId}/draft${query ? `?${query}` : ""}`);
}

export function leagueCompliance(leagueId: string) {
  return request<{ compliance: { roster_id: number; flags: { detail: string }[] }[] }>(
    `/api/v1/leagues/${leagueId}/compliance`
  );
}

export type CopilotEvent = {
  type: string;
  agent?: string;
  text?: string;
  source?: string;
  bias?: string;
  configured?: boolean;
  model?: string;
  detail?: string;
};

export async function configureCopilot(apiKey: string) {
  return request<{ configured: boolean; model: string; provider: string }>("/api/v1/copilot/configure", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey }),
  });
}

export async function streamCopilot(
  body: {
    league_id: string;
    roster_id: number;
    week?: number;
    question?: string;
    give?: string[];
    receive?: string[];
  },
  onEvent: (event: CopilotEvent) => void
) {
  const response = await fetch("/api/v1/copilot/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Copilot stream failed (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      try {
        onEvent(JSON.parse(dataLine.slice(6)) as CopilotEvent);
      } catch {
        /* ignore malformed packets */
      }
    }
  }
}

export function avatarUrl(avatar?: string | null, thumb = true) {
  if (!avatar) return null;
  const path = thumb ? "avatars/thumbs" : "avatars";
  return `https://sleepercdn.com/${path}/${avatar}`;
}
