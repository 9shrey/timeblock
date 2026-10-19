import { describe, expect, it, vi } from "vitest";
import { put } from "@/domain/changes";
import type { ChangeSet } from "@/domain/types";
import { createWriteQueue } from "./writeQueue";

const cs = (key: string): ChangeSet => [put("settings", { key, value: "1" })];

describe("writeQueue", () => {
  it("runs writes in order, one at a time", async () => {
    const log: string[] = [];
    let running = 0;
    const q = createWriteQueue(async (c) => {
      running++;
      expect(running).toBe(1);
      await new Promise((r) => setTimeout(r, 1));
      log.push(c[0]!.op === "put" ? (c[0]!.row as { key: string }).key : "");
      running--;
    }, vi.fn());
    void q.push(cs("a"));
    void q.push(cs("b"));
    expect(q.pending).toBe(2);
    await q.flush();
    expect(log).toEqual(["a", "b"]);
    expect(q.pending).toBe(0);
  });

  it("ignores empty change sets", async () => {
    const apply = vi.fn(async () => {});
    const q = createWriteQueue(apply, vi.fn());
    await q.push([]);
    expect(apply).not.toHaveBeenCalled();
    expect(q.pending).toBe(0);
  });

  it("reports a failure and drops the writes queued behind it", async () => {
    const applied: string[] = [];
    const onError = vi.fn();
    const q = createWriteQueue(async (c) => {
      const key = (c[0] as { row: { key: string } }).row.key;
      if (key === "bad") throw new Error("boom");
      applied.push(key);
    }, onError);
    void q.push(cs("a"));
    void q.push(cs("bad"));
    void q.push(cs("stale"));
    await q.flush();
    expect(applied).toEqual(["a"]);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![1]).toEqual(cs("bad"));
    await q.push(cs("fresh"));
    expect(applied).toEqual(["a", "fresh"]);
  });
});
