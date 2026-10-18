import { useEffect } from "react";
import { weekStartOf } from "@/domain/time/localDate";
import { DayView } from "@/features/day/DayView";
import { BudgetPanel } from "@/features/goals/BudgetPanel";
import { GoalsView } from "@/features/goals/GoalsView";
import { WeekView } from "@/features/week/WeekView";
import { ensureWeeksAround, useStore } from "@/state/store";
import { closeEditor, useUi } from "@/state/ui";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { useShortcuts } from "./shortcuts";

function Placeholder({ name }: { name: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{name} — coming soon</div>;
}

export function Shell() {
  const view = useStore((s) => s.view);
  const cursor = useStore((s) => s.cursor);
  const weekStartDay = useStore((s) => s.settings.weekStartDay);
  const budgetOpen = useStore((s) => s.budgetOpen);
  useShortcuts();

  // A popover or selection never outlives the day/view it belongs to.
  useEffect(() => {
    closeEditor();
    useUi.setState({ menu: null });
  }, [view, cursor]);
  useEffect(() => {
    useStore.setState({ selection: null });
  }, [view]);

  // Keep the viewed week and its neighbours loaded.
  useEffect(() => {
    void ensureWeeksAround(weekStartOf(cursor, weekStartDay));
  }, [cursor, weekStartDay]);

  // Suppress the webview's native context menu except in editable fields.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest("input, textarea, [contenteditable=true]")) e.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1">
          {view === "day" && <DayView />}
          {view === "week" && <WeekView />}
          {view === "goals" && <GoalsView />}
          {view === "review" && <Placeholder name="Weekly review" />}
          {view === "settings" && <Placeholder name="Settings" />}
        </main>
      </div>
      {budgetOpen && <BudgetPanel />}
    </div>
  );
}
