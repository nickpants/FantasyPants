"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { draftBoard } from "@/lib/api";
import { readSession } from "@/lib/session";
import type { DraftBoardResponse, DraftPlayer } from "@/lib/types";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const;

export default function DraftRoomPage() {
  const params = useParams<{ leagueId: string }>();
  const [board, setBoard] = useState<DraftBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("ALL");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const session = readSession();
        const payload = await draftBoard(
          params.leagueId,
          session?.user.sleeper_user_id,
        );
        if (!cancelled) {
          setBoard(payload);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Draft sync failed");
      }
    }

    void load();
    const live = board?.draft.status === "drafting";
    const id = window.setInterval(() => void load(), live ? 3000 : 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // Re-bind interval when status flips to drafting.
  }, [params.leagueId, board?.draft.status]);

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
      <Link href={`/league/${params.leagueId}`} className="display text-sm text-lime">
        ← League
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-5xl text-clay">Draft room</h1>
          <p className="text-muted">
            {board.draft.season} · {board.draft.type} · {board.draft.status} · pick{" "}
            {board.draft.picks_made}/{board.draft.total_picks} · {board.scoring_summary}
          </p>
        </div>
        {clock ? (
          <div className={`rounded-2xl border px-5 py-3 ${clock.is_you ? "border-lime bg-card" : "border-stroke bg-bg/70"}`}>
            <p className="display text-xs text-muted">On the clock</p>
            <p className="display text-2xl text-lime">
              {clock.is_you ? "You" : clock.team_name || clock.display_name || `Slot ${clock.draft_slot}`}
            </p>
            <p className="text-xs text-muted">
              Round {clock.round} · pick {clock.pick_no}
              {board.picks_until_you != null && !clock.is_you
                ? ` · you pick in ${board.picks_until_you}`
                : null}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">{live ? "Waiting on draft order…" : "Draft is not live."}</p>
        )}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-lime bg-card p-5">
          <h2 className="display text-xl text-lime">Take these</h2>
          <p className="mb-3 text-xs text-muted">
            Ranked by value over replacement plus roster need. {board.source.replaceAll("_", " ")}.
          </p>
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
                    <span className="display text-muted">{pick.round}.{pick.pick_no}</span>{" "}
                    <span className="text-clay">{pick.full_name}</span>{" "}
                    <span className="text-muted">{pick.position}</span>
                  </span>
                  <span className="text-lime">
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
            <p className="mt-3 text-sm text-muted">No picks yet. You&apos;ll land here after you&apos;re on the clock.</p>
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
              className={`display rounded-lg px-3 py-1 text-sm ${
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
                  <td className="px-3 py-2 text-lime">{player.p50.toFixed(1)}</td>
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
    <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${highlight ? "bg-lime text-ink" : "border border-stroke"}`}>
      <div>
        <p className="font-semibold">
          {rank}. {player.full_name}{" "}
          <span className={highlight ? "text-ink/70" : "text-muted"}>{player.position}</span>
        </p>
        <p className={`text-xs ${highlight ? "text-ink/70" : "text-muted"}`}>{player.reason}</p>
      </div>
      <div className="text-right">
        <p className="display text-lg">{player.p50.toFixed(1)}</p>
        <p className={`text-[10px] ${highlight ? "text-ink/70" : "text-muted"}`}>
          VOR {player.vor?.toFixed(1)}
        </p>
      </div>
    </div>
  );
}
