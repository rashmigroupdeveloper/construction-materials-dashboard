import type {
  DashboardKpis,
  DashboardPayload,
  DataIntegrity,
  MaterialCheck,
  MaterialRecord,
  MaterialSummary,
} from "./types";

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID ?? "1Hn6HBQcVP6vSvNm5I1W31Onttal9czN5_-h68ZEGmVY";

/** Worksheet tab names — infrastructure anchors, overridable via env */
const RECORDS_SHEET = process.env.SHEET_TAB_RECORDS ?? "DashData";
const SUMMARY_SHEET = process.env.SHEET_TAB_SUMMARY ?? "Dashboard";
const APPENDIX_SHEET = process.env.SHEET_TAB_APPENDIX ?? "Appendix2";

/** Used only if the unit cannot be found anywhere in the sheet itself */
const FALLBACK_UNIT = "1,000 m³";
/** Used only if period tokens cannot be read from the records header row */
const FALLBACK_PERIODS: [string, string] = ["Period 1", "Period 2"];

/** Supplemental-section detection thresholds (structure, not content) */
const SECTION_TITLE_MIN_LENGTH = 30;
const NUM_TOLERANCE = 0.01;

interface GvizCell {
  v?: string | number | null;
  f?: string;
}

interface GvizRow {
  c: (GvizCell | null)[];
}

interface GvizResponse {
  table: {
    cols: { label?: string }[];
    rows: GvizRow[];
  };
}

interface RawRow {
  category: string;
  project: string;
  material: string;
  location: string;
  d1: number;
  s1: number;
  b1: number;
  d2: number;
  s2: number;
  b2: number;
}

