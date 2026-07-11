"use client";

import { useMemo } from "react";
import { fmt, pct } from "@/lib/aggregate";
import { categoryShift } from "@/lib/insights";
import type { MaterialRecord } from "@/lib/types";
import { SectionHead } from "../ui";

/** Design palette — assigned to categories by rank, not by name */
const PALETTE = ["#0369a1", "#0f766e", "#d97706", "#475569", "#0ea5e9", "#be123c"];

interface CategoryShiftProps {
  rows: MaterialRecord[];
  periods: [string, string];
}

/**
 * Demand mix by project category across the two periods — shows at a glance
 * whether the same actors drive demand now and later, entirely from the data.
 */
export default function CategoryShift({ rows, periods }: CategoryShiftProps) {
  const data = useMemo(() => categoryShift(rows), [rows]);

  const colorOf = useMemo(() => {
    const map = new Map(data.map((d, i) => [d.category, PALETTE[i % PALETTE.length]]));
    return (category: string) => map.get(category) ?? PALETTE[PALETTE.length - 1];
  }, [data]);

  const mover = useMemo(() => {
    if (data.length === 0) return null;
    return [...data].sort(
      (a, b) => Math.abs(b.share2730 - b.share2026) - Math.abs(a.share2730 - a.share2026),
    )[0];
  }, [data]);

  if (data.length === 0) return null;

  return (
    <div className="panel p-5">
      <SectionHead
        title="Who drives demand, when"
        subtitle={`Demand mix by project category · ${periods[0]} vs ${periods[1]}`}
      />

      <div className="mt-4 space-y-4">
        <MixBar
          label={periods[0]}
          colorOf={colorOf}
          data={data.map((d) => ({ name: d.category, share: d.share2026, value: d.demand2026 }))}
        />
        <MixBar
          label={periods[1]}
          colorOf={colorOf}
          data={data.map((d) => ({ name: d.category, share: d.share2730, value: d.demand2730 }))}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {data.map((d) => (
          <span
            key={d.category}
            className="inline-flex items-center gap-1.5 text-[11px] text-(--muted)"
          >
            <span className="h-2 w-2 rounded-sm" style={{ background: colorOf(d.category) }} />
            {d.category}
          </span>
        ))}
      </div>

      {mover && (
        <p className="mt-3 rounded-xl border border-(--line) bg-(--surface-muted) px-3 py-2.5 text-sm text-(--muted)">
          Biggest shift: <strong className="text-foreground">{mover.category}</strong> goes from{" "}
          <strong className="text-foreground">{pct(mover.share2026)}</strong> of {periods[0]}{" "}
          demand to <strong className="text-foreground">{pct(mover.share2730)}</strong> in{" "}
          {periods[1]} — plan capacity and contracts for where demand is heading, not where it is.
        </p>
      )}
    </div>
  );
}

function MixBar({
  label,
  data,
  colorOf,
}: {
  label: string;
  data: { name: string; share: number; value: number }[];
  colorOf: (category: string) => string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold text-(--muted)">
          {label}
        </span>
        <span className="kpi-value text-[11px] text-(--muted)">
          {fmt(data.reduce((a, d) => a + d.value, 0))} total
        </span>
      </div>
      <div className="flex h-6 overflow-hidden rounded-lg bg-(--track)">
        {data.map(
          (d) =>
            d.share > 0 && (
              <div
                key={d.name}
                title={`${d.name}: ${pct(d.share)} (${fmt(d.value)})`}
                className="flex h-full items-center justify-center overflow-hidden text-[10px] font-bold text-white"
                style={{
                  width: `${d.share * 100}%`,
                  background: colorOf(d.name),
                }}
              >
                {d.share > 0.12 ? pct(d.share) : ""}
              </div>
            ),
        )}
      </div>
    </div>
  );
}
