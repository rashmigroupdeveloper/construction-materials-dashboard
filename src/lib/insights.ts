import { periodFields } from "./aggregate";
import type { MaterialRecord, Period } from "./types";

export interface OutlierInfo {
  record: MaterialRecord;
  share: number;
}

/**
 * Flag single records that dominate demand in scope (default: >25%).
 * These usually indicate a units error at source (e.g. m³ entered as 1,000 m³)
 * and can silently drive every KPI on the page.
 * Skipped for tiny scopes where one record legitimately dominates.
 */
export function detectOutliers(
  rows: MaterialRecord[],
  period: Period,
  threshold = 0.25,
  minRows = 8,
): OutlierInfo[] {
  if (rows.length < minRows) return [];
  const f = periodFields(period);
  const total = rows.reduce((a, r) => a + r[f.d], 0);
  if (total <= 0) return [];
  return rows
    .map((record) => ({ record, share: record[f.d] / total }))
    .filter((o) => o.share >= threshold)
    .sort((a, b) => b.share - a.share);
}

export interface SurplusShortage {
  name: string;
  surplus: number;
  shortage: number;
}

/** Per-group surplus (supply beyond demand) and shortage (unmet demand) */
export function surplusShortageBy(
  rows: MaterialRecord[],
  key: "material" | "location",
  period: Period,
): SurplusShortage[] {
  const f = periodFields(period);
  const map = new Map<string, SurplusShortage>();
  for (const r of rows) {
    const name = r[key];
    const prev = map.get(name) ?? { name, surplus: 0, shortage: 0 };
    map.set(name, {
      name,
      surplus: prev.surplus + r[f.sp],
      shortage: prev.shortage + r[f.u],
    });
  }
  return [...map.values()].filter((d) => d.surplus > 0 || d.shortage > 0);
}

export interface TransferStats {
  totalSurplus: number;
  totalShortage: number;
  transferable: number;
  coverablePct: number | null;
}

/** How much of the shortage could in-scope surplus theoretically absorb */
export function transferStats(rows: MaterialRecord[], period: Period): TransferStats {
  const f = periodFields(period);
  const totalSurplus = rows.reduce((a, r) => a + r[f.sp], 0);
  const totalShortage = rows.reduce((a, r) => a + r[f.u], 0);
  const transferable = Math.min(totalSurplus, totalShortage);
  return {
    totalSurplus,
    totalShortage,
    transferable,
    coverablePct: totalShortage > 0 ? transferable / totalShortage : null,
  };
}

export interface HeatCell {
  material: string;
  location: string;
  demand: number;
  supply: number;
  coverage: number | null;
  unmet: number;
}

export interface HeatmapData {
  materials: string[];
  rows: { location: string; cells: HeatCell[] }[];
}

/** Material × locality coverage grid, localities ranked by demand */
export function heatmapData(
  rows: MaterialRecord[],
  period: Period,
  maxLocations = 12,
): HeatmapData {
  const f = periodFields(period);
  const materials = [...new Set(rows.map((r) => r.material))].sort();
  const byLocation = new Map<string, number>();
  for (const r of rows) {
    byLocation.set(r.location, (byLocation.get(r.location) ?? 0) + r[f.d]);
  }
  const locations = [...byLocation.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxLocations)
    .map(([name]) => name);

  const grid = locations.map((location) => ({
    location,
    cells: materials.map((material) => {
      const rs = rows.filter((r) => r.location === location && r.material === material);
      const demand = rs.reduce((a, r) => a + r[f.d], 0);
      const supply = rs.reduce((a, r) => a + r[f.s], 0);
      return {
        material,
        location,
        demand,
        supply,
        coverage: demand > 0 ? supply / demand : null,
        unmet: rs.reduce((a, r) => a + r[f.u], 0),
      };
    }),
  }));

  return { materials, rows: grid };
}

export interface CategoryShiftRow {
  category: string;
  demand2026: number;
  demand2730: number;
  share2026: number;
  share2730: number;
}

/** Demand mix by project category, 2026 vs 2027–30 — reveals who drives each period */
export function categoryShift(rows: MaterialRecord[]): CategoryShiftRow[] {
  const map = new Map<string, { d26: number; d27: number }>();
  for (const r of rows) {
    const prev = map.get(r.category) ?? { d26: 0, d27: 0 };
    map.set(r.category, { d26: prev.d26 + r.demand2026, d27: prev.d27 + r.demand2730 });
  }
  const t26 = [...map.values()].reduce((a, v) => a + v.d26, 0);
  const t27 = [...map.values()].reduce((a, v) => a + v.d27, 0);
  return [...map.entries()]
    .map(([category, v]) => ({
      category,
      demand2026: v.d26,
      demand2730: v.d27,
      share2026: t26 ? v.d26 / t26 : 0,
      share2730: t27 ? v.d27 / t27 : 0,
    }))
    .sort((a, b) => b.demand2026 - a.demand2026);
}
