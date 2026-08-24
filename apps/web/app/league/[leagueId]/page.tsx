"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RosterGrid } from "@/components/sleeper/RosterGrid";
import { leagueCompliance, syncLeague } from "@/lib/api";
import { readSession } from "@/lib/session";
import type { LeagueDetailResponse, Roster } from "@/lib/types";

export default function LeaguePage() {
  const params = useParams<{ leagueId: string }>();
  const [data, setData] = useState<LeagueDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [locks, setLocks] = useState<Record<number, number>>({});

  useEffect(() => {
    let cancelled = false;
    syncLeague(params.leagueId)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        const session = readSession();
        const mine = payload.rosters.find(
          (roster) => roster.owner_id === session?.user.sleeper_user_id
        );
        setSelectedId(mine?.roster_id ?? payload.rosters[0]?.roster_id ?? null);
        leagueCompliance(params.leagueId)
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
  }, [params.leagueId]);

  const selected: Roster | undefined = useMemo(
    () => data?.rosters.find((roster) => roster.roster_id === selectedId),
    [data, selectedId]
  );

  if (error) {
    return <main className="p-10 text-blood">{error}</main>;
  }
  if (!data) {
    return <main className="p-10 text-muted">Pulling rosters from Sleeper…</main>;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/dashboard" className="display text-sm text-lime">
        ← Leagues
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-5xl text-clay">{data.league.name}</h1>
          <p className="text-muted">
            {data.league.total_rosters} teams · {data.league.status} · {data.league.scoring_summary}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/league/${params.leagueId}/start-sit`}
            className="display rounded-lg bg-lime px-4 py-2 text-ink"
          >
            Start / Sit
          </Link>
          <Link
            href={`/league/${params.leagueId}/matchup`}
            className="display rounded-lg border border-stroke px-4 py-2"
          >
            Matchup board
          </Link>
          <Link
            href={`/league/${params.leagueId}/waivers`}
            className="display rounded-lg border border-stroke px-4 py-2"
          >
            FAAB
          </Link>
          <Link
            href={`/league/${params.leagueId}/trades`}
            className="display rounded-lg border border-stroke px-4 py-2"
          >
            Trades
          </Link>
          <Link
            href={`/league/${params.leagueId}/draft-room`}
            className="display rounded-lg border border-stroke px-4 py-2"
          >
            Draft
          </Link>
        </div>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.rosters.map((roster) => (
          <button
            key={roster.roster_id}
            onClick={() => setSelectedId(roster.roster_id)}
            className={`rounded-xl border px-4 py-3 text-left ${
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
