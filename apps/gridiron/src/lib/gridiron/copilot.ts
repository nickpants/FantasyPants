import type { CopilotResult, LineupResponse, RosterFlag, TradeGradeResponse } from "@/lib/types";

const FLOOR_SYSTEM = `You are the Floor Conservator on GridironAI, a Sleeper start/sit specialist.
Prioritize high-floor, high-volume players (P10 / P50). Prefer snap-secure RBs, alpha WRs, and avoid boom/bust dart throws.
Sit DNP / Limited practice tags unless the slot is empty. Discount Questionable without Friday FP.
Use implied team totals: low implied = safer volume, not shootout darts.
Prefer easier opponent D (high FPA rank) when floors are close.
Be specific: name Sleeper slots (FLEX, SUPER_FLEX, etc.) and who to START vs SIT.
Keep it under 180 words. No preamble.`;

const CEILING_SYSTEM = `You are the Ceiling Gambler on GridironAI, a Sleeper start/sit specialist.
Prioritize P90 upside: implied team totals over 25, outdoor wind under 10, leverage when the user is an underdog.
Name the Vegas total / spread when you pivot FLEX. Avoid DNP regardless of ceiling.
Be specific about FLEX / SUPER_FLEX and who to START vs SIT for tournament variance.
Keep it under 180 words. No preamble.`;

const INJURY_SYSTEM = `You are the Injury & Beat Agent on GridironAI.
Use practice designations (FP / LP / DNP), Sleeper injury_status, body part, and beat notes.
Flag Sleeper IR/taxi lockouts. Call out roster-freeze risk if an ineligible player is sitting in IR.
Quote a beat note when it changes the start/sit (cleared vs held out).
Keep it under 160 words. No preamble.`;

const TRADE_SYSTEM = `You are the Trade Arbiter on GridironAI.
Judge a proposed Sleeper trade for THIS user's rest-of-season win probability, not "fairness" in a vacuum.
Call out: P50 delta, ceiling you are selling, injury/IR risk on either side, and leftover FAAB.
End with ACCEPT, REJECT, or COUNTER and one concrete counter if needed.
Keep it under 160 words. No preamble.`;

const MASTER_TRADE_SYSTEM = `You are the Sleeper Assistant Head Coach on GridironAI, ruling on a trade.
Synthesize Floor, Ceiling, Injury, and the Trade Arbiter into ONE decision: ACCEPT, REJECT, or COUNTER.
If win probability < 42%, you may pay a P50 premium for ceiling. If > 58%, do not smash your floor.
Never accept a player the Injury Agent flags as Out/IR without a contingency.
End with 3 bullets. Keep it under 200 words.`;

const MASTER_SYSTEM = `You are the Sleeper Assistant Head Coach on GridironAI.
Synthesize the Floor Conservator, Ceiling Gambler, and Injury Agent into ONE lineup decision.

Rules:
1. Clearly specify who to START and who to SIT for specific Sleeper slots.
2. If win probability < 42%, favor Ceiling. If > 58%, favor Floor. Otherwise blend, still pick one lineup.
3. Never start a player the Injury Agent says is Out/IR unless there is no alternative. Never start a BYE. Never move a LOCKED starter or promote a LOCKED bench player.
4. End with a 3-bullet action list.
Keep it under 220 words.`;

function coachBias(wp?: number | null) {
  if (wp == null) return "balanced";
  if (wp < 0.42) return "ceiling";
  if (wp > 0.58) return "floor";
  return "balanced";
}

