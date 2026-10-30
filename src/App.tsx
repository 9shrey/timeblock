import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "./app/Shell";
import { FirstSyncDialog } from "./features/account/FirstSyncDialog";
import { useStore } from "./state/store";

/** Resolved light/dark theme: the setting, or the desktop theme for "system". */
export function useResolvedTheme(): "light" | "dark" {
  const pref = useStore((s) => s.settings.theme);
  const system = useStore((s) => s.systemTheme);
  return pref === "system" ? system : pref;
}

export default function App() {
  const theme = useResolvedTheme();
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return (
    <TooltipProvider delayDuration={400}>
      <Shell />
      <FirstSyncDialog />
      <Toaster theme={theme} position="bottom-center" />
    </TooltipProvider>
  );
}
