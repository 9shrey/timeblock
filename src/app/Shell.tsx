import { useEffect } from "react";
import { toast } from "sonner";
import { weekStartOf } from "@/domain/time/localDate";
import { DayView } from "@/features/day/DayView";
import { BudgetPanel } from "@/features/goals/BudgetPanel";
import { GoalsView } from "@/features/goals/GoalsView";
import { ReviewView } from "@/features/review/ReviewView";
import { SettingsView } from "@/features/settings/SettingsView";
import { WeekView } from "@/features/week/WeekView";
import { ensureWeeksAround, useStore } from "@/state/store";
import { closeEditor, useUi } from "@/state/ui";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { useShortcuts } from "./shortcuts";

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
    ensureWeeksAround(weekStartOf(cursor, weekStartDay)).catch((e: unknown) =>
      toast.error("Couldn't load this week", {
        id: "week-load",
        description: `${e instanceof Error ? e.message : String(e)}. Navigate again to retry.`,
      }),
    );
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
          {view === "review" && <ReviewView />}
          {view === "settings" && <SettingsView />}
        </main>
      </div>
      {budgetOpen && <BudgetPanel />}
    </div>
  );
}
