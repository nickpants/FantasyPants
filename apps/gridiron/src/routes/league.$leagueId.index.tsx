import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { LeagueNav } from "@/components/LeagueNav";
import { RosterGrid } from "@/components/sleeper/RosterGrid";
import { leagueComplianceFn, syncLeagueFn } from "@/lib/gridiron/server-fns";
import { readSession } from "@/lib/session";
import type { LeagueDetailResponse, Player, Roster } from "@/lib/types";

export const Route = createFileRoute("/league/$leagueId/")({ component: LeaguePage });

function LeaguePage() {
  const { leagueId } = Route.useParams();
  const [data, setData] = useState<LeagueDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [locks, setLocks] = useState<Record<number, number>>({});

  useEffect(() => {
    let cancelled = false;
    syncLeagueFn({ data: { leagueId } })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        const session = readSession();
        const mine = payload.rosters.find((roster) => roster.owner_id === session?.user.sleeper_user_id);
        setSelectedId(mine?.roster_id ?? payload.rosters[0]?.roster_id ?? null);
        leagueComplianceFn({ data: { leagueId } })
          .then((report) => {
            const map: Record<number, number> = {};
            report.compliance.forEach((row) => {
              map[row.roster_id] = row.flags.length;
            });
            if (!cancelled) setLocks(map);
          })
          .catch(() => undefined);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Sync failed");
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  const selected: Roster | undefined = useMemo(
    () => data?.rosters.find((roster) => roster.roster_id === selectedId),
    [data, selectedId],
  );

  if (error) return <main className="p-10 text-blood">{error}</main>;
  if (!data) return <main className="p-10 text-muted">Pulling rosters from Sleeper…</main>;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link to="/dashboard" className="display text-sm text-lime">
        ← Leagues
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-5xl text-clay">{data.league.name}</h1>
          <p className="text-muted">
            {data.league.total_rosters} teams · {data.league.status} · {data.league.scoring_summary}
            {data.from_cache && data.synced_at
              ? ` · snapshot ${Math.max(1, Math.round((Date.now() - data.synced_at) / 1000))}s ago`
              : " · live Sleeper"}
          </p>
        </div>
        <LeagueNav leagueId={leagueId} active="/league/$leagueId" />
      </div>

      <DeskCue leagueId={leagueId} rosters={data.rosters} />

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.rosters.map((roster) => (
          <button
            key={roster.roster_id}
            onClick={() => setSelectedId(roster.roster_id)}
            className={`min-h-16 rounded-xl border px-4 py-3 text-left ${
              roster.roster_id === selectedId ? "border-lime bg-card" : "border-stroke bg-bg/60"
            }`}
          >
            <p className="display text-lg text-clay">{roster.team_name ?? `Roster ${roster.roster_id}`}</p>
            <p className="text-sm text-muted">
              {roster.wins}-{roster.losses}-{roster.ties} · FAAB {roster.total_faab - roster.waiver_budget_used}
              {locks[roster.roster_id] ? (
                <span className="ml-2 font-semibold text-blood">{locks[roster.roster_id]} lock</span>
              ) : null}
            </p>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="mt-10 rounded-2xl border border-stroke bg-card p-5">
          <h2 className="display mb-5 text-2xl text-lime">{selected.team_name ?? "Roster"}</h2>
          <RosterGrid roster={selected} rosterPositions={data.league.roster_positions} />
        </div>
      ) : null}
    </main>
  );
}

function taggedOnRoster(roster: Roster) {
  const pool: Player[] = [
    ...(roster.hydrated_starters ?? []),
    ...(roster.hydrated_players ?? []),
    ...(roster.hydrated_reserve ?? []),
  ];
  const ids = new Set<string>();
  for (const player of pool) {
    const status = player.injury_status || "";
    if (
      status === "Questionable" ||
      status === "Doubtful" ||
      status === "Out" ||
      status === "IR" ||
      status === "PUP" ||
      status === "Suspended" ||
      player.practice_participation
    ) {
      ids.add(player.player_id);
    }
  }
  return ids.size;
}

function DeskCue({ leagueId, rosters }: { leagueId: string; rosters: Roster[] }) {
  const session = readSession();
  const mine = rosters.find((roster) => roster.owner_id === session?.user.sleeper_user_id) ?? rosters[0];
  if (!mine) return null;
  const n = taggedOnRoster(mine);
  return (
    <Link
      to="/league/$leagueId/desk"
      params={{ leagueId }}
      className="mt-6 flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-sky bg-card px-5 py-4"
    >
      <div>
        <p className="display text-sm text-sky">Friday desk</p>
        <p className="text-clay">
          {n
            ? `${n} on your report · sit unless FP by 4pm`
            : "Nobody tagged. Confirm the Friday report anyway."}
        </p>
      </div>
      <span className="display shrink-0 text-sm text-lime">Open desk →</span>
    </Link>
  );
}