function slotLine(slot: {
  slot: string;
  player: {
    full_name?: string;
    position?: string;
    nfl_team?: string | null;
    p10?: number;
    p50?: number;
    mu?: number;
    p90?: number;
    injury_status?: string | null;
    practice_status?: string | null;
    beat_note?: string | null;
    implied_total?: number | null;
    opponent?: string | null;
    wind?: number | null;
    bye?: boolean;
    locked?: boolean;
    kickoff_label?: string | null;
    opp_mult?: number;
    def_mult?: number;
    def_rank?: number | null;
    target_share?: number | null;
    rush_share?: number | null;
    pass_share?: number | null;
  } | null;
}) {
  const player = slot.player;
  if (!player) return `${slot.slot}: empty`;
  const lock = player.bye ? " BYE" : player.locked ? " LOCKED" : player.kickoff_label ? ` ${player.kickoff_label}` : "";
  const game = player.bye
    ? ""
    : player.opponent
      ? ` vs ${player.opponent} implied=${player.implied_total ?? "?"} wind=${player.wind ?? "n/a"} D=${player.def_rank ?? "n/a"} (${player.def_mult ?? 1})`
      : "";
  const vol =
    player.position === "QB" && player.pass_share != null
      ? ` att=${Math.round(player.pass_share > 1 ? player.pass_share : player.pass_share * 100)}%`
      : player.target_share != null
        ? ` tgt=${Math.round(player.target_share > 1 ? player.target_share : player.target_share * 100)}%`
        : player.rush_share != null
          ? ` rush=${Math.round(player.rush_share > 1 ? player.rush_share : player.rush_share * 100)}%`
          : "";
  const note = player.beat_note ? ` note=${player.beat_note.slice(0, 120)}` : "";
  return `${slot.slot}: ${player.full_name} (${player.position}, ${player.nfl_team}) P10=${player.p10} P50=${player.p50 ?? player.mu} P90=${player.p90} ${player.injury_status || "Healthy"} ${player.practice_status || "no-prac"}${lock}${game}${vol}${note}`;
}

type Packed = {
  topic: "lineup" | "trade";
  text: string;
  bias: string;
  win_probability?: number | null;
  flags: RosterFlag[];
  remaining_faab?: number | null;
  trade?: TradeGradeResponse;
  current: LineupResponse["current"];
  swaps: LineupResponse["swaps"];
};

function packLineup(lineup: LineupResponse, flags: RosterFlag[], question?: string): Packed {
  const wp = lineup.opponent?.win_probability;
  const bias = coachBias(wp);
  const swaps = (lineup.swaps || []).map(
    (swap) => `Sit ${swap.sit?.full_name}, start ${swap.start?.full_name} at ${swap.slot} (${swap.delta_p50} P50)`,
  );
  const lines = [
    `League ${lineup.league_id} roster ${lineup.roster_id} (${lineup.team_name})`,
    `Season ${lineup.season} week ${lineup.week} · ${lineup.scoring_summary}`,
    `Current team P10/P50/P90: ${lineup.current.p10}/${lineup.current.p50}/${lineup.current.p90}`,
    `Optimal P50 lineup: ${lineup.optimal.p10}/${lineup.optimal.p50}/${lineup.optimal.p90}`,
    `Win probability (current): ${wp == null ? "n/a" : Math.round(wp * 100)}%`,
    `Optimal win probability: ${lineup.opponent?.optimal_win_probability == null ? "n/a" : Math.round(lineup.opponent.optimal_win_probability * 100)}%`,
    `Opponent: ${lineup.opponent?.team_name} P50=${lineup.opponent?.p50}`,
    `Coach bias: ${bias}`,
    `Locks: ${lineup.locks?.next_label ?? "none upcoming"} · locked=${lineup.locks?.locked_count ?? 0} bye=${lineup.locks?.bye_count ?? 0}`,
    "Vegas slate:",
    ...(lineup.slate?.length
      ? lineup.slate.slice(0, 12).map((g) => {
          const side = g.home ? "home" : "away";
          return `${g.team} ${side} vs ${g.opponent} spread=${g.spread} O/U=${g.total} implied=${g.implied} ${g.roof || ""} wind=${g.wind ?? "n/a"} (${g.source})`;
        })
      : ["No Vegas/nflverse rows for this week yet."]),
    "Current starters:",
    ...lineup.current.slots.map(slotLine),
    "Optimizer starters:",
    ...lineup.optimal.slots.map(slotLine),
    "Suggested swaps:",
    ...(swaps.length ? swaps : ["None — current matches P50 optimal."]),
    "IR / taxi flags:",
    ...(flags.length ? flags.map((f) => f.detail) : ["None reported."]),
  ];
  if (question) lines.push(`User question: ${question}`);
  return {
    topic: "lineup",
    text: lines.join("\n"),
    bias,
    win_probability: wp,
    flags,
    current: lineup.current,
    swaps: lineup.swaps,
  };
}

