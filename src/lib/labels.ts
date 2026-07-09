/**
 * Generic label helpers — no data-specific vocabulary. Labels always originate
 * from the sheet; these only shorten them for dense chart axes / lists.
 */

const SHORT_LABEL_MAX = 14;
const WORD_ABBREV_MIN = 8;
const WORD_ABBREV_KEEP = 6;
const LOC_LABEL_MAX = 22;

/** Abbreviate long words ("Construction stone" → "Constr. stone") for axis ticks */
export function shortLabel(label: string): string {
  if (label.length <= SHORT_LABEL_MAX) return label;
  return label
    .split(" ")
    .map((w) => (w.length >= WORD_ABBREV_MIN ? `${w.slice(0, WORD_ABBREV_KEEP)}.` : w))
    .join(" ");
}

/**
 * Location / org labels for ranked lists — keep full short names,
 * shorten PMU / directorate titles without mashing words together.
 */
export function shortLocation(label: string): string {
  const cleaned = label
    .replace(/\s+Project Management Unit$/i, " PMU")
    .replace(/^Vietnam Directorate for Roads$/i, "VN Roads Directorate")
    .trim();
  if (cleaned.length <= LOC_LABEL_MAX) return cleaned;
  return `${cleaned.slice(0, LOC_LABEL_MAX - 1)}…`;
}

export function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(Math.round(n));
}
