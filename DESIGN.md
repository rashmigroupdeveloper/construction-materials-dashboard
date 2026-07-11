---
name: Construction Materials Dashboard
description: Restrained product UI for live demand–supply triage from Google Sheets
colors:
  bg: "#eef2f6"
  surface: "#ffffff"
  surface-muted: "#f8fafc"
  track: "#eef2f7"
  ink: "#0f172a"
  muted: "#475569"
  line: "#e2e8f0"
  accent: "#0ea5e9"
  accent-deep: "#0369a1"
  accent-teal: "#0f766e"
  good: "#059669"
  warn: "#d97706"
  bad: "#e11d48"
typography:
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  heading:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  kpi:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  full: "999px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-deep}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "20px"
  metric-strip:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
---

## Overview

Product-register dashboard: restrained neutrals, one accent family (sky/teal), opaque surfaces, system sans throughout. Density is cockpit-like. Motion is feedback-only (press, state banners), never page-load choreography. Two modes — **Triage** (default) and **Deep dive** — replace a single scroll wall.

## Colors

Tinted cool neutrals (`bg`, `surface`, `surface-muted`) with ink at slate-900. Accent deep (`#0369a1`) for primary actions and selection. Semantic: good emerald, warn amber, bad rose. Muted text uses `#475569` (not washed `#64748b`) for AA contrast on light panels. No glass, no purple glow, no cream/paper body.

## Typography

One sans family for headings, body, labels, and KPI values. Tabular nums on metrics (`font-variant-numeric: tabular-nums`). No display serif. Labels are sentence case at 12px semibold — not tiny uppercase tracked eyebrows. Heading scale stays tight (1.125–1.2 ratio).

## Elevation

Panels: 1px line border + soft tinted shadow (`panel-shadow`). No `backdrop-filter` on default panels. Sticky filter bar uses the same opaque surface. Tooltips: solid white with light shadow, no blur.

## Components

- **Primary button:** accent-deep fill, `rounded-xl`, `pressable` scale 0.97 on active
- **Secondary button:** white + line border
- **Metric strip:** dense inline KPIs (label + value + sub), hot unmet in bad color — not five hero cards
- **Mode tabs:** Triage / Deep dive, one selected state (accent-deep)
- **Filters:** labeled selects, sticky under header
- **Callouts:** full border + tinted background (never `border-l-4` side stripes)
- **Charts:** Recharts with animation off or ≤200ms; hover gated to fine pointers

## Do's and Don'ts

**Do**

- Lead Triage with map + ranked shortages + decision CTA
- Keep filters and drill trail sticky and URL-synced
- Use opaque panels and sans-only UI
- Animate only state feedback under 250ms with ease-out
- Honor `prefers-reduced-motion`

**Don't**

- Number sections as scroll scaffolding (01 / 02 / 03)
- Use glassmorphism, gradient text, or side-stripe accents
- Put serif/display fonts on KPI numbers
- Auto-scroll to the detail table on every drill
- Re-animate pie/bar charts for 400–1500ms on every filter change
