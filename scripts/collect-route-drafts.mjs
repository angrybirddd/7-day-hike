import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDotEnv } from "./serve-map.mjs";

const DEFAULT_INPUT = "data/route-drafts/hiking-routes.json";
const DEFAULT_RAW_DIR = "data/raw/amap/route-drafts";
const AMAP_GEOCODE_URL = "https://restapi.amap.com/v3/geocode/geo";
const AMAP_PLACE_URL = "https://restapi.amap.com/v3/place/text";

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function readJsonFile(path) {
  const text = await readFile(path, "utf8");
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function safeSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function requestAmapJson(url) {
  const response = await fetch(url);
  const json = await response.json();
  if (json.status !== "1") {
    const safeUrl = url.toString().replace(/key=[^&]+/, "key=***");
    throw new Error(`Amap request failed: ${json.info || "unknown"} / ${json.infocode || "no-code"} / ${safeUrl}`);
  }
  return json;
}

function makeUrl(endpoint, params) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  return url;
}

export async function collectRouteDraftLookups({
  inputPath = DEFAULT_INPUT,
  rawDir = DEFAULT_RAW_DIR,
  key = process.env.AMAP_API_KEY,
  delayMs = 450,
} = {}) {
  if (!key) throw new Error("Set AMAP_API_KEY before collecting route draft lookups.");

  const routeDrafts = await readJsonFile(inputPath);
  const groups = Array.isArray(routeDrafts) ? routeDrafts : routeDrafts.routes || [];
  const written = [];
  await mkdir(rawDir, { recursive: true });

  for (const group of groups) {
    const city = group.region || "";
    for (const stop of group.stops || []) {
      const base = `${group.id}-${stop.id || safeSlug(stop.name)}`;
      const geocodeUrl = makeUrl(AMAP_GEOCODE_URL, {
        address: stop.name,
        city,
        key,
      });
      await sleep(delayMs);
      const geocode = await requestAmapJson(geocodeUrl);
      const geocodePath = resolve(rawDir, `${base}-geocode.json`);
      await writeFile(geocodePath, `${JSON.stringify(geocode, null, 2)}\n`, "utf8");
      written.push(geocodePath);

      const placeUrl = makeUrl(AMAP_PLACE_URL, {
        keywords: stop.name,
        city,
        citylimit: "false",
        extensions: "all",
        offset: "10",
        page: "1",
        key,
      });
      await sleep(delayMs);
      const place = await requestAmapJson(placeUrl);
      const placePath = resolve(rawDir, `${base}-place.json`);
      await writeFile(placePath, `${JSON.stringify(place, null, 2)}\n`, "utf8");
      written.push(placePath);
    }
  }

  return written;
}

const currentFile = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] || "") === currentFile) {
  loadDotEnv(resolve(process.cwd(), ".env"));
  const written = await collectRouteDraftLookups();
  await mkdir(dirname(resolve(DEFAULT_RAW_DIR, "placeholder")), { recursive: true });
  console.log(`Wrote ${written.length} route-draft lookup files.`);
}
