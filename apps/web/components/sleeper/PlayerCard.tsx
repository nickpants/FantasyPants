import type { Player } from "@/lib/types";

const POSITION_TONES: Record<string, string> = {
  QB: "bg-[#d6ff4b] text-[#0b120e]",
  RB: "bg-[#7ad0ff] text-[#0b120e]",
  WR: "bg-[#ffe56b] text-[#0b120e]",
  TE: "bg-[#ff9b5e] text-[#0b120e]",
  K: "bg-[#c9b6ff] text-[#0b120e]",
  DEF: "bg-[#efe6cc] text-[#0b120e]",
};

function injuryClass(status?: string | null) {
  if (!status) return "";
  if (status === "Out" || status === "IR") return "text-blood";
  return "text-[#ffb347]";
}

export function PlayerCard({
  player,
  slot,
  p10,
  p50,
  p90,
}: {
  player?: Player | null;
  slot: string;
  p10?: number | null;
  p50?: number | null;
  p90?: number | null;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-stroke bg-bg/70 px-3 py-2">
      <span className={`display min-w-11 rounded px-1.5 py-1 text-center text-[11px] ${POSITION_TONES[slot] ?? POSITION_TONES[player?.position ?? ""] ?? "bg-turf text-clay"}`}>
        {slot}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-clay">
          {player?.full_name ?? "Empty"}
        </p>
        <p className="text-xs text-muted">
          {player?.nfl_team ?? "FA"} · {player?.position ?? slot}
          {player?.injury_status ? (
            <span className={`ml-2 font-semibold ${injuryClass(player.injury_status)}`}>
              {player.injury_status}
            </span>
          ) : null}
        </p>
      </div>
      {p50 != null ? (
        <div className="text-right">
          <p className="display text-lg leading-none text-lime">{p50.toFixed(1)}</p>
          <p className="text-[10px] text-muted">
            {p10 != null ? p10.toFixed(1) : "—"} / {p90 != null ? p90.toFixed(1) : "—"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
