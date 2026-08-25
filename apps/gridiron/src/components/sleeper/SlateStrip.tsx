import type { GameSlateRow } from "@/lib/types";

export function SlateStrip({ slate }: { slate?: GameSlateRow[] }) {
  if (!slate?.length) return null;
  return (
    <section className="mt-6 overflow-x-auto rounded-2xl border border-stroke bg-card p-4">
      <h2 className="display mb-3 text-sm text-lime">Vegas slate</h2>
      <div className="flex min-w-max gap-2">
        {slate.slice(0, 16).map((game) => (
          <article
            key={`${game.team}-${game.opponent}`}
            className="min-w-40 rounded-lg border border-stroke bg-bg/70 px-3 py-2"
          >
            <p className="display text-sm text-clay">
              {game.team} {game.home ? "vs" : "@"} {game.opponent}
            </p>
            <p className="text-xs text-muted">
              {game.spread != null ? (game.spread > 0 ? `-${Math.abs(game.spread)}` : `+${Math.abs(game.spread)}`) : "NL"}
              {game.total != null ? ` · O/U ${game.total}` : ""}
            </p>
            <p className="text-xs text-lime">
              {game.implied != null ? `implied ${game.implied.toFixed(1)}` : "no total"}
              {game.wind != null ? ` · wind ${game.wind}` : game.roof ? ` · ${game.roof}` : ""}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
