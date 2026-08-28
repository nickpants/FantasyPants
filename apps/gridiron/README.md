# GridironAI — TanStack Start port

Live Sleeper copilot ported from the FastAPI + Next.js apps in this repo
(`apps/backend`, `apps/web`) to TanStack Start / React.

This snapshot is the version running in Grok Build. It is not a drop-in
replacement for `apps/web`; keep the Python API for ILP/PuLP until you
choose to cut over.

## What landed here (beyond the original Python copilot)

1. **Vegas + nflverse context** — weekly spreads, totals, implied points,
   roof/wind. µ is scaled by implied team total and outdoor wind. Start/Sit
   and Matchup render a slate strip.
2. **Exact lineup solver** — Hungarian max-µ assignment (handles overlapping
   FLEX / WRRB / REC / SUPER_FLEX). Greedy remains as `optimizeLineupGreedy`.
3. **Practice reports** — nflverse FP / LP / DNP plus ESPN beat notes. Those
   designations haircut Questionable/Doubtful instead of a flat 0.85.
4. **Persisted snapshots** — leagues, rosters, player catalog, and slate
   write through Postgres (`migrations/0002_gridiron.sql`). Repeat views
   skip the Sleeper round-trip inside the TTL.
5. **Bye weeks + kickoff locks** — bye detection when the slate is live;
   locked starters stay pinned, locked bench is ineligible. Kickoff times
   persist in `migrations/0003_locks.sql`.
6. **Opportunity scaling** — last-6-game target / rush / snap share from
   nflverse player-week stats (prior season for weeks 1–4; 70/30 blend after).
7. **Friday injury desk** — first-class `/desk` screen. Questionable/Doubtful,
   FP/LP/DNP tally, beat note, sit-unless-FP-by-4pm. Workflow is
   Roster → Desk → Start / Sit.
8. **Opponent D / FPA** — fantasy points allowed by opponent × position
   scales µ (rank 1 = easiest; 55% weight so it does not double-count Vegas).
9. **Sunday inactives + handcuffs** — 90 minutes before kickoff. Confirmed
   Inactive/Out, then the depth-chart handcuff (bench / wire / other roster).

## Layout

```
src/lib/gridiron/   engine, Sleeper client, nflverse/ESPN slate, store
src/lib/types.ts    shared DTOs
src/components/     locker-room UI
src/routes/         dashboard, desk, help, league pages
migrations/         unowned snapshot + lock tables
```

Zero-auth: connect a public Sleeper username.
