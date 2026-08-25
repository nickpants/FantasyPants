import type { Player, PracticeTag } from "@/lib/types";

const POSITION_TONES: Record<string, string> = {
  QB: "pos-qb",
  RB: "pos-rb",
  WR: "pos-wr",
  TE: "pos-te",
  K: "pos-k",
  DEF: "pos-def",
  FLEX: "pos-flex",
  SUPER_FLEX: "pos-flex",
  WRRB_FLEX: "pos-flex",
  REC_FLEX: "pos-flex",
};

function injuryClass(status?: string | null) {
  if (!status) return "";
  if (status === "Out" || status === "IR") return "text-blood";
  return "text-sky";
}

function practiceClass(tag?: PracticeTag | null) {
  if (tag === "DNP") return "border-blood text-blood";
  if (tag === "LP") return "border-sky text-sky";
  if (tag === "FP") return "border-lime text-lime";
  return "border-stroke text-muted";
}

export function PlayerCard({
  player,
  slot,
  p10,
  p50,
  p90,
}: {
  player?: (Player & { implied_total?: number | null; opponent?: string | null; wind?: number | null }) | null;
  slot: string;
  p10?: number | null;
  p50?: number | null;
  p90?: number | null;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-stroke bg-bg/70 px-3 py-2">
      <span
        className={`display min-w-11 rounded px-1.5 py-1 text-center text-xs ${POSITION_TONES[slot] ?? POSITION_TONES[player?.position ?? ""] ?? "pos-flex"}`}
      >
        {slot}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-clay">{player?.full_name ?? "Empty"}</p>
        <p className="text-xs text-muted">
          {player?.nfl_team ?? "FA"} · {player?.position ?? slot}
          {player?.opponent ? ` vs ${player.opponent}` : ""}
          {player?.injury_status ? (
            <span className={`ml-2 font-semibold ${injuryClass(player.injury_status)}`}>
              {player.injury_status}
            </span>
          ) : null}
        </p>
        {player?.practice_status || player?.implied_total != null ? (
          <p className="mt-1 flex flex-wrap gap-1">
            {player.practice_status ? (
              <span className={`rounded border px-1.5 text-xs ${practiceClass(player.practice_status)}`}>
                {player.practice_status}
              </span>
            ) : null}
            {player.implied_total != null ? (
              <span className="rounded border border-stroke px-1.5 text-xs text-muted">
                imp {player.implied_total.toFixed(1)}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      {p50 != null ? (
        <div className="text-right tabular-nums">
          <p className="display text-lg leading-none text-lime">{p50.toFixed(1)}</p>
          <p className="text-xs text-muted">
            {p10 != null ? p10.toFixed(1) : "—"} / {p90 != null ? p90.toFixed(1) : "—"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
