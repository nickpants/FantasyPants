# GridironAI — project rules for Grok Build

This is a **Sleeper-centric fantasy football copilot**. Keep the existing stack. Do not rewrite it as a client-only demo, a static landing page, or a single Next.js API-route app.

## Stack (do not replace)

- **UI:** Next.js 15 App Router + Tailwind v4 in `apps/web`
- **API:** FastAPI in `apps/backend` (PuLP optimizer, Monte Carlo, LangGraph copilot, Sleeper client)
- **DB:** SQLite at `data/gridiron.db` by default (Postgres/Redis are optional)
- **LLM:** SpaceXAI only — `XAI_API_KEY`, `https://api.x.ai/v1`, model `grok-4.6`
- **Sleeper:** public API, no OAuth. Never invent a Sleeper key.

## Grok Build Web / grok.me (read this first when publishing)

Follow **`GROK.md`** exactly. Short version:

1. Do **not** drop Python, PuLP, LangGraph, or the FastAPI app.
2. Runtime: Python **3.12+** and Node **20+**.
3. Install and run from the repo root:

```bash
npm run setup
npm run build
npm start
```

4. Bind `0.0.0.0:$PORT` (default 3000). `npm start` already does this via `scripts/start.mjs`.
5. Store **`XAI_API_KEY`** in the grok.me Secrets store (console.x.ai). Do not commit `.env`.
6. Prefer the platform Secrets store over writing `.env`. The copilot also reads `GROK_CODE_XAI_API_KEY` and `GROK_API_KEY`.
7. If the host cannot run Python, **stop and say so**. Do not port the optimizer or agents to JavaScript.

## Local development

```bash
npm run setup
# API  http://127.0.0.1:8000/docs
npm run dev:api
# UI   http://127.0.0.1:3000
npm run dev
```

`apps/web/next.config.ts` rewrites `/api/*` to `API_ORIGIN` (default `http://127.0.0.1:8000`) during `next dev`.

## Tests

```bash
npm run test:api
```

## Conventions

- Never hardcode secrets. Server-side only — the browser talks to `/api/v1/*`.
- SQLite + in-memory cache unless `DATABASE_URL` / `REDIS_URL` are set.
- IR slots with Sleeper id `"0"` are empty, not a player.
- Prefer editing existing modules over adding new frameworks.
- Frontend uses `"use client"` pages and `apps/web/lib/api.ts` for all backend calls.

## Layout

```
apps/backend/     FastAPI, agents, Sleeper, analytics
apps/web/         Next.js UI
scripts/          setup.mjs + start.mjs (single process for grok.me)
GROK.md           deploy runbook for Grok Build Web
```
