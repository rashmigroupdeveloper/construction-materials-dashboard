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
      <h2 className="font-display text-lg font-semibold tracking-tight text-[var(--ink)]">
        {title}
      </h2>
      <p className="mt-0.5 text-[12px] text-[var(--muted)]">{subtitle}</p>
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <span
          key={it.label}
          className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]"
        >
          <span className="h-2 w-2 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  hot,
  delay = 0,
}: {
  label: string;
  value: string;
  sub: string;
  hot?: boolean;
  delay?: number;
}) {
  return (
    <div
      className="panel rise-in relative overflow-hidden p-4"
      style={{ animationDelay: `${delay * 40}ms` }}
    >
      <div
        className={`absolute inset-x-0 top-0 h-[3px] ${
          hot
            ? "bg-gradient-to-r from-rose-500 to-rose-400"
            : "bg-gradient-to-r from-sky-500 to-teal-600"
        }`}
      />
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </p>
      <p
        className={`kpi-value font-display mt-2 text-2xl font-semibold tracking-tight ${
          hot ? "text-[var(--bad)]" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-[var(--muted)]">{sub}</p>
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
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-500/15"
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
