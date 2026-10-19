import React from "react";
import ReactDOM from "react-dom/client";
import { toast } from "sonner";
import App from "./App";
import { SqliteRepository } from "./data/SqliteRepository";
import { CLOCK_TICK_MS, makeClock, parseNowOverride } from "./domain/time/clock";
import type { Now } from "./domain/types";
import { getPlatform } from "./platform";
import { initStore, useStore } from "./state/store";
import "./styles/index.css";

/** Dev and end-to-end test builds accept `?seed`, `?reset` and `?now`; release builds never do. */
const TEST_SWITCHES = import.meta.env.DEV || import.meta.env.VITE_E2E === "1";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

function BootError({ error }: { error: unknown }) {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">Timeblock could not start</h1>
      <p className="max-w-lg text-sm text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
    </main>
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
          description: `${e instanceof Error ? e.message : String(e)}. The view was reloaded from disk.`,
        }),
    },
    clock(),
  );
  useStore.setState({ systemTheme: await platform.systemTheme() });
  void platform.onSystemThemeChange((systemTheme) => useStore.setState({ systemTheme }));

  setInterval(() => {
    const next = clock();
    const cur = useStore.getState().now;
    if (next.day !== cur.day || next.minute !== cur.minute) useStore.setState({ now: next });
  }, CLOCK_TICK_MS);

  platform.backupIfStale(24).catch((e: unknown) => console.warn("Automatic backup failed", e));
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
