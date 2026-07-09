export type Period = "2026" | "2730";

export interface MaterialRecord {
  id: string;
  project: string;
  category: string;
  material: string;
  location: string;
  demand2026: number;
  supply2026: number;
  balance2026: number;
  coverage2026: number | null;
  unmet2026: number;
  surplus2026: number;
  demand2730: number;
  supply2730: number;
  balance2730: number;
  coverage2730: number | null;
  unmet2730: number;
  surplus2730: number;
  mergedRows: number;
}

export interface MaterialSummary {
  material: string;
  demand2026: number;
  supply2026: number;
  balance2026: number;
  demand2730: number;
  supply2730: number;
  balance2730: number;
}

export interface DashboardKpis {
  demand2026: number;
  supply2026: number;
  coverage2026: number;
  demand2730: number;
  supply2730: number;
  coverage2730: number;
}

export interface MaterialCheck {
  material: string;
  sheetDemand2026: number;
  computedDemand2026: number;
  delta: number;
  ok: boolean;
}

export interface DataIntegrity {
  /** Computed sums (excl. supplemental sections) vs the sheet's own summary table */
  materialChecks: MaterialCheck[];
  /** Rows whose Balance column disagrees with Supply − Demand */
  balanceMismatches: number;
  duplicatesMerged: number;
  zeroRowsDropped: number;
  /** Appendix sections absent from the records sheet, discovered structurally */
  supplemental: {
    loaded: boolean;
    sections: string[];
    records: number;
    demand2026: number;
    supply2026: number;
    demand2730: number;
    supply2730: number;
  };
}

export interface DashboardPayload {
  source: {
    sheetId: string;
    sheetUrl: string;
    fetchedAt: string;
    worksheets: string[];
  };
  kpis: DashboardKpis;
  records: MaterialRecord[];
  integrity: DataIntegrity;
  meta: {
    recordCount: number;
    materials: string[];
    locations: string[];
    projects: string[];
    /** Display labels for the two period slots, read from the sheet's column headers */
    periods: [string, string];
    /** Measurement unit extracted from the sheet's own text */
    unit: string;
  };
}

export interface Filters {
  period: Period;
  project: string;
  material: string;
  location: string;
}
