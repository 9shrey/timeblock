import { AuthForm } from "./AuthForm";

/** Full-screen sign-in for the web app, shown until you're signed in. */
export function LoginScreen() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <img src={`${import.meta.env.BASE_URL}app-icon.svg`} alt="" className="mx-auto mb-3 size-12" />
        <h1 className="mb-1 text-center text-xl font-semibold">Timeblock</h1>
        <p className="mb-5 text-center text-sm text-muted-foreground">Sign in to see your plan. Changes sync with the desktop app.</p>
        <AuthForm showServer={false} />
      </div>
    </main>
  );
}
