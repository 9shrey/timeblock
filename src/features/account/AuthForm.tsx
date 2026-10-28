import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_SERVER, signIn, useSync } from "@/sync/engine";

const USERNAME = /^[a-z0-9_.-]{3,32}$/;

/** Sign in / create account. `showServer` lets desktop users point at their own server. */
export function AuthForm({ showServer }: { showServer: boolean }) {
  const savedServer = useSync((s) => s.server);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [server, setServer] = useState(savedServer || DEFAULT_SERVER);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = username.trim().toLowerCase();
    if (mode === "signup") {
      if (!USERNAME.test(name)) return setError("Usernames are 3–32 characters: letters, numbers, . _ or -.");
      if (password.length < 8) return setError("Use at least 8 characters for the password.");
      if (password !== confirm) return setError("The passwords don't match.");
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(mode, server, name, password);
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      {showServer && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sync-server">Server</Label>
          <Input id="sync-server" type="url" placeholder="https://sync.example.com" value={server} onChange={(e) => setServer(e.target.value)} required />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sync-username">Username</Label>
        <Input
          id="sync-username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sync-password">Password</Label>
        <Input
          id="sync-password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {mode === "signup" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sync-confirm">Confirm password</Label>
          <Input id="sync-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
      </Button>
      <button
        type="button"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        onClick={() => {
          setMode(mode === "login" ? "signup" : "login");
          setError(null);
        }}
      >
        {mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </form>
  );
}
