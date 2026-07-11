"use client";

import { useMemo } from "react";
import { fmt, pct } from "@/lib/aggregate";
import { surplusShortageBy, transferStats } from "@/lib/insights";
import { shortLabel } from "@/lib/labels";
import type { MaterialRecord, Period } from "@/lib/types";
import { SectionHead } from "../ui";

const SURPLUS_COLOR = "#059669";
const SHORTAGE_COLOR = "#e11d48";

interface TransferPanelProps {
  rows: MaterialRecord[];
  period: Period;
  periodLabel: string;
  material: string;
  onDrillMaterial: (material: string) => void;
  onDrillLocation: (location: string) => void;
}

/**
 * Reallocation planner: pairs in-scope surplus against shortage so planners
 * can see how much of the gap is a logistics problem (move material) versus a
 * true capacity problem (produce more).
 */
export default function TransferPanel({
  rows,
  period,
  periodLabel,
  material,
  onDrillMaterial,
  onDrillLocation,
}: TransferPanelProps) {
  const stats = useMemo(() => transferStats(rows, period), [rows, period]);
  const byMaterial = useMemo(
    () =>
      surplusShortageBy(rows, "material", period).sort((a, b) => b.shortage - a.shortage),
    [rows, period],
  );
  const byLocation = useMemo(
    () => surplusShortageBy(rows, "location", period),
    [rows, period],
  );
  const topSurplus = [...byLocation].sort((a, b) => b.surplus - a.surplus).filter((d) => d.surplus > 0).slice(0, 5);
  const topShortage = [...byLocation].sort((a, b) => b.shortage - a.shortage).filter((d) => d.shortage > 0).slice(0, 5);
  const maxVal = Math.max(...byMaterial.map((d) => Math.max(d.surplus, d.shortage)), 1);

  return (
    <div className="panel p-5">
      <SectionHead
        title={material === "All" ? "Reallocation potential" : `Reallocation · ${material}`}
        subtitle={`${periodLabel} · can surplus elsewhere plug the gap?`}
      />

      <div className="mt-3 rounded-xl border border-[var(--line)] bg-[#f8fafc] px-3 py-2.5 text-sm">
        <p className="text-[var(--muted)]">
          Surplus <strong className="text-emerald-700">{fmt(stats.totalSurplus)}</strong> vs
          shortage <strong className="text-[var(--bad)]">{fmt(stats.totalShortage)}</strong> —
          moving every surplus m³ would cover{" "}
          <strong className="text-[var(--ink)]">
            {stats.coverablePct != null ? pct(stats.coverablePct) : "—"}
          </strong>{" "}
          of the shortage. The rest needs new capacity.
        </p>
      </div>

      {material === "All" ? (
        <ul className="mt-3 space-y-2">
          {byMaterial.map((d) => (
            <li key={d.name}>
              <button
                type="button"
                onClick={() => onDrillMaterial(d.name)}
                className="group w-full rounded-xl px-2 py-1.5 text-left pressable hover:bg-[#f8fafc]"
              >
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-semibold text-[var(--ink)]">{shortLabel(d.name)}</span>
                  <span className="kpi-value tabular-nums text-[var(--muted)]">
                    <span className="text-[var(--bad)]">−{fmt(d.shortage)}</span>
                    {" · "}
                    <span className="text-emerald-700">+{fmt(d.surplus)}</span>
                  </span>
                </div>
                <div className="mt-1 flex h-2.5 items-center gap-[2px]">
                  <div className="flex h-full flex-1 justify-end overflow-hidden rounded-l-full bg-rose-50">
                    <div
                      className="h-full rounded-l-full"
                      style={{
                        width: `${(d.shortage / maxVal) * 100}%`,
                        background: SHORTAGE_COLOR,
                      }}
                    />
                  </div>
                  <div className="h-full w-px bg-[var(--line)]" />
                  <div className="flex h-full flex-1 overflow-hidden rounded-r-full bg-emerald-50">
                    <div
                      className="h-full rounded-r-full"
                      style={{
                        width: `${(d.surplus / maxVal) * 100}%`,
                        background: SURPLUS_COLOR,
                      }}
                    />
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <LocalityList
            title="Surplus localities"
            tone="surplus"
            items={topSurplus.map((d) => ({ name: d.name, value: d.surplus }))}
            onDrill={onDrillLocation}
          />
          <LocalityList
            title="Shortage localities"
            tone="shortage"
            items={topShortage.map((d) => ({ name: d.name, value: d.shortage }))}
            onDrill={onDrillLocation}
          />
        </div>
      )}
    </div>
  );
}

function LocalityList({
  title,
  tone,
  items,
  onDrill,
}: {
  title: string;
  tone: "surplus" | "shortage";
  items: { name: string; value: number }[];
  onDrill: (location: string) => void;
}) {
  const surplus = tone === "surplus";
  return (
    <div
      className={`rounded-xl border p-3 ${
        surplus ? "border-emerald-200/80 bg-emerald-50/40" : "border-rose-200/80 bg-rose-50/40"
      }`}
    >
      <p
        className={`text-xs font-semibold ${
          surplus ? "text-emerald-700" : "text-rose-700"
        }`}
      >
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--muted)]">None in scope.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {items.map((it) => (
            <li key={it.name}>
              <button
                type="button"
                onClick={() => onDrill(it.name)}
                className="flex w-full items-baseline justify-between gap-2 rounded-lg px-1.5 py-1 text-xs pressable hover:bg-white/70"
              >
                <span className="font-semibold text-[var(--ink)] underline-offset-2 hover:underline">
                  {it.name}
                </span>
                <span
                  className={`kpi-value font-bold tabular-nums ${
                    surplus ? "text-emerald-700" : "text-[var(--bad)]"
                  }`}
                >
                  {surplus ? "+" : "−"}
                  {fmt(it.value)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
