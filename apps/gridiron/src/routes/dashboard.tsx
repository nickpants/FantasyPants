import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { avatarUrl, clearSession, readSession, type Session } from "@/lib/session";

export const Route = createFileRoute("/dashboard")({ component: DashboardPage });

function DashboardPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const current = readSession();
    if (!current) {
      void navigate({ to: "/" });
      return;
    }
    setSession(current);
  }, [navigate]);

  if (!session) {
    return <main className="p-10 text-muted">Loading locker room…</main>;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="display text-sm text-lime">
            {session.nfl_state.season_type} · week {session.nfl_state.display_week ?? session.nfl_state.week} ·{" "}
            {session.season}
          </p>
          <h1 className="display mt-2 text-5xl text-clay">
            {session.user.display_name ?? session.user.username}
          </h1>
          <p className="text-muted">
            @{session.user.username} · {session.leagues.length} leagues
          </p>
        </div>
        <button
          className="display min-h-11 rounded-lg border border-stroke px-4 py-2 text-sm"
          onClick={() => {
            clearSession();
            void navigate({ to: "/" });
          }}
        >
          Disconnect
        </button>
      </header>

      {session.leagues.length === 0 ? (
        <p className="text-muted">No public Sleeper leagues found for this username.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {session.leagues.map((league) => {
            const avatar = avatarUrl(league.avatar);
            return (
              <Link
                key={league.sleeper_league_id}
                to="/league/$leagueId"
                params={{ leagueId: league.sleeper_league_id }}
                className="flex gap-4 rounded-2xl border border-stroke bg-card p-5 transition hover:border-lime"
              >
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-turf text-xl">
                  {avatar ? (
                    <img src={avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="display text-lime">{league.name.slice(0, 2)}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="display truncate text-2xl text-clay">{league.name}</h2>
                  <p className="text-sm text-muted">
                    {league.season} · {league.total_rosters} teams · {league.status} ·{" "}
                    {league.is_dynasty ? "Dynasty" : "Redraft"}
                  </p>
                  <p className="mt-1 text-sm text-lime">{league.scoring_summary}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
