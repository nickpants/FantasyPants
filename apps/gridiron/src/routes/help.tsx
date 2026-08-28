import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { injuryMultiplier } from "@/lib/gridiron/engine";
import type { PracticeTag } from "@/lib/types";
import {
  BookOpen,
  ClipboardList,
  Dices,
  Gauge,
  ShieldAlert,
  Swords,
  Trophy,
  Wallet,
} from "lucide-react";

export const Route = createFileRoute("/help")({ component: PlaybookPage });

const TOC = [
  { href: "#use", label: "How to use it" },
  { href: "#numbers", label: "The numbers" },
  { href: "#rankings", label: "How rankings are built" },
  { href: "#injury", label: "Injury & practice" },
  { href: "#lineup", label: "Start / sit" },
  { href: "#waivers", label: "FAAB & waivers" },
  { href: "#draft", label: "Draft board" },
  { href: "#limits", label: "What it will not do" },
] as const;

const VOLATILITY = [
  { pos: "QB", sigma: "32%", skew: "low", note: "Most week-to-week stable" },
  { pos: "RB", sigma: "40%", skew: "medium", note: "Goal-line spikes" },
  { pos: "WR", sigma: "45%", skew: "high", note: "Fattest boom tail" },
  { pos: "TE", sigma: "42%", skew: "high", note: "Boom if targeted" },
  { pos: "K", sigma: "50%", skew: "low", note: "Noisy, not skewed" },
  { pos: "DEF", sigma: "55%", skew: "medium", note: "Widest spread" },
] as const;

const INJURY_STATUSES = [
  { label: "Healthy", status: null },
  { label: "Questionable", status: "Questionable" },
  { label: "Doubtful", status: "Doubtful" },
] as const;

const PRACTICE: { label: string; tag: PracticeTag | null }[] = [
  { label: "None", tag: null },
  { label: "FP", tag: "FP" },
  { label: "LP", tag: "LP" },
  { label: "DNP", tag: "DNP" },
];

function fmtMult(n: number) {
  return n.toFixed(2);
}

function PlaybookPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link to="/" className="display text-sm text-lime">
        ← Home
      </Link>
      <header className="mt-4 max-w-3xl">
        <p className="display text-sm text-lime">GridironAI playbook</p>
        <h1 className="display mt-2 text-5xl text-balance text-clay md:text-7xl">
          Call the play.
          <span className="block text-lime">Trust the sheet.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-pretty text-lg text-muted">
          Connect a public Sleeper username. We score every player with{" "}
          <em className="text-clay not-italic">your</em> league settings, then
          simulate two thousand weeks so start/sit, FAAB, trades, and the draft
          board speak the same language.
        </p>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[220px_1fr]">
        <nav className="lg:sticky lg:top-6 lg:self-start">
          <p className="display mb-3 text-xs text-muted">On this page</p>
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:grid lg:overflow-visible">
            {TOC.map((item) => (
              <li key={item.href} className="shrink-0">
                <a
                  href={item.href}
                  className="display block min-h-11 rounded-lg border border-stroke px-3 py-2 text-sm text-clay hover:border-lime"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-16">
          <section id="use" className="scroll-mt-8">
            <SectionHead
              icon={ClipboardList}
              kicker="01"
              title="How to use it"
            />
            <ol className="mt-6 grid gap-4">
              <Step n="1" title="Connect">
                Enter your Sleeper username. No password — we only read public
                leagues for the current NFL season.
              </Step>
              <Step n="2" title="Pick a league">
                The locker room lists every public league on that account, with
                season, team count, and scoring (PPR, TE premium, pass TD).
                Open one.
              </Step>
              <Step n="3" title="Work the week">
                Use the tabs in this order when you are setting a lineup: Roster
                → Desk → Start / Sit → Matchup. The desk is Friday’s injury
                report and Sunday’s inactive list. FLEX math comes after. Use FAAB, Trades, and Draft when
                the calendar asks for them.
              </Step>
            </ol>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <ToolCard
                icon={ShieldAlert}
                title="Roster"
                body="Every team in the league. IR and taxi flags show if someone is illegally occupying a slot."
              />
              <ToolCard
                icon={ShieldAlert}
                title="Desk"
                body="Friday injury report and Sunday inactives for your roster. Questionable/Doubtful, FP/LP/DNP, sit-unless-FP-by-4pm, then 90-minute inactives with the handcuff."
              />
              <ToolCard
                icon={Gauge}
                title="Start / Sit"
                body="Your current lineup vs the optimal P50 lineup. Swaps are the only moves that change the median."
              />
              <ToolCard
                icon={Swords}
                title="Matchup"
                body="Pregame, live, or final. Win probability updates as actual points land and leftover projection shrinks."
              />
              <ToolCard
                icon={Wallet}
                title="FAAB"
                body="Remaining budgets plus recommended conservative / fair / aggressive bids on the best available adds."
              />
              <ToolCard
                icon={Trophy}
                title="Trades"
                body="Pick chips on both sides. Grade is rest-of-week P50, not “fair value” in a vacuum."
              />
              <ToolCard
                icon={Dices}
                title="Draft"
                body="Live board, who is on the clock, remaining starter holes, and a “take these” list that fills those holes before chasing extra WR depth."
              />
            </div>
          </section>

          <section id="numbers" className="scroll-mt-8">
            <SectionHead icon={BookOpen} kicker="02" title="The numbers" />
            <p className="mt-4 text-pretty text-muted">
              Every ranking in the app is a percentile of simulated fantasy
              points in <em className="text-clay not-italic">this</em> league.
              The big lime number on a player card is P50.
            </p>
            <RangeViz />
            <dl className="mt-6 grid gap-3 sm:grid-cols-2">
              <Term name="P50 (median)">
                The typical week. Half the simulations score less, half score
                more. Start/sit and trades optimize this unless you are a big
                underdog.
              </Term>
              <Term name="P10 (floor)">
                A down week — only 10% of simulations score worse. The Floor
                Conservator lives here.
              </Term>
              <Term name="P90 (ceiling)">
                A smash week — only 10% score better. Chase this in FLEX when
                win probability is under 42%.
              </Term>
              <Term name="Implied total">
                Vegas team points: (over/under ± spread) / 2. Shootouts lift
                passing games; low implied totals favor volume backs.
              </Term>
              <Term name="Opponent D">
                Fantasy points that defense has allowed to this position, vs
                league average. Rank 1 is the easiest matchup (most points
                allowed). Weeks 1–4 use last season; after that, 70/30. Weighted
                at 55% so it does not double-count Vegas implied totals.
              </Term>
              <Term name="Opportunity">
                Target share, rush share, and pass share from the last six
                games. Weeks 1–4 lean on last season; after that, 70% this
                year / 30% last year. It scales µ, not a separate ranking.
              </Term>
              <Term name="Kickoff lock">
                Once a game starts, that player is frozen. Locked starters stay
                in their slot. Locked bench cannot be started. Bye weeks sit
                automatically.
              </Term>
              <Term name="Win probability">
                Share of 2,000 paired simulations where your starters beat
                theirs. Live games replace projection with actual + leftover.
              </Term>
              <Term name="RLD">
                Replacement-level delta. How many P50 points a free agent is
                worth above the next wire player at that position and your
                worst rostered starter.
              </Term>
            </dl>
          </section>

          <section id="rankings" className="scroll-mt-8">
            <SectionHead
              icon={Dices}
              kicker="03"
              title="How rankings are generated"
            />
            <p className="mt-4 text-pretty text-muted">
              Rankings are not a downloaded expert sheet. They are rebuilt for
              your league every time you open a tool.
            </p>

            <ol className="mt-6 space-y-8">
              <RankStep n="1" title="Score the projection in your rules">
                <p>
                  Sleeper publishes a stat line for each player (pass yards,
                  receptions, TDs, sacks, and so on). We multiply every stat by
                  the matching key in your league’s{" "}
                  <code className="text-lime">scoring_settings</code> and sum
                  it. Full PPR, half PPR, TE premium, 6-point passing TDs, IDP
                  — if Sleeper stores the multiplier, we use it. Generic
                  “PPR rank” is ignored.
                </p>
                <WorkedExample />
              </RankStep>

              <RankStep n="2" title="Haircut injuries and practice">
                <p>
                  Out, IR, PUP, and Suspended go to zero and cannot be started.
                  Questionable and Doubtful are scaled by this week’s practice
                  tag (full / limited / DNP) from nflverse, with ESPN beat
                  notes when they exist. Friday full practice almost restores a
                  Questionable player; a DNP tanks them.
                </p>
              </RankStep>

              <RankStep n="3" title="Scale the game environment">
                <p>
                  Implied team total is compared to 22.5 points. Passing games
                  (WR, then QB/TE) move more than RBs. Defenses get the inverse.
                  Outdoor wind at 15+ mph cuts pass catchers and kickers, and
                  slightly helps RBs and DST. Missing Vegas rows skip this step
                  instead of guessing.
                </p>
              </RankStep>

              <RankStep n="4" title="Scale opponent defense">
                <p>
                  After the game environment, µ is multiplied by how that
                  defense actually scores against this position (nflverse PPR
                  fantasy points allowed). A WR facing a unit that has allowed
                  20% more than average to WRs gets a bump; a tough run D
                  haircuts RBs. The index is clamped and weighted at 55% so it
                  does not stack on top of implied total. Rank 1 = easiest
                  (most points allowed). Missing sample leaves the multiplier
                  at 1.00.
                </p>
              </RankStep>

              <RankStep n="5" title="Scale opportunity">
                <p>
                  µ is then multiplied by usage. WR vs 20% target share, TE vs
                  14%, RB a mix of 42% rush share and 8% target share, QB vs 92%
                  of team attempts. The bump is clamped 0.55–1.18 and weighted
                  65% in weeks 1–4 (when last year is the only honest sample)
                  and 40% after. Missing gsis rows leave the multiplier at 1.00.
                  Bye weeks zero the player instead.
                </p>
              </RankStep>

              <RankStep n="6" title="Roll 2,000 weeks">
                <p>
                  The adjusted median becomes µ. Spread (σ) and skew are
                  position-specific: wide receivers boom and bust more than
                  quarterbacks. We draw a skew-normal sample 2,000 times,
                  never below zero, and read P10 / P50 / P90 off the sorted
                  scores. High implied totals fatten WR/QB variance on purpose.
                </p>
                <div className="mt-4 overflow-x-auto rounded-2xl border border-stroke">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-turf text-muted">
                      <tr>
                        <th className="px-3 py-2">Pos</th>
                        <th className="px-3 py-2">Volatility</th>
                        <th className="px-3 py-2">Skew</th>
                        <th className="px-3 py-2">Read</th>
                      </tr>
                    </thead>
                    <tbody>
                      {VOLATILITY.map((row) => (
                        <tr key={row.pos} className="border-t border-stroke">
                          <td className="px-3 py-2">
                            <span className={`display rounded px-1.5 text-xs pos-${row.pos.toLowerCase()}`}>
                              {row.pos}
                            </span>
                          </td>
                          <td className="px-3 py-2 tabular-nums text-clay">{row.sigma}</td>
                          <td className="px-3 py-2 text-clay">{row.skew}</td>
                          <td className="px-3 py-2 text-muted">{row.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </RankStep>

              <RankStep n="7" title="Rank from that distribution">
                <p>
                  Start/sit ranks by lineup P50. Waivers rank by RLD, then P50.
                  Draft ranks remaining starter holes first, then VOR — K/DEF
                  wait until late. Trades rank by receive P50 minus give P50.
                  Same engine, different question.
                </p>
              </RankStep>
            </ol>

            <p className="mt-6 text-sm text-muted">
              Stat source is Sleeper weekly projections. If that feed is thin
              (preseason, week not posted), we fall back to season stats divided
              by games played. The subtitle on each page tells you which one
              you are looking at.
            </p>
          </section>

          <section id="injury" className="scroll-mt-8">
            <SectionHead
              icon={ShieldAlert}
              kicker="04"
              title="Injury & practice multipliers"
            />
            <p className="mt-4 text-pretty text-muted">
              These are applied to the raw scored projection before simulation.
              Out / IR / PUP / Suspended always score 0.00.
            </p>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-stroke">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-turf text-muted">
                  <tr>
                    <th className="px-3 py-2">Sleeper status</th>
                    {PRACTICE.map((col) => (
                      <th key={col.label} className="px-3 py-2">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {INJURY_STATUSES.map((row) => (
                    <tr key={row.label} className="border-t border-stroke">
                      <td className="px-3 py-2 text-clay">{row.label}</td>
                      {PRACTICE.map((col) => {
                        const v = injuryMultiplier(row.status, col.tag);
                        return (
                          <td
                            key={col.label}
                            className={`px-3 py-2 tabular-nums ${
                              v < 0.5 ? "text-blood" : v < 0.9 ? "text-sky" : "text-lime"
                            }`}
                          >
                            {fmtMult(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="border-t border-stroke">
                    <td className="px-3 py-2 text-clay">Out / IR / PUP</td>
                    {PRACTICE.map((col) => (
                      <td key={col.label} className="px-3 py-2 tabular-nums text-blood">
                        0.00
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-muted">
              Chips on a card: FP = full, LP = limited, DNP = did not practice.
              The Desk tab turns that table into a call: Questionable sits unless
              Friday full practice posts by 4pm ET. Doubtful sits. Out is out.
              Sunday games use Friday 4pm; Monday games Saturday 4pm; Thursday
              night uses Wednesday 4pm. Official inactives post 90 minutes
              before kickoff — Desk’s Sunday section sits the inactive and
              names the handcuff (your bench, the wire, or already owned).
            </p>
          </section>

          <section id="lineup" className="scroll-mt-8">
            <SectionHead icon={Gauge} kicker="05" title="Start / sit solver" />
            <p className="mt-4 text-pretty text-muted">
              We do not greedily fill WR then dump leftovers into FLEX. Every
              eligible player is assigned to every legal slot (FLEX, WRRB, REC,
              SUPER_FLEX) with a Hungarian max-P50 solver so a dual-eligible
              back does not steal a WR slot that a specialist needed.
            </p>
            <ul className="mt-4 grid gap-2 text-clay">
              <li>
                <span className="text-lime">Moves</span> only appear when sitting
                one player and starting another raises team P50.
              </li>
              <li>
                <span className="text-lime">Staff debate</span> is three voices
                plus a Head Coach: Floor (P10), Ceiling (P90), Injury. If your
                win probability is under 42% the coach leans ceiling; over 58%
                it protects the floor.
              </li>
              <li>
                Empty slots, Out/IR, and bye-week players are ineligible. The
                solver will never recommend them.
              </li>
              <li>
                <span className="text-lime">Kickoff lock</span> freezes anyone
                whose game has started. Locked starters stay in that slot;
                locked bench cannot be promoted. The banner counts down to the
                next lock.
              </li>
            </ul>
          </section>

          <section id="waivers" className="scroll-mt-8">
            <SectionHead icon={Wallet} kicker="06" title="FAAB bids" />
            <p className="mt-4 text-pretty text-muted">
              Available players are scored the same way as your roster. RLD is
              the better of (their P50 − best remaining free agent at the
              position) and (their P50 − your worst rostered player at that
              position). Then:
            </p>
            <div className="mt-4 rounded-2xl border border-stroke bg-card p-5 text-sm text-clay">
              <p className="display text-lime">Bid = remaining FAAB × season value</p>
              <p className="mt-2 text-pretty text-muted">
                Season value is RLD × weeks left (capped at 12), divided by 40
                and clipped at 100%. Conservative spends 40% of that, fair 70%,
                aggressive 95%. We leave $1 on the table unless the add is a
                must-have. Rolling-waiver leagues still rank the wire; they
                just will not show dollar bids.
              </p>
            </div>
            <p className="mt-4 text-pretty text-muted">
              Trades use the same P50: steal (≥ +4), win (≥ +1.5), fair, loss,
              lopsided (≤ −4). Grade your own rest-of-week points, not whether
              the other manager “won.”
            </p>
          </section>

          <section id="draft" className="scroll-mt-8">
            <SectionHead icon={Trophy} kicker="07" title="Draft ranking" />
            <p className="mt-4 text-pretty text-muted">
              Remaining starter holes (QB, RB, WR, TE, FLEX, SUPER_FLEX) jump the
              queue. Kickers and DST stay on ice until skill spots are filled or
              you are in the last two rounds. After that, value over replacement
              and one RB/WR backup still matter. Your completed picks are graded
              against best player available at the moment you clicked — 0.0 is
              BPA, negative means you reached.
            </p>
          </section>

          <section id="limits" className="scroll-mt-8">
            <SectionHead icon={ShieldAlert} kicker="08" title="What it will not do" />
            <ul className="mt-4 grid gap-2 text-pretty text-muted">
              <li>It never submits lineups, bids, or trades to Sleeper. You still tap those in the Sleeper app.</li>
              <li>Private leagues only appear if that username’s membership is publicly readable.</li>
              <li>Simulations are a distribution, not a promise. Weather, snap counts, and blowouts still happen.</li>
              <li>If nflverse has no line for a game yet, that player is scored without a Vegas bump.</li>
              <li>Disconnect on the dashboard clears this browser session. Nothing is stored as an account.</li>
            </ul>
            <p className="mt-8">
              <Link
                to="/"
                className="display inline-flex min-h-11 items-center rounded-lg bg-lime px-5 text-ink"
              >
                Connect a username
              </Link>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

function SectionHead({
  icon: Icon,
  kicker,
  title,
}: {
  icon: typeof BookOpen;
  kicker: string;
  title: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1 flex h-10 w-10 items-center justify-center rounded-lg border border-stroke bg-card text-lime">
        <Icon size={18} strokeWidth={2} />
      </span>
      <div>
        <p className="display text-xs text-lime">{kicker}</p>
        <h2 className="display text-3xl text-balance text-clay">{title}</h2>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4 rounded-2xl border border-stroke bg-card p-4">
      <span className="display text-2xl text-lime">{n}</span>
      <div>
        <h3 className="display text-xl text-clay">{title}</h3>
        <p className="mt-1 text-pretty text-muted">{children}</p>
      </div>
    </li>
  );
}

function ToolCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof BookOpen;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-2xl border border-stroke bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-lime">
        <Icon size={16} strokeWidth={2} />
        <h3 className="display text-lg text-clay">{title}</h3>
      </div>
      <p className="text-pretty text-sm text-muted">{body}</p>
    </article>
  );
}

function Term({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-stroke bg-bg/70 p-4">
      <dt className="display text-lime">{name}</dt>
      <dd className="mt-1 text-pretty text-sm text-muted">{children}</dd>
    </div>
  );
}

function RankStep({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li>
      <h3 className="display text-xl text-clay">
        <span className="text-lime">{n}.</span> {title}
      </h3>
      <div className="mt-2 space-y-3 text-pretty text-muted">{children}</div>
    </li>
  );
}

function RangeViz() {
  return (
    <figure className="mt-6 rounded-2xl border border-stroke bg-card p-5">
      <figcaption className="display text-xs text-muted">
        Example WR · 2,000 simulated weeks
      </figcaption>
      <div className="relative mt-5 h-3 rounded-full bg-turf">
        <div className="absolute inset-y-0 left-[18%] right-[12%] rounded-full bg-lime/25" />
        <span className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 bg-sky" style={{ left: "18%" }} />
        <span className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 bg-lime" style={{ left: "48%" }} />
        <span className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 bg-blood" style={{ left: "88%" }} />
      </div>
      <div className="mt-3 flex justify-between text-xs tabular-nums">
        <span className="text-sky">P10 · 6.1</span>
        <span className="text-lime">P50 · 13.8</span>
        <span className="text-blood">P90 · 24.4</span>
      </div>
      <p className="mt-3 text-pretty text-sm text-muted">
        Same player, three answers. Start/sit uses the middle. The Floor
        Conservator uses the left. The Ceiling Gambler uses the right.
      </p>
    </figure>
  );
}

function WorkedExample() {
  return (
    <div className="mt-3 rounded-2xl border border-stroke bg-bg/70 p-4 text-sm">
      <p className="display text-xs text-lime">Worked example · full PPR WR</p>
      <ul className="mt-3 space-y-1 tabular-nums text-clay">
        <li>6 rec × 1.0 = 6.0</li>
        <li>72 rec yards × 0.1 = 7.2</li>
        <li>1 TD × 6.0 = 6.0</li>
        <li className="text-lime">Raw projection = 19.2</li>
        <li>Questionable + limited practice × 0.68 = 13.06</li>
        <li>Implied total 28.0 (WR bump) × 1.088 ≈ 14.2 µ</li>
        <li className="text-muted">Then 2,000 draws → P10 / P50 / P90 on the card</li>
      </ul>
    </div>
  );
}
