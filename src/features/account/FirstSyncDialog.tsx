import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { resolveFirstSync, signOut, useSync, type FirstSyncChoice } from "@/sync/engine";

const OPTIONS: { choice: FirstSyncChoice; title: string; detail: string }[] = [
  { choice: "merge", title: "Merge both", detail: "Keep everything from this device and the account. Recommended." },
  { choice: "server", title: "Use the account's data", detail: "Replace this device's data with what's in the account." },
  { choice: "device", title: "Use this device's data", detail: "Replace the account's data with what's on this device." },
];

/** Shown on the first sign-in when both this device and the account already have data. */
export function FirstSyncDialog() {
  const open = useSync((s) => s.needsChoice);
  const username = useSync((s) => s.username);
  const [busy, setBusy] = useState(false);

  const choose = async (choice: FirstSyncChoice) => {
    setBusy(true);
    try {
      await resolveFirstSync(choice);
      toast.success("Sync is on");
    } catch (e) {
      toast.error("Couldn't finish syncing", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>This device and {username ?? "your account"} both have data</DialogTitle>
          <DialogDescription>Choose how to combine them. A backup of this device's data is kept either way (desktop app).</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {OPTIONS.map((o, i) => (
            <Button key={o.choice} variant={i === 0 ? "default" : "outline"} className="h-auto flex-col items-start gap-0.5 py-2 text-left" disabled={busy} onClick={() => void choose(o.choice)}>
              <span>{o.title}</span>
              <span className="text-xs font-normal whitespace-normal opacity-80">{o.detail}</span>
            </Button>
          ))}
          <Button variant="ghost" disabled={busy} onClick={() => void signOut()}>
            Cancel and sign out
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
