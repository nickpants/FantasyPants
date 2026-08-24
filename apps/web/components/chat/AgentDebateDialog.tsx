"use client";

import { useEffect, useState } from "react";
import { configureCopilot, streamCopilot } from "@/lib/api";

type AgentId = "floor" | "ceiling" | "injury" | "trade" | "master";

const LABELS: Record<AgentId, string> = {
  floor: "Floor Conservator",
  ceiling: "Ceiling Gambler",
  injury: "Injury & Beat",
  trade: "Trade Arbiter",
  master: "Head Coach",
};

export function AgentDebateDialog({
  leagueId,
  rosterId,
  week,
  give,
  receive,
}: {
  leagueId: string;
  rosterId: number;
  week?: number;
  give?: string[];
  receive?: string[];
}) {
  const [agents, setAgents] = useState<Partial<Record<AgentId, string>>>({});
  const [status, setStatus] = useState("Waiting for the staff meeting…");
  const [source, setSource] = useState<string>("");
  const [bias, setBias] = useState<string>("");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const isTrade = Boolean(give?.length || receive?.length);

  async function run(ask?: string) {
    setRunning(true);
    setError(null);
    setAgents({});
    setStatus("Opening the debate…");
    try {
      await streamCopilot(
        {
          league_id: leagueId,
          roster_id: rosterId,
          week,
          question: ask || undefined,
          give,
          receive,
        },
        (event) => {
          if (event.type === "status") {
            setSource(String(event.source ?? ""));
            setBias(String(event.bias ?? ""));
            setStatus(
              event.configured
                ? `SpaceXAI · ${event.model}`
                : "Heuristic staff (set XAI_API_KEY for Grok)"
            );
          } else if (event.type === "agent" && event.agent) {
            setAgents((prev) => ({ ...prev, [event.agent as AgentId]: String(event.text ?? "") }));
          } else if (event.type === "error") {
            setError(String(event.detail ?? "Copilot failed"));
          } else if (event.type === "done") {
            setStatus((prev) => prev);
          }
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stream failed");
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, rosterId, week, give?.join(","), receive?.join(",")]);

  return (
    <section className="mt-10 rounded-2xl border border-stroke bg-card p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display text-2xl text-lime">Staff debate</h2>
          <p className="text-sm text-muted">
            {status}
            {bias ? ` · bias ${bias}` : ""}
            {source ? ` · ${source}` : ""}
          </p>
        </div>
        <button
          className="display rounded-lg border border-stroke px-3 py-2 text-sm disabled:opacity-50"
          disabled={running}
          onClick={() => void run(question)}
        >
          {running ? "In the booth…" : "Re-run"}
        </button>
      </div>

      {status.toLowerCase().includes("heuristic") ? (
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setSavingKey(true);
            setError(null);
            try {
              await configureCopilot(apiKey);
              setApiKey("");
              await run(question);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save key");
            } finally {
              setSavingKey(false);
            }
          }}
        >
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="xai-…  (console.x.ai)"
            className="min-w-0 flex-1 rounded-lg border border-stroke bg-bg px-3 py-2 text-clay outline-none focus:border-lime"
            autoComplete="off"
            suppressHydrationWarning
          />
          <button className="display rounded-lg border border-lime px-4 py-2 text-lime" disabled={savingKey || !apiKey}>
            {savingKey ? "Saving" : "Use Grok"}
          </button>
        </form>
      ) : null}

      <div className={`grid gap-3 ${isTrade ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3"}`}>
        {((isTrade ? ["floor", "ceiling", "injury", "trade"] : ["floor", "ceiling", "injury"]) as AgentId[]).map((id) => (
          <article key={id} className="rounded-xl border border-stroke bg-bg/70 p-3">
            <h3 className="display text-sm text-lime">{LABELS[id]}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-clay">
              {agents[id] ?? (running ? "…" : "—")}
            </p>
          </article>
        ))}
      </div>

      <article className="mt-4 rounded-xl border border-lime bg-bg/80 p-4">
        <h3 className="display text-lg text-lime">{LABELS.master}</h3>
        <p className="mt-2 whitespace-pre-wrap text-clay">{agents.master ?? (running ? "Waiting on the staff…" : "—")}</p>
      </article>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(question);
        }}
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask the staff a follow-up, e.g. what about Kupp in FLEX?"
          className="min-w-0 flex-1 rounded-lg border border-stroke bg-bg px-3 py-2 text-clay outline-none focus:border-lime"
        />
        <button className="display rounded-lg bg-lime px-4 py-2 text-ink" type="submit" disabled={running}>
          Ask
        </button>
      </form>
      {error ? <p className="mt-3 text-sm text-blood">{error}</p> : null}
    </section>
  );
}
