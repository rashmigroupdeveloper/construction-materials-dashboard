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
```

## API

`GET /api/data` — returns parsed dashboard payload (cached 5 minutes on server).

## Features

- Live data from Google Sheets (Refresh button + server revalidation)
- KPI cards, period comparison, gap bridge, material/location charts
- Drill-down filters via chart clicks
- Concentration outlier alert (when top locality >50% of unmet)
- Detail table with search filters

## Build & deploy

```bash
npm run build
npm start
```

Deploy to Vercel — set `GOOGLE_SHEET_ID` in project environment variables.

## Legacy HTML dashboard

The single-file v5 dashboard remains at:

`../construction_materials_final_light_dashboard_drillthrough (1).html`

Use `build_dashboard_data.py` to refresh embedded Excel data for the offline version.
