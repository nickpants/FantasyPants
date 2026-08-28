import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentDebateDialog } from "@/components/chat/AgentDebateDialog";
import { LeagueNav } from "@/components/LeagueNav";
import { PlayerCard } from "@/components/sleeper/PlayerCard";
import { SlateStrip } from "@/components/sleeper/SlateStrip";
import { WinProbGauge } from "@/components/sleeper/WinProbGauge";
import { formatLockIn } from "@/lib/gridiron/engine";
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
            {" · "}
            <Link to="/help" hash="rankings" className="text-lime">
              How rankings work
            </Link>
          </p>
        </div>
        <LeagueNav leagueId={leagueId} active="/league/$leagueId/start-sit" />
      </div>

      {data.opponent ? (
        <div className="mt-6 max-w-sm">
          <WinProbGauge label="Win probability (current lineup)" value={data.opponent.win_probability} />
        </div>
      ) : null}

      <LockBanner locks={data.locks} />

      <DeskAlert leagueId={leagueId} alert={data.desk_alert} sunday={data.sunday_alert} />

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

function LockBanner({ locks }: { locks?: LineupResponse["locks"] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!locks?.next_kickoff_ms) return;
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [locks?.next_kickoff_ms]);
  if (!locks) return null;
  if (!locks.next_kickoff_ms && !locks.locked_count && !locks.bye_count) return null;
  const label =
    locks.next_kickoff_ms != null
      ? now >= locks.next_kickoff_ms
        ? "LOCKED"
        : formatLockIn(locks.next_kickoff_ms, now)
      : locks.next_label;
  return (
    <section className="mt-6 flex items-start gap-3 rounded-2xl border border-stroke bg-card px-5 py-4">
      <Clock className="mt-0.5 size-5 shrink-0 text-lime" aria-hidden />
      <div>
        <p className="display text-sm text-lime">Kickoff lock</p>
        <p className="display text-2xl text-clay">{label ?? "No kickoff posted"}</p>
        <p className="mt-1 text-sm text-muted">
          {locks.locked_count} locked · {locks.bye_count} on bye. Locked starters stay put. Locked
          bench cannot enter. Bye weeks sit automatically.
        </p>
      </div>
    </section>
  );
}

function DeskAlert({
  leagueId,
  alert,
  sunday,
}: {
  leagueId: string;
  alert?: LineupResponse["desk_alert"];
  sunday?: LineupResponse["sunday_alert"];
}) {
  const friday = alert ? alert.sit + alert.watch + alert.out : 0;
  const sun = sunday ? sunday.inactive + sunday.sit + sunday.watch : 0;
  if (!friday && !sun) return null;
  const bits = [
    alert?.out ? `${alert.out} out` : null,
    alert?.sit ? `${alert.sit} sit` : null,
    alert?.watch ? `${alert.watch} watch` : null,
    sunday?.inactive ? `${sunday.inactive} inactive` : null,
  ].filter(Boolean);
  return (
    <Link
      to="/league/$leagueId/desk"
      params={{ leagueId }}
      className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-sky bg-card px-5 py-4"
    >
      <div>
        <p className="display text-sm text-sky">{sun ? "Desk · Friday + Sunday" : "Friday desk"}</p>
        <p className="text-clay">
          {friday + sun} starter{friday + sun === 1 ? "" : "s"} still in question
          {bits.length ? ` · ${bits.join(" · ")}` : ""}
        </p>
      </div>
      <span className="display shrink-0 text-sm text-lime">Open desk →</span>
    </Link>
  );
}
