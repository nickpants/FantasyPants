import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { LeagueNav } from "@/components/LeagueNav";
import { draftBoardFn } from "@/lib/gridiron/server-fns";
import { readSession } from "@/lib/session";
import type { DraftBoardResponse, DraftPlayer } from "@/lib/types";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const;

export const Route = createFileRoute("/league/$leagueId/draft-room")({ component: DraftRoomPage });

function DraftRoomPage() {
  const { leagueId } = Route.useParams();
  const [board, setBoard] = useState<DraftBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("ALL");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const session = readSession();
        const payload = await draftBoardFn({
          data: { leagueId, sleeperUserId: session?.user.sleeper_user_id },
        });
        if (!cancelled) {
          setBoard(payload);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Draft sync failed");
      }
    }

    void load();
    const id = window.setInterval(() => void load(), board?.draft.status === "drafting" ? 3000 : 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [leagueId, board?.draft.status]);

  const available = useMemo(() => {
    if (!board) return [];
    if (position === "ALL") return board.available;
    return board.available.filter((player) => player.position === position);
  }, [board, position]);

  if (error && !board) return <main className="p-10 text-blood">{error}</main>;
  if (!board) return <main className="p-10 text-muted">Loading the draft board…</main>;

  const clock = board.on_the_clock;
  const live = board.draft.status === "drafting";

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link to="/league/$leagueId" params={{ leagueId }} className="display text-sm text-lime">
        ← League
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-5xl text-clay">Draft room</h1>
          <p className="text-muted">
            {board.draft.season} · {board.draft.type} · {board.draft.status} · pick {board.draft.picks_made}/
            {board.draft.total_picks} · {board.scoring_summary}
          </p>
        </div>
        <LeagueNav leagueId={leagueId} active="/league/$leagueId/draft-room" />
      </div>

      {clock ? (
        <div
          className={`mt-6 max-w-sm rounded-2xl border px-5 py-3 ${clock.is_you ? "border-lime bg-card" : "border-stroke bg-bg/70"}`}
        >
          <p className="display text-xs text-muted">On the clock</p>
          <p className="display text-2xl text-lime">
            {clock.is_you ? "You" : clock.team_name || clock.display_name || `Slot ${clock.draft_slot}`}
          </p>
          <p className="text-xs text-muted">
            Round {clock.round} · pick {clock.pick_no}
            {board.picks_until_you != null && !clock.is_you ? ` · you pick in ${board.picks_until_you}` : null}
          </p>
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted">{live ? "Waiting on draft order…" : "Draft is not live."}</p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-lime bg-card p-5">
          <h2 className="display text-xl text-lime">Take these</h2>
          <p className="mb-3 text-xs text-muted">
            Ranked by roster holes first, then value over replacement. {board.source.replaceAll("_", " ")}.
          </p>
          {board.need_board ? <NeedStrip board={board.need_board} /> : null}
          <ol className="grid gap-2">
            {board.recommendations.map((player, index) => (
              <li key={player.player_id}>
                <PlayerRow player={player} rank={index + 1} highlight={index === 0} />
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-2xl border border-stroke bg-bg/70 p-5">
          <h2 className="display text-xl text-clay">Your picks</h2>
          {board.your_roster.length ? (
            <ul className="mt-3 grid gap-2">
              {board.your_roster.map((pick) => (
                <li key={pick.pick_no} className="flex items-center justify-between text-sm">
                  <span>
                    <span className="display text-muted">
                      {pick.round}.{pick.pick_no}
                    </span>{" "}
                    <span className="text-clay">{pick.full_name}</span>{" "}
                    <span className="text-muted">{pick.position}</span>
                  </span>
                  <span className="text-lime tabular-nums">
                    {pick.p50 != null ? pick.p50.toFixed(1) : "—"}
                    {pick.grade != null ? (
                      <span className={`ml-2 text-xs ${pick.grade >= -1 ? "text-lime" : "text-blood"}`}>
                        {pick.grade >= 0 ? "BPA" : `${pick.grade.toFixed(1)} vs BPA`}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">No picks yet. You'll land here after you're on the clock.</p>
          )}
        </section>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap gap-2">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              type="button"
              onClick={() => setPosition(pos)}
              className={`display min-h-11 rounded-lg px-3 py-1 text-sm ${
                position === pos ? "bg-lime text-ink" : "border border-stroke"
              }`}
            >
              {pos}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-2xl border border-stroke">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-turf text-muted">
              <tr>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2">P50</th>
                <th className="px-3 py-2">ADP</th>
              </tr>
            </thead>
            <tbody>
              {available.map((player) => (
                <tr key={player.player_id} className="border-t border-stroke">
                  <td className="px-3 py-2">
                    <span className="font-semibold text-clay">{player.full_name}</span>
                    <span className="ml-2 text-xs text-muted">
                      {player.position} · {player.nfl_team}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-lime tabular-nums">{player.p50.toFixed(1)}</td>
                  <td className="px-3 py-2 text-muted">{player.adp != null ? Number(player.adp).toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {board.recent_picks.length ? (
        <section className="mt-8">
          <h2 className="display text-xl text-muted">Recent picks</h2>
          <ol className="mt-3 grid gap-1 text-sm">
            {board.recent_picks.map((pick) => (
              <li key={pick.pick_no} className="text-clay">
                <span className="display text-muted">{pick.pick_no}.</span> {pick.full_name}{" "}
                <span className="text-muted">{pick.position}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}

function NeedStrip({
  board,
}: {
  board: NonNullable<DraftBoardResponse["need_board"]>;
}) {
  if (!board.holes.length) {
    return (
      <p className="mb-3 text-xs text-muted">
        Starters filled · {board.picks_left} pick{board.picks_left === 1 ? "" : "s"} left
      </p>
    );
  }
  return (
    <div className="mb-4 flex flex-wrap gap-1">
      {board.holes.map((hole) => (
        <span
          key={hole.slot}
          className={`display rounded px-2 py-1 text-xs ${
            hole.slot === "K" || hole.slot === "DEF"
              ? "border border-stroke text-muted"
              : hole.kind === "starter"
                ? "bg-lime text-ink"
                : "border border-stroke text-clay"
          }`}
        >
          {hole.slot}
          {hole.remaining > 1 ? ` ×${hole.remaining}` : ""}
        </span>
      ))}
      <span className="display rounded border border-stroke px-2 py-1 text-xs text-muted">
        {board.picks_left} left
      </span>
    </div>
  );
}

function needLabel(need?: string) {
  if (need === "starter") return "STARTER";
  if (need === "flex") return "FLEX";
  if (need === "superflex") return "SF";
  if (need === "depth") return "DEPTH";
  return "BPA";
}

function PlayerRow({
  player,
  rank,
  highlight,
}: {
  player: DraftPlayer;
  rank: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg px-3 py-2 ${highlight ? "bg-lime text-ink" : "border border-stroke"}`}
    >
      <div className="min-w-0">
        <p className="font-semibold">
          {rank}. {player.full_name}{" "}
          <span className={highlight ? "text-ink/70" : "text-muted"}>{player.position}</span>
        </p>
        <p className={`text-xs ${highlight ? "text-ink/70" : "text-muted"}`}>{player.reason}</p>
      </div>
      <div className="ml-3 shrink-0 text-right tabular-nums">
        <p className="display text-lg">{player.p50.toFixed(1)}</p>
        <p className={`text-xs ${highlight ? "text-ink/70" : "text-muted"}`}>
          {needLabel(player.need)}
          {player.vor != null ? ` · VOR ${player.vor.toFixed(1)}` : ""}
        </p>
      </div>
    </div>
  );
}
