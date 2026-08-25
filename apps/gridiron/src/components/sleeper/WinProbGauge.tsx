export function WinProbGauge({
  label,
  value,
  note,
}: {
  label: string;
  value?: number | null;
  note?: string;
}) {
  const pct = value == null ? null : Math.round(value * 100);
  return (
    <div className="rounded-2xl border border-stroke bg-card p-5">
      <p className="display text-xs text-muted">{label}</p>
      <p className="display mt-2 text-5xl text-lime tabular-nums">{pct == null ? "—" : `${pct}%`}</p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-turf">
        <div className="h-full bg-lime transition-[width] duration-500" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <p className="mt-3 text-xs text-muted">
        {note
          ? note
          : pct == null
            ? "No matchup to simulate yet."
            : "2,000-game skew-normal simulation of this week's starters."}
      </p>
    </div>
  );
}