function packTrade(grade: TradeGradeResponse, flags: RosterFlag[], wp?: number | null, remainingFaab?: number | null, question?: string): Packed {
  const bias = coachBias(wp);
  const give = grade.give.map((p) => `${p.full_name} (${p.position}, P50=${p.p50})`).join(", ") || "(empty)";
  const receive = grade.receive.map((p) => `${p.full_name} (${p.position}, P50=${p.p50})`).join(", ") || "(empty)";
  const lines = [
    "TRADE PROPOSAL",
    `You SEND: ${give}`,
    `You GET: ${receive}`,
    `P50 delta: ${grade.delta} (${grade.grade})`,
    `Win probability: ${wp == null ? "n/a" : Math.round(wp * 100)}%`,
    `Remaining FAAB: ${remainingFaab ?? "n/a"}`,
    "IR / taxi flags:",
    ...(flags.length ? flags.map((f) => f.detail) : ["None reported."]),
  ];
  if (question) lines.push(`User question: ${question}`);
  return {
    topic: "trade",
    text: lines.join("\n"),
    bias,
    win_probability: wp,
    flags,
    remaining_faab: remainingFaab,
    trade: grade,
    current: { slots: [], p10: 0, p50: 0, p90: 0 },
    swaps: [],
  };
}

function names(slots: LineupResponse["current"]["slots"]) {
  return slots
    .filter((s) => s.player?.full_name)
    .map((s) => `${s.player!.full_name} (${s.slot})`);
}

function floorBrief(ctx: Packed) {
  const safest = [...ctx.current.slots]
    .filter((s) => s.player && s.player.p10 != null)
    .sort((a, b) => (b.player?.p10 || 0) - (a.player?.p10 || 0))
    .slice(0, 3);
  const listed = names(safest).join(", ") || "your high-volume starters";
  const dnp = ctx.current.slots.filter((s) => s.player?.practice_status === "DNP").map((s) => s.player!.full_name);
  const sit = dnp.length ? ` Sit DNP: ${dnp.join(", ")}.` : "";
  return `Floor Conservator: Protect the median. I would keep ${listed} locked in. Chase volume over splash plays in FLEX.${sit} Sit anyone whose P10 is near zero, who is Questionable without FP, or who is in a sub-20 implied total unless they are the volume back.`;
}

function ceilingBrief(ctx: Packed) {
  const swaps = ctx.swaps || [];
  let move =
    "The P50 sheet is already maxed; look at P90 on the FLEX for a smash-game pivot.";
  if (swaps.length) {
    const best = swaps.reduce((a, b) => (a.delta_p50 > b.delta_p50 ? a : b));
    move = `Sit ${best.sit?.full_name} and start ${best.start?.full_name} at ${best.slot} for +${best.delta_p50} P50, and more importantly P90 leverage.`;
  }
  const shoot = [...ctx.current.slots]
    .filter((s) => (s.player?.implied_total || 0) >= 25)
    .map((s) => `${s.player!.full_name} (${s.player!.implied_total} imp)`);
  const underdog = ctx.win_probability != null && ctx.win_probability < 0.42;
  const posture = underdog
    ? "We are an underdog, so variance is a feature."
    : "We can still take a calculated dart in FLEX.";
  const env = shoot.length ? ` Shootouts: ${shoot.slice(0, 3).join(", ")}.` : "";
  return `Ceiling Gambler: ${posture} ${move}${env} I want the highest implied-total FLEX even if it dents P10, unless they are DNP.`;
}

