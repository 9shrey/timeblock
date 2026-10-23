import { useState } from "react";
import { Download, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { flushWrites } from "@/state/store";

const DISMISSED_KEY = "timeblock.demoBannerDismissed";
/** Must match the web platform's database key (src/platform/web.ts). */
const DB_KEY = "timeblock.db";
const DOWNLOAD_URL = "https://9shrey.github.io/timeblock/download.html";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Shown only in the public in-browser demo build (`VITE_DEMO=1`). */
export function DemoBanner() {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Not persisted; it just comes back next visit.
    }
    setDismissed(true);
  };

  // Drop the saved database; on reload the demo reseeds an empty one.
  const reset = async () => {
    await flushWrites();
    try {
      localStorage.removeItem(DB_KEY);
    } catch {
      // Nothing saved to remove.
    }
    location.reload();
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-primary/10 px-4 py-1.5 text-sm">
      <span>
        <strong>Live demo</strong> with sample data. Your edits stay in this browser only.
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => void reset()}>
          <RotateCcw /> Reset demo
        </Button>
        <Button size="sm" asChild>
          <a href={DOWNLOAD_URL}>
            <Download /> Get the desktop app
          </a>
        </Button>
        <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={dismiss}>
          <X />
        </Button>
      </div>
    </div>
  );
}
