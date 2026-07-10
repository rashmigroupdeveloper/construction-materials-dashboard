"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { buildDashboardUrl, parseDashboardUrl, trailFromFilters } from "@/lib/url-state";
import { ChartLegend, FilterSelect, KpiCard, SectionHead, SheetIcon } from "./ui";
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

/** Numbered heading between page sections — the whole dashboard is one scroll */
function SectionDivider({
  index,
  title,
  desc,
}: {
  index: number;
  title: string;
  desc: string;
}) {
  return (
    <div className="mb-4 mt-9 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
      <span className="flex h-7 w-7 shrink-0 translate-y-1 items-center justify-center rounded-full bg-[var(--accent-deep)] text-xs font-black text-white">
        {index}
      </span>
      <h2 className="font-display text-2xl font-semibold tracking-tight text-[var(--ink)]">
        {title}
      </h2>
      <span className="text-sm text-[var(--muted)]">{desc}</span>
    </div>
  );
}

const tooltipStyle = {
  contentStyle: {
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 12,
    background: "rgba(255,255,255,0.96)",
    boxShadow: "0 12px 32px rgba(15,23,42,0.12)",
    padding: "10px 12px",
  },
  itemStyle: { fontSize: 12, color: "#0f172a" },
  labelStyle: { fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 },
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
    (nextFilters: Filters) => {
      router.replace(`${pathname}${buildDashboardUrl(nextFilters)}`, { scroll: false });
    },
    [pathname, router],
  );

  const applyDashboardState = useCallback(
    (nextFilters: Filters, nextTrail: DrillStep[]) => {
      setFilters(nextFilters);
      setTrail(nextTrail);
      syncUrl(nextFilters);
    },
    [syncUrl],
  );

  useEffect(() => {
    if (!data || urlHydrated.current) return;
    const parsed = parseDashboardUrl(searchParams);
    setFilters(parsed.filters);
    setTrail(trailFromFilters(parsed.filters, projectShort));
    urlHydrated.current = true;
  }, [data, searchParams, projectShort]);

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
    if (opts?.scroll !== false) {
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
    if (opts?.scroll !== false) {
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
      document.getElementById("detail-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">
        Loading live data from Google Sheets…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg p-12 text-center">
        <p className="font-semibold text-[var(--bad)]">Failed to load dashboard</p>
        <p className="mt-2 text-sm text-[var(--muted)]">{error}</p>
        <button
          type="button"
          onClick={() => setReloadSeq((seq) => seq + 1)}
          className="mt-4 rounded-full bg-[var(--accent-deep)] px-5 py-2.5 text-sm font-semibold text-white"
        >
          Retry
        </button>
      </div>
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
      <header className="panel rise-in mb-5 overflow-hidden p-7 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              Construction Materials
            </h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">
              Demand–supply intelligence loaded live from Google Sheets. Unit:{" "}
              <strong className="text-[var(--ink)]">{unit}</strong>.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={data.source.sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-[#0f9d58] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110"
              >
                <SheetIcon />
                Open Google Sheet
                <span className="text-white/80" aria-hidden>
                  ↗
                </span>
              </a>
              <a
                href={`https://docs.google.com/spreadsheets/d/${data.source.sheetId}/export?format=xlsx`}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-bold text-[var(--ink)] transition hover:bg-[#f8fafc]"
              >
                Download Excel (.xlsx)
              </a>
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[#f8fafc] px-4 py-3 text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
              Last fetch
            </p>
            <p className="kpi-value mt-1 text-sm font-semibold">
              {new Date(data.source.fetchedAt).toLocaleString()}
            </p>
            <a
              href={data.source.sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-[11px] font-semibold text-[var(--accent-deep)] underline underline-offset-2"
            >
              View source sheet
            </a>
          </div>
        </div>
      </header>

      {/* What is unmet */}
      <div className="panel mb-5 border-l-4 border-l-rose-500 p-4 md:px-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-600">
          What is unmet?
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
          <strong className="text-[var(--ink)]">Unmet</strong> = shortage where demand exceeds
          supply:{" "}
          <span className="kpi-value font-semibold text-[var(--ink)]">
            max(Demand − Supply, 0)
          </span>
          . Surplus locations (supply &gt; demand) count as <strong>0</strong> unmet — they do not
          cancel shortages elsewhere.{" "}
          <strong className="text-[var(--ink)]">Balance</strong> = Supply − Demand (can be
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
              drillTo({ key: "project", value: v, label: projectShort(v) }, { scroll: false });
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
              drillTo({ key: "material", value: v, label: v }, { scroll: false });
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
              drillTo({ key: "location", value: v, label: v }, { scroll: false });
            }
          }}
        />
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={resetFilters}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm font-bold text-[var(--ink)] transition hover:bg-[#f8fafc]"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => setReloadSeq((seq) => seq + 1)}
            className="w-full rounded-xl bg-[var(--accent-deep)] px-3 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
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
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
          Drill
        </span>
        <button
          type="button"
          onClick={() => goBreadcrumb(-1)}
          className={`rounded-full px-3 py-1 text-xs font-bold transition ${
            trail.length === 0
              ? "bg-sky-600 text-white"
              : "bg-sky-50 text-sky-800 hover:bg-sky-100"
          }`}
        >
          All
        </button>
        {trail.map((step, i) => (
          <span key={`${step.key}-${step.value}`} className="inline-flex items-center gap-2">
            <span className="text-[var(--muted)]">›</span>
            <button
              type="button"
              onClick={() => goBreadcrumb(i)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                i === trail.length - 1
                  ? "bg-sky-600 text-white"
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
            className="ml-auto text-xs font-semibold text-[var(--muted)] underline"
          >
            ← Back
          </button>
        )}
        <button
          type="button"
          onClick={scrollToTable}
          className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold text-[var(--ink)] hover:bg-[#f8fafc]"
        >
          View rows ↓
        </button>
      </nav>

      {/* Outlier watch — single records big enough to distort every KPI */}
      {outliers.length > 0 && (
        <div className="rise-in mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/80 bg-gradient-to-r from-amber-50 to-white px-5 py-4 text-sm text-amber-950">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-black text-white">
            !
          </span>
          <p className="min-w-0 flex-1">
            <strong>Data watch:</strong>{" "}
            {outliers.map((o, i) => (
              <span key={o.record.id}>
                {i > 0 && ", "}
                <button
                  type="button"
                  className="font-bold underline underline-offset-2"
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
            className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition ${
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
        <div className="rise-in mb-5 flex gap-3 rounded-2xl border border-rose-200/80 bg-gradient-to-r from-rose-50 to-white px-5 py-4 text-sm text-rose-900">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-600 text-[11px] font-black text-white">
            !
          </span>
          <p>
            <strong>Concentration:</strong> {byLocation[0].name} holds{" "}
            {(topLocShare * 100).toFixed(1)}% of unmet demand ({fmt(byLocation[0].unmet)} {unit}
            ).{" "}
            <button
              type="button"
              className="font-bold underline"
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

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard
          label="Total demand"
          value={fmt(t.demand)}
          sub={`${pLabel}, ${unit}${excludeOutliers ? " · excl. outliers" : ""}`}
          delay={0}
        />
        <KpiCard label="Supply capacity" value={fmt(t.supply)} sub="Available capacity" delay={1} />
        <KpiCard
          label="Unmet demand"
          value={fmt(t.unmet)}
          sub="max(D − S, 0)"
          hot
          delay={2}
        />
        <KpiCard label="Net balance" value={fmt(t.balance)} sub="Supply − demand" delay={3} />
        <KpiCard
          label="Coverage"
          value={pct(coverage)}
          sub={excludeOutliers ? "Supply ÷ demand · excl. outliers" : "Supply ÷ demand"}
          delay={4}
        />
      </div>

      {/* Bridge to the sheet's own summary tab, so the larger totals here never
          read as a data mismatch — shown only at full (unfiltered) scope */}
      {kpiBridge && kpiBridge.extras.length > 0 &&
        filters.project === "All" &&
        filters.material === "All" &&
        filters.location === "All" && (
          <div className="panel mb-5 border-l-4 border-l-sky-500 px-4 py-3 text-xs leading-relaxed text-[var(--muted)]">
            <strong className="text-[var(--ink)]">
              Why total demand here is larger than the sheet’s Dashboard tab:
            </strong>{" "}
            that tab counts only the three main sections —{" "}
            <span className="kpi-value font-semibold text-[var(--ink)]">
              {fmt(kpiBridge.main)}
            </span>{" "}
            demand in {pLabel}. This dashboard also includes{" "}
            {kpiBridge.extras.map(([cat, v], i) => (
              <span key={cat}>
                {i > 0 && " and "}
                <strong className="text-[var(--ink)]">{cat}</strong> (+{fmt(v)})
              </span>
            ))}
            , which exist in Appendix 2 but are missing from the sheet’s own summary. Together:{" "}
            <span className="kpi-value font-semibold text-[var(--ink)]">
              {fmt(kpiBridge.total)}
            </span>
            . Nothing is double-counted — use the Project filter to view any group alone.
          </div>
        )}

      <SectionDivider
        index={1}
        title="Map command center"
        desc="Click a province — every chart and table below follows"
      />
      <div id="section-map" className="mb-5">
        <ProvinceMap
          locationAgg={byLocationAll}
          periodLabel={pLabel}
          selectedLocation={filters.location}
          materialFilter={filters.material}
          onDrill={(l) => drillTo({ key: "location", value: l, label: l }, { scroll: false })}
        />
      </div>

      <SectionDivider
        index={2}
        title="Overview"
        desc="The big picture — where the shortages are"
      />
      <div id="section-overview" className="mb-5 space-y-5">
      <div className="panel rise-in p-5" style={{ animationDelay: "80ms" }}>
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

          <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
            Demand <strong className="text-[var(--ink)]">{fmt(t.demand)}</strong> vs supply{" "}
            <strong className="text-[var(--ink)]">{fmt(t.supply)}</strong> → coverage{" "}
            <strong className="text-[var(--ink)]">{pct(coverage)}</strong>, unmet{" "}
            <strong className="text-[var(--bad)]">{fmt(t.unmet)}</strong> ({unit}).
          </p>

          {drillLevel === "overview" && dominant && topLoc && (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() =>
                    drillTo({ key: "material", value: dominant.name, label: dominant.name })
                  }
                  className="rounded-xl border border-rose-200/80 bg-rose-50/60 px-3 py-2.5 text-left transition hover:border-rose-300 hover:bg-rose-50"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wide text-rose-600">
                    Material driver
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-[var(--ink)]">{dominant.name}</p>
                  <p className="kpi-value mt-0.5 text-xs text-[var(--muted)]">
                    {pct(dominant.share)} of unmet · {fmt(dominant.value)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    drillTo({ key: "location", value: topLoc.name, label: topLoc.name })
                  }
                  className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-3 py-2.5 text-left transition hover:border-amber-300 hover:bg-amber-50"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">
                    Location driver
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-[var(--ink)]">{topLoc.name}</p>
                  <p className="kpi-value mt-0.5 text-xs text-[var(--muted)]">
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
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-deep)] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
              >
                Drill {dominant.name} → {topLoc.name}
                <span aria-hidden>→</span>
              </button>
            </>
          )}

          {drillLevel === "material" && (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-[var(--muted)]">
                Scoped to <strong className="text-[var(--ink)]">{filters.material}</strong>
                {nextLocUnderMaterial ? (
                  <>
                    . Top shortage locality:{" "}
                    <strong className="text-[var(--ink)]">{nextLocUnderMaterial.name}</strong> (
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
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-deep)] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
                >
                  Next: drill into {nextLocUnderMaterial.name}
                  <span aria-hidden>→</span>
                </button>
              )}
            </div>
          )}

          {drillLevel === "location" && (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-[var(--muted)]">
                Scoped to <strong className="text-[var(--ink)]">{filters.location}</strong>
                {filters.material !== "All" ? (
                  <>
                    {" "}
                    × <strong className="text-[var(--ink)]">{filters.material}</strong>
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
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-deep)] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
                >
                  Next: filter {dominant.name} here
                  <span aria-hidden>→</span>
                </button>
              )}
              {filters.material !== "All" && (
                <button
                  type="button"
                  onClick={scrollToTable}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-bold text-[var(--ink)] transition hover:bg-[#f8fafc]"
                >
                  View {scoped.length} detail rows ↓
                </button>
              )}
            </div>
          )}

          {drillLevel === "project" && (
            <p className="mt-3 text-sm text-[var(--muted)]">
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
                                className="fill-[var(--muted)]"
                                style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  letterSpacing: "0.14em",
                                }}
                              >
                                TOTAL UNMET
                              </text>
                              <text
                                x={cx}
                                y={cy + 6}
                                textAnchor="middle"
                                className="fill-[var(--ink)]"
                                style={{
                                  fontSize: 22,
                                  fontWeight: 600,
                                  fontFamily: "var(--font-fraunces), Georgia, serif",
                                }}
                              >
                                {fmt(t.unmet)}
                              </text>
                              <text
                                x={cx}
                                y={cy + 24}
                                textAnchor="middle"
                                className="fill-[var(--muted)]"
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
              <div className="flex h-3 overflow-hidden rounded-full bg-[#eef2f7]">
                {shareRows.map((d) => (
                  <button
                    key={d.name}
                    type="button"
                    title={`${d.name}: ${pct(d.share)}`}
                    className="h-full transition-[filter] duration-200 hover:brightness-110"
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
                      className="group w-full rounded-xl px-2 py-1.5 text-left transition hover:bg-[#f8fafc]"
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
                          <span className="truncate text-sm font-semibold text-[var(--ink)]">
                            <span className="mr-1.5 text-[10px] font-bold text-[var(--muted)]">
                              {String(i + 1).padStart(2, "0")}
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
                            style={{
                              width: `${d.share * 100}%`,
                              background: d.color,
                            }}
                          />
                        </div>
                        <span className="kpi-value w-[4.5rem] text-right text-[11px] text-[var(--muted)]">
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
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                  excludeTopLoc
                    ? "bg-sky-600 text-white"
                    : "border border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[#f8fafc]"
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
              className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-left text-xs transition hover:bg-rose-50"
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
                  className="group w-full rounded-xl px-2 py-1.5 text-left transition hover:bg-[#fff1f2]"
                  title={`${d.name} · unmet ${fmt(d.unmet)} · ${pct(d.shareOfScope)} of scope`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-5 shrink-0 text-[10px] font-bold tabular-nums text-[var(--muted)]">
                        {String(d.rank).padStart(2, "0")}
                      </span>
                      <span className="truncate text-sm font-semibold text-[var(--ink)] group-hover:text-rose-800">
                        {d.short}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-2">
                      <span className="kpi-value text-[11px] font-bold text-rose-700">
                        {pct(d.shareOfScope)}
                      </span>
                      <span className="kpi-value w-[3.6rem] text-right text-xs text-[var(--muted)]">
                        {fmt(d.unmet)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1.5 ml-7 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${d.barPct}%`, background: d.color }}
                    />
                  </div>
                </button>
              </li>
            ))}
            {locationRank.length === 0 && (
              <li className="px-2 py-6 text-center text-sm text-[var(--muted)]">
                No unmet shortage in this scope
              </li>
            )}
          </ul>
        </div>
      </div>

      <SectionDivider
        index={3}
        title="Charts & comparisons"
        desc="Materials, periods and priorities side by side"
      />
      <div id="section-analysis" className="mb-5 space-y-5">
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
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tickFormatter={(v) => compact(v)}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  {...tooltipStyle}
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
          <SectionHead title={`Gap bridge · ${pLabel}`} subtitle="Demand → supply → unmet" />
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { name: "Demand", value: t.demand, fill: DEMAND_COLOR },
                  { name: "Supply", value: t.supply, fill: SUPPLY_COLOR },
                  { name: "Unmet", value: t.unmet, fill: UNMET_COLOR },
                ]}
                margin={{ left: 4, right: 8, bottom: 8, top: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => compact(v)}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v) => fmt(Number(v))}
                  cursor={{ fill: "rgba(14,165,233,0.06)" }}
                />
                <Bar dataKey="value" radius={[10, 10, 0, 0]} maxBarSize={72}>
                  {[DEMAND_COLOR, SUPPLY_COLOR, UNMET_COLOR].map((c) => (
                    <Cell key={c} fill={c} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
            {[
              { l: "Demand", v: fmt(t.demand), tip: "Required volume" },
              { l: "Supply", v: fmt(t.supply), tip: "Available capacity" },
              { l: "Unmet", v: fmt(t.unmet), tip: "Shortage only" },
            ].map((x) => (
              <div key={x.l} className="rounded-xl bg-[#f8fafc] px-2 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                  {x.l}
                </p>
                <p className="kpi-value mt-0.5 font-bold">{x.v}</p>
                <p className="mt-0.5 text-[10px] text-[var(--muted)]">{x.tip}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
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
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tickFormatter={(v) => compact(v)}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  {...tooltipStyle}
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
                        <p className="text-xs font-bold text-[var(--ink)]">{p.name}</p>
                        <p className="mt-1 text-[11px] text-[var(--muted)]">
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
      </div>

      <SectionDivider
        index={4}
        title="Detail rows & data checks"
        desc="Every record, plus proof the numbers match the sheet"
      />
      <div id="section-details" className="mb-5 space-y-5">
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

      <div id="detail-table" className="panel mb-5 scroll-mt-24 overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Detail records</h2>
            <p className="text-sm text-[var(--muted)]">
              {scoped.length} rows
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
              className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-800"
            >
              Clear drill
            </button>
          )}
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#f8fafc] text-left text-[10px] uppercase tracking-wider text-[#64748b]">
              <tr>
                <th className="px-4 py-3 font-bold">Location</th>
                <th className="px-4 py-3 font-bold">Material</th>
                <th className="px-4 py-3 font-bold">Project</th>
                <th className="px-4 py-3 text-right font-bold">Demand</th>
                <th className="px-4 py-3 text-right font-bold">Supply</th>
                <th className="px-4 py-3 text-right font-bold">Unmet</th>
                <th className="px-4 py-3 text-right font-bold">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {[...scoped]
                .sort((a, b) => b[f.u] - a[f.u])
                .slice(0, 200)
                .map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-[var(--line)] transition hover:bg-[#f0f9ff]"
                  >
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        className="font-medium text-sky-800 underline-offset-2 hover:underline"
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
                        className="text-sky-800 underline-offset-2 hover:underline"
                        onClick={() =>
                          drillTo({ key: "material", value: r.material, label: r.material })
                        }
                      >
                        {r.material}
                      </button>
                    </td>
                    <td
                      className="max-w-[200px] truncate px-4 py-2.5 text-[var(--muted)]"
                      title={r.project}
                    >
                      {shortLabel(r.project)}
                    </td>
                    <td className="kpi-value px-4 py-2.5 text-right">{fmt(r[f.d])}</td>
                    <td className="kpi-value px-4 py-2.5 text-right">{fmt(r[f.s])}</td>
                    <td className="kpi-value px-4 py-2.5 text-right font-semibold text-[var(--bad)]">
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

      <footer className="panel mb-2 flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-xs text-[var(--muted)]">
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
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0f9d58] px-3 py-1.5 font-bold text-white"
          >
            <SheetIcon className="h-3.5 w-3.5" />
            Open sheet ↗
          </a>
          <a
            href={`https://docs.google.com/spreadsheets/d/${data.source.sheetId}/export?format=xlsx`}
            className="inline-flex items-center rounded-full border border-[var(--line)] bg-white px-3 py-1.5 font-bold text-[var(--ink)]"
          >
            Download Excel
          </a>
        </div>
      </footer>
    </main>
  );
}