function injuryBrief(ctx: Packed) {
  const injured = ctx.current.slots
    .filter((s) => s.player && (s.player.injury_status || s.player.practice_status))
    .map((s) => {
      const p = s.player!;
      const prac = p.practice_status ? ` ${p.practice_status}` : "";
      const note = p.beat_note ? ` — ${p.beat_note.slice(0, 90)}` : "";
      return `${p.full_name} (${p.injury_status || "Healthy"}${prac}) in ${s.slot}${note}`;
    });
  const parts: string[] = [];
  if (ctx.flags.length) parts.push("LOCKOUT: " + ctx.flags.map((f) => f.detail).join("; "));
  if (injured.length) parts.push("Start/sit medicals: " + injured.join("; ") + ".");
  if (!parts.length) return "Injury Agent: No IR/taxi lockouts and no Out/IR starters. Clear to set the lineup.";
  return "Injury Agent: " + parts.join(" ");
}

function tradeBrief(ctx: Packed) {
  const trade = ctx.trade;
  if (!trade) return "";
  const give = trade.give.map((p) => p.full_name).join(", ") || "nothing";
  const receive = trade.receive.map((p) => p.full_name).join(", ") || "nothing";
  const extra = ctx.remaining_faab != null ? ` You have $${ctx.remaining_faab} FAAB left.` : "";
  let call = "COUNTER — value is close; ask for a dart or $FAAB.";
  if (trade.delta >= 1.5) call = "ACCEPT — you are buying weekly points.";
  else if (trade.delta <= -1.5) call = "REJECT — you are selling the middle of your roster.";
  return `Trade Arbiter: Send ${give} for ${receive}. Sheet says ${trade.grade} (${trade.delta >= 0 ? "+" : ""}${trade.delta.toFixed(1)} P50).${extra} ${call}`;
}

function masterBrief(ctx: Packed, floor: string, ceiling: string, injury: string) {
  let lean =
    "This is a coin-flip matchup. I am taking the optimizer's P50 swaps unless Injury vetoes them.";
  let useSwaps = ctx.swaps;
  if (ctx.bias === "ceiling") {
    lean = "Win probability is under 42%. I am taking the Ceiling Gambler's FLEX upside.";
  } else if (ctx.bias === "floor") {
    lean = "Win probability is over 58%. I am siding with the Floor Conservator and the safer P10.";
    useSwaps = [];
  }
  const flagBlob = ctx.flags.map((f) => f.detail).join(" ");
  useSwaps = useSwaps.filter((swap) => !flagBlob.includes(swap.start?.full_name || "___"));
  const bullets: string[] = [];
  if (useSwaps.length) {
    for (const swap of useSwaps.slice(0, 4)) {
      bullets.push(`START ${swap.start?.full_name} over ${swap.sit?.full_name} at ${swap.slot}.`);
    }
  } else {
    bullets.push("Hold current starters — do not donate P10 for fireworks.");
  }
  if (ctx.flags.length) bullets.push("Move ineligible IR/taxi players before any add, or Sleeper will freeze the roster.");
  bullets.push("Re-check Friday practice tags before lock.");
  return `Head Coach: ${lean}\n\n${bullets.map((b) => `- ${b}`).join("\n")}\n\nFloor said: ${floor.slice(0, 120)}…\nCeiling said: ${ceiling.slice(0, 120)}…\n${injury.slice(0, 160)}`;
}

