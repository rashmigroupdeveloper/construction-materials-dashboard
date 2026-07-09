"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MapLayerMouseEvent, FillLayerSpecification, LineLayerSpecification } from "mapbox-gl";
import type { FeatureCollection } from "geojson";
import Map, {
  FullscreenControl,
  Layer,
  NavigationControl,
  Popup,
  ScaleControl,
  Source,
  type MapRef,
} from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { fmt, pct } from "@/lib/aggregate";
import { shortLocation } from "@/lib/labels";
import {
  VIETNAM_GEOJSON_URL,
  VIETNAM_MAP_CENTER,
  buildProvinceMetrics,
  enrichGeoJsonForMapbox,
  type EnrichedProvinceProperties,
} from "@/lib/vietnam-provinces";
import { SectionHead } from "../ui";

/** Mapbox public tokens always start with pk. */
function resolveMapboxToken(): string {
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim() ?? "";
  return token.startsWith("pk.") ? token : "";
}

const MAPBOX_TOKEN = resolveMapboxToken();

function subscribeToClientSnapshot() {
  return () => {};
}

interface ProvinceMapProps {
  locationAgg: {
    name: string;
    unmet: number;
    demand: number;
    supply: number;
    coverage: number | null;
  }[];
  periodLabel: string;
  selectedLocation: string;
  materialFilter?: string;
  onDrill: (location: string) => void;
}

type HoveredFeature = {
  longitude: number;
  latitude: number;
  props: EnrichedProvinceProperties;
};

function buildFillPaint(
  scaleMax: number,
  selectedLocation: string,
): FillLayerSpecification["paint"] {
  const sqrtMax = Math.sqrt(scaleMax);
  const colorCases: unknown[] = ["case"];
  if (selectedLocation !== "All") {
    colorCases.push(["==", ["get", "sheetLoc"], selectedLocation], "#be123c");
  }
  colorCases.push(
    ["boolean", ["feature-state", "hover"], false],
    "#9f1239",
    ["==", ["get", "hasData"], 0],
    "#dce4ef",
    ["<=", ["get", "unmet"], 0],
    "#d1dae6",
    ["interpolate", ["linear"], ["sqrt", ["get", "unmet"]], 0, "#fecdd3", sqrtMax, "#be123c"],
  );

  const opacityCases: unknown[] =
    selectedLocation !== "All"
      ? ["case", ["==", ["get", "sheetLoc"], selectedLocation], 0.95, 0.38]
      : ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.9];

  return {
    "fill-color": colorCases,
    "fill-opacity": opacityCases,
  } as FillLayerSpecification["paint"];
}

function buildOutlinePaint(selectedLocation: string): LineLayerSpecification["paint"] {
  const colorCases: unknown[] = ["case"];
  if (selectedLocation !== "All") {
    colorCases.push(["==", ["get", "sheetLoc"], selectedLocation], "#0f172a");
  }
  colorCases.push(
    ["boolean", ["feature-state", "hover"], false],
    "#0f172a",
    "#64748b",
  );

  const widthCases: unknown[] = ["case"];
  if (selectedLocation !== "All") {
    widthCases.push(["==", ["get", "sheetLoc"], selectedLocation], 2.5);
  }
  widthCases.push(
    ["boolean", ["feature-state", "hover"], false],
    2,
    0.75,
  );

  return {
    "line-color": colorCases,
    "line-width": widthCases,
  } as LineLayerSpecification["paint"];
}

