import type { Feature, FeatureCollection, Geometry } from "geojson";
import { geoMercator } from "d3-geo";

type GeoFeature = Feature<Geometry, Record<string, unknown>>;

/** Walk all [lon, lat] pairs in a GeoJSON geometry tree */
function walkCoords(
  coords: unknown,
  visit: (lon: number, lat: number) => void,
): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    visit(coords[0], coords[1]);
    return;
  }
  for (const c of coords) walkCoords(c, visit);
}

/** Manual bounds — d3 geoBounds() returns world extent on this dataset */
export function vietnamBounds(
  features: GeoFeature[],
): [[number, number], [number, number]] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const f of features) {
    const geom = f.geometry;
    if (geom.type === "GeometryCollection") continue;
    walkCoords((geom as { coordinates: unknown }).coordinates, (lon, lat) => {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    });
  }

  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

/** Mercator projection — manual fit (d3 geoBounds/fitExtent broken on this GeoJSON) */
export function createVietnamProjection(
  features: GeoFeature[],
  width: number,
  height: number,
  padding: number,
) {
  const [[minLon, minLat], [maxLon, maxLat]] = vietnamBounds(features);
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;
  const midLat = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const scaleX = innerW / (lonSpan * (Math.PI / 180) * Math.cos(midLat));
  const scaleY = innerH / (latSpan * (Math.PI / 180));
  const scale = Math.min(scaleX, scaleY);

  return geoMercator()
    .center([(minLon + maxLon) / 2, (minLat + maxLat) / 2])
    .scale(scale)
    .translate([width / 2, height / 2])
    .clipExtent([
      [padding, padding],
      [width - padding, height - padding],
    ]);
}

/** Build SVG path from projected rings — avoids geoPath antimeridian artifacts (huge hit areas) */
function ringToSvgPath(
  ring: number[][],
  project: (lon: number, lat: number) => [number, number] | null,
): string {
  const parts: string[] = [];
  for (const [lon, lat] of ring) {
    const pt = project(lon, lat);
    if (!pt) continue;
    parts.push(`${parts.length ? "L" : "M"}${pt[0].toFixed(2)},${pt[1].toFixed(2)}`);
  }
  return parts.length ? `${parts.join("")}Z` : "";
}

