import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { LeagueNav } from "@/components/LeagueNav";
import { formatInactiveWindow, formatReportWindow } from "@/lib/gridiron/engine";
import { injuryDeskFn, syncLeagueFn } from "@/lib/gridiron/server-fns";
import { readSession } from "@/lib/session";
import type { DeskCallKind, InjuryDeskResponse, InjuryDeskRow, PracticeTag, SundayDeskRow } from "@/lib/types";

export const Route = createFileRoute("/league/$leagueId/desk")({ component: InjuryDeskPage });

function InjuryDeskPage() {
  const { leagueId } = Route.useParams();
  const [data, setData] = useState<InjuryDeskResponse | null>(null);
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
        const desk = await injuryDeskFn({ data: { leagueId, rosterId: mine.roster_id } });
        if (!cancelled) setData(desk);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Desk failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  if (error) return <main className="p-10 text-blood">{error}</main>;
  if (!data) return <main className="p-10 text-muted">Pulling Friday’s report…</main>;

  const empty = !data.calls.length && !data.cleared.length && !data.out.length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link to="/league/$leagueId" params={{ leagueId }} className="display text-sm text-lime">
        ← {data.team_name ?? "Roster"}
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="display text-sm text-lime">Friday 4pm · Sunday 90 min</p>
          <h1 className="display text-5xl text-clay">Who sits.</h1>
          <p className="mt-2 text-muted">
            {data.season} · week {data.week} · {data.scoring_summary}
            {" · "}
            <Link to="/help" hash="injury" className="text-lime">
              How the call is made
            </Link>
          </p>
        </div>
        <LeagueNav leagueId={leagueId} active="/league/$leagueId/desk" />
      </div>

      <WindowBanner data={data} />
      <SundayBanner data={data} />

      {empty ? (
        <section className="mt-8 rounded-2xl border border-lime bg-card p-6">
          <h2 className="display text-2xl text-lime">Clear</h2>
          <p className="mt-2 max-w-xl text-pretty text-muted">
            Nobody on this roster is on the injury report. That is the Friday you want.
          </p>
          <SundayBlock rows={data.sunday.rows} />
          <LineupCta leagueId={leagueId} label="Set the lineup" />
        </section>
      ) : (
        <div className="mt-8 grid gap-8">
          {data.calls.length ? (
            <DeskSection
              title="Call now"
              kicker={
                data.counts.starters_in_question
                  ? `${data.counts.starters_in_question} starter${data.counts.starters_in_question === 1 ? "" : "s"} in question`
                  : "Bench tags — do not promote"
              }
              rows={data.calls}
              tone="alert"
            />
          ) : null}
          {data.out.length ? (
            <DeskSection title="Out" kicker="Cannot start" rows={data.out} tone="out" />
          ) : null}
          {data.cleared.length ? (
            <DeskSection title="Cleared" kicker="Friday FP — treat as active" rows={data.cleared} tone="ok" />
          ) : null}
          <SundayBlock rows={data.sunday.rows} />
          <LineupCta leagueId={leagueId} label="Calls made. Set the lineup" />
        </div>
      )}
    </main>
  );
}

function LineupCta({ leagueId, label }: { leagueId: string; label: string }) {
  return (
    <Link
      to="/league/$leagueId/start-sit"
      params={{ leagueId }}
      className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl bg-lime px-4 py-3 text-ink"
    >
      <span className="display text-sm">{label}</span>
      <ArrowRight size={16} strokeWidth={2.5} />
    </Link>
  );
}

function tallyLine(data: InjuryDeskResponse) {
  const t = data.practice_tally;
  const bits = [
    t.fp ? `${t.fp} FP` : null,
    t.lp ? `${t.lp} LP` : null,
    t.dnp ? `${t.dnp} DNP` : null,
    t.none ? `${t.none} no tag` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : "No practice tags posted";
}

function WindowBanner({ data }: { data: InjuryDeskResponse }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!data.deadline_ms || now >= data.deadline_ms) return;
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [data.deadline_ms, now]);

  const open = data.deadline_ms != null && now < data.deadline_ms;
  const label = data.deadline_ms != null ? formatReportWindow(data.deadline_ms, now) : data.deadline_label;
  const q = data.counts.sit + data.counts.watch + data.counts.out;

  return (
    <section
      className={`mt-6 flex flex-wrap items-center gap-4 rounded-2xl border px-5 py-4 ${
        open ? "border-sky bg-card" : "border-stroke bg-bg/70"
      }`}
    >
      <Clock size={22} className={open ? "text-sky" : "text-muted"} strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <p className="display text-sm text-lime">{open ? "FP window" : "FP window closed"}</p>
        <p className="display text-2xl text-clay">{label ?? "Friday 4:00 PM ET"}</p>
        <p className="text-sm text-muted">
          Sit unless they post FP by 4pm ET.
          {q ? ` ${q} tagged.` : ""} {tallyLine(data)}.
        </p>
      </div>
    </section>
  );
}

