import { PlayerCard } from "@/components/sleeper/PlayerCard";
import type { Player, Roster } from "@/lib/types";

const BENCH_SLOTS = new Set(["BN", "IR", "TAXI"]);

function playerMap(players: Player[] | undefined) {
  return new Map((players ?? []).map((player) => [player.player_id, player]));
}

function resolvePlayer(map: Map<string, Player>, id: string): Player | undefined {
  if (!id || id === "0") return undefined;
  return map.get(id) ?? { player_id: id, full_name: id, position: "UNK" };
}

export function RosterGrid({
  roster,
  rosterPositions,
}: {
  roster: Roster;
  rosterPositions: string[];
}) {
  const starterSlots = rosterPositions.filter((slot) => !BENCH_SLOTS.has(slot));
  const map = playerMap(roster.hydrated_starters ?? roster.hydrated_players);
  const starters = roster.starters.map((id) => resolvePlayer(map, id));
  const fullMap = playerMap(roster.hydrated_players);
  const benchIds = (roster.players ?? []).filter(
    (id) =>
      !roster.starters.includes(id) &&
      !(roster.reserve ?? []).includes(id) &&
      !(roster.taxi ?? []).includes(id),
  );
  const bench = benchIds.map((id) => resolvePlayer(fullMap, id)).filter((p): p is Player => Boolean(p));
  const reserve = (roster.reserve ?? [])
    .map((id) => resolvePlayer(playerMap(roster.hydrated_reserve ?? roster.hydrated_players), id))
    .filter((p): p is Player => Boolean(p));
  const taxi = (roster.taxi ?? [])
    .map((id) => resolvePlayer(playerMap(roster.hydrated_taxi ?? roster.hydrated_players), id))
    .filter((p): p is Player => Boolean(p));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <section>
        <h3 className="display mb-3 text-sm text-lime">Starting lineup</h3>
        <div className="grid gap-2">
          {starterSlots.map((slot, index) => (
            <PlayerCard key={`${slot}-${index}`} slot={slot} player={starters[index]} />
          ))}
        </div>
      </section>
      <section className="grid gap-6">
        <div>
          <h3 className="display mb-3 text-sm text-muted">Bench</h3>
          <div className="grid gap-2">
            {bench.length ? (
              bench.map((player) => <PlayerCard key={player.player_id} slot="BN" player={player} />)
            ) : (
              <p className="text-sm text-muted">No bench players.</p>
            )}
          </div>
        </div>
        {reserve.length ? (
          <div>
            <h3 className="display mb-3 text-sm text-blood">IR</h3>
            <div className="grid gap-2">
              {reserve.map((player) => (
                <PlayerCard key={player.player_id} slot="IR" player={player} />
              ))}
            </div>
          </div>
        ) : null}
        {taxi.length ? (
          <div>
            <h3 className="display mb-3 text-sm text-sky">Taxi</h3>
            <div className="grid gap-2">
              {taxi.map((player) => (
                <PlayerCard key={player.player_id} slot="TAXI" player={player} />
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
