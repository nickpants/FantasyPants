import type { League, NflState, SleeperUser } from "./types";

const KEY = "gridiron.session";

export type Session = {
  user: SleeperUser;
  season: string;
  nfl_state: NflState;
  leagues: League[];
};

export function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function writeSession(session: Session) {
  window.localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(KEY);
}

export function avatarUrl(avatar?: string | null, thumb = true) {
  if (!avatar) return null;
  const path = thumb ? "avatars/thumbs" : "avatars";
  return `https://sleepercdn.com/${path}/${avatar}`;
}
