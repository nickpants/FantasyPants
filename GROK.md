# Grok Build Web — deploy GridironAI to grok.me

This file is the deploy runbook for **Grok Build on the web** (Build Mode on grok.com / iOS / Android) and for any agent publishing this repo to `*.grok.me`.

Read this **before** installing, previewing, or hitting Publish.

## What this app is

**GridironAI** is a working Sleeper fantasy copilot, not a toy landing page:

- Connect a Sleeper username (public API, no OAuth)
- Roster, start/sit (PuLP), matchup Monte Carlo, FAAB, trades, live draft helper
- Staff debate (Floor / Ceiling / Injury / Trade Arbiter / Head Coach) via SpaceXAI `grok-4.6`

It is a **two-runtime monorepo** (Next.js UI + Python FastAPI). A single process wraps both so grok.me only exposes **one port**.

## Paste this into Grok Build (Build Mode)

If you are importing this repo from GitHub or dropping it into a Grok Build Web chat, send:

> This repo is GridironAI. Read `AGENTS.md` and `GROK.md` before you touch files.
>
> Do not rewrite the stack. Keep FastAPI + Next.js. Do not convert the optimizer, Monte Carlo, or LangGraph agents to JavaScript.
>
> Install Python 3.12+ and Node 20+ if missing. From the repo root run:
> `npm run setup && npm run build && npm start`
>
> `npm start` binds `0.0.0.0:$PORT` (default 3000) and reverse-proxies `/api` to FastAPI so SSE copilot streams work.
>
> Put `XAI_API_KEY` in grok.me Secrets (create at https://console.x.ai). Never commit `.env`.
>
> SQLite at `data/gridiron.db` is the default database. Sleeper needs no key.
>
> When the preview loads, open `/`, connect a public Sleeper username, and confirm the dashboard hydrates. Then Publish to a grok.me URL (access: anyone with the link, unless I say otherwise). Enable SpaceXAI APIs for this app if the Publish sheet offers it.
>
> If Python cannot be installed on this host, stop and tell me. Do not ship a UI-only stub.

## Runtime the host must provide

| Requirement | Version / value |
| --- | --- |
| Python | 3.12+ (`python3`) |
| Node.js | 20+ |
| Public port | `PORT` (fallback `3000`) |
| Bind address | `HOST` (fallback `0.0.0.0`) |
| Disk | writable `data/` for SQLite (ephemeral is OK) |
| Egress | `https://api.sleeper.app`, `https://api.x.ai`, `https://github.com` (nflverse CSVs) |

Optional: Postgres (`DATABASE_URL`) and Redis (`REDIS_URL`). **Do not require Docker** for grok.me.

## Secrets (grok.me Secrets store)

Never write secrets into source. Use the Publish → Secrets UI.

| Name | Required | Purpose |
| --- | --- | --- |
| `XAI_API_KEY` | For the copilot staff debate | SpaceXAI key from https://console.x.ai (`xai-…`) |
| `GROK_CODE_XAI_API_KEY` | No | Alternate name; already supported |
| `GROK_API_KEY` | No | Alternate name; already supported |
| `XAI_MODEL` | No | Default `grok-4.6` |
| `XAI_BASE_URL` | No | Default `https://api.x.ai/v1` |
| `DATABASE_URL` | No | Default SQLite `sqlite+aiosqlite:///./data/gridiron.db` |
| `REDIS_URL` | No | In-process cache if unset |
| `CORS_ORIGINS` | No | Same-origin proxy covers the UI; regex already allows `*.grok.me` |
| `NFLVERSE_ENABLED` | No | Default `true` |

Sleeper is unauthenticated. There is no `SLEEPER_API_KEY`.

If Build Mode offers **“Turn on SpaceXAI APIs”** for this app, enable it. Still set `XAI_API_KEY` on the published site — preview keys do not survive Publish.

## Commands (repo root)

```bash
# 1. Python venv + pip install -e . + npm install
npm run setup

# 2. Next.js production build
npm run build

# 3. One process: FastAPI + Next + proxy on $PORT
npm start
```

Health check (must return JSON `{ "status": "ok" }`):

```bash
curl -sS "http://127.0.0.1:${PORT:-3000}/health"
```

UI: `http://127.0.0.1:${PORT:-3000}/`  
API docs: `http://127.0.0.1:${PORT:-3000}/docs`

## What `npm start` does

`scripts/start.mjs`:

1. Builds the Next app if `apps/web/.next` is missing
2. Starts uvicorn (`main:app`) on loopback
3. Starts `next start` on loopback
4. Listens on `0.0.0.0:$PORT` and routes:
   - `/api/*`, `/health`, `/docs`, `/redoc`, `/openapi.json` → FastAPI
   - everything else → Next.js

Do not run `next dev` for the published site. Do not expose two public ports.

## Container path (if the host prefers Docker)

```bash
docker build -t gridiron-ai .
docker run --rm -p 3000:3000 \
  -e PORT=3000 \
  -e XAI_API_KEY \
  gridiron-ai
```

## Publish checklist

1. Preview starts without replacing the backend.
2. `GET /health` is 200.
3. Homepage renders “Call the play before the snap.”
4. Connecting a Sleeper username reaches `POST /api/v1/sync/sleeper` and the dashboard lists leagues.
5. `XAI_API_KEY` is in Secrets (or the staff panel still offers a paste field).
6. Publish → `*.grok.me`. Suggested slug: `gridiron-ai`.
7. Access: **anyone with the link** unless the owner asks for private.
8. Do not commit `.env`, `data/*.db`, `.venv`, or `node_modules`.

## What not to do

- Do not collapse this into a Vite SPA or Next-only rewrite of PuLP / LangGraph.
- Do not hardcode API keys in client components.
- Do not assume Postgres or Redis exist.
- Do not block on `docker compose` — it is optional local infra only.
- Do not scrape or impersonate Sleeper auth.

## After it is live

Open the grok.me URL, connect a Sleeper username, open a league, then Start/Sit and the staff debate. If Grok is not configured, the heuristic staff still answers.
