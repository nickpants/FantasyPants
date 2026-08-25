import { useNavigate } from "@tanstack/react-router";
import { FormEvent, useState } from "react";
import { refreshPlayersFn, syncSleeperUserFn } from "@/lib/gridiron/server-fns";
import { writeSession } from "@/lib/session";

const DEMO_USER = "natejones";

export function ConnectForm() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await syncSleeperUserFn({ data: { username: username.trim() } });
      writeSession(result);
      void refreshPlayersFn().catch(() => undefined);
      await navigate({ to: "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach Sleeper");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-md space-y-4">
      <label className="display block text-sm text-lime" htmlFor="sleeper-username">
        Sleeper username
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="sleeper-username"
          name="sleeper_username"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="e.g. natejones"
          className="min-h-12 min-w-0 flex-1 rounded-lg border border-lime/40 bg-card px-4 py-3 text-clay outline-none placeholder:text-muted focus:border-lime"
        />
        <button
          type="submit"
          disabled={pending || !username.trim()}
          className="display min-h-12 rounded-lg bg-lime px-5 py-3 text-ink disabled:opacity-50"
        >
          {pending ? "Syncing" : "Connect"}
        </button>
      </div>
      {error ? <p className="text-sm text-blood">{error}</p> : null}
      <p className="text-sm text-muted">
        Zero-auth. We pull public Sleeper leagues for the current NFL season.{" "}
        <button
          type="button"
          className="text-lime underline decoration-lime/40 underline-offset-2"
          onClick={() => setUsername(DEMO_USER)}
        >
          Try {DEMO_USER}
        </button>
      </p>
    </form>
  );
}