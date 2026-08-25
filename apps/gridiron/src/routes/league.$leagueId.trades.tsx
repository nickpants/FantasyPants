import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AgentDebateDialog } from "@/components/chat/AgentDebateDialog";
import { LeagueNav } from "@/components/LeagueNav";
import { gradeTradeFn, tradeDeskFn } from "@/lib/gridiron/server-fns";
import { readSession } from "@/lib/session";
import type { TradeDeskResponse, TradeGradeResponse } from "@/lib/types";

export const Route = createFileRoute("/league/$leagueId/trades")({ component: TradesPage });

function TradesPage() {
  const { leagueId } = Route.useParams();
  const [desk, setDesk] = useState<TradeDeskResponse | null>(null);
  const [myId, setMyId] = useState<number | null>(null);
  const [theirId, setTheirId] = useState<number | null>(null);
  const [give, setGive] = useState<string[]>([]);
  const [receive, setReceive] = useState<string[]>([]);
  const [verdict, setVerdict] = useState<TradeGradeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await tradeDeskFn({ data: { leagueId } });
        if (cancelled) return;
        const session = readSession();
        const mine =
          payload.rosters.find((roster) => roster.owner_id === session?.user.sleeper_user_id) ??
          payload.rosters[0];
        const other = payload.rosters.find((roster) => roster.roster_id !== mine?.roster_id) ?? null;
        setDesk(payload);
        setMyId(mine?.roster_id ?? null);
        setTheirId(other?.roster_id ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load trades");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  const mine = useMemo(() => desk?.rosters.find((roster) => roster.roster_id === myId), [desk, myId]);
  const theirs = useMemo(() => desk?.rosters.find((roster) => roster.roster_id === theirId), [desk, theirId]);

  function toggle(list: string[], setter: (next: string[]) => void, playerId: string) {
    setter(list.includes(playerId) ? list.filter((id) => id !== playerId) : [...list, playerId]);
    setVerdict(null);
  }

  async function onGrade() {
    setPending(true);
    setError(null);
    try {
      setVerdict(await gradeTradeFn({ data: { leagueId, give, receive } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not grade trade");
    } finally {
      setPending(false);
    }
  }

  if (error && !desk) return <main className="p-10 text-blood">{error}</main>;
  if (!desk) return <main className="p-10 text-muted">Pulling trade chips…</main>;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link to="/league/$leagueId" params={{ leagueId }} className="display text-sm text-lime">
        ← League
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-5xl text-clay">Trade desk</h1>
          <p className="text-muted">
            {desk.season} · week {desk.week} · values are league-scored P50
          </p>
        </div>
        <LeagueNav leagueId={leagueId} active="/league/$leagueId/trades" />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <label className="text-sm text-muted">
          You
          <select
            className="ml-2 min-h-11 rounded-lg border border-stroke bg-bg px-2 py-1 text-clay"
            value={myId ?? ""}
            onChange={(event) => {
              setMyId(Number(event.target.value));
              setGive([]);
              setVerdict(null);
            }}
          >
            {desk.rosters.map((roster) => (
              <option key={roster.roster_id} value={roster.roster_id}>
                {roster.team_name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-muted">
          Them
          <select
            className="ml-2 min-h-11 rounded-lg border border-stroke bg-bg px-2 py-1 text-clay"
            value={theirId ?? ""}
            onChange={(event) => {
              setTheirId(Number(event.target.value));
              setReceive([]);
              setVerdict(null);
            }}
          >
            {desk.rosters
              .filter((roster) => roster.roster_id !== myId)
              .map((roster) => (
                <option key={roster.roster_id} value={roster.roster_id}>
                  {roster.team_name}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <PlayerPicker title="You send" players={mine?.players ?? []} selected={give} onToggle={(id) => toggle(give, setGive, id)} />
        <PlayerPicker
          title="You get"
          players={theirs?.players ?? []}
          selected={receive}
          onToggle={(id) => toggle(receive, setReceive, id)}
        />
      </div>

      <button
        className="display mt-6 min-h-12 rounded-lg bg-lime px-5 py-3 text-ink disabled:opacity-50"
        disabled={pending || give.length + receive.length === 0}
        onClick={() => void onGrade()}
      >
        {pending ? "Grading…" : "Grade trade"}
      </button>
      {error ? <p className="mt-3 text-sm text-blood">{error}</p> : null}

      {verdict ? (
        <section className="mt-6 rounded-2xl border border-lime bg-card p-5">
          <p className="display text-3xl text-lime">{verdict.grade}</p>
          <p className="text-muted">
            You send {verdict.give_p50.toFixed(1)} P50 · get {verdict.receive_p50.toFixed(1)} P50 · delta{" "}
            {verdict.delta >= 0 ? "+" : ""}
            {verdict.delta.toFixed(1)}
          </p>
        </section>
      ) : null}

      {verdict && myId != null ? (
        <AgentDebateDialog leagueId={leagueId} rosterId={myId} week={desk.week} give={give} receive={receive} />
      ) : null}
    </main>
  );
}

function PlayerPicker({
  title,
  players,
  selected,
  onToggle,
}: {
  title: string;
  players: { player_id: string; full_name: string; position: string; p50: number }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-stroke bg-card p-4">
      <h2 className="display text-xl text-clay">{title}</h2>
      <ul className="mt-3 max-h-96 space-y-1 overflow-auto">
        {players.map((player) => {
          const on = selected.includes(player.player_id);
          return (
            <li key={player.player_id}>
              <button
                type="button"
                onClick={() => onToggle(player.player_id)}
                className={`flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-left ${
                  on ? "bg-lime text-ink" : "hover:bg-turf"
                }`}
              >
                <span>
                  {player.full_name}{" "}
                  <span className={on ? "text-ink/70" : "text-muted"}>{player.position}</span>
                </span>
                <span className="display tabular-nums">{player.p50.toFixed(1)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
