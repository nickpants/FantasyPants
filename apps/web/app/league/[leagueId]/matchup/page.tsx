"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { WinProbGauge } from "@/components/sleeper/WinProbGauge";
import { matchupAnalytics, syncLeague } from "@/lib/api";
import { readSession } from "@/lib/session";
import type { AnalyticsMatchup, AnalyticsSide, LiveStarter, MatchupAnalyticsResponse } from "@/lib/types";

export default function MatchupPage() {
  const params = useParams<{ leagueId: string }>();
  const [board, setBoard] = useState<MatchupAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const detail = await syncLeague(params.leagueId);
        const session = readSession();
        const sameSeason = detail.league.season === (session?.season ?? detail.league.season);
        const week = sameSeason
          ? session?.nfl_state.display_week ?? session?.nfl_state.week ?? 1
          : 1;
        const analytics = await matchupAnalytics(params.leagueId, week);
        if (!cancelled) {
          setBoard(analytics);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load matchups");
      }
    }

    void load();
    const live = board?.mode === "live";
    const id = window.setInterval(() => void load(), live ? 20000 : 60000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [params.leagueId, board?.mode]);

  const mine = useMemo(() => {
    const session = readSession();
    return board?.matchups.find(
      (pair) =>
        pair.home.owner_id === session?.user.sleeper_user_id ||
        pair.away?.owner_id === session?.user.sleeper_user_id
    );
  }, [board]);

  const myProb = useMemo(() => {
    const session = readSession();
    if (!mine) return null;
    if (mine.home.owner_id === session?.user.sleeper_user_id) return mine.home.win_probability;
    return mine.away?.win_probability ?? null;
  }, [mine]);

  if (error && !board) return <main className="p-10 text-blood">{error}</main>;
  if (!board) return <main className="p-10 text-muted">Simulating this week&apos;s board…</main>;

  const modeLabel =
    board.mode === "live" ? "Live" : board.mode === "final" ? "Final" : "Pregame";

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href={`/league/${params.leagueId}`} className="display text-sm text-lime">
        ← League
      </Link>
      <h1 className="display mt-4 text-5xl text-clay">Matchup board</h1>
      <p className="text-muted">
        {board.season} · week {board.week} · {modeLabel} · {board.scoring_summary} ·{" "}
        {board.source.replaceAll("_", " ")}
      </p>

      {mine ? (
        <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_280px]">
          <MatchupCard pair={mine} highlight />
          <WinProbGauge
            label={board.mode === "pregame" ? "Win probability" : "Live win probability"}
            value={myProb}
            note={
              board.mode === "live"
                ? "Actuals locked; remaining projection still rolling."
                : board.mode === "final"
                  ? "All NFL games in this sample are final."
                  : undefined
            }
          />
        </div>
      ) : null}

      {mine && mySide(mine) ? <StarterStrip side={mySide(mine)!} /> : null}

      <div className="mt-8 grid gap-4">
        {board.matchups
          .filter((pair) => pair.matchup_id !== mine?.matchup_id)
          .map((pair) => (
            <MatchupCard key={String(pair.matchup_id)} pair={pair} />
          ))}
      </div>
    </main>
  );
}

function mySide(pair: AnalyticsMatchup): AnalyticsSide | null {
  const session = readSession();
  if (pair.away && pair.away.owner_id === session?.user.sleeper_user_id) return pair.away;
  return pair.home;
}

function MatchupCard({ pair, highlight = false }: { pair: AnalyticsMatchup; highlight?: boolean }) {
  return (
    <article className={`rounded-2xl border p-5 ${highlight ? "border-lime bg-card" : "border-stroke bg-bg/70"}`}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <TeamSide side={pair.home} align="left" />
        <span className="display text-muted">vs</span>
        <TeamSide side={pair.away} align="right" />
      </div>
    </article>
  );
}

function TeamSide({
  side,
  align,
}: {
  side?: AnalyticsSide | null;
  align: "left" | "right";
}) {
  if (!side) {
    return <p className={`text-muted ${align === "right" ? "text-right" : ""}`}>Bye</p>;
  }
  const actual = side.points;
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <p className="display text-xl text-clay">{side.team_name ?? `Roster ${side.roster_id}`}</p>
      <p className="text-3xl font-semibold text-lime">
        {actual != null ? Number(actual).toFixed(1) : side.projected_median.toFixed(1)}
      </p>
      <p className="text-xs text-muted">
        {actual != null ? `proj ${side.projected_median.toFixed(1)} · ` : ""}
        P10 {side.projected_floor.toFixed(1)} · P90 {side.projected_ceiling.toFixed(1)} ·{" "}
        {(side.win_probability * 100).toFixed(0)}% WP
        {side.pregame_win_probability != null
          ? ` (opened ${(side.pregame_win_probability * 100).toFixed(0)}%)`
          : ""}
      </p>
    </div>
  );
}

function StarterStrip({ side }: { side: AnalyticsSide }) {
  const starters = side.live_starters;
  if (!starters?.length) return null;
  return (
    <section className="mt-4 rounded-2xl border border-stroke bg-card p-4">
      <h2 className="display mb-3 text-sm text-lime">Your starters</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {starters.map((starter) => (
          <StarterChip key={starter.player_id} starter={starter} />
        ))}
      </div>
    </section>
  );
}

function StarterChip({ starter }: { starter: LiveStarter }) {
  const label =
    starter.toast ? "Toast" : starter.phase === "live" ? "In window" : starter.phase === "final" ? "Final" : "Yet to play";
  const tone = starter.toast
    ? "border-blood text-blood"
    : starter.phase === "live"
      ? "border-lime text-lime"
      : starter.phase === "final"
        ? "border-stroke text-muted"
        : "border-stroke text-sky";
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone}`}>
      <p className="truncate text-sm text-clay">
        {starter.full_name}{" "}
        <span className="text-xs text-muted">{starter.position}</span>
      </p>
      <p className="display text-lg text-lime">
        {starter.actual.toFixed(1)}
        {starter.phase !== "final" ? (
          <span className="ml-2 text-xs text-muted">+{starter.remaining.toFixed(1)} left</span>
        ) : null}
      </p>
      <p className="text-[10px] uppercase tracking-wide">{label}</p>
    </div>
  );
}
