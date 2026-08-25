import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LeagueNav } from "@/components/LeagueNav";
import { syncLeagueFn, waiverBoardFn } from "@/lib/gridiron/server-fns";
import { readSession } from "@/lib/session";
import type { WaiverBoardResponse } from "@/lib/types";

export const Route = createFileRoute("/league/$leagueId/waivers")({ component: WaiversPage });

function WaiversPage() {
  const { leagueId } = Route.useParams();
  const [board, setBoard] = useState<WaiverBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const league = await syncLeagueFn({ data: { leagueId } });
        const session = readSession();
        const mine = league.rosters.find((roster) => roster.owner_id === session?.user.sleeper_user_id);
        const payload = await waiverBoardFn({ data: { leagueId, rosterId: mine?.roster_id } });
        if (!cancelled) setBoard(payload);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load waivers");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  if (error) return <main className="p-10 text-blood">{error}</main>;
  if (!board) return <main className="p-10 text-muted">Reading the wire and FAAB ledger…</main>;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link to="/league/$leagueId" params={{ leagueId }} className="display text-sm text-lime">
        ← League
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-5xl text-clay">FAAB / Waivers</h1>
          <p className="text-muted">
            {board.season} · week {board.week} · {board.is_faab ? `$${board.remaining_faab} remaining` : "rolling waivers"}
          </p>
        </div>
        <LeagueNav leagueId={leagueId} active="/league/$leagueId/waivers" />
      </div>

      {board.compliance.length ? (
        <section className="mt-6 rounded-2xl border border-blood bg-card p-5">
          <h2 className="display text-xl text-blood">Roster locks</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {board.compliance.flatMap((row) =>
              row.flags.map((flag) => (
                <li key={`${row.roster_id}-${flag.player_id}`}>
                  <span className="font-semibold">{row.team_name}</span>: {flag.detail}
                </li>
              )),
            )}
          </ul>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="display text-xl text-lime">Remaining FAAB</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {board.faab_table.map((row) => (
            <div key={row.roster_id} className="rounded-xl border border-stroke bg-card px-3 py-2">
              <p className="truncate text-sm text-clay">{row.team_name ?? `Roster ${row.roster_id}`}</p>
              <p className="display text-2xl text-lime tabular-nums">${row.remaining}</p>
              <p className="text-xs text-muted">used ${row.used}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="display text-xl text-lime">Recommended bids</h2>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-stroke">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-turf text-muted">
              <tr>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2">P50</th>
                <th className="px-3 py-2">RLD</th>
                <th className="px-3 py-2">Cons.</th>
                <th className="px-3 py-2">Fair</th>
                <th className="px-3 py-2">Agg.</th>
              </tr>
            </thead>
            <tbody>
              {board.available.slice(0, 25).map((player) => (
                <tr key={player.player_id} className="border-t border-stroke">
                  <td className="px-3 py-2">
                    <span className="font-semibold text-clay">{player.full_name}</span>
                    <span className="ml-2 text-xs text-muted">
                      {player.position} · {player.nfl_team}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-lime tabular-nums">{player.p50.toFixed(1)}</td>
                  <td className="px-3 py-2 tabular-nums">{player.rld.toFixed(1)}</td>
                  <td className="px-3 py-2">{player.bids ? `$${player.bids.conservative}` : "—"}</td>
                  <td className="px-3 py-2 font-semibold">{player.bids ? `$${player.bids.fair}` : "—"}</td>
                  <td className="px-3 py-2">{player.bids ? `$${player.bids.aggressive}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
