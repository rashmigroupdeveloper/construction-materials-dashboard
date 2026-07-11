"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { DashboardPayload, Filters, Period } from "@/lib/types";
import {
  aggregateBy,
  filterRecords,
  fmt,
  pct,
  periodFields,
  periodLabel,
  totals,
} from "@/lib/aggregate";
import { detectOutliers } from "@/lib/insights";
import { compact, shortLabel, shortLocation } from "@/lib/labels";
import {
  buildDashboardUrl,
  parseDashboardUrl,
  trailFromFilters,
  type DashboardView,
} from "@/lib/url-state";
import {
  ChartLegend,
  FilterSelect,
  MetricStrip,
  ModeTabs,
  SectionHead,
  SheetIcon,
} from "./ui";
import CategoryShift from "./widgets/CategoryShift";
import CoverageHeatmap from "./widgets/CoverageHeatmap";
import DataQualityPanel from "./widgets/DataQualityPanel";
import ProvinceMap from "./widgets/ProvinceMap";
import TransferPanel from "./widgets/TransferPanel";

const SHARE_COLORS = ["#e11d48", "#0f766e", "#0369a1", "#d97706", "#64748b", "#7c3aed"];
const DEMAND_COLOR = "#0369a1";
const SUPPLY_COLOR = "#059669";
const UNMET_COLOR = "#e11d48";
const UNMET_LATE_COLOR = "#b45309";

/** Analysis parameters (thresholds/limits, not data) */
const CONCENTRATION_ALERT_SHARE = 0.5;
const TOP_SHORTAGE_LOCATIONS = 12;

const DEFAULT_FILTERS: Filters = {
  period: "2026",
  project: "All",
  material: "All",
  location: "All",
};

type DrillStep = {
  key: "material" | "location" | "project";
  value: string;
  label: string;
};

const tooltipStyle = {
  contentStyle: {
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 12,
    background: "#ffffff",
    boxShadow: "0 12px 32px rgba(15,23,42,0.12)",
    padding: "10px 12px",
  },
  itemStyle: { fontSize: 12, color: "#0f172a" },
  labelStyle: { fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 4 },
};

/** High-frequency chart updates: no entrance choreography (Emil) */
const chartMotion = {
  isAnimationActive: false as const,
};

