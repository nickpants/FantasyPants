#!/usr/bin/env node
/**
 * One-shot install for GridironAI (Grok Build Web, Docker, or a fresh clone).
 * Creates .venv, installs Python deps from pyproject.toml, then npm install.
 */
import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const venvPython = path.join(root, ".venv", isWin ? "Scripts/python.exe" : "bin/python");

function run(command, args, extra = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWin,
    env: process.env,
    ...extra,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function firstOnPath(names) {
  for (const name of names) {
    const probe = spawnSync(name, ["--version"], { encoding: "utf8", shell: isWin });
    if (probe.status === 0) return name;
  }
  return null;
}

mkdirSync(path.join(root, "data"), { recursive: true });

const python = existsSync(venvPython)
  ? venvPython
  : firstOnPath(["python3", "python"]);

if (!python) {
  console.error("Python 3.12+ is required. Install python3, then re-run: npm run setup");
  process.exit(1);
}

if (!existsSync(venvPython)) {
  console.log(`Creating virtualenv with ${python}…`);
  run(python, ["-m", "venv", ".venv"]);
}

console.log("Installing Python package (gridiron-ai)…");
run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
run(venvPython, ["-m", "pip", "install", "-e", "."]);

console.log("Installing Node workspaces…");
run("npm", ["install"]);

console.log("Setup complete. Next: npm run build && npm start");
