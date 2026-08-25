import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AgentDebateDialog } from "@/components/chat/AgentDebateDialog";
import { LeagueNav } from "@/components/LeagueNav";
import { PlayerCard } from "@/components/sleeper/PlayerCard";
import { SlateStrip } from "@/components/sleeper/SlateStrip";
import { WinProbGauge } from "@/components/sleeper/WinProbGauge";
import { optimizeLineupFn, syncLeagueFn } from "@/lib/gridiron/server-fns";
import { readSession } from "@/lib/session";
import type { LineupResponse, LineupSlot } from "@/lib/types";

export const Route = createFileRoute("/league/$leagueId/start-sit")({ component: StartSitPage });

function StartSitPage() {
  const { leagueId } = Route.useParams();
  const [data, setData] = useState<LineupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const league = await syncLeagueFn({ data: { leagueId } });
        const session = readSession();
        const mine =
          league.rosters.find((roster) => roster.owner_id === session?.user.sleeper_user_id) ??
          league.rosters[0];
        if (!mine) throw new Error("No roster in this league");
        const lineup = await optimizeLineupFn({ data: { leagueId, rosterId: mine.roster_id } });
        if (!cancelled) setData(lineup);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Optimizer failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  if (error) return <main className="p-10 text-blood">{error}</main>;
  if (!data) return <main className="p-10 text-muted">Solving the lineup and rolling 2,000 games…</main>;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link to="/league/$leagueId" params={{ leagueId }} className="display text-sm text-lime">
        ← {data.team_name ?? "Roster"}
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-5xl text-clay">Start / Sit</h1>
          <p className="text-muted">
            {data.season} · week {data.week} · {data.scoring_summary} · {data.source.replaceAll("_", " ")}
            {data.solver ? ` · ${data.solver}` : ""}
          </p>
        </div>
        <LeagueNav leagueId={leagueId} active="/league/$leagueId/start-sit" />
      </div>

      {data.opponent ? (
        <div className="mt-6 max-w-sm">
          <WinProbGauge label="Win probability (current lineup)" value={data.opponent.win_probability} />
        </div>
      ) : null}

      <SlateStrip slate={data.slate} />

      {data.swaps.length ? (
        <section className="mt-8 rounded-2xl border border-lime bg-card p-5">
          <h2 className="display text-xl text-lime">Moves</h2>
          <ul className="mt-3 grid gap-2">
            {data.swaps.map((swap) => (
              <li key={`${swap.slot}-${swap.sit?.player_id}-${swap.start?.player_id}`} className="text-clay">
                Sit <span className="font-semibold">{swap.sit?.full_name}</span>, start{" "}
                <span className="font-semibold text-lime">{swap.start?.full_name}</span> at {swap.slot}
                <span className="ml-2 text-sm text-muted">
                  {swap.delta_p50 >= 0 ? "+" : ""}
                  {swap.delta_p50.toFixed(1)} P50
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mt-8 text-muted">Current starters already match the optimal P50 lineup.</p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <LineupColumn title="Current" side={data.current} />
        <LineupColumn title="Optimal" side={data.optimal} accent />
      </div>

      {data.opponent ? (
        <p className="mt-6 text-sm text-muted">
          vs {data.opponent.team_name ?? "opponent"} · their P50 {data.opponent.p50.toFixed(1)}. Optimal lineup lifts
          win probability to {(data.opponent.optimal_win_probability * 100).toFixed(0)}%.
        </p>
      ) : null}

      <AgentDebateDialog leagueId={data.league_id} rosterId={data.roster_id} week={data.week} />
    </main>
  );
}

function LineupColumn({
  title,
  side,
  accent = false,
}: {
  title: string;
  side: LineupResponse["current"];
  accent?: boolean;
}) {
  return (
    <section className={`rounded-2xl border p-5 ${accent ? "border-lime bg-card" : "border-stroke bg-bg/70"}`}>
      <div className="mb-4 flex items-end justify-between">
        <h2 className="display text-2xl text-clay">{title}</h2>
        <p className="text-sm text-muted tabular-nums">
          P10 {side.p10.toFixed(1)} · <span className="text-lime">P50 {side.p50.toFixed(1)}</span> · P90{" "}
          {side.p90.toFixed(1)}
        </p>
      </div>
      <div className="grid gap-2">
        {side.slots.map((slot: LineupSlot, index) => (
          <PlayerCard
            key={`${slot.slot}-${index}`}
            slot={slot.slot}
            player={slot.player}
            p10={slot.player?.p10}
            p50={slot.player?.p50 ?? slot.player?.mu}
            p90={slot.player?.p90}
          />
        ))}
      </div>
    </section>
  );
}
