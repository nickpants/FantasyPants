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

type CardPlayer = Player & {
  implied_total?: number | null;
  opponent?: string | null;
  wind?: number | null;
  bye?: boolean;
  locked?: boolean;
  kickoff_label?: string | null;
  inactive_label?: string | null;
  designated_inactive?: boolean;
  opp_mult?: number;
  def_mult?: number;
  def_rank?: number | null;
  target_share?: number | null;
  rush_share?: number | null;
  pass_share?: number | null;
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

function fmtShare(share?: number | null) {
  if (share == null || !Number.isFinite(share)) return null;
  const pct = share > 1 ? share : share * 100;
  return `${Math.round(pct)}%`;
}

export function PlayerCard({
  player,
  slot,
  p10,
  p50,
  p90,
}: {
  player?: CardPlayer | null;
  slot: string;
  p10?: number | null;
  p50?: number | null;
  p90?: number | null;
}) {
  const bye = Boolean(player?.bye);
  const locked = Boolean(player?.locked);
  const lockLabel = bye ? "BYE" : locked ? "LOCKED" : player?.kickoff_label || null;
  const tgt = fmtShare(player?.target_share);
  const rush = fmtShare(player?.rush_share);
  const pass = fmtShare(player?.pass_share);
  const pos = player?.position;
  const opp =
    player?.opp_mult != null && Math.abs(player.opp_mult - 1) >= 0.02
      ? `×${player.opp_mult.toFixed(2)} vol`
      : null;
  const defPct =
    player?.def_mult != null && Math.abs(player.def_mult - 1) >= 0.03
      ? Math.round((player.def_mult - 1) * 100)
      : null;
  const vs = bye ? "BYE" : player?.opponent ? `vs ${player.opponent}` : "";
  const showTgt = Boolean(tgt) && (pos === "WR" || pos === "TE" || pos === "RB");
  const showRush = Boolean(rush) && pos === "RB";
  const showPass = Boolean(pass) && pos === "QB";

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border bg-bg/70 px-3 py-2 ${
        bye ? "border-stroke opacity-60" : locked ? "border-sky/50" : "border-stroke"
      }`}
    >
      <span
        className={`display min-w-11 rounded px-1.5 py-1 text-center text-xs ${POSITION_TONES[slot] ?? POSITION_TONES[player?.position ?? ""] ?? "pos-flex"}`}
      >
        {slot}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-clay">{player?.full_name ?? "Empty"}</p>
        <p className="text-xs text-muted">
          {player?.nfl_team ?? "FA"} · {player?.position ?? slot}
          {vs ? ` ${vs}` : ""}
          {player?.injury_status && !bye ? (
            <span className={`ml-2 font-semibold ${injuryClass(player.injury_status)}`}>
              {player.injury_status}
            </span>
          ) : null}
        </p>
        {player?.practice_status || player?.implied_total != null || lockLabel || player?.inactive_label || showTgt || showRush || showPass || opp || defPct != null ? (
          <p className="mt-1 flex flex-wrap gap-1">
            {lockLabel ? (
              <span
                className={`rounded border px-1.5 text-xs ${
                  bye
                    ? "border-stroke text-muted"
                    : locked
                      ? "border-sky text-sky"
                      : "border-lime text-lime"
                }`}
              >
                {lockLabel}
              </span>
            ) : null}
            {player?.practice_status ? (
              <span className={`rounded border px-1.5 text-xs ${practiceClass(player.practice_status)}`}>
                {player.practice_status}
              </span>
            ) : null}
            {player?.inactive_label ? (
              <span
                className={`rounded border px-1.5 text-xs ${
                  player.designated_inactive || player.inactive_label === "INACTIVE"
                    ? "border-blood text-blood"
                    : "border-sky text-sky"
                }`}
              >
                {player.inactive_label}
              </span>
            ) : null}
            {player?.implied_total != null && !bye ? (
              <span className="rounded border border-stroke px-1.5 text-xs text-muted">
                imp {player.implied_total.toFixed(1)}
              </span>
            ) : null}
            {showTgt ? (
              <span className="rounded border border-stroke px-1.5 text-xs text-muted">{tgt} tgt</span>
            ) : null}
            {showRush ? (
              <span className="rounded border border-stroke px-1.5 text-xs text-muted">{rush} rush</span>
            ) : null}
            {showPass ? (
              <span className="rounded border border-stroke px-1.5 text-xs text-muted">{pass} att</span>
            ) : null}
            {opp ? (
              <span className="rounded border border-stroke px-1.5 text-xs text-muted">{opp}</span>
            ) : null}
            {defPct != null ? (
              <span
                className={`rounded border px-1.5 text-xs ${
                  defPct > 0 ? "border-lime text-lime" : "border-blood text-blood"
                }`}
              >
                {defPct > 0 ? "+" : ""}
                {defPct}% D{player?.def_rank ? ` · ${player.def_rank}` : ""}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      {p50 != null ? (
        <div className="text-right tabular-nums">
          <p className={`display text-lg leading-none ${bye ? "text-muted" : "text-lime"}`}>
            {p50.toFixed(1)}
          </p>
          <p className="text-xs text-muted">
            {p10 != null ? p10.toFixed(1) : "—"} / {p90 != null ? p90.toFixed(1) : "—"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
