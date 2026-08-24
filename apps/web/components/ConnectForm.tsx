"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { refreshPlayers, syncSleeperUser } from "@/lib/api";
import { writeSession } from "@/lib/session";

export function ConnectForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await syncSleeperUser(username.trim());
      writeSession(result);
      void refreshPlayers().catch(() => undefined);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach Sleeper");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-md space-y-4" suppressHydrationWarning>
      <label className="display block text-sm text-lime" htmlFor="sleeper-username">
        Sleeper username
      </label>
      <div className="flex gap-2">
        <input
          id="sleeper-username"
          name="sleeper_username"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="e.g. sleeperuser"
          className="min-w-0 flex-1 rounded-lg border border-stroke bg-bg px-4 py-3 text-clay outline-none placeholder:text-muted focus:border-lime"
          suppressHydrationWarning
        />
        <button
          type="submit"
          disabled={pending || !username.trim()}
          className="display rounded-lg bg-lime px-5 py-3 text-ink disabled:opacity-50"
          suppressHydrationWarning
        >
          {pending ? "Syncing" : "Connect"}
        </button>
      </div>
      {error ? <p className="text-sm text-blood">{error}</p> : null}
      <p className="text-sm text-muted">
        Zero-auth. We pull public Sleeper leagues for the current NFL season and store them locally.
      </p>
    </form>
  );
}
