import { useEffect, useState } from "react";
import { copilotStatusFn, runCopilotFn } from "@/lib/gridiron/server-fns";

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
  const [bias, setBias] = useState("");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [configured, setConfigured] = useState(false);
  const isTrade = Boolean(give?.length || receive?.length);

  async function run(ask?: string, useGrok = false) {
    setRunning(true);
    setError(null);
    setAgents({});
    setStatus(useGrok ? "Calling Grok staff…" : "Opening the debate…");
    try {
      const result = await runCopilotFn({
        data: {
          leagueId,
          rosterId,
          week,
          question: ask || undefined,
          give,
          receive,
          useGrok,
        },
      });
      setAgents(result.agents);
      setBias(result.bias);
      setConfigured(result.configured);
      setStatus(result.configured && useGrok ? `xAI · ${result.model}` : "Heuristic staff");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copilot failed");
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void copilotStatusFn().then((s) => setConfigured(s.configured)).catch(() => undefined);
    void run(undefined, false);
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
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="display min-h-11 rounded-lg border border-stroke px-3 py-2 text-sm disabled:opacity-50"
            disabled={running}
            onClick={() => void run(question, false)}
          >
            {running ? "In the booth…" : "Re-run heuristics"}
          </button>
          {configured ? (
            <button
              className="display min-h-11 rounded-lg bg-lime px-3 py-2 text-sm text-ink disabled:opacity-50"
              disabled={running}
              onClick={() => void run(question, true)}
            >
              Call Grok staff
            </button>
          ) : null}
        </div>
      </div>

      {!configured ? (
        <p className="mb-4 text-sm text-muted">
          Heuristic staff is live. Grok briefs run when an xAI key is available on this app.
        </p>
      ) : null}

      <div className={`grid gap-3 ${isTrade ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3"}`}>
        {((isTrade ? ["floor", "ceiling", "injury", "trade"] : ["floor", "ceiling", "injury"]) as AgentId[]).map(
          (id) => (
            <article key={id} className="rounded-xl border border-stroke bg-bg/70 p-3">
              <h3 className="display text-sm text-lime">{LABELS[id]}</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-clay">{agents[id] ?? (running ? "…" : "—")}</p>
            </article>
          ),
        )}
      </div>

      <article className="mt-4 rounded-xl border border-lime bg-bg/80 p-4">
        <h3 className="display text-lg text-lime">{LABELS.master}</h3>
        <p className="mt-2 whitespace-pre-wrap text-clay">
          {agents.master ?? (running ? "Waiting on the staff…" : "—")}
        </p>
      </article>

      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void run(question, configured);
        }}
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask the staff a follow-up, e.g. what about Kupp in FLEX?"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-stroke bg-bg px-3 py-2 text-clay outline-none focus:border-lime"
        />
        <button className="display min-h-11 rounded-lg bg-lime px-4 py-2 text-ink" type="submit" disabled={running}>
          Ask
        </button>
      </form>
      {error ? <p className="mt-3 text-sm text-blood">{error}</p> : null}
    </section>
  );
}
