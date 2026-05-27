import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMapData, classifyPlace, readJsonFile } from "../scripts/build-map-data.mjs";

test("classifies obvious forestry sites as trusted and noisy related places as unverified", () => {
  assert.deepEqual(
    classifyPlace({
      name: "加格达奇林业局",
      type: "政府机构及社会团体;政府机关;区县级政府及事业单位",
      address: "晨光街",
      query: "加格达奇林业局",
    }),
    {
      category: "bureau",
      status: "trusted",
      reason: "name matches forestry bureau or forest-industry company",
    },
  );

  assert.deepEqual(
    classifyPlace({
      name: "大杨树林业局鑫港海鲜",
      type: "餐饮服务;中餐厅;海鲜酒楼",
      address: "大杨树镇林业局四号商住楼",
      query: "大杨树林业局",
    }),
    {
      category: "related",
      status: "unverified",
      reason: "noise keyword or POI type suggests related non-forestry venue",
    },
  );

  assert.deepEqual(
    classifyPlace({
      name: "拓跋鲜卑历史文化园",
      type: "风景名胜;风景名胜;风景名胜",
      address: "",
      query: "阿里河林业局",
    }),
    {
      category: "related",
      status: "unverified",
      reason: "Amap returned this POI but it is not a direct bureau or forest-farm match",
    },
  );

  assert.deepEqual(
    classifyPlace({
      name: "加格达奇林业局白桦林场",
      type: "政府机构及社会团体;政府机关;区县级政府及事业单位",
      address: "",
      query: "加格达奇林业局",
    }),
    {
      category: "farm",
      status: "trusted",
      reason: "name matches forest farm",
    },
  );
});

test("builds map data with anchors, routes, trusted places, unverified places, and no BOM-sensitive parsing", async () => {
  const data = await buildMapData({
    placesGeojsonPath: "data/processed/places-first-pass.geojson",
    anchorsPath: "data/processed/anchor-towns.json",
    routesPath: "data/processed/anchor-route-segments.json",
  });

  assert.equal(data.anchors.length, 14);
  assert.equal(data.routes.length, 13);
  assert.equal(data.meta.rawPlaceCount, 339);
  assert.equal(data.places.length, 302);
  assert.equal(data.routes[0].distance_m, 72576);
  assert.equal(data.meta.source, "amap-first-pass");

  assert.equal(new Set(data.places.map((place) => place.id)).size, data.places.length);

  const statuses = new Set(data.places.map((place) => place.status));
  assert.deepEqual(statuses, new Set(["trusted", "unverified"]));

  const bureau = data.places.find((place) => place.name === "加格达奇林业局");
  assert.equal(bureau.category, "bureau");
  assert.equal(bureau.status, "trusted");
  assert.deepEqual(Object.keys(bureau).sort(), [
    "address",
    "adname",
    "category",
    "id",
    "lnglat",
    "name",
    "query",
    "reason",
    "source",
    "status",
  ]);

  const noisy = data.places.find((place) => place.name.includes("海鲜"));
  assert.equal(noisy.status, "unverified");

  const queryOnly = data.places.find((place) => place.name === "拓跋鲜卑历史文化园");
  assert.equal(queryOnly.status, "unverified");

  const whiteBirch = data.places.filter((place) => place.name === "加格达奇林业局白桦林场");
  assert.equal(whiteBirch.length, 1);
});

test("builds route groups for the original route and three unverified draft hiking routes", async () => {
  const data = await buildMapData({
    placesGeojsonPath: "data/processed/places-first-pass.geojson",
    anchorsPath: "data/processed/anchor-towns.json",
    routesPath: "data/processed/anchor-route-segments.json",
    draftRoutesPath: "data/route-drafts/hiking-routes.json",
  });

  assert.equal(data.routeGroups.length, 4);
  assert.deepEqual(
    data.routeGroups.map((group) => group.id),
    ["greater-khingan-forestry", "huanggangliang-high-intensity", "hulunbuir-khingan-crossing", "keshiketeng-family-grassland"],
  );

  const original = data.routeGroups[0];
  assert.equal(original.status, "trusted");
  assert.equal(original.segments.length, data.routes.length);
  assert.equal(original.stops.length, data.anchors.length);

  const drafts = data.routeGroups.slice(1);
  assert.equal(drafts.every((group) => group.status === "draft_unverified"), true);
  assert.deepEqual(
    drafts.map((group) => group.totalKm),
    [190, 185, 190],
  );
  assert.equal(drafts.every((group) => group.segments.every((segment) => segment.status === "draft_unverified")), true);

  const huanggangliang = data.routeGroups.find((group) => group.id === "huanggangliang-high-intensity");
  assert.equal(huanggangliang.stops.length, 10);
  assert.equal(huanggangliang.segments.length, 9);
  assert.equal(huanggangliang.segments[0].planKm, 22);
  assert.equal(huanggangliang.segments[0].ascentM, 650);
  assert.equal(huanggangliang.segments[0].terrain.includes("森林"), true);

  const hulunbuir = data.routeGroups.find((group) => group.id === "hulunbuir-khingan-crossing");
  assert.match(hulunbuir.name, /大兴安岭-草原-湿地/);
  assert.equal(hulunbuir.days, "9天");
  assert.equal(hulunbuir.segments.length, 9);
});

test("readJsonFile tolerates UTF-8 BOM files", async () => {
  const data = await readJsonFile("data/processed/places-first-pass.geojson");
  assert.equal(data.type, "FeatureCollection");
});