export default function ProvinceMap({
  locationAgg,
  periodLabel,
  selectedLocation,
  materialFilter = "All",
  onDrill,
}: ProvinceMapProps) {
  const mapRef = useRef<MapRef>(null);
  const hoveredIdRef = useRef<string | number | null>(null);

  const mounted = useSyncExternalStore(
    subscribeToClientSnapshot,
    () => true,
    () => false,
  );
  const [rawGeo, setRawGeo] = useState<FeatureCollection | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [excludeTopFromScale, setExcludeTopFromScale] = useState(false);
  const [hovered, setHovered] = useState<HoveredFeature | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(VIETNAM_GEOJSON_URL);
        if (!res.ok) throw new Error(`Map load failed (${res.status})`);
        const json = (await res.json()) as FeatureCollection;
        if (!cancelled) setRawGeo(json);
      } catch (e) {
        if (!cancelled) {
          setGeoError(e instanceof Error ? e.message : "Could not load map");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const metrics = useMemo(() => buildProvinceMetrics(locationAgg), [locationAgg]);

  const topLocShare = useMemo(() => {
    const total = locationAgg.reduce((a, d) => a + d.unmet, 0);
    const top = [...locationAgg].sort((a, b) => b.unmet - a.unmet)[0];
    return total && top ? top.unmet / total : 0;
  }, [locationAgg]);

  const enriched = useMemo(() => {
    if (!rawGeo) return null;
    return enrichGeoJsonForMapbox(rawGeo, locationAgg, { excludeTopFromScale });
  }, [rawGeo, locationAgg, excludeTopFromScale]);

  const fillPaint = useMemo(
    () => (enriched ? buildFillPaint(enriched.scaleMax, selectedLocation) : undefined),
    [enriched, selectedLocation],
  );

  const outlinePaint = useMemo(
    () => buildOutlinePaint(selectedLocation),
    [selectedLocation],
  );

  const clearHoverState = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map && hoveredIdRef.current != null) {
      map.removeFeatureState({ source: "provinces", id: hoveredIdRef.current });
      hoveredIdRef.current = null;
    }
  }, []);

  const onMapMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      const map = mapRef.current?.getMap();
      const feature = e.features?.[0];
      if (!map || !feature?.id) {
        clearHoverState();
        setHovered(null);
        mapRef.current?.getMap().getCanvas().style.removeProperty("cursor");
        return;
      }

      const props = feature.properties as unknown as EnrichedProvinceProperties;
      if (props.canDrill !== 1) {
        clearHoverState();
        setHovered(null);
        map.getCanvas().style.cursor = "";
        return;
      }

      map.getCanvas().style.cursor = "pointer";
      if (hoveredIdRef.current !== feature.id) {
        clearHoverState();
        map.setFeatureState({ source: "provinces", id: feature.id }, { hover: true });
        hoveredIdRef.current = feature.id;
      }

      setHovered({
        longitude: e.lngLat.lng,
        latitude: e.lngLat.lat,
        props,
      });
    },
    [clearHoverState],
  );

  const onMapMouseLeave = useCallback(() => {
    clearHoverState();
    setHovered(null);
    mapRef.current?.getMap().getCanvas().style.removeProperty("cursor");
  }, [clearHoverState]);

  const onMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const props = feature.properties as unknown as EnrichedProvinceProperties;
      if (props.canDrill === 1 && props.sheetLoc) {
        onDrill(props.sheetLoc);
      }
    },
    [onDrill],
  );

  const onMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !enriched) return;
    const [[minLon, minLat], [maxLon, maxLat]] = enriched.bounds;
    map.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      { padding: { top: 48, bottom: 48, left: 40, right: 40 }, duration: 0 },
    );
  }, [enriched]);

  const mappedCount = metrics.provinces.length;
  const withUnmet = metrics.provinces.filter((p) => p.unmet > 0).length;
  const scopeLabel =
    materialFilter !== "All" ? `${periodLabel} · ${materialFilter}` : periodLabel;

  if (!mounted) {
    return (
      <div className="panel p-5">
        <SectionHead title="Province map" subtitle="Loading map…" />
        <div className="mt-4 flex h-[min(82vh,920px)] min-h-[680px] items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 text-sm text-[var(--muted)]">
          Preparing Mapbox…
        </div>
      </div>
    );
  }

  if (!MAPBOX_TOKEN) {
    return (
      <div className="panel p-5">
        <SectionHead
          title="Province map"
          subtitle="Mapbox token required for interactive map"
        />
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-6 text-sm text-amber-950">
          <p className="font-semibold">Mapbox token missing or invalid</p>
          <p className="mt-2 text-[var(--muted)]">
            Add this exact line to <code className="rounded bg-white px-1.5 py-0.5 text-xs">.env.local</code>{" "}
            (note the variable name — not <code className="rounded bg-white px-1.5 py-0.5 text-xs">NEXT_PUBLIC_pk…</code>
            ):
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-white p-3 text-xs text-[var(--ink)]">
            NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.your_token_here
          </pre>
          <p className="mt-3 text-[var(--muted)]">
            Get a free token at{" "}
            <a
              href="https://account.mapbox.com/access-tokens/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-sky-700 underline"
            >
              mapbox.com
            </a>
            , then <strong>restart</strong> <code className="text-xs">npm run dev</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHead
          title="Province map"
          subtitle={`Unmet by province · ${scopeLabel} · ${mappedCount} provinces in data`}
        />
        {topLocShare > 0.4 && (
          <button
            type="button"
            onClick={() => setExcludeTopFromScale((v) => !v)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
              excludeTopFromScale
                ? "bg-sky-600 text-white"
                : "border border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[#f8fafc]"
            }`}
          >
            {excludeTopFromScale ? "Include #1 in scale" : "Hide #1 from color scale"}
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-4 xl:flex-row">
        <div className="relative min-h-[680px] min-w-0 flex-[1_1_78%] overflow-hidden rounded-2xl border border-sky-300 shadow-md xl:h-[min(82vh,920px)]">
          {geoError && (
            <p className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 text-sm text-rose-600">
              {geoError}
            </p>
          )}
          {!enriched && !geoError && (
            <div className="flex h-full min-h-[680px] items-center justify-center bg-sky-50 text-sm text-[var(--muted)]">
              Loading provinces…
            </div>
          )}
          {enriched && fillPaint && (
            <Map
              ref={mapRef}
              mapboxAccessToken={MAPBOX_TOKEN}
              initialViewState={VIETNAM_MAP_CENTER}
              mapStyle="mapbox://styles/mapbox/light-v11"
              style={{ width: "100%", height: "100%", minHeight: 680 }}
              interactiveLayerIds={["provinces-fill"]}
              onLoad={onMapLoad}
              onMouseMove={onMapMouseMove}
              onMouseLeave={onMapMouseLeave}
              onClick={onMapClick}
              attributionControl={false}
              reuseMaps
            >
              <NavigationControl position="top-right" showCompass />
              <FullscreenControl position="top-right" />
              <ScaleControl position="bottom-left" unit="metric" />

              <Source id="provinces" type="geojson" data={enriched.geo} promoteId="shapeID">
                <Layer id="provinces-fill" type="fill" paint={fillPaint} />
                <Layer id="provinces-outline" type="line" paint={outlinePaint} />
                <Layer
                  id="provinces-labels"
                  type="symbol"
                  minzoom={4.5}
                  layout={{
                    "text-field": ["get", "label"],
                    "text-size": [
                      "interpolate",
                      ["linear"],
                      ["zoom"],
                      4.5,
                      9,
                      6,
                      11,
                      8,
                      13,
                      10,
                      15,
                    ],
                    "text-anchor": "center",
                    "text-max-width": 8,
                    "text-allow-overlap": false,
                    "text-padding": 2,
                  }}
                  paint={{
                    "text-color": [
                      "case",
                      ["==", ["get", "hasData"], 1],
                      "#0f172a",
                      "#94a3b8",
                    ],
                    "text-halo-color": "#ffffff",
                    "text-halo-width": 1.25,
                    "text-opacity": [
                      "interpolate",
                      ["linear"],
                      ["zoom"],
                      4.5,
                      0.65,
                      7,
                      1,
                    ],
                  }}
                  filter={["has", "label"]}
                />
                <Layer
                  id="provinces-labels-data"
                  type="symbol"
                  minzoom={5.5}
                  layout={{
                    "text-field": [
                      "format",
                      ["get", "label"],
                      { "font-scale": 1 },
                      "\n",
                      {},
                      ["concat", ["to-string", ["round", ["get", "unmet"]]], " unmet"],
                      { "font-scale": 0.82 },
                    ],
                    "text-size": 10,
                    "text-anchor": "center",
                    "text-allow-overlap": false,
                  }}
                  paint={{
                    "text-color": "#9f1239",
                    "text-halo-color": "#ffffff",
                    "text-halo-width": 1.5,
                  }}
                  filter={[
                    "all",
                    ["==", ["get", "hasData"], 1],
                    [">", ["get", "unmet"], 0],
                  ]}
                />
              </Source>

              {hovered && (
                <Popup
                  longitude={hovered.longitude}
                  latitude={hovered.latitude}
                  closeButton={false}
                  closeOnClick={false}
                  anchor="bottom"
                  offset={12}
                  className="province-map-popup"
                >
                  <p className="text-sm font-bold text-[var(--ink)]">{hovered.props.label}</p>
                  {hovered.props.hasData === 1 ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Unmet <strong className="text-rose-700">{fmt(hovered.props.unmet)}</strong>
                      <br />
                      Demand {fmt(hovered.props.demand)} · Supply {fmt(hovered.props.supply)}
                      <br />
                      Coverage{" "}
                      {hovered.props.coverage >= 0 ? pct(hovered.props.coverage) : "—"}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-[var(--muted)]">No data in current filters</p>
                  )}
                  {hovered.props.canDrill === 1 && (
                    <p className="mt-1 text-[10px] font-semibold text-sky-700">Click to drill</p>
                  )}
                </Popup>
              )}
            </Map>
          )}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-3 xl:w-[min(100%,280px)]">
          <div className="rounded-xl border border-[var(--line)] bg-[#f8fafc] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
              Legend · unmet intensity
            </p>
            <div
              className="mt-2 h-3 rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, #e2e8f0 0%, #fecdd3 35%, #fb7185 65%, #be123c 100%)",
              }}
            />
            <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
              <span>0</span>
              <span>{enriched ? fmt(enriched.scaleMax) : "—"}+</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
              {withUnmet} provinces with shortage · scroll to zoom · drag to pan · labels appear as
              you zoom in
            </p>
          </div>

          {metrics.nonProvinces.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">
                PMUs / directorates (not on map)
              </p>
              <ul className="mt-2 max-h-[200px] space-y-1 overflow-auto">
                {metrics.nonProvinces.map((p) => (
                  <li key={p.name}>
                    <button
                      type="button"
                      onClick={() => onDrill(p.name)}
                      className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-xs hover:bg-amber-100/80"
                    >
                      <span className="truncate pr-2" title={p.name}>
                        {shortLocation(p.name)}
                      </span>
                      <span className="kpi-value shrink-0 font-bold text-amber-900">
                        {fmt(p.unmet)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[10px] text-[var(--muted)]">
            © Mapbox © OpenStreetMap
          </p>
        </div>
      </div>
    </div>
  );
}
