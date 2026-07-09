"use client";

import type { DashboardView } from "@/lib/url-state";

const TABS: { id: DashboardView; label: string; hint: string }[] = [
  { id: "overview", label: "Overview", hint: "Story, map, top shortages" },
  { id: "analysis", label: "Analysis", hint: "Charts and comparisons" },
  { id: "details", label: "Details", hint: "Heatmap and row data" },
];

interface ViewTabsProps {
  view: DashboardView;
  onChange: (view: DashboardView) => void;
}

export default function ViewTabs({ view, onChange }: ViewTabsProps) {
  return (
    <nav
      aria-label="Dashboard sections"
      className="panel mb-5 flex flex-wrap gap-2 p-2"
      role="tablist"
    >
      {TABS.map((tab) => {
        const selected = view === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`flex min-h-[44px] flex-1 flex-col items-center justify-center rounded-xl px-4 py-2.5 text-center transition sm:flex-none sm:min-w-[9rem] ${
              selected
                ? "bg-[var(--accent-deep)] text-white shadow-sm"
                : "bg-white text-[var(--ink)] hover:bg-[#f8fafc]"
            }`}
          >
            <span className="text-sm font-bold">{tab.label}</span>
            <span
              className={`mt-0.5 hidden text-[10px] sm:block ${
                selected ? "text-white/80" : "text-[var(--muted)]"
              }`}
            >
              {tab.hint}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
