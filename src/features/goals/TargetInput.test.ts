import { describe, expect, it } from "vitest";
import { dailyPaceHint, parseTargetInput } from "./TargetInput";

describe("parseTargetInput", () => {
  it.each([
    ["15", 900],
    ["7.5", 450],
    ["7,5", 450],
    ["15h", 900],
    ["1h30", 90],
    ["1h 30m", 90],
    ["90m", 90],
    ["90 min", 90],
    ["1:30", 90],
    ["0", 0],
    ["0.01", 5],
  ])("%s → %i", (text, minutes) => {
    expect(parseTargetInput(text)).toBe(minutes);
  });

  it.each(["", "abc", "-3", "200h", "1h75"])("rejects %j", (text) => {
    expect(parseTargetInput(text)).toBeUndefined();
  });
});

describe("dailyPaceHint", () => {
  it("divides by active days", () => {
    expect(dailyPaceHint(900, 0b0111110)).toBe("≈ 3h a day over 5 days");
    expect(dailyPaceHint(null, 127)).toBeNull();
  });
});
