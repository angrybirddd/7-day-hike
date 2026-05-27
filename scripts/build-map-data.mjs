import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_INPUTS = {
  placesGeojsonPath: "data/processed/places-first-pass.geojson",
  anchorsPath: "data/processed/anchor-towns.json",
  routesPath: "data/processed/anchor-route-segments.json",
  outputPath: "data/processed/map-data.json",
};

const NOISE_KEYWORDS = [
  "餐厅",
  "海鲜",
  "小区",
  "停车场",
  "宾馆",
  "酒店",
  "学校",
  "中学",
  "商店",
  "超市",
  "工会",
  "公安",
  "派出所",
  "法院",
  "加油站",
  "检查站",
  "服务站",
  "办公室",
  "信息中心",
  "供应处",
  "贮木场",
  "防火",
  "调查设计",
  "电讯",
  "家电",
];

const NOISE_TYPE_KEYWORDS = [
  "餐饮服务",
  "商务住宅",
  "交通设施服务",
  "住宿服务",
  "科教文化服务",
  "购物服务",
  "生活服务",
  "公检法机构",
  "政府机构及社会团体;社会团体",
];

export async function readJsonFile(path) {
  const text = await readFile(path, "utf8");
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

export function classifyPlace(place) {
  const name = place.name || "";
  const type = place.type || "";
  const haystack = `${name} ${type} ${place.address || ""}`;

  if (NOISE_KEYWORDS.some((keyword) => haystack.includes(keyword)) || NOISE_TYPE_KEYWORDS.some((keyword) => type.includes(keyword))) {
    return {
      category: "related",
      status: "unverified",
      reason: "noise keyword or POI type suggests related non-forestry venue",
    };
  }

  if (name.includes("国有林场") || name.endsWith("林场") || name.includes("林业局") && name.includes("林场")) {
    return {
      category: "farm",
      status: "trusted",
      reason: "name matches forest farm",
    };
  }

  if (name.includes("林业局") || name.includes("林业管理局") || name.includes("森工公司") || name.includes("森工") || name.includes("森林工业")) {
    return {
      category: "bureau",
      status: "trusted",
      reason: "name matches forestry bureau or forest-industry company",
    };
  }

  if (name.includes("林场")) {
    return {
      category: "farm",
      status: "trusted",
      reason: "name matches forest farm",
    };
  }

  return {
    category: "related",
    status: "unverified",
    reason: "Amap returned this POI but it is not a direct bureau or forest-farm match",
  };
}

function normalizePlace(feature) {
  const props = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  const classification = classifyPlace(props);

  return {
    id: props.id,
    name: props.name,
    category: classification.category,
    status: classification.status,
    lnglat: [lng, lat],
    address: props.address || "",
    adname: props.adname || "",
    source: props.source || "amap_place_text",
    query: props.query || "",
    reason: classification.reason,
  };
}

function dedupePlaceFeatures(features) {
  const byKey = new Map();

  for (const feature of features) {
    const props = feature.properties;
    const coordinates = feature.geometry.coordinates.join(",");
    const key = props.id || `${props.name}:${coordinates}`;
    const current = byKey.get(key);

    if (!current) {
      byKey.set(key, structuredClone(feature));
      continue;
    }

    const queries = new Set([current.properties.query, props.query].filter(Boolean));
    current.properties.query = [...queries].join(" | ");
  }

  return [...byKey.values()];
}

function normalizeAnchor(anchor) {
  const [lng, lat] = anchor.location.split(",").map(Number);
  return {
    id: `anchor:${anchor.name}`,
    name: anchor.name,
    category: "anchor",
    status: "trusted",
    lnglat: [lng, lat],
    address: anchor.formatted_address || "",
    adname: anchor.district || "",
    source: anchor.source || "amap_geocode",
    reason: "manually selected route anchor",
  };
}

function normalizeRoute(route, index) {
  return {
    id: `route:${index}`,
    from: route.from,
    to: route.to,
    origin: route.origin.split(",").map(Number),
    destination: route.destination.split(",").map(Number),
    distance_m: Number(route.distance_m),
    duration_s: Number(route.duration_s),
    source: route.source || "amap_direction_driving",
  };
}

export async function buildMapData(paths = DEFAULT_INPUTS) {
  const placesGeojson = await readJsonFile(paths.placesGeojsonPath);
  const anchors = await readJsonFile(paths.anchorsPath);
  const routes = await readJsonFile(paths.routesPath);
  const placeFeatures = dedupePlaceFeatures(placesGeojson.features);

  return {
    meta: {
      source: "amap-first-pass",
      generatedAt: new Date().toISOString(),
      rawPlaceCount: placesGeojson.features.length,
      placeCount: placeFeatures.length,
      anchorCount: anchors.length,
      routeCount: routes.length,
    },
    anchors: anchors.map(normalizeAnchor),
    routes: routes.map(normalizeRoute),
    places: placeFeatures.map(normalizePlace),
  };
}

export async function writeMapData(paths = DEFAULT_INPUTS) {
  const outputPath = paths.outputPath || DEFAULT_INPUTS.outputPath;
  const data = await buildMapData(paths);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
}

const currentFile = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] || "") === currentFile) {
  const data = await writeMapData(DEFAULT_INPUTS);
  console.log(`Wrote ${DEFAULT_INPUTS.outputPath}: ${data.places.length} places, ${data.anchors.length} anchors, ${data.routes.length} routes.`);
}
