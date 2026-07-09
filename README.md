# Construction Materials Dashboard (Next.js)

Live dashboard that reads from [Google Sheets](https://docs.google.com/spreadsheets/d/1Hn6HBQcVP6vSvNm5I1W31Onttal9czN5_-h68ZEGmVY/edit).

## Data source

| Sheet tab     | Purpose                                      |
|---------------|----------------------------------------------|
| **DashData**  | Detail rows (category × material × locality) |
| **Dashboard** | Summary KPIs, material & category totals     |
| Appendix2     | Raw source (linked in sheet)                 |
| Drilldown     | Pivot-style drill hierarchy                  |

The app fetches **DashData** for charts/filters and **Dashboard** for headline KPIs.

## Requirements

- Node.js 18+
- Google Sheet must be **shared as “Anyone with the link can view”** (required for public CSV/JSON export)

## Setup

```bash
cd dashboard-next
npm install
cp .env.example .env.local   # already configured with sheet ID
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment

```env
GOOGLE_SHEET_ID=1Hn6HBQcVP6vSvNm5I1W31Onttal9czN5_-h68ZEGmVY
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.your_mapbox_token
```

Get a free Mapbox token at [account.mapbox.com/access-tokens](https://account.mapbox.com/access-tokens/) (required for the interactive province map).

## API

`GET /api/data` — returns parsed dashboard payload (cached 5 minutes on server).

## Features

- Live data from Google Sheets (Refresh button + server revalidation)
- **Story-first layout** — Overview / Analysis / Details tabs reduce cognitive load
- **Shareable URLs** — filters and drill state sync to query params (`?material=…&location=…&view=details`)
- KPI cards, province map, coverage heatmap, reallocation panel
- Drill-down filters via chart clicks and breadcrumb trail
- Concentration and outlier alerts for skewed distributions
- Detail table with row-level drill

### URL parameters

| Param | Values | Example |
|-------|--------|---------|
| `period` | `2026`, `2730` | `?period=2730` |
| `project` | sheet project name | `?project=…` |
| `material` | sheet material name | `?material=Filling+sand` |
| `location` | sheet locality | `?location=Can+Tho` |
| `view` | `overview`, `analysis`, `details` | `?view=analysis` |

## Build & deploy

```bash
npm run build
npm start
```

### Vercel

```bash
cd dashboard-next
npx vercel --prod
```

Set `GOOGLE_SHEET_ID` and `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` in the Vercel project environment variables. The sheet must remain publicly viewable.

## Legacy HTML dashboard

The single-file v5 dashboard remains at:

`../construction_materials_final_light_dashboard_drillthrough (1).html`

Use `build_dashboard_data.py` to refresh embedded Excel data for the offline version.
