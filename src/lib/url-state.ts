import type { Filters, Period } from "./types";

const VALID_PERIODS: Period[] = ["2026", "2730"];

export function parseDashboardUrl(searchParams: URLSearchParams): { filters: Filters } {
  const period = searchParams.get("period");

  return {
    filters: {
      period: VALID_PERIODS.includes(period as Period) ? (period as Period) : "2026",
      project: searchParams.get("project") ?? "All",
      material: searchParams.get("material") ?? "All",
      location: searchParams.get("location") ?? "All",
    },
  };
}

export function buildDashboardUrl(filters: Filters): string {
  const params = new URLSearchParams();

  if (filters.period !== "2026") params.set("period", filters.period);
  if (filters.project !== "All") params.set("project", filters.project);
  if (filters.material !== "All") params.set("material", filters.material);
  if (filters.location !== "All") params.set("location", filters.location);

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Rebuild breadcrumb trail from active filter dimensions */
export function trailFromFilters(
  filters: Filters,
  projectLabel: (p: string) => string,
): { key: "project" | "material" | "location"; value: string; label: string }[] {
  const steps: { key: "project" | "material" | "location"; value: string; label: string }[] = [];
  if (filters.project !== "All") {
    steps.push({ key: "project", value: filters.project, label: projectLabel(filters.project) });
  }
  if (filters.material !== "All") {
    steps.push({ key: "material", value: filters.material, label: filters.material });
  }
  if (filters.location !== "All") {
    steps.push({ key: "location", value: filters.location, label: filters.location });
  }
  return steps;
}