function DeskSection({
  title,
  kicker,
  rows,
  tone,
}: {
  title: string;
  kicker: string;
  rows: InjuryDeskRow[];
  tone: "alert" | "out" | "ok";
}) {
  const border = tone === "ok" ? "border-lime" : tone === "out" ? "border-blood" : "border-sky";
  return (
    <section className={`rounded-2xl border bg-card p-5 ${border}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2 className="display text-2xl text-clay">{title}</h2>
        <p className="text-sm text-muted">{kicker}</p>
      </div>
      <div className="grid gap-3">
        {rows.map((row) => (
          <DeskCard key={row.player.player_id} row={row} />
        ))}
      </div>
    </section>
  );
}

const POS: Record<string, string> = {
  QB: "pos-qb",
  RB: "pos-rb",
  WR: "pos-wr",
  TE: "pos-te",
  K: "pos-k",
  DEF: "pos-def",
};

function callStamp(call: DeskCallKind) {
  if (call === "START") return "bg-lime text-ink";
  if (call === "WATCH") return "bg-sky text-ink";
  return "bg-blood text-ink";
}

function practiceTone(tag?: PracticeTag | null) {
  if (tag === "DNP") return "border-blood text-blood";
  if (tag === "LP") return "border-sky text-sky";
  if (tag === "FP") return "border-lime text-lime";
  return "border-stroke text-muted";
}

function DeskCard({ row }: { row: InjuryDeskRow }) {
  const player = row.player;
  const vs = player.bye ? "BYE" : player.opponent ? `vs ${player.opponent}` : "";
  return (
    <article className="rounded-xl border border-stroke bg-bg/70 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={`display min-w-11 rounded px-1.5 py-1 text-center text-xs ${POS[player.position] ?? "pos-flex"}`}
        >
          {row.slot}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-clay">{player.full_name}</p>
            {row.starting ? null : (
              <span className="display rounded border border-stroke px-1.5 py-0.5 text-xs text-muted">bench</span>
            )}
          </div>
          <p className="text-sm text-muted">
            {player.nfl_team ?? "FA"} · {player.position}
            {vs ? ` · ${vs}` : ""}
            {player.injury_status ? ` · ${player.injury_status}` : ""}
            {player.injury_body_part ? ` · ${player.injury_body_part}` : ""}
          </p>
          <p className="mt-2 display text-xl text-lime">{row.headline}</p>
          <p className="text-sm text-pretty text-muted">{row.reason}</p>
          <p className="mt-2 flex flex-wrap gap-1">
            {player.practice_status ? (
              <span className={`rounded border px-1.5 text-xs ${practiceTone(player.practice_status)}`}>
                {player.practice_status}
              </span>
            ) : (
              <span className="rounded border border-stroke px-1.5 text-xs text-muted">no practice tag</span>
            )}
            {row.deadline_label ? (
              <span className="rounded border border-stroke px-1.5 text-xs text-muted">{row.deadline_label}</span>
            ) : null}
            {player.locked ? (
              <span className="rounded border border-sky px-1.5 text-xs text-sky">LOCKED</span>
            ) : null}
          </p>
          {player.beat_note ? (
            <blockquote className="mt-3 border-l-2 border-lime pl-3 text-sm text-pretty text-clay">
              {player.beat_note}
            </blockquote>
          ) : null}
          {row.replacement ? (
            <p className="mt-3 text-sm text-clay">
              If you sit → start{" "}
              <span className="font-semibold text-lime">{row.replacement.full_name}</span>{" "}
              <span className="text-muted">
                ({row.replacement.position} · {row.replacement.p50.toFixed(1)} P50)
              </span>
            </p>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-end gap-2">
          <span className={`display rounded-lg px-3 py-2 text-lg leading-none ${callStamp(row.call)}`}>{row.call}</span>
          <p className="text-right tabular-nums">
            <span className="display text-lg text-muted">{(player.p50 ?? player.mu).toFixed(1)}</span>
            <span className="ml-1 text-xs text-muted">P50</span>
          </p>
        </div>
      </div>
    </article>
  );
}

function SundayBanner({ data }: { data: InjuryDeskResponse }) {
  const [now, setNow] = useState(() => Date.now());
  const deadline = data.sunday.deadline_ms;
  useEffect(() => {
    if (!deadline || now >= deadline) return;
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [deadline, now]);

  const open = deadline != null && now < deadline;
  const label = deadline != null ? formatInactiveWindow(deadline, now) : data.sunday.deadline_label;
  const n = data.sunday.counts.inactive + data.sunday.counts.sit + data.sunday.counts.watch;
  const close = deadline != null && now >= deadline && now < (deadline + 90 * 60 * 1000);

  return (
    <section
      id="sunday"
      className={`mt-3 flex flex-wrap items-center gap-4 rounded-2xl border px-5 py-4 ${
        close ? "border-blood bg-card" : open ? "border-sky bg-card" : "border-stroke bg-bg/70"
      }`}
    >
      <Clock size={22} className={close ? "text-blood" : open ? "text-sky" : "text-muted"} strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <p className="display text-sm text-lime">Sunday inactives</p>
        <p className="display text-2xl text-clay">{label ?? "90 min before kickoff"}</p>
        <p className="text-sm text-muted">
          Official list posts 90 minutes before kickoff. Sit the inactive. Start the handcuff.
          {n ? ` ${n} in question.` : ""}
          {data.sunday.counts.handcuffs ? ` ${data.sunday.counts.handcuffs} handcuff${data.sunday.counts.handcuffs === 1 ? "" : "s"}.` : ""}
        </p>
      </div>
    </section>
  );
}

function SundayBlock({ rows }: { rows: SundayDeskRow[] }) {
  if (!rows.length) {
    return (
      <section className="mt-8 rounded-2xl border border-stroke bg-card p-5">
        <h2 className="display text-2xl text-clay">Sunday</h2>
        <p className="mt-2 max-w-xl text-pretty text-muted">
          Nobody on this roster is waiting on inactives. The list still posts 90 minutes before kickoff — check
          back then.
        </p>
      </section>
    );
  }
  const sit = rows.filter((r) => r.call === "INACTIVE" || r.call === "SIT");
  const watch = rows.filter((r) => r.call === "WATCH");
  const rest = rows.filter((r) => r.call === "START");
  return (
    <section className="mt-8 space-y-4">
      <div>
        <h2 className="display text-2xl text-clay">Sunday</h2>
        <p className="text-sm text-muted">90 minutes before kickoff. Handcuff or sit.</p>
      </div>
      {sit.length ? (
        <div className="grid gap-3">
          {sit.map((row) => (
            <SundayCard key={row.player.player_id} row={row} />
          ))}
        </div>
      ) : null}
      {watch.length ? (
        <div className="grid gap-3">
          {watch.map((row) => (
            <SundayCard key={row.player.player_id} row={row} />
          ))}
        </div>
      ) : null}
      {rest.length ? (
        <div className="grid gap-3">
          {rest.map((row) => (
            <SundayCard key={row.player.player_id} row={row} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SundayCard({ row }: { row: SundayDeskRow }) {
  const player = row.player;
  const vs = player.bye ? "BYE" : player.opponent ? `vs ${player.opponent}` : "";
  const cuff = row.handcuff;
  return (
    <article className="rounded-xl border border-stroke bg-bg/70 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className={`display min-w-11 rounded px-1.5 py-1 text-center text-xs ${POS[player.position] ?? "pos-flex"}`}>
          {row.slot}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-clay">{player.full_name}</p>
            {row.starting ? null : (
              <span className="display rounded border border-stroke px-1.5 py-0.5 text-xs text-muted">bench</span>
            )}
          </div>
          <p className="text-sm text-muted">
            {player.nfl_team ?? "FA"} · {player.position}
            {vs ? ` · ${vs}` : ""}
            {player.injury_status ? ` · ${player.injury_status}` : ""}
          </p>
          <p className="mt-2 display text-xl text-lime">{row.headline}</p>
          <p className="text-sm text-pretty text-muted">{row.reason}</p>
          {row.inactive_label ? (
            <p className="mt-2">
              <span className="rounded border border-stroke px-1.5 text-xs text-muted">{row.inactive_label}</span>
            </p>
          ) : null}
          {cuff ? (
            <p className="mt-3 text-sm text-clay">
              Handcuff{" "}
              <span className="font-semibold text-lime">{cuff.full_name}</span>{" "}
              <span className="text-muted">
                ({cuff.position}
                {cuff.p50 != null ? ` · ${cuff.p50.toFixed(1)} P50` : ""})
              </span>
              <span className="mt-1 block text-pretty">{cuff.action}</span>
            </p>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-end gap-2">
          <span className={`display rounded-lg px-3 py-2 text-lg leading-none ${callStamp(row.call)}`}>{row.call}</span>
          <p className="text-right tabular-nums">
            <span className="display text-lg text-muted">{(player.p50 ?? player.mu).toFixed(1)}</span>
            <span className="ml-1 text-xs text-muted">P50</span>
          </p>
        </div>
      </div>
    </article>
  );
}