export default function Dashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlHydrated = useRef(false);

  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [view, setView] = useState<DashboardView>("triage");
  const [trail, setTrail] = useState<DrillStep[]>([]);
  const [excludeTopLoc, setExcludeTopLoc] = useState(false);
  const [hoverShare, setHoverShare] = useState<string | null>(null);
  const [excludeOutliers, setExcludeOutliers] = useState(false);
  const [reloadSeq, setReloadSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/data", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load data");
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [reloadSeq]);

  const rows = useMemo(
    () => (data ? filterRecords(data.records, filters) : []),
    [data, filters],
  );

  const outliers = useMemo(
    () => detectOutliers(rows, filters.period),
    [rows, filters.period],
  );

  /** Rows powering every chart/KPI — optionally excluding flagged outliers */
  const scoped = useMemo(() => {
    if (!excludeOutliers || outliers.length === 0) return rows;
    const flagged = new Set(outliers.map((o) => o.record.id));
    return rows.filter((r) => !flagged.has(r.id));
  }, [rows, outliers, excludeOutliers]);

  const f = periodFields(filters.period);
  const t = totals(scoped, filters.period);
  const coverage = t.demand ? t.supply / t.demand : 0;

  // All display labels come from the sheet itself (column headers / cell text)
  const pLabels: [string, string] = data?.meta.periods ?? ["", ""];
  const pLabel = data ? periodLabel(filters.period, data.meta.periods) : "";
  const unit = data?.meta.unit ?? "";

  /** Short display name per project description, sourced from the records */
  const categoryOfProject = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of data?.records ?? []) {
      if (!map.has(r.project)) map.set(r.project, r.category);
    }
    return map;
  }, [data]);
  const projectShort = useCallback(
    (p: string) => categoryOfProject.get(p) ?? p,
    [categoryOfProject],
  );

  const syncUrl = useCallback(
    (nextFilters: Filters, nextView: DashboardView = view) => {
      router.replace(`${pathname}${buildDashboardUrl(nextFilters, nextView)}`, {
        scroll: false,
      });
    },
    [pathname, router, view],
  );

  const applyDashboardState = useCallback(
    (nextFilters: Filters, nextTrail: DrillStep[], nextView: DashboardView = view) => {
      setFilters(nextFilters);
      setTrail(nextTrail);
      setView(nextView);
      syncUrl(nextFilters, nextView);
    },
    [syncUrl, view],
  );

  const setDashboardView = useCallback(
    (nextView: DashboardView) => {
      setView(nextView);
      syncUrl(filters, nextView);
    },
    [filters, syncUrl],
  );

  useEffect(() => {
    if (!data || urlHydrated.current) return;
    const parsed = parseDashboardUrl(searchParams);
    setFilters(parsed.filters);
    setView(parsed.view);
    setTrail(trailFromFilters(parsed.filters, projectShort));
    urlHydrated.current = true;
  }, [data, searchParams, projectShort]);

  /** Power-user shortcuts: 1/2 period, R reset (ignore when typing in inputs) */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      if (e.key === "1") {
        applyDashboardState({ ...filters, period: "2026" }, trail);
      } else if (e.key === "2") {
        applyDashboardState({ ...filters, period: "2730" }, trail);
      } else if (e.key === "r" || e.key === "R") {
        setExcludeTopLoc(false);
        applyDashboardState(DEFAULT_FILTERS, [], view);
      } else if (e.key === "t" || e.key === "T") {
        setDashboardView("triage");
      } else if (e.key === "d" || e.key === "D") {
        setDashboardView("deep");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyDashboardState, filters, setDashboardView, trail, view]);

  /**
   * Demand split: sheet-summary sections vs the extra Appendix 2 blocks the
   * sheet's own summary tab omits (Ministry section, totals-only provinces).
   * Powers the "why is this larger than the sheet" note under the KPIs.
   */
  const kpiBridge = useMemo(() => {
    if (!data) return null;
    const extraCats = new Set([
      ...data.integrity.supplemental.sections,
      ...(data.integrity.totalSection.category ? [data.integrity.totalSection.category] : []),
    ]);
    const dField = filters.period === "2026" ? ("demand2026" as const) : ("demand2730" as const);
    let main = 0;
    const byCat = new Map<string, number>();
    for (const r of data.records) {
      if (extraCats.has(r.category)) {
        byCat.set(r.category, (byCat.get(r.category) ?? 0) + r[dField]);
      } else {
        main += r[dField];
      }
    }
    const extras = [...byCat.entries()].filter(([, v]) => v > 0);
    return { main, extras, total: main + extras.reduce((a, [, v]) => a + v, 0) };
  }, [data, filters.period]);

  const byMaterial = useMemo(
    () => aggregateBy(scoped, "material", filters.period).sort((a, b) => b.demand - a.demand),
    [scoped, filters.period],
  );

  const byLocationAll = useMemo(
    () => aggregateBy(scoped, "location", filters.period).sort((a, b) => b.unmet - a.unmet),
    [scoped, filters.period],
  );

  const byLocation = useMemo(
    () => byLocationAll.slice(0, TOP_SHORTAGE_LOCATIONS),
    [byLocationAll],
  );

  const periodCompare = useMemo(() => {
    const mats = [...new Set(scoped.map((r) => r.material))];
    return mats.map((material) => {
      const rs = scoped.filter((r) => r.material === material);
      return {
        material: shortLabel(material),
        fullName: material,
        u26: rs.reduce((a, r) => a + r.unmet2026, 0),
        u27: rs.reduce((a, r) => a + r.unmet2730, 0),
        d26: rs.reduce((a, r) => a + r.demand2026, 0),
        s26: rs.reduce((a, r) => a + r.supply2026, 0),
      };
    });
  }, [scoped]);

  const shareRows = useMemo(() => {
    const totalUnmet = byMaterial.reduce((a, d) => a + Math.max(0, d.unmet), 0);
    return byMaterial
      .filter((d) => d.unmet > 0)
      .sort((a, b) => b.unmet - a.unmet)
      .map((d, i) => ({
        name: d.name,
        short: shortLabel(d.name),
        value: d.unmet,
        share: totalUnmet ? d.unmet / totalUnmet : 0,
        color: SHARE_COLORS[i % SHARE_COLORS.length],
      }));
  }, [byMaterial]);

  // Priority matrix: every locality in scope (not just top 12 by unmet)
  const scatterData = useMemo(
    () =>
      byLocationAll
        .filter((d) => d.demand > 0)
        .map((d) => ({
          name: d.name,
          coverage: d.coverage ?? 0,
          unmet: d.unmet,
          demand: d.demand,
        })),
    [byLocationAll],
  );

  const scatterMaxCoverage = useMemo(
    () => Math.max(1, ...scatterData.map((d) => d.coverage)),
    [scatterData],
  );

  const topLocShare = useMemo(() => {
    if (!t.unmet || !byLocation[0]) return 0;
    return byLocation[0].unmet / t.unmet;
  }, [t.unmet, byLocation]);

  /** Ranked shortage list — optionally hide #1 so peer gaps are readable */
  const locationRank = useMemo(() => {
    const pool = excludeTopLoc && byLocationAll.length > 1 ? byLocationAll.slice(1) : byLocationAll;
    const ranked = pool.filter((d) => d.unmet > 0).slice(0, TOP_SHORTAGE_LOCATIONS);
    const listTotal = ranked.reduce((a, d) => a + d.unmet, 0);
    const maxUnmet = ranked[0]?.unmet || 1;
    const scopeUnmet = t.unmet || 1;
    return ranked.map((d, i) => ({
      ...d,
      short: shortLocation(d.name),
      shareOfScope: d.unmet / scopeUnmet,
      shareOfList: listTotal ? d.unmet / listTotal : 0,
      barPct: (d.unmet / maxUnmet) * 100,
      color: i === 0 ? UNMET_COLOR : i < 3 ? "#be123c" : "#64748b",
      rank: excludeTopLoc ? i + 2 : i + 1,
    }));
  }, [byLocationAll, excludeTopLoc, t.unmet]);

  const hiddenTopLoc = excludeTopLoc ? byLocationAll[0] : null;

  // Next drill target: top locality within current material scope
  const nextLocUnderMaterial = useMemo(() => {
    if (filters.material === "All") return null;
    const locs = aggregateBy(scoped, "location", filters.period)
      .filter((d) => d.unmet > 0)
      .sort((a, b) => b.unmet - a.unmet);
    return locs[0] ?? null;
  }, [scoped, filters.material, filters.period]);

  /** Preferred breadcrumb order: project → material → location */
  const DRILL_ORDER: DrillStep["key"][] = ["project", "material", "location"];

  function sortTrail(steps: DrillStep[]) {
    return [...steps].sort(
      (a, b) => DRILL_ORDER.indexOf(a.key) - DRILL_ORDER.indexOf(b.key),
    );
  }

  /** Drill one dimension; replaces any existing step of the same key */
  function drillTo(step: DrillStep, opts?: { scroll?: boolean }) {
    const nextTrail = sortTrail([...trail.filter((s) => s.key !== step.key), step]);
    const nextFilters = { ...filters, [step.key]: step.value };
    applyDashboardState(nextFilters, nextTrail);
    if (opts?.scroll === true) {
      queueMicrotask(scrollToTable);
    }
  }

  /** Multi-step drill (e.g. Filling sand → Can Tho) */
  function drillPath(steps: DrillStep[], opts?: { scroll?: boolean }) {
    const byKey = new Map<DrillStep["key"], DrillStep>();
    for (const s of steps) byKey.set(s.key, s);
    const nextTrail = sortTrail([...byKey.values()]);
    const nextFilters: Filters = {
      ...filters,
      project: "All",
      material: "All",
      location: "All",
    };
    for (const s of nextTrail) nextFilters[s.key] = s.value;
    applyDashboardState(nextFilters, nextTrail);
    if (opts?.scroll === true) {
      queueMicrotask(scrollToTable);
    }
  }

  function goBreadcrumb(index: number) {
    if (index < 0) {
      applyDashboardState(DEFAULT_FILTERS, []);
      return;
    }
    const nextTrail = trail.slice(0, index + 1);
    const nextFilters: Filters = {
      ...filters,
      project: "All",
      material: "All",
      location: "All",
    };
    for (const s of nextTrail) nextFilters[s.key] = s.value;
    applyDashboardState(nextFilters, nextTrail);
  }

  function resetFilters() {
    setExcludeTopLoc(false);
    applyDashboardState(DEFAULT_FILTERS, []);
  }

  function scrollToTable() {
    queueMicrotask(() => {
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById("detail-table")?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "start",
      });
    });
  }

  if (loading) {
    return (
      <main
        id="main-content"
        className="mx-auto max-w-[1520px] px-5 py-8 md:px-6"
        aria-busy="true"
        aria-label="Loading dashboard"
      >
        <div className="panel mb-5 overflow-hidden p-7 md:p-8">
          <div className="skeleton h-9 w-72 max-w-full" />
          <div className="skeleton mt-4 h-4 w-full max-w-xl" />
          <div className="mt-5 flex flex-wrap gap-2">
            <div className="skeleton h-10 w-40 rounded-full" />
            <div className="skeleton h-10 w-44 rounded-full" />
          </div>
        </div>
        <div className="panel mb-5 grid grid-cols-2 gap-3 p-3.5 md:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="space-y-2">
              <div className="skeleton h-3 w-16" />
              <div className="skeleton h-10 w-full rounded-xl" />
            </div>
          ))}
        </div>
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="panel p-4">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton mt-3 h-8 w-28" />
              <div className="skeleton mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="panel p-5">
            <div className="skeleton h-5 w-40" />
            <div className="skeleton mt-2 h-3 w-56" />
            <div className="skeleton mt-5 h-48 w-full rounded-xl" />
          </div>
          <div className="panel p-5">
            <div className="skeleton h-5 w-44" />
            <div className="skeleton mt-2 h-3 w-52" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="skeleton h-8 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
        <p className="mt-6 text-center text-sm text-(--muted)">
          Loading live data from Google Sheets…
        </p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main id="main-content" className="mx-auto max-w-lg p-12 text-center">
        <p className="font-semibold text-(--bad)">Failed to load dashboard</p>
        <p className="mt-2 text-sm text-(--muted)">{error}</p>
        <button
          type="button"
          onClick={() => setReloadSeq((seq) => seq + 1)}
          className="pressable pressable-hover-lift mt-4 rounded-xl bg-(--accent-deep) px-5 py-2.5 text-sm font-semibold text-white"
        >
          Retry
        </button>
      </main>
    );
  }

  const dominant = shareRows[0];
  const topLoc = byLocation[0];
  const drillLevel =
    filters.location !== "All"
      ? "location"
      : filters.material !== "All"
        ? "material"
        : filters.project !== "All"
          ? "project"
          : "overview";

  return (
    <main id="main-content" className="mx-auto max-w-[1520px] px-5 py-8 md:px-6">
      <header className="panel mb-5 overflow-hidden p-6 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                Construction Materials
              </h1>
              <ModeTabs value={view} onChange={setDashboardView} />
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-(--muted)">
              Demand–supply intelligence. Unit:{" "}
              <strong className="text-foreground">{unit}</strong>.
              <span className="ml-2 hidden text-[11px] sm:inline">
                Shortcuts: 1/2 period · T/D mode · R reset
              </span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={data.source.sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-[#0f9d58] px-4 py-2 text-sm font-semibold text-white pressable pressable-hover-lift"
              >
                <SheetIcon />
                Open Google Sheet
                <span className="text-white/80" aria-hidden>
                  ↗
                </span>
              </a>
              <a
                href={`https://docs.google.com/spreadsheets/d/${data.source.sheetId}/export?format=xlsx`}
                className="inline-flex items-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-semibold text-foreground pressable hover:bg-(--surface-muted)"
              >
                Download Excel
              </a>
            </div>
          </div>
          <div className="rounded-xl border border-(--line) bg-(--surface-muted) px-4 py-3 text-right">
            <p className="text-xs font-semibold text-(--muted)">Last fetch</p>
            <p className="kpi-value mt-1 text-sm font-semibold">
              {new Date(data.source.fetchedAt).toLocaleString()}
            </p>
            <a
              href={data.source.sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-[11px] font-semibold text-(--accent-deep) underline underline-offset-2 link-pressable"
            >
              View source sheet
            </a>
          </div>
        </div>
      </header>

      <div className="callout callout-danger mb-5">
        <p className="text-xs font-semibold text-rose-800">What is unmet?</p>
        <p className="mt-1 text-sm leading-relaxed text-(--muted)">
          <strong className="text-foreground">Unmet</strong> = shortage where demand exceeds
          supply:{" "}
          <span className="kpi-value font-semibold text-foreground">
            max(Demand − Supply, 0)
          </span>
          . Surplus locations (supply &gt; demand) count as <strong>0</strong> unmet — they do not
          cancel shortages elsewhere.{" "}
          <strong className="text-foreground">Balance</strong> = Supply − Demand (can be
          negative). Unit: {unit}.
        </p>
      </div>

      <div className="panel sticky top-3 z-20 mb-5 grid grid-cols-2 gap-3 p-3.5 md:grid-cols-5">
        <FilterSelect
          label="Period"
          value={filters.period}
          options={[
            { value: "2026", label: pLabels[0] },
            { value: "2730", label: pLabels[1] },
          ]}
          onChange={(v) => {
            const nextFilters = { ...filters, period: v as Period };
            applyDashboardState(nextFilters, trail);
          }}
        />
        <FilterSelect
          label="Project"
          value={filters.project}
          options={[
            { value: "All", label: "All" },
            ...data.meta.projects.map((p) => ({ value: p, label: projectShort(p) })),
          ]}
          onChange={(v) => {
            if (v === "All") {
              const nextTrail = trail.filter((s) => s.key !== "project");
              applyDashboardState({ ...filters, project: "All" }, nextTrail);
            } else {
              drillTo({ key: "project", value: v, label: projectShort(v) });
            }
          }}
        />
        <FilterSelect
          label="Material"
          value={filters.material}
          options={[
            { value: "All", label: "All" },
            ...data.meta.materials.map((m) => ({ value: m, label: m })),
          ]}
          onChange={(v) => {
            if (v === "All") {
              const nextTrail = trail.filter((s) => s.key !== "material");
              applyDashboardState({ ...filters, material: "All" }, nextTrail);
            } else {
              drillTo({ key: "material", value: v, label: v });
            }
          }}
        />
        <FilterSelect
          label="Location"
          value={filters.location}
          options={[
            { value: "All", label: "All" },
            ...data.meta.locations.map((l) => ({ value: l, label: l })),
          ]}
          onChange={(v) => {
            if (v === "All") {
              const nextTrail = trail.filter((s) => s.key !== "location");
              applyDashboardState({ ...filters, location: "All" }, nextTrail);
            } else {
              drillTo({ key: "location", value: v, label: v });
            }
          }}
        />
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={resetFilters}
            className="w-full rounded-xl border border-(--line) bg-white px-3 py-2.5 text-sm font-semibold text-foreground pressable hover:bg-(--surface-muted)"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => setReloadSeq((seq) => seq + 1)}
            className="w-full rounded-xl bg-(--accent-deep) px-3 py-2.5 text-sm font-semibold text-white pressable pressable-hover-lift"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Breadcrumb drill trail */}
      <nav
        aria-label="Drill path"
        className="panel mb-5 flex flex-wrap items-center gap-2 px-4 py-3 text-sm"
      >
        <span className="text-xs font-semibold text-(--muted)">Drill</span>
        <button
          type="button"
          onClick={() => goBreadcrumb(-1)}
          className={`rounded-lg px-3 py-1 text-xs font-semibold pressable ${
            trail.length === 0
              ? "bg-(--accent-deep) text-white"
              : "bg-sky-50 text-sky-800 hover:bg-sky-100"
          }`}
        >
          All
        </button>
        {trail.map((step, i) => (
          <span key={`${step.key}-${step.value}`} className="inline-flex items-center gap-2">
            <span className="text-(--muted)">›</span>
            <button
              type="button"
              onClick={() => goBreadcrumb(i)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold pressable ${
                i === trail.length - 1
                  ? "bg-(--accent-deep) text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {step.label}
            </button>
          </span>
        ))}
        {trail.length > 0 && (
          <button
            type="button"
            onClick={() => goBreadcrumb(trail.length - 2)}
            className="ml-auto text-xs font-semibold text-(--muted) underline link-pressable"
          >
            ← Back
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setDashboardView("deep");
            queueMicrotask(scrollToTable);
          }}
          className="pressable rounded-lg border border-(--line) px-3 py-1 text-xs font-semibold text-foreground hover:bg-(--surface-muted)"
        >
          View rows
        </button>
      </nav>

      {/* Outlier watch — single records big enough to distort every KPI */}
      {outliers.length > 0 && (
        <div className="state-in callout callout-warn mb-5 flex flex-wrap items-center gap-3 text-sm text-amber-950">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
            !
          </span>
          <p className="min-w-0 flex-1">
            <strong>Data watch:</strong>{" "}
            {outliers.map((o, i) => (
              <span key={o.record.id}>
                {i > 0 && ", "}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2 link-pressable"
                  onClick={() =>
                    drillPath([
                      { key: "material", value: o.record.material, label: o.record.material },
                      { key: "location", value: o.record.location, label: o.record.location },
                    ])
                  }
                >
                  {o.record.location} · {o.record.material}
                </button>{" "}
                ({fmt(o.record[f.d])} = {pct(o.share)} of demand in scope)
              </span>
            ))}
            . A single record this large usually means a units issue at source — verify before
            acting on the coverage KPI.
          </p>
          <button
            type="button"
            onClick={() => setExcludeOutliers((v) => !v)}
            className={`shrink-0 rounded-lg px-4 py-2 text-xs font-semibold pressable ${
              excludeOutliers
                ? "bg-amber-600 text-white hover:brightness-110"
                : "border border-amber-400 bg-white text-amber-900 hover:bg-amber-50"
            }`}
          >
            {excludeOutliers ? "Outliers excluded — include" : "Exclude from analysis"}
          </button>
        </div>
      )}

      {topLocShare > CONCENTRATION_ALERT_SHARE && byLocation[0] && (
        <div className="state-in callout callout-danger mb-5 flex gap-3 text-sm text-rose-900">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-600 text-[11px] font-bold text-white">
            !
          </span>
          <p>
            <strong>Concentration:</strong> {byLocation[0].name} holds{" "}
            {(topLocShare * 100).toFixed(1)}% of unmet demand ({fmt(byLocation[0].unmet)} {unit}
            ).{" "}
            <button
              type="button"
              className="font-semibold underline link-pressable"
              onClick={() =>
                drillTo({
                  key: "location",
                  value: byLocation[0].name,
                  label: byLocation[0].name,
                })
              }
            >
              Drill into {byLocation[0].name}
            </button>
          </p>
        </div>
      )}

      <MetricStrip
        items={[
          {
            label: "Total demand",
            value: fmt(t.demand),
            sub: `${pLabel}, ${unit}${excludeOutliers ? " · excl. outliers" : ""}`,
          },
          { label: "Supply capacity", value: fmt(t.supply), sub: "Available capacity" },
          { label: "Unmet demand", value: fmt(t.unmet), sub: "max(D − S, 0)", hot: true },
          { label: "Net balance", value: fmt(t.balance), sub: "Supply − demand" },
          {
            label: "Coverage",
            value: pct(coverage),
            sub: excludeOutliers ? "Supply ÷ demand · excl. outliers" : "Supply ÷ demand",
          },
        ]}
      />

      {kpiBridge &&
        kpiBridge.extras.length > 0 &&
        filters.project === "All" &&
        filters.material === "All" &&
        filters.location === "All" && (
          <div className="callout callout-info mb-5 text-xs leading-relaxed text-(--muted)">
            <strong className="text-foreground">
              Why total demand here is larger than the sheet’s Dashboard tab:
            </strong>{" "}
            that tab counts only the three main sections —{" "}
            <span className="kpi-value font-semibold text-foreground">
              {fmt(kpiBridge.main)}
            </span>{" "}
            demand in {pLabel}. This dashboard also includes{" "}
            {kpiBridge.extras.map(([cat, v], i) => (
              <span key={cat}>
                {i > 0 && " and "}
                <strong className="text-foreground">{cat}</strong> (+{fmt(v)})
              </span>
            ))}
            , which exist in Appendix 2 but are missing from the sheet’s own summary. Together:{" "}
            <span className="kpi-value font-semibold text-foreground">
              {fmt(kpiBridge.total)}
            </span>
            . Nothing is double-counted — use the Project filter to view any group alone.
          </div>
        )}

      {view === "triage" ? (
      <div
        id="section-triage"
        role="tabpanel"
        aria-labelledby="mode-tab-triage"
        className="mb-5 space-y-5"
      >
      <div id="section-map">
        <ProvinceMap
          locationAgg={byLocationAll}
          periodLabel={pLabel}
          selectedLocation={filters.location}
          materialFilter={filters.material}
          onDrill={(l) => drillTo({ key: "location", value: l, label: l })}
        />
      </div>

      <div id="section-overview" className="space-y-5">
      <div className="panel p-5">
          <SectionHead
            title={
              drillLevel === "overview"
                ? "Decision story"
                : drillLevel === "material"
                  ? `Story · ${filters.material}`
                  : drillLevel === "location"
                    ? `Story · ${filters.location}`
                    : `Story · ${projectShort(filters.project)}`
            }
            subtitle={`For ${pLabel} · ${scoped.length} records in scope`}
          />

          <p className="mt-3 text-sm leading-relaxed text-(--muted)">
            Demand <strong className="text-foreground">{fmt(t.demand)}</strong> vs supply{" "}
            <strong className="text-foreground">{fmt(t.supply)}</strong> → coverage{" "}
            <strong className="text-foreground">{pct(coverage)}</strong>, unmet{" "}
            <strong className="text-(--bad)">{fmt(t.unmet)}</strong> ({unit}).
          </p>

          {drillLevel === "overview" && dominant && topLoc && (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() =>
                    drillTo({ key: "material", value: dominant.name, label: dominant.name })
                  }
                  className="rounded-xl border border-rose-200/80 bg-rose-50/60 px-3 py-2.5 text-left pressable hover:border-rose-300 hover:bg-rose-50"
                >
                  <p className="text-xs font-semibold text-rose-700">
                    Material driver
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-foreground">{dominant.name}</p>
                  <p className="kpi-value mt-0.5 text-xs text-(--muted)">
                    {pct(dominant.share)} of unmet · {fmt(dominant.value)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    drillTo({ key: "location", value: topLoc.name, label: topLoc.name })
                  }
                  className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-3 py-2.5 text-left pressable hover:border-amber-300 hover:bg-amber-50"
                >
                  <p className="text-xs font-semibold text-amber-800">
                    Location driver
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-foreground">{topLoc.name}</p>
                  <p className="kpi-value mt-0.5 text-xs text-(--muted)">
                    {pct(topLocShare)} of unmet · {fmt(topLoc.unmet)}
                  </p>
                </button>
              </div>
              <button
                type="button"
                onClick={() =>
                  drillPath([
                    { key: "material", value: dominant.name, label: dominant.name },
                    { key: "location", value: topLoc.name, label: topLoc.name },
                  ])
                }
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-(--accent-deep) px-4 py-2.5 text-sm font-semibold text-white pressable pressable-hover-lift"
              >
                Drill {dominant.name} → {topLoc.name}
                <span aria-hidden>→</span>
              </button>
            </>
          )}

          {drillLevel === "material" && (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-(--muted)">
                Scoped to <strong className="text-foreground">{filters.material}</strong>
                {nextLocUnderMaterial ? (
                  <>
                    . Top shortage locality:{" "}
                    <strong className="text-foreground">{nextLocUnderMaterial.name}</strong> (
                    {t.unmet
                      ? pct(nextLocUnderMaterial.unmet / t.unmet)
                      : "—"}{" "}
                    of this material’s unmet).
                  </>
                ) : (
                  ". No location shortage in this view."
                )}
              </p>
              {nextLocUnderMaterial && (
                <button
                  type="button"
                  onClick={() =>
                    drillTo({
                      key: "location",
                      value: nextLocUnderMaterial.name,
                      label: nextLocUnderMaterial.name,
                    })
                  }
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-(--accent-deep) px-4 py-2.5 text-sm font-bold text-white pressable pressable-hover-lift"
                >
                  Next: drill into {nextLocUnderMaterial.name}
                  <span aria-hidden>→</span>
                </button>
              )}
            </div>
          )}

          {drillLevel === "location" && (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-(--muted)">
                Scoped to <strong className="text-foreground">{filters.location}</strong>
                {filters.material !== "All" ? (
                  <>
                    {" "}
                    × <strong className="text-foreground">{filters.material}</strong>
                  </>
                ) : null}
                . {scoped.length} detail rows below — click material chips to narrow further.
              </p>
              {filters.material === "All" && dominant && (
                <button
                  type="button"
                  onClick={() =>
                    drillTo({ key: "material", value: dominant.name, label: dominant.name })
                  }
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-(--accent-deep) px-4 py-2.5 text-sm font-bold text-white pressable pressable-hover-lift"
                >
                  Next: filter {dominant.name} here
                  <span aria-hidden>→</span>
                </button>
              )}
              {filters.material !== "All" && (
                <button
                  type="button"
                  onClick={() => {
                    setDashboardView("deep");
                    queueMicrotask(scrollToTable);
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2.5 text-sm font-semibold text-foreground pressable hover:bg-(--surface-muted)"
                >
                  View {scoped.length} detail rows
                </button>
              )}
            </div>
          )}

          {drillLevel === "project" && (
            <p className="mt-3 text-sm text-(--muted)">
              Scoped to project type. Use material / location charts to continue drilling.
            </p>
          )}
        </div>

      {/* Unmet share hero */}
        <div className="panel p-5">
          <SectionHead
            title="Unmet share by material"
            subtitle={
              dominant
                ? `${dominant.name} drives ${pct(dominant.share)} of shortage`
                : "No unmet demand in this view"
            }
          />
          <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="mx-auto h-[200px] w-[200px] shrink-0 sm:mx-0">
              <div className="chart-clickable h-full w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={shareRows}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={62}
                      outerRadius={88}
                      paddingAngle={2.5}
                      stroke="#fff"
                      strokeWidth={3}
                      {...chartMotion}
                      onMouseEnter={(_, i) => setHoverShare(shareRows[i]?.name ?? null)}
                      onMouseLeave={() => setHoverShare(null)}
                      onClick={(_, index) => {
                        const item = shareRows[index ?? 0];
                        if (item)
                          drillTo({ key: "material", value: item.name, label: item.name });
                      }}
                    >
                      {shareRows.map((d) => (
                        <Cell
                          key={d.name}
                          fill={d.color}
                          opacity={hoverShare && hoverShare !== d.name ? 0.35 : 1}
                        />
                      ))}
                      <Label
                        content={({ viewBox }) => {
                          if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
                          const { cx, cy } = viewBox;
                          return (
                            <g>
                              <text
                                x={cx}
                                y={cy - 16}
                                textAnchor="middle"
                                className="fill-(--muted)"
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                }}
                              >
                                Total unmet
                              </text>
                              <text
                                x={cx}
                                y={cy + 6}
                                textAnchor="middle"
                                className="fill-foreground"
                                style={{
                                  fontSize: 22,
                                  fontWeight: 600,
                                  fontFamily: "ui-sans-serif, system-ui, sans-serif",
                                }}
                              >
                                {fmt(t.unmet)}
                              </text>
                              <text
                                x={cx}
                                y={cy + 24}
                                textAnchor="middle"
                                className="fill-(--muted)"
                                style={{ fontSize: 10 }}
                              >
                                {unit}
                              </text>
                            </g>
                          );
                        }}
                      />
                    </Pie>
                    <Tooltip
                      {...tooltipStyle}
                      animationDuration={150}
                      formatter={(v, _n, item) => {
                        const row = item?.payload as { share?: number } | undefined;
                        return [`${fmt(Number(v))} (${pct(row?.share ?? 0)})`, "Unmet"];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5">
              <div className="flex h-3 overflow-hidden rounded-full bg-(--track)">
                {shareRows.map((d) => (
                  <button
                    key={d.name}
                    type="button"
                    title={`${d.name}: ${pct(d.share)}`}
                    className="h-full pressable scrub-opacity"
                    style={{
                      width: `${Math.max(d.share * 100, 0.8)}%`,
                      background: d.color,
                      opacity: hoverShare && hoverShare !== d.name ? 0.35 : 1,
                    }}
                    onMouseEnter={() => setHoverShare(d.name)}
                    onMouseLeave={() => setHoverShare(null)}
                    onClick={() => drillTo({ key: "material", value: d.name, label: d.name })}
                  />
                ))}
              </div>

              <ul className="mt-1 space-y-1.5">
                {shareRows.map((d, i) => (
                  <li key={d.name}>
                    <button
                      type="button"
                      className="group w-full rounded-xl px-2 py-1.5 text-left pressable scrub-opacity hover:bg-(--surface-muted)"
                      onMouseEnter={() => setHoverShare(d.name)}
                      onMouseLeave={() => setHoverShare(null)}
                      onClick={() => drillTo({ key: "material", value: d.name, label: d.name })}
                      style={{
                        opacity: hoverShare && hoverShare !== d.name ? 0.45 : 1,
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: d.color }}
                          />
                          <span className="truncate text-sm font-semibold text-foreground">
                            <span className="mr-1.5 text-[11px] font-semibold text-(--muted)">
                              {i + 1}.
                            </span>
                            {d.name}
                          </span>
                        </div>
                        <span className="kpi-value shrink-0 text-sm font-bold tabular-nums">
                          {pct(d.share)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 pl-[18px]">
                        <div className="share-track flex-1">
                          <div
                            className="share-fill"
                            style={
                              {
                                "--share": d.share,
                                background: d.color,
                              } as CSSProperties
                            }
                          />
                        </div>
                        <span className="kpi-value w-18 text-right text-[11px] text-(--muted)">
                          {fmt(d.value)}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHead
              title={
                filters.material !== "All"
                  ? `Shortage locations · ${filters.material}`
                  : "Top shortage locations"
              }
              subtitle={
                hiddenTopLoc
                  ? `Peers only — #1 ${shortLocation(hiddenTopLoc.name)} hidden (${pct(hiddenTopLoc.unmet / (t.unmet || 1))} of unmet)`
                  : `Top ${locationRank.length} of ${byLocationAll.length} by unmet`
              }
            />
            {byLocationAll.length > 1 && byLocationAll[0] && byLocationAll[0].unmet / (t.unmet || 1) > 0.4 && (
              <button
                type="button"
                onClick={() => setExcludeTopLoc((v) => !v)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold pressable ${
                  excludeTopLoc
                    ? "bg-sky-600 text-white"
                    : "border border-(--line) bg-white text-foreground hover:bg-[#f8fafc]"
                }`}
              >
                {excludeTopLoc ? "Show #1 again" : "Hide #1 · see peers"}
              </button>
            )}
          </div>

          {hiddenTopLoc && (
            <button
              type="button"
              onClick={() =>
                drillTo({ key: "location", value: hiddenTopLoc.name, label: hiddenTopLoc.name })
              }
              className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-left text-xs pressable hover:bg-rose-50"
            >
              <span>
                <span className="font-bold text-rose-800">#1 {hiddenTopLoc.name}</span>
                <span className="text-rose-700/80"> still {pct(hiddenTopLoc.unmet / (t.unmet || 1))} of unmet — click to drill</span>
              </span>
              <span className="kpi-value shrink-0 font-bold text-rose-800">{fmt(hiddenTopLoc.unmet)}</span>
            </button>
          )}

          <ul className="mt-3 space-y-1">
            {locationRank.map((d) => (
              <li key={d.name}>
                <button
                  type="button"
                  onClick={() => drillTo({ key: "location", value: d.name, label: d.name })}
                  className="group w-full rounded-xl px-2 py-1.5 text-left pressable hover:bg-[#fff1f2]"
                  title={`${d.name} · unmet ${fmt(d.unmet)} · ${pct(d.shareOfScope)} of scope`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-5 shrink-0 text-[11px] font-semibold tabular-nums text-(--muted)">
                        {d.rank}.
                      </span>
                      <span className="truncate text-sm font-semibold text-foreground group-hover:text-rose-800">
                        {d.short}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-2">
                      <span className="kpi-value text-[11px] font-bold text-rose-700">
                        {pct(d.shareOfScope)}
                      </span>
                      <span className="kpi-value w-[3.6rem] text-right text-xs text-(--muted)">
                        {fmt(d.unmet)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1.5 ml-7 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]">
                    <div
                      className="bar-fill"
                      style={
                        {
                          "--bar": d.barPct / 100,
                          background: d.color,
                        } as CSSProperties
                      }
                    />
                  </div>
                </button>
              </li>
            ))}
            {locationRank.length === 0 && (
              <li className="px-2 py-6 text-center text-sm text-(--muted)">
                No unmet shortage in this scope
              </li>
            )}
          </ul>
        </div>
      </div>
      </div>
      ) : (
      <div
        id="section-deep"
        role="tabpanel"
        aria-labelledby="mode-tab-deep"
        className="mb-5 space-y-5"
      >
      <div className="grid gap-5 lg:grid-cols-2">
        <TransferPanel
          rows={scoped}
          period={filters.period}
          periodLabel={pLabel}
          material={filters.material}
          onDrillMaterial={(m) => drillTo({ key: "material", value: m, label: m })}
          onDrillLocation={(l) => drillTo({ key: "location", value: l, label: l })}
        />
        <CategoryShift rows={scoped} periods={pLabels} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="panel p-5">
          <SectionHead
            title="Period comparison"
            subtitle="Click a material bar to drill"
          />
          <div className="chart-clickable mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={periodCompare} margin={{ bottom: 48, left: 4, right: 8 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="material"
                  tick={{ fontSize: 11, fill: "#475569" }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tickFormatter={(v) => compact(v)}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  {...tooltipStyle}
                  animationDuration={150}
                  formatter={(v) => fmt(Number(v))}
                  cursor={{ fill: "rgba(14,165,233,0.06)" }}
                />
                {(
                  [
                    ["d26", "2026 demand", DEMAND_COLOR],
                    ["s26", "2026 supply", SUPPLY_COLOR],
                    ["u26", "2026 unmet", UNMET_COLOR],
                    ["u27", "2027–30 unmet", UNMET_LATE_COLOR],
                  ] as const
                ).map(([key, name, fill]) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    name={name}
                    fill={fill}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                    {...chartMotion}
                    onClick={(_, index) => {
                      const item = periodCompare[index ?? 0];
                      if (item)
                        drillTo({
                          key: "material",
                          value: item.fullName,
                          label: item.fullName,
                        });
                    }}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartLegend
            items={[
              { label: "2026 demand", color: DEMAND_COLOR },
              { label: "2026 supply", color: SUPPLY_COLOR },
              { label: "2026 unmet", color: UNMET_COLOR },
              { label: "2027–30 unmet", color: UNMET_LATE_COLOR },
            ]}
          />
        </div>

        <div className="panel p-5">
          <SectionHead
            title={
              filters.material !== "All"
                ? `Demand vs supply · ${filters.material}`
                : "Demand vs supply"
            }
            subtitle="By material · click to drill"
          />
          <div className="chart-clickable mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={byMaterial.map((d) => ({ ...d, short: shortLabel(d.name) }))}
                margin={{ bottom: 8, left: 4, right: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="short"
                  tick={{ fontSize: 11, fill: "#475569" }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tickFormatter={(v) => compact(v)}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  {...tooltipStyle}
                  animationDuration={150}
                  formatter={(v) => fmt(Number(v))}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as { name?: string } | undefined;
                    return p?.name ?? "";
                  }}
                  cursor={{ fill: "rgba(14,165,233,0.06)" }}
                />
                <Bar
                  dataKey="demand"
                  name="Demand"
                  fill={DEMAND_COLOR}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={36}
                  {...chartMotion}
                  onClick={(_, index) => {
                    const item = byMaterial[index ?? 0];
                    if (item) drillTo({ key: "material", value: item.name, label: item.name });
                  }}
                />
                <Bar
                  dataKey="supply"
                  name="Supply"
                  fill={SUPPLY_COLOR}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={36}
                  {...chartMotion}
                  onClick={(_, index) => {
                    const item = byMaterial[index ?? 0];
                    if (item) drillTo({ key: "material", value: item.name, label: item.name });
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartLegend
            items={[
              { label: "Demand", color: DEMAND_COLOR },
              { label: "Supply", color: SUPPLY_COLOR },
            ]}
          />
        </div>
      </div>

        <div className="panel p-5">
          <SectionHead
            title="Priority matrix"
            subtitle={`All ${scatterData.length} localities in scope · coverage vs unmet · bubble = demand · click to drill`}
          />
          <div className="chart-clickable mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ bottom: 20, left: 4, right: 12, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  type="number"
                  dataKey="coverage"
                  name="Coverage"
                  domain={[0, Math.ceil(scatterMaxCoverage * 20) / 20]}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  label={{
                    value: "Coverage →",
                    position: "insideBottom",
                    offset: -2,
                    style: { fill: "#94a3b8", fontSize: 10 },
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="unmet"
                  name="Unmet"
                  tickFormatter={(v) => compact(v)}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <ZAxis type="number" dataKey="demand" range={[60, 520]} />
                <ReferenceLine
                  x={1}
                  stroke="#059669"
                  strokeDasharray="4 4"
                  label={{
                    value: "100% covered",
                    position: "insideTopRight",
                    style: { fill: "#059669", fontSize: 10, fontWeight: 700 },
                  }}
                />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3", stroke: "#94a3b8" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const p = payload[0].payload as {
                      name: string;
                      coverage: number;
                      unmet: number;
                      demand: number;
                    };
                    return (
                      <div className="chart-tooltip">
                        <p className="text-xs font-bold text-foreground">{p.name}</p>
                        <p className="mt-1 text-[11px] text-(--muted)">
                          Coverage {pct(p.coverage)} · Unmet {fmt(p.unmet)} · Demand {fmt(p.demand)}
                        </p>
                        <p className="mt-1 text-[10px] font-semibold text-sky-700">Click to drill</p>
                      </div>
                    );
                  }}
                />
                <Scatter
                  name="Localities"
                  data={scatterData}
                  fill="#0f766e"
                  fillOpacity={0.75}
                  {...chartMotion}
                  onClick={(d) => {
                    const pt = d as { name?: string };
                    if (pt.name)
                      drillTo({ key: "location", value: pt.name, label: pt.name });
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        <DataQualityPanel
          integrity={data.integrity}
          recordsInScope={scoped.length}
          surplusRowsInScope={scoped.filter((r) => r[f.b] > 0).length}
          basePeriodLabel={pLabels[0]}
        />

      <CoverageHeatmap
        rows={scoped}
        period={filters.period}
        periodLabel={pLabel}
        onDrill={(material, location) =>
          drillPath([
            { key: "material", value: material, label: material },
            { key: "location", value: location, label: location },
          ])
        }
      />

      <div id="detail-table" className="panel scroll-mt-24 overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-(--line) px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Detail records</h2>
            <p className="text-sm text-(--muted)">
              {scoped.length} rows
              {scoped.length > 200 ? " · showing top 200 by unmet" : ""}
              {trail.length > 0 ? ` · filtered by ${trail.map((s) => s.label).join(" › ")}` : ""}
              {excludeOutliers && outliers.length > 0
                ? ` · ${outliers.length} outlier record(s) hidden`
                : ""}
            </p>
          </div>
          {trail.length > 0 && (
            <button
              type="button"
              onClick={() => goBreadcrumb(-1)}
              className="pressable rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"
            >
              Clear drill
            </button>
          )}
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-(--surface-muted) text-left text-xs font-semibold text-(--muted)">
              <tr>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Material</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3 text-right">Demand</th>
                <th className="px-4 py-3 text-right">Supply</th>
                <th className="px-4 py-3 text-right">Unmet</th>
                <th className="px-4 py-3 text-right">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {[...scoped]
                .sort((a, b) => b[f.u] - a[f.u])
                .slice(0, 200)
                .map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-(--line) ui-transition hover:bg-[#f0f9ff]"
                  >
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        className="font-medium text-sky-800 underline-offset-2 link-pressable hover:underline"
                        onClick={() =>
                          drillTo({ key: "location", value: r.location, label: r.location })
                        }
                      >
                        {r.location}
                      </button>
                      {r.mergedRows > 1 && (
                        <span
                          className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-bold text-slate-500"
                          title={`Sum of ${r.mergedRows} sheet rows with the same category, material and locality`}
                        >
                          ×{r.mergedRows}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        className="text-sky-800 underline-offset-2 link-pressable hover:underline"
                        onClick={() =>
                          drillTo({ key: "material", value: r.material, label: r.material })
                        }
                      >
                        {r.material}
                      </button>
                    </td>
                    <td
                      className="max-w-[200px] truncate px-4 py-2.5 text-(--muted)"
                      title={r.project}
                    >
                      {shortLabel(r.project)}
                    </td>
                    <td className="kpi-value px-4 py-2.5 text-right">{fmt(r[f.d])}</td>
                    <td className="kpi-value px-4 py-2.5 text-right">{fmt(r[f.s])}</td>
                    <td className="kpi-value px-4 py-2.5 text-right font-semibold text-(--bad)">
                      {fmt(r[f.u])}
                    </td>
                    <td className="kpi-value px-4 py-2.5 text-right">{pct(r[f.c])}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      </div>
      )}

      <footer className="panel mb-2 flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-xs text-(--muted)">
        <p>
          Source: Google Sheet {data.source.recordsFrom} (all sections) · {data.meta.recordCount}{" "}
          records · {data.integrity.zeroRowsDropped} zero rows dropped ·{" "}
          {data.integrity.duplicatesMerged} duplicates merged · fetched live on every load
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={data.source.sheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#0f9d58] px-3 py-1.5 font-semibold text-white pressable"
          >
            <SheetIcon className="h-3.5 w-3.5" />
            Open sheet ↗
          </a>
          <a
            href={`https://docs.google.com/spreadsheets/d/${data.source.sheetId}/export?format=xlsx`}
            className="inline-flex items-center rounded-xl border border-(--line) bg-white px-3 py-1.5 font-semibold text-foreground pressable"
          >
            Download Excel
          </a>
        </div>
      </footer>
    </main>
  );
}
