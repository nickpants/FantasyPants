# GridironAI

Sleeper-centric AI fantasy copilot. This repo is the first production slice of
`sleeper_fantasy_football_spec.md`: ingestion, persistence, and a working locker-room UI.

## What’s running now (Sprints 1–4)

- Async `SleeperClient` with a 1000 req/min token bucket and exponential backoff
- User → leagues → roster/matchup sync against the public Sleeper API (no OAuth)
- Player catalog worker (`/v1/players/nfl`, 24h cache)
- League-aware scoring, PuLP start/sit optimizer, 10k-game Monte Carlo (P10 / P50 / P90 + win probability)
- nflverse usage (target share, WOPR, snaps) + Vegas implied totals blended into every projection
- FAAB ledger + replacement-level bids, trade grader, IR/taxi lockouts
- FastAPI + SQLAlchemy (SQLite by default, Postgres/Redis via Docker)
- Next.js 15 UI: connect a username, browse leagues, inspect a roster, Start/Sit, matchup board, FAAB, trades, draft room, streamed staff debate
- Live Sleeper draft helper: on-the-clock, VOR + need recommendations, remaining board (polls every 3s while drafting)
- Live matchups: actual Sleeper points locked, residual projection for games still in window, WP that moves Sunday

The Start/Sit page and Trade desk stream Floor / Ceiling / Injury / Trade Arbiter, synthesized by the Head Coach. Paste an `XAI_API_KEY` (console.x.ai) in the staff panel to run SpaceXAI (`grok-4.6`); without a key it uses the heuristic staff. Injury briefs include nflverse practice reports.

## Publish on Grok Build Web (`*.grok.me`)

This repo is packaged for Grok Build on the web. The files the platform reads:

- [`AGENTS.md`](AGENTS.md) — auto-loaded project rules
- [`GROK.md`](GROK.md) — deploy runbook (paste-ready prompt, secrets, start command)
- `.grok/rules/grok-build-web.md` — short “do not rewrite this stack” rule

From [grok.com](https://grok.com/?referrer=website&mode=build) → **Build** mode, import this repo (or paste the prompt at the top of `GROK.md`) and Publish. Put `XAI_API_KEY` in the grok.me Secrets store. One process, one port:

```bash
npm run setup
npm run build
npm start
```

`scripts/start.mjs` binds `0.0.0.0:$PORT`, reverse-proxies `/api` to FastAPI, and serves the Next.js UI.

## Quick start (no Docker)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# API  — http://127.0.0.1:8000/docs
cd apps/backend && ../../.venv/bin/uvicorn main:app --reload --port 8000

# UI   — http://localhost:3000
cd apps/web && npm install && npm run dev
```

Open the UI, enter a Sleeper username, and your 2026 leagues should appear.

## Optional: Postgres 16 + Redis 7

Docker is not required for local SQLite. When you have Docker:

```bash
docker compose up -d
```

Then set in `.env`:

```
DATABASE_URL=postgresql+asyncpg://gridiron:gridiron@localhost:5432/gridiron
REDIS_URL=redis://localhost:6379/0
```

## Tests

```bash
.venv/bin/pytest
```

## Daily player refresh

```bash
cd apps/backend && ../../.venv/bin/python -m workers.player_cron
```

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/sync/sleeper` | Connect a Sleeper username, persist leagues |
| `GET` | `/api/v1/leagues/{id}` | Sync league users + rosters |
| `GET` | `/api/v1/leagues/{id}/matchups/{week}` | Persist weekly matchup snapshots |
| `POST` | `/api/v1/sync/players` | Refresh the ~5MB Sleeper player catalog |
| `POST` | `/api/v1/optimizer/lineup` | Optimal starters + P10/P50/P90 + matchup WP |
| `GET` | `/api/v1/leagues/{id}/analytics/{week}` | League-wide Monte Carlo matchup board |
| `GET` | `/api/v1/leagues/{id}/waivers` | FAAB remaining, RLD bids, transaction ledger |
| `GET` | `/api/v1/leagues/{id}/compliance` | IR / taxi lockouts |
| `GET` | `/api/v1/leagues/{id}/trades` | Trade desk with league-scored player values |
| `POST` | `/api/v1/optimizer/faab` | Tiered bid for one waiver target |
| `POST` | `/api/v1/optimizer/trade` | Grade a proposed player swap |
| `GET` | `/api/v1/copilot/status` | Whether SpaceXAI is configured |
| `POST` | `/api/v1/copilot/configure` | Save `XAI_API_KEY` to gitignored `.env` |
| `POST` | `/api/v1/copilot/stream` | SSE staff debate (floor / ceiling / injury / master) |
| `POST` | `/api/v1/copilot/chat` | Non-streaming copilot (same graph) |
| `GET` | `/api/v1/leagues/{id}/draft` | Draft helper: clock, VOR board, pick recs |
| `GET` | `/api/v1/state/nfl` | Cached NFL calendar (5 min TTL) |

## SpaceXAI

Copilot agents call `https://api.x.ai/v1` with `XAI_API_KEY`. Leave the key
out of the browser bundle; it is server-side only. See `.env.example`. On grok.me
use the Secrets store (see `GROK.md`).
