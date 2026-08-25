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

## Layout

```
src/lib/gridiron/   engine, Sleeper client, nflverse/ESPN slate, store
src/lib/types.ts    shared DTOs
src/components/     locker-room UI
src/routes/         dashboard + league pages
migrations/         unowned snapshot tables
```

Zero-auth: connect a public Sleeper username (demo: `natejones`).
