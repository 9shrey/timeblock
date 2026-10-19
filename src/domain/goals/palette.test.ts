import { describe, expect, it } from "vitest";
import { nextColor, PALETTE } from "./palette";

describe("palette", () => {
  it("has 12 distinct #rrggbb colours", () => {
    expect(PALETTE).toHaveLength(12);
    expect(new Set(PALETTE.map((c) => c.toLowerCase())).size).toBe(12);
    for (const c of PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("picks the first unused colour, case-insensitively", () => {
    expect(nextColor([])).toBe(PALETTE[0]);
    expect(nextColor([PALETTE[0]!.toUpperCase()])).toBe(PALETTE[1]);
    expect(nextColor([PALETTE[1]!, "#123456"])).toBe(PALETTE[0]);
  });

  it("cycles when every colour is used", () => {
    expect(nextColor([...PALETTE])).toBe(PALETTE[0]);
    expect(nextColor([...PALETTE, "#000000"])).toBe(PALETTE[1]);
  });
});
