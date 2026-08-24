#!/usr/bin/env node
/**
 * Production entry for Grok Build Web / grok.me / Docker.
 *
 * Starts FastAPI on a loopback port, Next.js on a loopback port, and a tiny
 * reverse proxy on 0.0.0.0:$PORT so the host only has to expose one process.
 * /api, /docs, /health go to FastAPI (SSE streams are piped, not buffered).
 */
import { createServer as createNetServer } from "node:net";
import http from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(root, "apps", "web");
const isWin = process.platform === "win32";
const publicPort = Number(process.env.PORT || 3000);
const publicHost = process.env.HOST || "0.0.0.0";
const children = [];
const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

let shuttingDown = false;

function pythonBin() {
  const venv = path.join(root, ".venv", isWin ? "Scripts/python.exe" : "bin/python");
  if (existsSync(venv)) return venv;
  return "python3";
}

function freePort(preferred) {
  return new Promise((resolve, reject) => {
    const tryListen = (port) => {
      const server = createNetServer();
      server.unref();
      server.on("error", () => {
        if (port === 0) {
          reject(new Error("Could not allocate a free TCP port"));
          return;
        }
        tryListen(0);
      });
      server.listen(port, "127.0.0.1", () => {
        const addr = server.address();
        const bound = typeof addr === "object" && addr ? addr.port : port;
        server.close(() => resolve(bound));
      });
    };
    tryListen(preferred || 0);
  });
}

function spawnChild(command, args, { cwd = root, env = {} } = {}) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: isWin,
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`${command} exited (${signal || code}). Shutting down.`);
    shutdown(code || 1);
  });
  return child;
}

function proxyTo(target, req, res) {
  const dest = new URL(req.url || "/", target);
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null || HOP.has(key.toLowerCase())) continue;
    headers[key] = value;
  }
  const upstream = http.request(
    {
      protocol: dest.protocol,
      hostname: dest.hostname,
      port: dest.port,
      path: dest.pathname + dest.search,
      method: req.method,
      headers,
    },
    (incoming) => {
      const outHeaders = { ...incoming.headers };
      delete outHeaders.connection;
      res.writeHead(incoming.statusCode || 502, outHeaders);
      incoming.pipe(res);
    }
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end(`Bad gateway (${target}): ${err.message}`);
  });
  req.pipe(upstream);
}

function shouldRouteToApi(urlPath) {
  return (
    urlPath === "/health" ||
    urlPath === "/docs" ||
    urlPath === "/redoc" ||
    urlPath === "/openapi.json" ||
    urlPath.startsWith("/docs/") ||
    urlPath.startsWith("/redoc/") ||
    urlPath.startsWith("/api")
  );
}

async function waitFor(url, label, timeoutMs = 60000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label} at ${url} (${lastError})`);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 1500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function pickInternalPort(preferred, used) {
  if (preferred && !used.has(preferred)) return preferred;
  return 0;
}

async function main() {
  mkdirSync(path.join(root, "data"), { recursive: true });

  if (!existsSync(path.join(webDir, ".next"))) {
    console.log("No Next.js build found — running npm run build…");
    const status = await new Promise((resolve) => {
      const build = spawn("npm", ["run", "build"], {
        cwd: root,
        stdio: "inherit",
        shell: isWin,
        env: process.env,
      });
      build.on("exit", resolve);
    });
    if (status !== 0) {
      console.error("Next.js build failed.");
      process.exit(status || 1);
    }
  }

  const python = pythonBin();
  const venvPython = path.join(root, ".venv", isWin ? "Scripts/python.exe" : "bin/python");
  if (python === venvPython && !existsSync(python)) {
    console.error("Missing .venv. Run `npm run setup` first.");
    process.exit(1);
  }

  const used = new Set([publicPort]);
  const apiPort = await freePort(
    pickInternalPort(Number(process.env.GRIDIRON_API_PORT || 8000), used)
  );
  used.add(apiPort);
  const webPort = await freePort(
    pickInternalPort(Number(process.env.GRIDIRON_WEB_PORT || 3001), used)
  );

  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const webOrigin = `http://127.0.0.1:${webPort}`;

  console.log(`GridironAI API  → ${apiOrigin}`);
  console.log(`GridironAI UI   → ${webOrigin}`);
  console.log(`Public proxy    → http://${publicHost}:${publicPort}`);

  spawnChild(
    python,
    [
      "-m",
      "uvicorn",
      "main:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(apiPort),
      "--app-dir",
      path.join(root, "apps", "backend"),
    ],
    { env: { PYTHONPATH: path.join(root, "apps", "backend"), PYTHONUNBUFFERED: "1" } }
  );

  spawnChild("npx", ["next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    cwd: webDir,
    env: { API_ORIGIN: apiOrigin },
  });

  await waitFor(`${apiOrigin}/health`, "FastAPI");
  await waitFor(webOrigin, "Next.js");

  const server = http.createServer((req, res) => {
    const urlPath = (req.url || "/").split("?")[0];
    proxyTo(shouldRouteToApi(urlPath) ? apiOrigin : webOrigin, req, res);
  });
  server.listen(publicPort, publicHost, () => {
    console.log(`GridironAI listening on ${publicHost}:${publicPort}`);
  });
}

main().catch((err) => {
  console.error(err);
  shutdown(1);
});
