import type { GameSlateRow } from "@/lib/types";

export function SlateStrip({ slate }: { slate?: GameSlateRow[] }) {
  if (!slate?.length) return null;
  return (
    <section className="mt-6 overflow-x-auto rounded-2xl border border-stroke bg-card p-4">
      <h2 className="display mb-3 text-sm text-lime">Vegas slate</h2>
      <div className="flex min-w-max gap-2">
        {slate.slice(0, 20).map((game) => {
          const bye = Boolean(game.bye) || game.opponent === "BYE";
          return (
            <article
              key={`${game.team}-${game.opponent}`}
              className={`min-w-40 rounded-lg border px-3 py-2 ${
                bye ? "border-stroke bg-bg/40 opacity-70" : "border-stroke bg-bg/70"
              }`}
            >
              <p className="display text-sm text-clay">
                {bye ? `${game.team} BYE` : `${game.team} ${game.home ? "vs" : "@"} ${game.opponent}`}
              </p>
              <p className="text-xs text-muted">
                {bye
                  ? "sit this week"
                  : `${
                      game.spread != null
                        ? game.spread > 0
                          ? `-${Math.abs(game.spread)}`
                          : `+${Math.abs(game.spread)}`
                        : "NL"
                    }${game.total != null ? ` · O/U ${game.total}` : ""}`}
              </p>
              <p className={`text-xs ${game.kickoff_label === "LOCKED" ? "text-sky" : "text-lime"}`}>
                {bye
                  ? "BYE"
                  : game.kickoff_label
                    ? game.kickoff_label
                    : game.implied != null
                      ? `implied ${game.implied.toFixed(1)}`
                      : "no total"}
                {!bye && game.implied != null && game.kickoff_label
                  ? ` · imp ${game.implied.toFixed(1)}`
                  : ""}
                {!bye && game.wind != null ? ` · wind ${game.wind}` : !bye && game.roof ? ` · ${game.roof}` : ""}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