function geometryToSvgPath(
  geometry: GeoFeature["geometry"],
  project: (lon: number, lat: number) => [number, number] | null,
): string {
  if (geometry.type === "Polygon") {
    return geometry.coordinates
      .map((ring) => ringToSvgPath(ring as number[][], project))
      .filter(Boolean)
      .join(" ");
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((poly) =>
        (poly as number[][][])
          .map((ring) => ringToSvgPath(ring, project))
          .filter(Boolean)
          .join(" "),
      )
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

export function featureToSvgPath(
  feature: GeoFeature,
  projection: ReturnType<typeof geoMercator>,
): string {
  const project = (lon: number, lat: number): [number, number] | null => {
    const pt = projection([lon, lat]);
    return pt ? ([pt[0], pt[1]] as [number, number]) : null;
  };
  return geometryToSvgPath(feature.geometry, project);
}

export function buildProvincePaths(
  geo: FeatureCollection,
  width: number,
  height: number,
  padding: number,
  sheetLocations: string[],
  metricBySheet: Map<string, ProvinceMetric>,
) {
  const features = geo.features as GeoFeature[];
  const projection = createVietnamProjection(features, width, height, padding);

  return features.map((feature) => {
    const shape = shapeNameFromFeature(feature.properties ?? {});
    const shapeId = String(feature.properties?.shapeID ?? shape);
    const sheetLoc = matchShapeToSheet(shape, sheetLocations);
    const metric = sheetLoc ? metricBySheet.get(sheetLoc) : undefined;
    const d = featureToSvgPath(feature, projection);
    return { shape, shapeId, sheetLoc, metric, d };
  });
}

/** GeoJSON — bundled locally (geoBoundaries VNM ADM1 simplified, public domain) */
export const VIETNAM_GEOJSON_URL = "/maps/vietnam-provinces.geojson";

/** Sheet locality → geoBoundaries shapeName (Vietnamese administrative names) */
export const SHEET_TO_SHAPE: Record<string, string> = {
  "Ca Mau": "Cà Mau",
  "Can Tho": "Cần Thơ",
  "Dak Lak": "Đắk Lắk",
  "Dien Bien": "Điện Biên",
  "Dong Thap": "Đồng Tháp",
  "Gia Lai": "Gia Lai",
  "Ha Tinh": "Hà Tĩnh",
  "Hai Phong": "Hải Phòng",
  Hanoi: "Hà Nội",
  "Hung Yen": "Hưng Yên",
  "Lai Chau": "Lai Châu",
  "Lam Dong": "Lâm Đồng",
  "Lang Son": "Lạng Sơn",
  "Nghe An": "Nghệ An",
  "Quang Ngai": "Quảng Ngãi",
  "Quang Ninh": "Quảng Ninh",
  "Thai Nguyen": "Thái Nguyên",
  "Thanh Hoa": "Thanh Hóa",
  "Tuyen Quang": "Tuyên Quang",
  "Vinh Long": "Vĩnh Long",
};

/** PMU / directorate rows — not mappable to a single province polygon */
export const NON_PROVINCE_LOCATIONS = new Set([
  "Ho Chi Minh Road Project Management Unit",
  "My Thuan Project Management Unit",
  "Railway Project Management Unit",
  "Vietnam Directorate for Roads",
]);

export function normalizeProvinceKey(name: string): string {
  return name
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function shapeNameFromFeature(properties: Record<string, unknown>): string {
  const raw = String(properties.shapeName ?? properties.name ?? "").trim();
  return raw.replace(/\s+/g, " ");
}

export function sheetLocationToShape(sheetLocation: string): string | null {
  if (NON_PROVINCE_LOCATIONS.has(sheetLocation)) return null;
  if (SHEET_TO_SHAPE[sheetLocation]) return SHEET_TO_SHAPE[sheetLocation];
  return sheetLocation;
}

export function matchShapeToSheet(
  shapeName: string,
  sheetLocations: string[],
): string | null {
  const shapeKey = normalizeProvinceKey(shapeName);
  for (const loc of sheetLocations) {
    const mapped = sheetLocationToShape(loc);
    if (!mapped) continue;
    if (normalizeProvinceKey(mapped) === shapeKey) return loc;
  }
  for (const loc of sheetLocations) {
    if (normalizeProvinceKey(loc) === shapeKey) return loc;
  }
  return null;
}

export interface ProvinceMetric {
  sheetLocation: string;
  shapeName: string;
  unmet: number;
  demand: number;
  supply: number;
  coverage: number | null;
}

export interface MapMetrics {
  provinces: ProvinceMetric[];
  nonProvinces: { name: string; unmet: number; demand: number; supply: number }[];
  maxUnmet: number;
}

export function buildProvinceMetrics(
  locationAgg: {
    name: string;
    unmet: number;
    demand: number;
    supply: number;
    coverage: number | null;
  }[],
): MapMetrics {
  const provinces: ProvinceMetric[] = [];
  const nonProvinces: MapMetrics["nonProvinces"] = [];

  for (const row of locationAgg) {
    if (NON_PROVINCE_LOCATIONS.has(row.name) || !sheetLocationToShape(row.name)) {
      if (NON_PROVINCE_LOCATIONS.has(row.name) || row.name.includes("Management Unit") || row.name.includes("Directorate")) {
        nonProvinces.push({
          name: row.name,
          unmet: row.unmet,
          demand: row.demand,
          supply: row.supply,
        });
      }
      continue;
    }
    const shape = sheetLocationToShape(row.name)!;
    provinces.push({
      sheetLocation: row.name,
      shapeName: shape,
      unmet: row.unmet,
      demand: row.demand,
      supply: row.supply,
      coverage: row.coverage,
    });
  }

  const maxUnmet = Math.max(...provinces.map((p) => p.unmet), 1);
  return { provinces, nonProvinces, maxUnmet };
}

/** Choropleth color scale cap — avoids one outlier washing out all other provinces */
export function colorScaleMax(unmetValues: number[]): number {
  const vals = unmetValues.filter((v) => v > 0).sort((a, b) => a - b);
  if (!vals.length) return 1;
  if (vals.length === 1) return vals[0];
  // 90th percentile (or 2nd-highest when few provinces) keeps peer gaps visible
  const p90 = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.9))];
  const second = vals[vals.length - 2];
  return Math.max(second, p90, 1);
}

