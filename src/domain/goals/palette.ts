/**
 * Goal colours: mid-dark hues that carry white text as solid fills and still read as
 * light tints (low-alpha backgrounds) in both light and dark themes.
 */

export const PALETTE: readonly string[] = [
  "#2563eb", // blue
  "#059669", // emerald
  "#b45309", // amber
  "#e11d48", // rose
  "#7c3aed", // violet
  "#0e7490", // cyan
  "#ea580c", // orange
  "#4d7c0f", // lime
  "#c026d3", // fuchsia
  "#0d9488", // teal
  "#4f46e5", // indigo
  "#64748b", // slate
];

/** First palette colour not in `used` (case-insensitive), else cycles by `used.length`. */
export function nextColor(used: readonly string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()));
  const free = PALETTE.find((c) => !taken.has(c.toLowerCase()));
  return free ?? (PALETTE[used.length % PALETTE.length] as string);
}
