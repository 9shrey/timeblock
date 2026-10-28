import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ACCOUNT_REQUIRED } from "@/sync/mode";
import { changePassword, deleteAccount, signOut, signOutEverywhere, syncNow, useSync } from "@/sync/engine";
import { AuthForm } from "./AuthForm";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** On the web app, signing out also forgets this browser's copy of the data. */
async function leave(action: () => Promise<void>): Promise<void> {
  await action();
  if (ACCOUNT_REQUIRED) {
    const { clearStoredDb } = await import("@/platform/web");
    clearStoredDb();
    location.reload();
  }
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setOldPw("");
    setNewPw("");
    setError(null);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && close()}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (newPw.length < 8) return setError("Use at least 8 characters for the new password.");
            setBusy(true);
            try {
              await changePassword(oldPw, newPw);
              toast.success("Password changed", { description: "Your other devices were signed out." });
              close();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>Other devices are signed out and need the new password.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="pw-old">Current password</Label>
          <Input id="pw-old" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required />
          <Label htmlFor="pw-new">New password</Label>
          <Input id="pw-new" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await leave(() => deleteAccount(pw));
              toast.success("Account deleted", { description: ACCOUNT_REQUIRED ? undefined : "Your data is still on this device." });
              onClose();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete account?</DialogTitle>
            <DialogDescription>
              This deletes the account and all data stored on the sync server, and signs out every device. Data in the desktop app stays on
              that computer.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="del-pw">Password</Label>
          <Input id="del-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              Delete account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Settings → Sync & account. */
export function AccountSection({ desktop }: { desktop: boolean }) {
  const { username, server, status, lastSyncedAt, error } = useSync();
  const [pwOpen, setPwOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Sync & account</h2>
      {!username ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Optional. Sign in to sync your plan between this {desktop ? "computer" : "browser"} and the Timeblock web app. Without an
            account, your data stays only on this device.
          </p>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
          <div className="max-w-sm rounded-lg border p-4">
            <AuthForm showServer={desktop} />
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{username}</span>
            {desktop ? ` on ${server}` : ""}.{" "}
            {status === "error" || status === "offline"
              ? (error ?? "Not synced.")
              : lastSyncedAt
                ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}.`
                : "Not synced yet."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={status === "syncing"} onClick={() => void syncNow()}>
              Sync now
            </Button>
            <Button variant="outline" onClick={() => setPwOpen(true)}>
              Change password…
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void leave(signOut).then(
                  () => toast("Signed out", { description: ACCOUNT_REQUIRED ? undefined : "Your data stays on this device." }),
                  (e: unknown) => toast.error("Couldn't sign out", { description: errorText(e) }),
                )
              }
            >
              Sign out
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void leave(signOutEverywhere).then(
                  () => toast("Signed out on every device"),
                  (e: unknown) => toast.error("Couldn't sign out everywhere", { description: errorText(e) }),
                )
              }
            >
              Sign out everywhere
            </Button>
            <Button variant="outline" className="text-destructive" onClick={() => setDelOpen(true)}>
              Delete account…
            </Button>
          </div>
        </>
      )}
      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
      <DeleteDialog open={delOpen} onClose={() => setDelOpen(false)} />
    </section>
  );
}
