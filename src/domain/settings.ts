import { z } from "zod";
import type { SettingRow, Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  weekStartDay: 1,
  dayStartMinute: 7 * 60,
  snapMinutes: 15,
  defaultBlockMinutes: 60,
  theme: "system",
  notifyNextBlock: false,
  notifyUnconfirmed: false,
  notifyWeeklyReview: false,
  closeToTray: false,
};

/** Per-key schemas. Invalid or missing values fall back to the default. */
const schemas: { [K in keyof Settings]: z.ZodType<Settings[K]> } = {
  weekStartDay: z.union([z.literal(1), z.literal(0), z.literal(6)]),
  dayStartMinute: z.number().int().min(0).max(1380),
  snapMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
  defaultBlockMinutes: z.number().int().min(5).max(480),
  theme: z.enum(["system", "light", "dark"]),
  notifyNextBlock: z.boolean(),
  notifyUnconfirmed: z.boolean(),
  notifyWeeklyReview: z.boolean(),
  closeToTray: z.boolean(),
};

export const SETTING_KEYS = Object.keys(schemas) as (keyof Settings)[];

export function parseSettings(rows: readonly SettingRow[]): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (!(row.key in schemas)) continue;
    const key = row.key as keyof Settings;
    let value: unknown;
    try {
      value = JSON.parse(row.value);
    } catch {
      continue;
    }
    const parsed = schemas[key].safeParse(value);
    if (parsed.success) (out as unknown as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}

export function settingRow<K extends keyof Settings>(key: K, value: Settings[K]): SettingRow {
  const parsed = schemas[key].parse(value);
  return { key, value: JSON.stringify(parsed) };
}

/** Validates a single value without throwing. */
export function isValidSetting<K extends keyof Settings>(key: K, value: unknown): value is Settings[K] {
  return schemas[key].safeParse(value).success;
}
