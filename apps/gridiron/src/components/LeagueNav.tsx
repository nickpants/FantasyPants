import { Link } from "@tanstack/react-router";

const LINKS = [
  { to: "/league/$leagueId", label: "Roster", exact: true },
  { to: "/league/$leagueId/desk", label: "Desk" },
  { to: "/league/$leagueId/start-sit", label: "Start / Sit" },
  { to: "/league/$leagueId/matchup", label: "Matchup" },
  { to: "/league/$leagueId/waivers", label: "FAAB" },
  { to: "/league/$leagueId/trades", label: "Trades" },
  { to: "/league/$leagueId/draft-room", label: "Draft" },
] as const;

export function LeagueNav({ leagueId, active }: { leagueId: string; active: string }) {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1">
      {LINKS.map((link) => {
        const isActive = active === link.to;
        return (
          <Link
            key={link.to}
            to={link.to}
            params={{ leagueId }}
            className={`display min-h-11 shrink-0 rounded-lg px-3 py-2 text-sm ${
              isActive ? "bg-lime text-ink" : "border border-stroke text-clay"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
      <Link
        to="/help"
        className="display min-h-11 shrink-0 rounded-lg border border-stroke px-3 py-2 text-sm text-muted hover:border-lime hover:text-lime"
      >
        Playbook
      </Link>
    </nav>
  );
}