function num(cell: GvizCell | null | undefined): number {
  if (!cell || cell.v == null || cell.v === "") return 0;
  const n = typeof cell.v === "number" ? cell.v : parseFloat(String(cell.v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function str(cell: GvizCell | null | undefined): string {
  if (!cell || cell.v == null) return "";
  return String(cell.v).trim();
}

function isNumericCell(cell: GvizCell | null | undefined): boolean {
  return !!cell && typeof cell.v === "number";
}

function calcCoverage(demand: number, supply: number): number | null {
  return demand > 0 ? supply / demand : null;
}

async function fetchGviz(sheetName: string): Promise<GvizResponse> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Failed to fetch sheet "${sheetName}": ${res.status}`);
  const text = await res.text();
  const json = text.replace(/^[^(]*\(/, "").replace(/\);?\s*$/, "");
  return JSON.parse(json) as GvizResponse;
}

// ---------------------------------------------------------------------------
// Column mapping — derived from the records sheet's own header labels, so
// reordered or renamed columns (and renamed periods) flow through untouched.
// ---------------------------------------------------------------------------

interface ColumnMap {
  category: number;
  material: number;
  location: number;
  periods: [string, string];
  d: [number, number];
  s: [number, number];
  b: [number | null, number | null];
}

function mapRecordColumns(data: GvizResponse): ColumnMap {
  const labels = data.table.cols.map((c) => (c.label ?? "").trim());
  const find = (re: RegExp) => labels.findIndex((l) => re.test(l));

  const category = find(/categor/i);
  const material = find(/material/i);
  const location = find(/local|location|province/i);

  const demandCols = labels
    .map((label, index) => ({ label, index }))
    .filter((x) => /^demand/i.test(x.label))
    .map((x) => ({ index: x.index, token: x.label.replace(/^demand/i, "").trim() }));

  const colFor = (prefix: RegExp, token: string) =>
    labels.findIndex((l) => prefix.test(l) && l.includes(token));

  if (category >= 0 && material >= 0 && location >= 0 && demandCols.length >= 2) {
    const [p1, p2] = demandCols;
    const sup1 = colFor(/^supply/i, p1.token);
    const sup2 = colFor(/^supply/i, p2.token);
    if (sup1 >= 0 && sup2 >= 0) {
      const bal1 = colFor(/^balance/i, p1.token);
      const bal2 = colFor(/^balance/i, p2.token);
      return {
        category,
        material,
        location,
        periods: [p1.token || FALLBACK_PERIODS[0], p2.token || FALLBACK_PERIODS[1]],
        d: [p1.index, p2.index],
        s: [sup1, sup2],
        b: [bal1 >= 0 ? bal1 : null, bal2 >= 0 ? bal2 : null],
      };
    }
  }

  // Positional fallback (headers consumed differently or unlabeled)
  return {
    category: 0,
    material: 1,
    location: 2,
    periods: FALLBACK_PERIODS,
    d: [3, 6],
    s: [4, 7],
    b: [5, 8],
  };
}

function parseRecordsSheet(data: GvizResponse, cols: ColumnMap): RawRow[] {
  const rows: RawRow[] = [];
  for (const row of data.table.rows) {
    const category = str(row.c[cols.category]);
    const material = str(row.c[cols.material]);
    const location = str(row.c[cols.location]);
    if (!category || !material || !location) continue;
    const d1 = num(row.c[cols.d[0]]);
    const s1 = num(row.c[cols.s[0]]);
    const d2 = num(row.c[cols.d[1]]);
    const s2 = num(row.c[cols.s[1]]);
    rows.push({
      category,
      project: category,
      material,
      location,
      d1,
      s1,
      b1: cols.b[0] != null ? num(row.c[cols.b[0]]) : s1 - d1,
      d2,
      s2,
      b2: cols.b[1] != null ? num(row.c[cols.b[1]]) : s2 - d2,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Appendix parsing — category descriptions and supplemental sections are
// discovered from the appendix's own structure, so new sections, categories
// or materials added to the sheet are picked up without code changes.
// ---------------------------------------------------------------------------

const ROMAN_RE = /^[ivxlcdm]+\.?$/i;

/**
 * Long description per records-sheet category, found by locating the appendix
 * section header that contains the category name (e.g. "Central Government" →
 * "Key transport infrastructure projects … invested by the Central Government").
 */
function deriveCategoryDescriptions(
  appendix: GvizResponse,
  categories: string[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of appendix.table.rows) {
    for (const cell of row.c.slice(0, 3)) {
      const text = str(cell);
      if (text.length <= SECTION_TITLE_MIN_LENGTH) continue;
      for (const cat of categories) {
        if (!map.has(cat) && text.toLowerCase().includes(cat.toLowerCase())) {
          map.set(cat, text);
        }
      }
    }
  }
  return map;
}

/**
 * Derive a short display name for a section title, e.g.
 * "Key projects managed by the Ministry of Construction" → "Ministry of Construction".
 * Grammar heuristic only — no fixed strings.
 */
function shortSectionName(title: string): string {
  const afterThe = title.split(/\s+the\s+/i).pop()?.trim() ?? "";
  if (afterThe && afterThe.length >= 4 && afterThe.length < title.length) return afterThe;
  return title.length > 40 ? `${title.slice(0, 40)}…` : title;
}

interface SupplementalSection {
  title: string;
  shortName: string;
  rows: RawRow[];
}

/**
 * Find appendix sections that are NOT represented in the records sheet.
 * Structural signature (no text anchors): a row with an empty marker column,
 * a long text title matching no known category, no numeric cells, immediately
 * followed by roman-numeral material blocks. Each such section is ingested:
 * roman-marker rows set the material, other named rows are detail records.
 */
function parseSupplementalSections(
  appendix: GvizResponse,
  knownCategories: string[],
): SupplementalSection[] {
  const rows = appendix.table.rows;
  const lowerCats = knownCategories.map((c) => c.toLowerCase());

  const headerIdxs: number[] = [];
  rows.forEach((row, i) => {
    const marker = str(row.c[0]);
    const title = str(row.c[1]);
    if (marker || title.length < SECTION_TITLE_MIN_LENGTH) return;
    if (lowerCats.some((c) => title.toLowerCase().includes(c))) return;
    if (row.c.slice(2).some(isNumericCell)) return;
    for (let j = i + 1; j < rows.length; j++) {
      const nextMarker = str(rows[j].c[0]);
      const nextName = str(rows[j].c[1]);
      if (!nextMarker && !nextName) continue;
      if (ROMAN_RE.test(nextMarker) && nextName) headerIdxs.push(i);
      break;
    }
  });

  return headerIdxs.map((start, h) => {
    const end = headerIdxs[h + 1] ?? rows.length;
    const block = rows.slice(start + 1, end);

    // Value columns = columns where this section actually holds numbers
    const numericCols = [
      ...new Set(
        block.flatMap((r) =>
          r.c.map((cell, ci) => (ci >= 2 && isNumericCell(cell) ? ci : -1)).filter((ci) => ci >= 0),
        ),
      ),
    ].sort((a, b) => a - b);

    const title = str(rows[start].c[1]);
    const shortName = shortSectionName(title);
    const out: RawRow[] = [];
    let material = "";

    for (const row of block) {
      const marker = str(row.c[0]);
      const name = str(row.c[1]);
      if (!name) continue;
      if (ROMAN_RE.test(marker)) {
        material = name;
        continue;
      }
      if (!material) continue;
      const v = numericCols.map((ci) => num(row.c[ci]));
      const [d1 = 0, s1 = 0, b1 = s1 - d1, d2 = 0, s2 = 0, b2 = s2 - d2] = v;
      out.push({ category: shortName, project: title, material, location: name, d1, s1, b1, d2, s2, b2 });
    }

    return { title, shortName, rows: out };
  });
}

/** Extract the measurement unit from the sheet's own text (e.g. "1,000 m³") */
function deriveUnit(responses: (GvizResponse | null)[]): string {
  const unitRe = /([\d.,]+\s*m[³3]\b[^),]*)/i;
  for (const res of responses) {
    if (!res) continue;
    for (const col of res.table.cols) {
      const m = (col.label ?? "").match(unitRe);
      if (m) return m[1].trim();
    }
    for (const row of res.table.rows.slice(0, 40)) {
      for (const cell of row.c) {
        const m = str(cell).match(unitRe);
        if (m) return m[1].trim();
      }
    }
  }
  return FALLBACK_UNIT;
}

// ---------------------------------------------------------------------------
// Record building & integrity
// ---------------------------------------------------------------------------

function isZero(r: RawRow): boolean {
  return [r.d1, r.s1, r.b1, r.d2, r.s2, r.b2].every((v) => v === 0);
}

function countBalanceMismatches(rows: RawRow[]): number {
  return rows.filter(
    (r) =>
      Math.abs(r.s1 - r.d1 - r.b1) > NUM_TOLERANCE ||
      Math.abs(r.s2 - r.d2 - r.b2) > NUM_TOLERANCE,
  ).length;
}

interface BuildResult {
  records: MaterialRecord[];
  zeroRowsDropped: number;
  duplicatesMerged: number;
}

/** Drop all-zero rows, merge duplicate (category, material, locality) keys */
function buildRecords(raw: RawRow[], descriptions: Map<string, string>): BuildResult {
  const nonZero = raw.filter((r) => !isZero(r));
  const merged = new Map<string, RawRow & { count: number }>();

  for (const r of nonZero) {
    const key = `${r.category}|${r.material}|${r.location}`;
    const prev = merged.get(key);
    merged.set(
      key,
      prev
        ? {
            ...prev,
            d1: prev.d1 + r.d1,
            s1: prev.s1 + r.s1,
            b1: prev.b1 + r.b1,
            d2: prev.d2 + r.d2,
            s2: prev.s2 + r.s2,
            b2: prev.b2 + r.b2,
            count: prev.count + 1,
          }
        : { ...r, count: 1 },
    );
  }

  const records = [...merged.entries()].map(([key, r]) => ({
    id: key,
    project: descriptions.get(r.category) ?? r.project,
    category: r.category,
    material: r.material,
    location: r.location,
    demand2026: r.d1,
    supply2026: r.s1,
    balance2026: r.b1,
    coverage2026: calcCoverage(r.d1, r.s1),
    unmet2026: Math.max(r.d1 - r.s1, 0),
    surplus2026: Math.max(r.s1 - r.d1, 0),
    demand2730: r.d2,
    supply2730: r.s2,
    balance2730: r.b2,
    coverage2730: calcCoverage(r.d2, r.s2),
    unmet2730: Math.max(r.d2 - r.s2, 0),
    surplus2730: Math.max(r.s2 - r.d2, 0),
    mergedRows: r.count,
  }));

  return {
    records,
    zeroRowsDropped: raw.length - nonZero.length,
    duplicatesMerged: nonZero.length - records.length,
  };
}

function kpisFromRecords(records: MaterialRecord[]): DashboardKpis {
  const sum = (fn: (r: MaterialRecord) => number) => records.reduce((a, r) => a + fn(r), 0);
  const d26 = sum((r) => r.demand2026);
  const s26 = sum((r) => r.supply2026);
  const d27 = sum((r) => r.demand2730);
  const s27 = sum((r) => r.supply2730);
  return {
    demand2026: d26,
    supply2026: s26,
    coverage2026: d26 ? s26 / d26 : 0,
    demand2730: d27,
    supply2730: s27,
    coverage2730: d27 ? s27 / d27 : 0,
  };
}

/** Rows of the summary sheet whose first cell names a material we know from the data */
function parseSummaryMaterials(
  data: GvizResponse,
  knownMaterials: Set<string>,
): MaterialSummary[] {
  const materials: MaterialSummary[] = [];
  for (const row of data.table.rows) {
    const name = str(row.c[0]);
    if (!knownMaterials.has(name)) continue;
    materials.push({
      material: name,
      demand2026: num(row.c[1]),
      supply2026: num(row.c[2]),
      balance2026: num(row.c[3]),
      demand2730: num(row.c[4]),
      supply2730: num(row.c[5]),
      balance2730: num(row.c[6]),
    });
  }
  return materials;
}

/**
 * Reconcile computed sums against the sheet's own summary table. The summary
 * covers only records-sheet sections, so supplemental categories are excluded
 * from the comparison side.
 */
function buildMaterialChecks(
  records: MaterialRecord[],
  sheetMaterials: MaterialSummary[],
  supplementalCategories: Set<string>,
): MaterialCheck[] {
  return sheetMaterials.map((m) => {
    const computed = records
      .filter((r) => !supplementalCategories.has(r.category) && r.material === m.material)
      .reduce((a, r) => a + r.demand2026, 0);
    const delta = computed - m.demand2026;
    return {
      material: m.material,
      sheetDemand2026: m.demand2026,
      computedDemand2026: computed,
      delta,
      ok: Math.abs(delta) < 1,
    };
  });
}

function buildIntegrity(
  records: MaterialRecord[],
  sheetMaterials: MaterialSummary[],
  build: BuildResult,
  rawAll: RawRow[],
  sections: SupplementalSection[],
  appendixLoaded: boolean,
): DataIntegrity {
  const suppCats = new Set(sections.map((s) => s.shortName));
  const suppRecords = records.filter((r) => suppCats.has(r.category));
  const sum = (fn: (r: MaterialRecord) => number) => suppRecords.reduce((a, r) => a + fn(r), 0);
  return {
    materialChecks: buildMaterialChecks(records, sheetMaterials, suppCats),
    balanceMismatches: countBalanceMismatches(rawAll),
    duplicatesMerged: build.duplicatesMerged,
    zeroRowsDropped: build.zeroRowsDropped,
    supplemental: {
      loaded: appendixLoaded,
      sections: sections.map((s) => s.shortName),
      records: suppRecords.length,
      demand2026: sum((r) => r.demand2026),
      supply2026: sum((r) => r.supply2026),
      demand2730: sum((r) => r.demand2730),
      supply2730: sum((r) => r.supply2730),
    },
  };
}

export async function loadDashboardData(): Promise<DashboardPayload> {
  const [recordsSheet, summarySheet, appendixSheet] = await Promise.all([
    fetchGviz(RECORDS_SHEET),
    fetchGviz(SUMMARY_SHEET),
    // Supplemental sections are additive — degrade gracefully if unavailable
    fetchGviz(APPENDIX_SHEET).catch(() => null),
  ]);

  const cols = mapRecordColumns(recordsSheet);
  const baseRows = parseRecordsSheet(recordsSheet, cols);
  const baseCategories = [...new Set(baseRows.map((r) => r.category))];

  const sections = appendixSheet
    ? parseSupplementalSections(appendixSheet, baseCategories)
    : [];
  const descriptions = appendixSheet
    ? deriveCategoryDescriptions(appendixSheet, baseCategories)
    : new Map<string, string>();

  const raw = [...baseRows, ...sections.flatMap((s) => s.rows)];
  const build = buildRecords(raw, descriptions);
  const { records } = build;

  const knownMaterials = new Set(records.map((r) => r.material));
  const sheetMaterials = parseSummaryMaterials(summarySheet, knownMaterials);

  return {
    source: {
      sheetId: SHEET_ID,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
      fetchedAt: new Date().toISOString(),
      worksheets: [SUMMARY_SHEET, RECORDS_SHEET, APPENDIX_SHEET],
    },
    kpis: kpisFromRecords(records),
    records,
    integrity: buildIntegrity(records, sheetMaterials, build, raw, sections, appendixSheet !== null),
    meta: {
      recordCount: records.length,
      materials: [...new Set(records.map((r) => r.material))].sort(),
      locations: [...new Set(records.map((r) => r.location))].sort(),
      projects: [...new Set(records.map((r) => r.project))].sort(),
      periods: cols.periods,
      unit: deriveUnit([appendixSheet, summarySheet, recordsSheet]),
    },
  };
}
