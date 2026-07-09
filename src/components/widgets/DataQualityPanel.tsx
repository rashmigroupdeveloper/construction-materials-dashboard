"use client";

import { fmt } from "@/lib/aggregate";
import { shortLabel } from "@/lib/labels";
import type { DataIntegrity } from "@/lib/types";
import { SectionHead } from "../ui";

interface DataQualityPanelProps {
  integrity: DataIntegrity;
  recordsInScope: number;
  surplusRowsInScope: number;
  basePeriodLabel: string;
}

/**
 * Live reconciliation of the API payload against the sheet's own summary
 * tables, so silent drift between raw data and published totals is visible.
 */
export default function DataQualityPanel({
  integrity,
  recordsInScope,
  surplusRowsInScope,
  basePeriodLabel,
}: DataQualityPanelProps) {
  const allOk = integrity.materialChecks.every((c) => c.ok);
  const { supplemental, totalSection } = integrity;
  const totalOk = totalSection.checks.every((c) => c.ok);

  return (
    <div className="panel rise-in p-5" style={{ animationDelay: "120ms" }}>
      <SectionHead
        title="Data integrity"
        subtitle="Recomputed from raw records on every fetch"
      />

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        <QualityChip label="Records in scope" value={String(recordsInScope)} good />
        <QualityChip label="Surplus rows" value={String(surplusRowsInScope)} good />
        <QualityChip
          label="Balance errors"
          value={String(integrity.balanceMismatches)}
          good={integrity.balanceMismatches === 0}
        />
        <QualityChip
          label="Dupes merged"
          value={String(integrity.duplicatesMerged)}
          good
          note={`${integrity.zeroRowsDropped} zero rows dropped`}
        />
      </div>

      {integrity.materialChecks.length > 0 && (
        <div className="mt-3 rounded-xl border border-[var(--line)] bg-[#f8fafc] p-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
              Sheet reconciliation · demand {basePeriodLabel} by material
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                allOk ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
              }`}
            >
              {allOk ? "MATCHES SHEET" : "DRIFT DETECTED"}
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {integrity.materialChecks.map((c) => (
              <li key={c.material} className="flex items-center justify-between text-xs">
                <span className="text-[var(--muted)]">{shortLabel(c.material)}</span>
                <span className="kpi-value flex items-center gap-2 tabular-nums">
                  {fmt(c.computedDemand2026)}
                  {c.ok ? (
                    <span className="font-bold text-emerald-600">✓</span>
                  ) : (
                    <span className="font-bold text-rose-600">Δ {fmt(c.delta)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {totalSection.found && totalSection.checks.length > 0 && (
        <div className="mt-3 rounded-xl border border-[var(--line)] bg-[#f8fafc] p-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
              Appendix “{totalSection.title}” · demand {basePeriodLabel} by material
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                totalOk ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
              }`}
            >
              {totalOk ? "MATCHES TOTAL" : "SHEET TOTAL DIFFERS"}
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {totalSection.checks.map((c) => (
              <li key={c.material} className="flex items-center justify-between text-xs">
                <span className="text-[var(--muted)]">{shortLabel(c.material)}</span>
                <span className="kpi-value flex items-center gap-2 tabular-nums">
                  {fmt(c.computedDemand2026)}
                  {c.ok ? (
                    <span className="font-bold text-emerald-600">✓</span>
                  ) : (
                    <span className="font-bold text-amber-600">
                      sheet {fmt(c.sheetDemand2026)} · Δ {fmt(c.delta)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {!totalOk && (
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
              The appendix&apos;s own total section disagrees with the sum of its detail
              sections. The dashboard shows sums recomputed from every detail row, so no
              data is lost — the drift above is in the source sheet itself.
            </p>
          )}
        </div>
      )}

      {totalSection.provincesAdded.length > 0 && (
        <div className="mt-3 rounded-xl border border-sky-200/80 bg-sky-50/50 p-3 text-xs leading-relaxed text-sky-900">
          <strong>Localities recovered from the total section:</strong>{" "}
          {totalSection.provincesAdded.join(", ")} appear only in “{totalSection.title}”
          and in no detail section. Their figures are included under{" "}
          <strong>{totalSection.category}</strong> so nothing in the sheet is dropped.
        </div>
      )}

      <div
        className={`mt-3 rounded-xl border p-3 text-xs leading-relaxed ${
          supplemental.loaded && supplemental.records > 0
            ? "border-teal-200/80 bg-teal-50/50 text-teal-900"
            : "border-amber-200/80 bg-amber-50/60 text-amber-900"
        }`}
      >
        {supplemental.loaded && supplemental.records > 0 ? (
          <>
            <strong>Supplemental section(s) included:</strong>{" "}
            {supplemental.sections.join(", ")} ({supplemental.records} records found in the
            appendix but absent from the records sheet): +{fmt(supplemental.demand2026)} demand /
            +{fmt(supplemental.supply2026)} supply in {basePeriodLabel}, +
            {fmt(supplemental.demand2730)} / +{fmt(supplemental.supply2730)} later. The
            sheet&apos;s own totals exclude them.
          </>
        ) : supplemental.loaded ? (
          <>
            <strong>No supplemental sections found</strong> — every appendix section is
            represented in the records sheet.
          </>
        ) : (
          <>
            <strong>Appendix unavailable</strong> — supplemental sections could not be checked,
            so totals reflect the records sheet only.
          </>
        )}
      </div>
    </div>
  );
}

function QualityChip({
  label,
  value,
  good,
  note,
}: {
  label: string;
  value: string;
  good: boolean;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[#f8fafc] p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p
        className={`kpi-value mt-1 text-lg font-bold ${good ? "" : "text-[var(--bad)]"}`}
      >
        {value}
      </p>
      {note && <p className="mt-0.5 text-[10px] text-[var(--muted)]">{note}</p>}
    </div>
  );
}
