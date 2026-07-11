"use client";

import { useMemo } from "react";
import { fmt, pct } from "@/lib/aggregate";
import { heatmapData, type HeatCell } from "@/lib/insights";
import { shortLabel } from "@/lib/labels";
import type { MaterialRecord, Period } from "@/lib/types";
import { SectionHead } from "../ui";

interface CoverageHeatmapProps {
  rows: MaterialRecord[];
  period: Period;
  periodLabel: string;
  onDrill: (material: string, location: string) => void;
}

/**
 * Material × locality coverage grid — the fastest way to spot which
 * material is critical where. Click any cell to drill into it.
 */
export default function CoverageHeatmap({
  rows,
  period,
  periodLabel,
  onDrill,
}: CoverageHeatmapProps) {
  const data = useMemo(() => heatmapData(rows, period), [rows, period]);

  if (data.rows.length === 0) return null;

  return (
    <div className="panel mb-5 p-5">
      <SectionHead
        title={`Coverage heatmap · ${periodLabel}`}
        subtitle="Supply ÷ demand per material and locality (top localities by demand) · click a cell to drill"
      />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left font-semibold text-[10px] text-(--muted)">
                Locality
              </th>
              {data.materials.map((m) => (
                <th
                  key={m}
                  className="px-1 py-1 text-center font-semibold text-[10px] text-(--muted)"
                >
                  {shortLabel(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.location}>
                <td className="whitespace-nowrap px-2 py-1 font-semibold text-foreground">
                  {row.location}
                </td>
                {row.cells.map((cell) => (
                  <HeatCellButton key={cell.material} cell={cell} onDrill={onDrill} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-(--muted)">
        <LegendSwatch color={cellBackground(0.1)} label="< 50% covered" />
        <LegendSwatch color={cellBackground(0.75)} label="50–99%" />
        <LegendSwatch color={cellBackground(1.2)} label="≥ 100% (surplus)" />
        <LegendSwatch color="#f1f5f9" label="no demand" />
      </div>
    </div>
  );
}

function cellBackground(coverage: number | null): string {
  if (coverage == null) return "#f1f5f9";
  if (coverage >= 1) return "rgba(5,150,105,0.18)";
  if (coverage >= 0.5) return `rgba(217,119,6,${0.12 + (1 - coverage) * 0.25})`;
  return `rgba(225,29,72,${0.14 + (1 - coverage) * 0.3})`;
}

function cellColor(coverage: number | null): string {
  if (coverage == null) return "#94a3b8";
  if (coverage >= 1) return "#047857";
  if (coverage >= 0.5) return "#92400e";
  return "#9f1239";
}

function HeatCellButton({
  cell,
  onDrill,
}: {
  cell: HeatCell;
  onDrill: (material: string, location: string) => void;
}) {
  const hasDemand = cell.demand > 0;
  return (
    <td className="p-0">
      <button
        type="button"
        disabled={!hasDemand}
        onClick={() => onDrill(cell.material, cell.location)}
        title={
          hasDemand
            ? `${cell.location} · ${cell.material}\nDemand ${fmt(cell.demand)} · Supply ${fmt(cell.supply)} · Unmet ${fmt(cell.unmet)}`
            : `${cell.location} · ${cell.material}: no demand`
        }
        className={`kpi-value block w-full rounded-lg px-1 py-2 text-center text-[11px] font-bold tabular-nums pressable ${
          hasDemand ? "cursor-pointer hover:ring-2 hover:ring-sky-400/60" : "cursor-default"
        }`}
        style={{ background: cellBackground(cell.coverage), color: cellColor(cell.coverage) }}
      >
        {hasDemand ? pct(cell.coverage) : "—"}
      </button>
    </td>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-3 w-3 rounded" style={{ background: color }} />
      {label}
    </span>
  );
}