function masterTradeBrief(ctx: Packed, floor: string, ceiling: string, injury: string, trade: string) {
  const delta = ctx.trade?.delta ?? 0;
  const wp = ctx.win_probability;
  let ruling = "COUNTER";
  let why = "Close. Come back with a bench dart or FAAB on top.";
  if (wp != null && wp < 0.42 && delta >= -1) {
    ruling = "ACCEPT";
    why = "We are an underdog. I will pay a little P50 to buy a higher ceiling.";
  } else if (delta >= 1.5) {
    ruling = "ACCEPT";
    why = "The Trade Arbiter has the points. Take them.";
  } else if (delta <= -2) {
    ruling = "REJECT";
    why = "This punches a hole in the floor without enough return.";
  }
  return `Head Coach: ${ruling}. ${why}\n\n- Arbiter: ${trade.slice(0, 140)}\n- Floor: ${floor.slice(0, 100)}\n- Ceiling: ${ceiling.slice(0, 100)}\n- Injury: ${injury.slice(0, 100)}`;
}

async function complete(system: string, user: string, maxTokens = 400) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("AI is not available");
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`xAI API error ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (body.choices?.[0]?.message?.content || "").trim();
}

async function specialist(system: string, packed: Packed, fallback: (ctx: Packed) => string) {
  if (!process.env.XAI_API_KEY) return fallback(packed);
  try {
    return await complete(system, packed.text);
  } catch (err) {
    return `${fallback(packed)}\n(LLM fallback: ${err instanceof Error ? err.message : "failed"})`;
  }
}

export function copilotConfigured() {
  return Boolean(process.env.XAI_API_KEY);
}

export async function runDebate(input: {
  lineup: LineupResponse;
  flags?: RosterFlag[];
  question?: string;
  trade?: TradeGradeResponse;
  remainingFaab?: number | null;
  useGrok?: boolean;
}): Promise<CopilotResult> {
  const packed = input.trade
    ? packTrade(input.trade, input.flags || [], input.lineup.opponent?.win_probability, input.remainingFaab, input.question)
    : packLineup(input.lineup, input.flags || [], input.question);
  const configured = copilotConfigured();
  const wantLlm = Boolean(input.useGrok && configured);
  const source = wantLlm ? "grok-4.5" : "heuristic";

  let floor: string;
  let ceiling: string;
  let injury: string;
  let trade = "";
  if (wantLlm) {
    const jobs: Promise<string>[] = [
      specialist(FLOOR_SYSTEM, packed, floorBrief),
      specialist(CEILING_SYSTEM, packed, ceilingBrief),
      specialist(INJURY_SYSTEM, packed, injuryBrief),
    ];
    if (packed.topic === "trade") jobs.push(specialist(TRADE_SYSTEM, packed, tradeBrief));
    const results = await Promise.all(jobs);
    floor = results[0];
    ceiling = results[1];
    injury = results[2];
    trade = results[3] || "";
  } else {
    floor = floorBrief(packed);
    ceiling = ceilingBrief(packed);
    injury = injuryBrief(packed);
    trade = packed.topic === "trade" ? tradeBrief(packed) : "";
  }

  let master: string;
  if (wantLlm) {
    const user =
      packed.text +
      "\n\nFloor Conservator:\n" +
      floor +
      "\n\nCeiling Gambler:\n" +
      ceiling +
      "\n\nInjury Agent:\n" +
      injury +
      "\n\nTrade Arbiter:\n" +
      trade +
      `\n\nBias instruction: ${packed.bias}`;
    try {
      master = await complete(packed.topic === "trade" ? MASTER_TRADE_SYSTEM : MASTER_SYSTEM, user, 500);
    } catch {
      master =
        packed.topic === "trade"
          ? masterTradeBrief(packed, floor, ceiling, injury, trade)
          : masterBrief(packed, floor, ceiling, injury);
    }
  } else {
    master =
      packed.topic === "trade"
        ? masterTradeBrief(packed, floor, ceiling, injury, trade)
        : masterBrief(packed, floor, ceiling, injury);
  }

  return {
    configured,
    model: "grok-4.5",
    source,
    bias: packed.bias,
    agents: {
      floor,
      ceiling,
      injury,
      ...(trade ? { trade } : {}),
      master,
    },
  };
}
