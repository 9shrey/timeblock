import React from "react";
import ReactDOM from "react-dom/client";
import { toast } from "sonner";
import { FolderOpen } from "lucide-react";
import App from "./App";
import { Button } from "./components/ui/button";
import { BackupList } from "./features/settings/BackupList";
import { SqliteRepository } from "./data/SqliteRepository";
import { CLOCK_TICK_MS, makeClock, parseNowOverride } from "./domain/time/clock";
import type { Now } from "./domain/types";
import { getPlatform } from "./platform";
import { extendRunningTimer } from "./state/commands";
import { scheduleNotifications, wireNotificationClicks } from "./state/notifications";
import { flushWrites, initStore, pendingWrites, useStore } from "./state/store";
import { scheduleTray, wireTrayActions } from "./state/tray";
import { useUi } from "./state/ui";
import "./styles/index.css";

/** Dev and end-to-end test builds accept `?seed`, `?reset` and `?now`; release builds never do. */
const TEST_SWITCHES = import.meta.env.DEV || import.meta.env.VITE_E2E === "1";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

function BootError({ error }: { error: unknown }) {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Timeblock could not start</h1>
      <p className="max-w-lg text-sm text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
      <BootRecovery />
    </main>
  );
}

/** Restoring a backup or opening the data folder, when the platform itself came up. */
function BootRecovery() {
  const [desktop, setDesktop] = React.useState(false);
  React.useEffect(() => {
    getPlatform().then(
      (p) => setDesktop(p.kind === "tauri"),
      () => {},
    );
  }, []);
  if (!desktop) return null;
  return (
    <section className="flex w-full max-w-xl flex-col gap-3 rounded-lg border p-4 text-left">
      <p className="text-sm">You can restore a backup (your current data is backed up first) or open the data folder.</p>
      <BackupList />
      <Button variant="outline" className="self-start" onClick={() => void getPlatform().then((p) => p.revealDataDir())}>
        <FolderOpen /> Open data folder
      </Button>
    </section>
  );
}

/**
 * Dev-only switches: `?reset=1` wipes data, `?seed=demo` loads demo data (both removed from
 * the URL once applied). `VITE_DEV_SEED=demo npm run tauri dev` seeds an empty native DB.
 */
async function applyDevParams(repo: SqliteRepository, now: Now) {
  const url = new URL(location.href);
  const reset = url.searchParams.get("reset") === "1";
  const seed = url.searchParams.get("seed");
  if (!reset && !seed) {
    if (import.meta.env.VITE_DEV_SEED === "demo" && (await repo.loadBase()).goals.length === 0) {
      const { demoSeed } = await import("./data/devSeed");
      await repo.replaceAll(demoSeed(now));
    }
    return;
  }
  const { demoSeed, EMPTY_DATA } = await import("./data/devSeed");
  if (reset) await repo.replaceAll(EMPTY_DATA);
  if (seed === "demo") await repo.replaceAll(demoSeed(now));
  url.searchParams.delete("reset");
  url.searchParams.delete("seed");
  history.replaceState(null, "", url);
}

async function boot() {
  const platform = await getPlatform();
  const driver = await platform.createDriver();
  const repo = new SqliteRepository(driver, (reason) => platform.backupNow(reason));
  await repo.init();

  const clock = makeClock(TEST_SWITCHES ? parseNowOverride(location.search) : null);
  if (TEST_SWITCHES) await applyDevParams(repo, clock());

  await initStore(
    {
      repo,
      onWriteError: (e) =>
        toast.error("Couldn't save your last change", {
          description: `${e instanceof Error ? e.message : String(e)}. The view was reloaded from disk and undo history was cleared.`,
        }),
    },
    clock(),
  );
  await platform.guardClose({ flush: flushWrites, pending: pendingWrites });
  useStore.setState({ systemTheme: await platform.systemTheme() });
  void platform.onSystemThemeChange((systemTheme) => useStore.setState({ systemTheme }));

  void wireNotificationClicks(platform);
  void wireTrayActions(platform);
  scheduleNotifications(platform, clock());
  scheduleTray(platform, clock());
  void platform.setCloseToTray(useStore.getState().settings.closeToTray);
  useStore.subscribe((s, prev) => {
    if (s.settings.closeToTray !== prev.settings.closeToTray) void platform.setCloseToTray(s.settings.closeToTray);
  });
  setInterval(() => {
    const next = clock();
    const cur = useStore.getState().now;
    if (next.day !== cur.day || next.minute !== cur.minute) {
      useStore.setState({ now: next });
      extendRunningTimer(next);
      scheduleNotifications(platform, next);
    }
    scheduleTray(platform, next);
  }, CLOCK_TICK_MS);

  // The running block's title in the window title, so you can tell at a glance.
  const updateTitle = () => {
    const id = useUi.getState().runningBlockId;
    const block = id ? useStore.getState().data.blocks[id] : null;
    document.title = block ? `⏱ ${block.title || "Untitled"} — Timeblock` : "Timeblock";
  };
  useStore.subscribe(updateTitle);
  useUi.subscribe(updateTitle);

  platform.backupIfStale(24).catch((e: unknown) => {
    console.warn("Automatic backup failed", e);
    toast.error("Automatic backup failed", {
      description: `${e instanceof Error ? e.message : String(e)}. Try Settings → Back up now.`,
    });
  });
}

boot().then(
  () =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  (error: unknown) => {
    console.error(error);
    root.render(<BootError error={error} />);
  },
);
