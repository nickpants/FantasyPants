# Grok Build Web deploy

When previewing or publishing this repository on Grok Build Web (`grok.com` Build Mode, `*.grok.me`):

1. Read `/GROK.md` and follow it. Do not improvise a different architecture.
2. Keep **FastAPI + Next.js**. Python 3.12 and Node 20 are required.
3. From the repo root: `npm run setup && npm run build && npm start`.
4. Bind `0.0.0.0:$PORT`. `scripts/start.mjs` is the process the host should run.
5. Secret: `XAI_API_KEY` in the grok.me Secrets store. Sleeper needs no key.
6. If Python is unavailable, stop. Never ship a UI-only stub or a JS rewrite of the optimizer.
