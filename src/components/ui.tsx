"use client";

export function SheetIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z" />
      <path d="M7 7h4v4H7zm6 0h4v2h-4zm0 4h4v2h-4zM7 13h4v4H7zm6 2h4v2h-4z" opacity=".85" />
    </svg>
  );
}

export function SectionHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-0.5 text-xs text-(--muted)">{subtitle}</p>
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <span
          key={it.label}
          className="inline-flex items-center gap-1.5 text-[11px] text-(--muted)"
        >
          <span className="h-2 w-2 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Dense toolbar metrics — not hero KPI cards */
export function MetricStrip({
  items,
}: {
  items: { label: string; value: string; sub: string; hot?: boolean }[];
}) {
  return (
    <div
      className="panel mb-5 grid grid-cols-2 divide-y divide-(--line) sm:grid-cols-3 sm:divide-y-0 md:grid-cols-5 md:divide-x"
      role="group"
      aria-label="Key metrics"
    >
      {items.map((item) => (
        <div key={item.label} className="px-4 py-3">
          <p className="text-xs font-semibold text-(--muted)">{item.label}</p>
          <p
            className={`kpi-value mt-1 text-xl font-semibold tracking-tight ${
              item.hot ? "text-(--bad)" : "text-foreground"
            }`}
          >
            {item.value}
          </p>
          <p className="mt-0.5 text-[11px] text-(--muted)">{item.sub}</p>
        </div>
      ))}
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-(--muted)">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="ui-transition rounded-xl border border-(--line) bg-white px-3 py-2.5 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-500/15"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ModeTabs({
  value,
  onChange,
}: {
  value: "triage" | "deep";
  onChange: (v: "triage" | "deep") => void;
}) {
  const tabs: { id: "triage" | "deep"; label: string }[] = [
    { id: "triage", label: "Triage" },
    { id: "deep", label: "Deep dive" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Dashboard mode"
      className="inline-flex rounded-xl border border-(--line) bg-(--surface-muted) p-1"
    >
      {tabs.map((tab) => {
        const selected = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            id={`mode-tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`pressable rounded-lg px-3.5 py-1.5 text-sm font-semibold ${
              selected
                ? "bg-(--accent-deep) text-white shadow-sm"
                : "text-(--muted) hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