/** Rose sequential fill for unmet intensity (0 → pale, max → deep) */
export function unmetFill(
  unmet: number,
  scaleMax: number,
  selected: boolean,
  dimmed: boolean,
  hasData: boolean,
): string {
  if (selected) return "#be123c";
  if (!hasData) return dimmed ? "#e8edf5" : "#dce4ef";
  if (unmet <= 0) return dimmed ? "#e8edf5" : "#d1dae6";
  const t = Math.min(1, Math.sqrt(unmet / scaleMax));
  const boosted = 0.22 + t * 0.78;
  const r = Math.round(255 - boosted * 55);
  const g = Math.round(228 - boosted * 175);
  const b = Math.round(236 - boosted * 175);
  return `rgb(${r},${g},${b})`;
}

export interface EnrichedProvinceProperties {
  shapeName: string;
  shapeID: string;
  sheetLoc: string;
  label: string;
  unmet: number;
  demand: number;
  supply: number;
  coverage: number;
  hasData: number;
  canDrill: number;
}

/** Join sheet metrics onto GeoJSON for Mapbox choropleth + labels */
export function enrichGeoJsonForMapbox(
  geo: FeatureCollection,
  locationAgg: {
    name: string;
    unmet: number;
    demand: number;
    supply: number;
    coverage: number | null;
  }[],
  options?: { excludeTopFromScale?: boolean },
): {
  geo: FeatureCollection;
  scaleMax: number;
  bounds: [[number, number], [number, number]];
} {
  const sheetLocations = locationAgg.map((d) => d.name);
  const metrics = buildProvinceMetrics(locationAgg);
  const metricBySheet = new Map(metrics.provinces.map((p) => [p.sheetLocation, p]));

  const unmetForScale = [...metrics.provinces].sort((a, b) => b.unmet - a.unmet);
  const scalePool =
    options?.excludeTopFromScale && unmetForScale.length > 1
      ? unmetForScale.slice(1).map((p) => p.unmet)
      : metrics.provinces.map((p) => p.unmet);
  const scaleMax = colorScaleMax(scalePool);

  const features = (geo.features as GeoFeature[]).map((feature) => {
    const shape = shapeNameFromFeature(feature.properties ?? {});
    const shapeID = String(feature.properties?.shapeID ?? shape);
    const sheetLoc = matchShapeToSheet(shape, sheetLocations);
    const metric = sheetLoc ? metricBySheet.get(sheetLoc) : undefined;
    const hasData = Boolean(metric);

    return {
      ...feature,
      id: shapeID,
      properties: {
        ...feature.properties,
        shapeName: shape,
        shapeID,
        sheetLoc: sheetLoc ?? "",
        label: sheetLoc || shape,
        unmet: metric?.unmet ?? 0,
        demand: metric?.demand ?? 0,
        supply: metric?.supply ?? 0,
        coverage: metric?.coverage ?? -1,
        hasData: hasData ? 1 : 0,
        canDrill: sheetLoc ? 1 : 0,
      },
    };
  });

  return {
    geo: { type: "FeatureCollection", features },
    scaleMax,
    bounds: vietnamBounds(features),
  };
}

export const VIETNAM_MAP_CENTER = { longitude: 105.84, latitude: 16.05, zoom: 4.85 } as const;
