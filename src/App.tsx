import { useStore } from "./state/store";

/** Temporary M2 smoke screen; replaced by the app shell in M3. */
export default function App() {
  const data = useStore((s) => s.data);
  const now = useStore((s) => s.now);
  const blocks = Object.values(data.blocks);
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-2">
      <h1 className="text-2xl font-semibold">Timeblock</h1>
      <p data-testid="counts" className="text-sm text-muted-foreground">
        {now.day} · goals {Object.keys(data.goals).length} · plan {blocks.filter((b) => b.layer === "plan").length} ·
        actual {blocks.filter((b) => b.layer === "actual").length}
      </p>
    </main>
  );
}
