/** Pure helpers for the desktop tray menu's "Today's next block" line. */
import { formatMinute } from "./time/localDate";
import type { Block, Goal, Now } from "./types";

const displayTitle = (title: string, goal: Goal | null) => title.trim() || goal?.name || "Untitled";

/** The running or next upcoming plan block today, for the tray menu. Null if there is none left. */
export function nextUpcomingBlock(blocks: readonly Block[], goals: Readonly<Record<string, Goal>>, now: Now): string | null {
  const candidates = blocks
    .filter((b) => b.day === now.day && b.layer === "plan" && !b.skipped && b.endMinute > now.minute)
    .sort((a, b) => a.startMinute - b.startMinute);
  const b = candidates[0];
  if (!b) return null;
  const title = displayTitle(b.title, b.goalId ? goals[b.goalId] ?? null : null);
  const when = b.startMinute <= now.minute ? "now" : formatMinute(b.startMinute);
  return `${title} · ${when}`;
}
