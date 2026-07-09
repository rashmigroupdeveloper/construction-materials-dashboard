import type { Filters, MaterialRecord, Period } from "./types";

export function periodFields(period: Period) {
  return period === "2026"
    ? {
        d: "demand2026" as const,
        s: "supply2026" as const,
        b: "balance2026" as const,
        u: "unmet2026" as const,
        sp: "surplus2026" as const,
        c: "coverage2026" as const,
      }
    : {
        d: "demand2730" as const,
        s: "supply2730" as const,
        b: "balance2730" as const,
        u: "unmet2730" as const,
        sp: "surplus2730" as const,
        c: "coverage2730" as const,
      };
}

/** Display label for a period slot, sourced from the sheet's column headers */
export function periodLabel(period: Period, periods: [string, string]): string {
  return period === "2026" ? periods[0] : periods[1];
}

export function filterRecords(records: MaterialRecord[], filters: Filters) {
  return records.filter(
    (r) =>
      (filters.project === "All" || r.project === filters.project) &&
      (filters.material === "All" || r.material === filters.material) &&
      (filters.location === "All" || r.location === filters.location),
  );
}

export function totals(rows: MaterialRecord[], period: Period) {
  const f = periodFields(period);
  return rows.reduce(
    (acc, r) => ({
      demand: acc.demand + r[f.d],
      supply: acc.supply + r[f.s],
      balance: acc.balance + r[f.b],
      unmet: acc.unmet + r[f.u],
    }),
    { demand: 0, supply: 0, balance: 0, unmet: 0 },
  );
}

export function aggregateBy(
  rows: MaterialRecord[],
  key: "material" | "location" | "project",
  period: Period,
) {
  const f = periodFields(period);
  const map = new Map<
    string,
    { name: string; demand: number; supply: number; balance: number; unmet: number }
  >();

  for (const r of rows) {
    const name = r[key];
    if (!map.has(name)) {
      map.set(name, { name, demand: 0, supply: 0, balance: 0, unmet: 0 });
    }
    const o = map.get(name)!;
    o.demand += r[f.d];
    o.supply += r[f.s];
    o.balance += r[f.b];
    o.unmet += r[f.u];
  }

  return [...map.values()].map((o) => ({
    ...o,
    coverage: o.demand ? o.supply / o.demand : null,
  }));
}

export function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function pct(v: number | null): string {
  return v != null && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—";
}
