const DEFAULT_ROUTE_GROUP_ID = "all";

const state = {
  amap: null,
  map: null,
  data: null,
  zoom: 7,
  activeRouteGroupId: DEFAULT_ROUTE_GROUP_ID,
  showBureau: true,
  showFarm: true,
  showUnverified: false,
  measuring: false,
  measurePoints: [],
  walking: null,
  overlays: {
    routeLines: [],
    routeStopMarkers: [],
    placeMarkers: [],
    labelsLayer: null,
    unverifiedCluster: null,
    highlight: null,
    measureMarkers: [],
    measureLine: null,
  },
};

const els = {
  loading: document.querySelector("#loadingState"),
  error: document.querySelector("#errorState"),
  errorTitle: document.querySelector("#errorTitle"),
  errorBody: document.querySelector("#errorBody"),
  poiCount: document.querySelector("#poiCount"),
  trustedCount: document.querySelector("#trustedCount"),
  routeKm: document.querySelector("#routeKm"),
  searchInput: document.querySelector("#searchInput"),
  layerButtons: [...document.querySelectorAll("[data-layer]")],
  routeGroupControls: document.querySelector("#routeGroupControls"),
  routeList: document.querySelector("#routeList"),
  resultsList: document.querySelector("#resultsList"),
  detailPanel: document.querySelector("#detailPanel"),
  zoomHint: document.querySelector("#zoomHint"),
  measureToggle: document.querySelector("#measureToggle"),
  measureClear: document.querySelector("#measureClear"),
  measureStatus: document.querySelector("#measureStatus"),
};

const CATEGORY_LABELS = {
  anchor: "路线锚点",
  bureau: "林业局",
  farm: "林场",
  related: "待核查",
  draft_stop: "草案节点",
};

const STATUS_LABELS = {
  trusted: "可信",
  unverified: "待核查",
  draft_unverified: "草案待核查",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showError(title, body) {
  els.loading.hidden = true;
  els.error.hidden = false;
  els.errorTitle.textContent = title;
  els.errorBody.textContent = body;
}

function setLoading(text) {
  els.loading.hidden = false;
  els.loading.textContent = text;
}

async function getJson(url) {
  const cleanUrl = new URL(url, `${window.location.protocol}//${window.location.host}`).toString();
  const response = await fetch(cleanUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.AMapLoader) resolve();
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.append(script);
  });
}

async function loadAmap(config) {
  window._AMapSecurityConfig = {
    securityJsCode: config.amap.securityJsCode,
  };
  await loadScript("https://webapi.amap.com/loader.js");
  return window.AMapLoader.load({
    key: config.amap.key,
    version: "2.0",
    plugins: ["AMap.MarkerCluster", "AMap.Walking"],
  });
}

function selectedRouteGroups() {
  if (!state.data?.routeGroups) return [];
  if (state.activeRouteGroupId === "all") return state.data.routeGroups;
  return state.data.routeGroups.filter((group) => group.id === state.activeRouteGroupId);
}

function totalRouteKm() {
  return Math.round(selectedRouteGroups().reduce((sum, group) => sum + Number(group.totalKm || 0), 0));
}

function visibleTrustedPlaces() {
  return state.data.places
    .filter((place) => place.status === "trusted")
    .filter((place) => {
      if (place.category === "bureau") return state.showBureau && state.zoom >= 8;
      if (place.category === "farm") return state.showFarm && state.zoom >= 10;
      return false;
    });
}

function visibleLabelPlaces() {
  const places = visibleTrustedPlaces();
  if (state.showUnverified && state.zoom >= 12) {
    places.push(...state.data.places.filter((place) => place.status === "unverified"));
  }
  return places;
}

function routeGroupById(id) {
  return state.data.routeGroups.find((group) => group.id === id);
}

function ensureActiveRouteGroup() {
  if (state.activeRouteGroupId !== "all" && !routeGroupById(state.activeRouteGroupId)) {
    state.activeRouteGroupId = "all";
  }
}

function visibleSegments() {
  return selectedRouteGroups().flatMap((group) =>
    group.segments
      .filter((segment) => segment.drawable !== false && segment.origin && segment.destination)
      .map((segment) => ({ ...segment, group })),
  );
}

function visibleStops() {
  const byKey = new Map();
  for (const group of selectedRouteGroups()) {
    for (const stop of group.stops || []) {
      if (!stop.lnglat) continue;
      byKey.set(`${group.id}:${stop.localId || stop.id}`, { ...stop, group });
    }
  }
  return [...byKey.values()];
}

function clearOverlays(items) {
  for (const item of items) item.setMap?.(null);
  items.length = 0;
}

function clearLayer(layer) {
  if (layer) layer.setMap(null);
}

function markerContent(className, text = "") {
  const label = text ? `<span>${escapeHtml(text)}</span>` : "";
  return `<div class="${className}">${label}</div>`;
}

function makeMarker(item, className, text = "") {
  const marker = new state.amap.Marker({
    position: item.lnglat,
    content: markerContent(className, text),
    anchor: "center",
    offset: new state.amap.Pixel(0, 0),
    extData: item,
  });
  marker.on("click", () => selectItem(item));
  return marker;
}

function makeRouteStopMarker(stop, index) {
  const isDraft = stop.status === "draft_unverified";
  const marker = new state.amap.Marker({
    position: stop.lnglat,
    content: markerContent(isDraft ? "marker marker-draft" : "marker marker-anchor", isDraft ? "" : String(index + 1)),
    anchor: "center",
    offset: new state.amap.Pixel(0, 0),
    extData: stop,
  });
  marker.on("click", () => selectItem({ ...stop, category: isDraft ? "draft_stop" : "anchor", status: stop.status || "trusted" }));
  return marker;
}

function renderMetrics() {
  const trusted = state.data.places.filter((place) => place.status === "trusted").length;
  els.poiCount.textContent = state.data.places.length;
  els.trustedCount.textContent = trusted;
  els.routeKm.textContent = totalRouteKm();
}

function renderRouteGroupControls() {
  const groups = [{ id: "all", name: "全部路线", status: "mixed" }, ...state.data.routeGroups];
  els.routeGroupControls.innerHTML = groups
    .map((group) => {
      const active = group.id === state.activeRouteGroupId ? "active" : "";
      const draft = group.status === "draft_unverified" ? " draft" : "";
      return `<button class="route-tab ${active}${draft}" type="button" data-route-group="${escapeHtml(group.id)}">${escapeHtml(group.name)}</button>`;
    })
    .join("");

  els.routeGroupControls.querySelectorAll("[data-route-group]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeRouteGroupId = button.dataset.routeGroup;
      renderAll();
      fitVisibleRoutes();
    });
  });
}

function renderRoutes() {
  clearOverlays(state.overlays.routeLines);

  state.overlays.routeLines = visibleSegments().map(({ group, ...segment }) => {
    const draft = segment.status === "draft_unverified";
    const line = new state.amap.Polyline({
      path: [segment.origin, segment.destination],
      strokeColor: group.color || "#2d7190",
      strokeWeight: draft ? 5 : 7,
      strokeOpacity: draft ? 0.72 : 0.9,
      strokeStyle: draft ? "dashed" : "solid",
      lineJoin: "round",
      lineCap: "round",
      extData: { ...segment, group },
      zIndex: draft ? 70 : 82,
    });
    line.on("click", () => selectRouteSegment({ ...segment, group }));
    return line;
  });

  if (state.overlays.routeLines.length) state.map.add(state.overlays.routeLines);
}

function renderRouteStops() {
  clearOverlays(state.overlays.routeStopMarkers);
  state.overlays.routeStopMarkers = visibleStops().map((stop, index) => makeRouteStopMarker(stop, index));
  if (state.overlays.routeStopMarkers.length) state.map.add(state.overlays.routeStopMarkers);
}

function labelIcon(category, status, colorOverride) {
  const color = colorOverride || (category === "bureau" ? "#b55b32" : category === "farm" ? "#145c3d" : category === "anchor" ? "#2d7190" : "#6e8f3d");
  const opacity = status === "unverified" || status === "draft_unverified" ? 0.62 : 0.96;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="6" fill="${color}" fill-opacity="${opacity}" stroke="white" stroke-width="3"/></svg>`;
  return {
    type: "image",
    image: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    size: [18, 18],
    anchor: "center",
  };
}

function makeLabelMarker(item) {
  const marker = new state.amap.LabelMarker({
    position: item.lnglat,
    rank: item.status === "trusted" ? 50 : 10,
    icon: labelIcon(item.category, item.status),
    text: {
      content: item.name,
      direction: "right",
      offset: [8, 0],
      style: {
        fontSize: item.status === "trusted" ? 13 : 12,
        fontWeight: item.status === "trusted" ? "700" : "500",
        fillColor: item.status === "trusted" ? "#14211d" : "#63736d",
        strokeColor: "#fffdf7",
        strokeWidth: 4,
      },
    },
    extData: item,
  });
  marker.on("click", () => selectItem(item));
  return marker;
}

function makeRouteStopLabel(stop) {
  const draft = stop.status === "draft_unverified";
  const marker = new state.amap.LabelMarker({
    position: stop.lnglat,
    rank: draft ? 68 : 100,
    icon: labelIcon(draft ? "draft_stop" : "anchor", stop.status, stop.group?.color),
    text: {
      content: stop.name,
      direction: draft ? "right" : "top",
      offset: draft ? [8, 0] : [0, -10],
      style: {
        fontSize: draft ? 12 : 14,
        fontWeight: draft ? "700" : "800",
        fillColor: draft ? "#3b3f35" : "#14211d",
        strokeColor: "#fffdf7",
        strokeWidth: draft ? 4 : 5,
      },
    },
    extData: stop,
  });
  marker.on("click", () => selectItem({ ...stop, category: draft ? "draft_stop" : "anchor", status: stop.status || "trusted" }));
  return marker;
}

function makeRouteDistanceLabel(segment) {
  const midpoint = [(segment.origin[0] + segment.destination[0]) / 2, (segment.origin[1] + segment.destination[1]) / 2];
  const emptyIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`;
  const label = segment.planKm ? `${Math.round(Number(segment.planKm))} km` : "待核查";
  const marker = new state.amap.LabelMarker({
    position: midpoint,
    rank: segment.status === "trusted" ? 82 : 58,
    icon: {
      type: "image",
      image: `data:image/svg+xml;utf8,${encodeURIComponent(emptyIcon)}`,
      size: [1, 1],
      anchor: "center",
    },
    text: {
      content: label,
      direction: "center",
      offset: [0, 0],
      style: {
        fontSize: 12,
        fontWeight: "800",
        fillColor: segment.group?.color || "#2d7190",
        strokeColor: "#fffdf7",
        strokeWidth: 5,
      },
    },
    extData: segment,
  });
  marker.on("click", () => selectRouteSegment(segment));
  return marker;
}

function renderLabels() {
  clearLayer(state.overlays.labelsLayer);
  state.overlays.labelsLayer = new state.amap.LabelsLayer({
    zooms: [3, 20],
    zIndex: 1000,
    collision: true,
    allowCollision: false,
  });

  const routeStopLabels = visibleStops().map(makeRouteStopLabel);
  const routeLabels = visibleSegments().map(makeRouteDistanceLabel);
  state.overlays.labelsLayer.add([...routeStopLabels, ...routeLabels, ...visibleLabelPlaces().map(makeLabelMarker)]);
  state.map.add(state.overlays.labelsLayer);
}

function renderTrustedMarkers() {
  clearOverlays(state.overlays.placeMarkers);
  state.overlays.placeMarkers = visibleTrustedPlaces().map((place) => makeMarker(place, `marker marker-${place.category}`));
  if (state.overlays.placeMarkers.length) state.map.add(state.overlays.placeMarkers);
}

function renderUnverifiedCluster() {
  clearLayer(state.overlays.unverifiedCluster);
  state.overlays.unverifiedCluster = null;
  if (!state.showUnverified) return;

  const points = state.data.places
    .filter((place) => place.status === "unverified")
    .map((place) => ({
      lnglat: place.lnglat,
      weight: 1,
      item: place,
    }));

  state.map.plugin(["AMap.MarkerCluster"], () => {
    state.overlays.unverifiedCluster = new state.amap.MarkerCluster(state.map, points, {
      gridSize: state.zoom >= 12 ? 40 : 72,
      renderClusterMarker(context) {
        context.marker.setContent(markerContent("cluster-marker", String(context.count)));
        context.marker.setOffset(new state.amap.Pixel(-18, -18));
      },
      renderMarker(context) {
        const place = context.data[0].item;
        context.marker.setContent(markerContent("marker marker-related"));
        context.marker.setOffset(new state.amap.Pixel(-8, -8));
        context.marker.on("click", () => selectItem(place));
      },
    });
  });
}

function renderMapObjects() {
  if (!state.map) return;
  renderRoutes();
  renderRouteStops();
  renderTrustedMarkers();
  renderLabels();
  renderUnverifiedCluster();
  renderZoomHint();
}

function renderZoomHint() {
  const active = state.activeRouteGroupId === "all" ? "全部路线" : routeGroupById(state.activeRouteGroupId)?.name || "当前路线";
  if (state.zoom < 8) {
    els.zoomHint.textContent = `${active}：当前主要看路线骨架。放大到 8 级显示林业局，10 级显示林场。`;
  } else if (state.zoom < 10) {
    els.zoomHint.textContent = `${active}：当前显示可信林业局。继续放大到 10 级显示林场。`;
  } else if (state.zoom < 12) {
    els.zoomHint.textContent = `${active}：当前显示可信林业局和林场。12 级后可查看待核查点。`;
  } else {
    els.zoomHint.textContent = state.showUnverified ? "待核查层已开启，标签会自动避让；完整列表仍可搜索。" : "可开启待核查层查看高德返回的关联 POI。";
  }
}

function renderLayerButtons() {
  for (const button of els.layerButtons) {
    const layer = button.dataset.layer;
    const active = layer === "bureau" ? state.showBureau : layer === "farm" ? state.showFarm : state.showUnverified;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function routeLabel(route) {
  return `${route.from} -> ${route.to}`;
}

function segmentMeta(segment) {
  const km = segment.planKm ? `${Number(segment.planKm).toFixed(1)} km` : "计划里程待核查";
  const climb = segment.ascentM ? `爬升 ${segment.ascentM} m` : "";
  return [segment.day, km, climb, STATUS_LABELS[segment.status]].filter(Boolean).join(" · ");
}

function renderRouteList() {
  const groups = selectedRouteGroups();
  els.routeList.innerHTML = groups
    .map((group) => {
      const items = group.segments
        .map((segment) => `<li><button type="button" data-segment="${escapeHtml(segment.id)}"><b>${escapeHtml(routeLabel(segment))}</b><span>${escapeHtml(segmentMeta(segment))}</span></button></li>`)
        .join("");
      return `<li class="route-group-title"><b style="--route-color:${escapeHtml(group.color || "#2d7190")}">${escapeHtml(group.name)}</b><span>${escapeHtml(group.status === "draft_unverified" ? "草案待核查" : "可信路线")}</span></li>${items}`;
    })
    .join("");

  els.routeList.querySelectorAll("[data-segment]").forEach((button) => {
    button.addEventListener("click", () => {
      const segment = selectedRouteGroups().flatMap((group) => group.segments.map((item) => ({ ...item, group }))).find((item) => item.id === button.dataset.segment);
      selectRouteSegment(segment);
    });
  });
}

function matchesSearch(item, term) {
  const text = [item.name, item.from, item.to, item.address, item.adname, item.category, item.status, item.query, item.region, item.terrain, item.camp, item.risk, item.support]
    .filter(Boolean)
    .join(" ");
  return text.toLowerCase().includes(term.toLowerCase());
}

function renderResults() {
  const term = els.searchInput.value.trim();
  if (!term) {
    els.resultsList.innerHTML = "";
    return;
  }

  const routeGroupResults = state.data.routeGroups.map((item) => ({ type: "group", item }));
  const segmentResults = state.data.routeGroups.flatMap((group) => group.segments.map((segment) => ({ type: "segment", item: { ...segment, group } })));
  const stopResults = state.data.routeGroups.flatMap((group) => group.stops.map((stop) => ({ type: "stop", item: { ...stop, group, category: stop.status === "draft_unverified" ? "draft_stop" : "anchor" } })));
  const itemResults = state.data.places.map((item) => ({ type: "item", item }));

  const items = [...routeGroupResults, ...segmentResults, ...stopResults, ...itemResults]
    .filter(({ item }) => matchesSearch(item, term))
    .slice(0, 35);

  els.resultsList.innerHTML = items
    .map(({ type, item }) => {
      const title = type === "segment" ? routeLabel(item) : item.name;
      const meta =
        type === "group"
          ? `${item.totalKm || 0} km · ${STATUS_LABELS[item.status] || item.status}`
          : type === "segment"
            ? segmentMeta(item)
            : `${CATEGORY_LABELS[item.category]} · ${STATUS_LABELS[item.status] || item.status}`;
      return `<li><button type="button" data-kind="${type}" data-id="${escapeHtml(item.id)}"><b>${escapeHtml(title)}</b><span>${escapeHtml(meta)}</span></button></li>`;
    })
    .join("");

  els.resultsList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.kind;
      const id = button.dataset.id;
      if (kind === "group") {
        state.activeRouteGroupId = id;
        renderAll();
        fitVisibleRoutes();
      } else if (kind === "segment") {
        const segment = state.data.routeGroups.flatMap((group) => group.segments.map((item) => ({ ...item, group }))).find((item) => item.id === id);
        selectRouteSegment(segment);
      } else if (kind === "stop") {
        const stop = state.data.routeGroups.flatMap((group) => group.stops.map((item) => ({ ...item, group, category: item.status === "draft_unverified" ? "draft_stop" : "anchor" }))).find((item) => item.id === id);
        selectItem(stop);
      } else {
        selectItem(state.data.places.find((item) => item.id === id));
      }
    });
  });
}

function renderDetail(html) {
  els.detailPanel.innerHTML = html;
}

function detailRows(rows) {
  return rows
    .filter((row) => row.value !== undefined && row.value !== null && row.value !== "")
    .map((row) => `<dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd>`)
    .join("");
}

function measureButtons(item) {
  if (!item?.lnglat) return "";
  return `
    <div class="detail-actions">
      <button type="button" data-measure-point="start" data-lnglat="${escapeHtml(item.lnglat.join(","))}" data-name="${escapeHtml(item.name)}">设为起点</button>
      <button type="button" data-measure-point="end" data-lnglat="${escapeHtml(item.lnglat.join(","))}" data-name="${escapeHtml(item.name)}">设为终点</button>
    </div>
  `;
}

function selectItem(item) {
  if (!item) return;
  const category = item.category || (item.status === "draft_unverified" ? "draft_stop" : "anchor");
  const status = item.status || "trusted";
  state.map.setZoomAndCenter(Math.max(state.zoom, category === "anchor" ? 8 : 12), item.lnglat);
  drawHighlight(item.lnglat);

  renderDetail(`
    <article class="detail-card ${escapeHtml(status)}">
      <span>${escapeHtml(CATEGORY_LABELS[category] || category)} · ${escapeHtml(STATUS_LABELS[status] || status)}</span>
      <h2>${escapeHtml(item.name)}</h2>
      <dl>${detailRows([
        { label: "地址", value: item.address },
        { label: "区域", value: item.adname || item.group?.region },
        { label: "路线", value: item.group?.name },
        { label: "来源", value: item.source },
        { label: "判断", value: item.reason || (status === "draft_unverified" ? "文字路线草案节点，坐标需复核" : "") },
        { label: "坐标", value: item.lnglat?.join(", ") },
      ])}</dl>
      ${measureButtons(item)}
    </article>
  `);
}

function routeBoundsFromPositions(positions) {
  const lngs = positions.map((position) => position[0]);
  const lats = positions.map((position) => position[1]);
  return new state.amap.Bounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]);
}

function mapAvoidPadding() {
  const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
  if (!sidebar) return [72, 72, 72, 72];

  if (window.innerWidth <= 680) {
    return [72, Math.min(Math.round(sidebar.height + 32), Math.round(window.innerHeight * 0.48)), 48, 48];
  }

  return [72, 72, Math.min(Math.round(sidebar.width + 48), Math.round(window.innerWidth * 0.45)), 72];
}

function selectRouteSegment(segment) {
  if (!segment) return;
  if (segment.origin && segment.destination) {
    state.map.setBounds(routeBoundsFromPositions([segment.origin, segment.destination]), false, mapAvoidPadding());
  }
  clearHighlight();

  renderDetail(`
    <article class="detail-card route ${escapeHtml(segment.status)}">
      <span>${escapeHtml(segment.group?.name || "路线段")} · ${escapeHtml(STATUS_LABELS[segment.status] || segment.status)}</span>
      <h2>${escapeHtml(routeLabel(segment))}</h2>
      <dl>${detailRows([
        { label: "日程", value: segment.day },
        { label: "计划里程", value: segment.planKm ? `${Number(segment.planKm).toFixed(1)} km` : "待轨迹复核" },
        { label: "预计时间", value: segment.durationS ? `${(segment.durationS / 3600).toFixed(1)} h` : "" },
        { label: "爬升", value: segment.ascentM ? `${segment.ascentM} m` : "" },
        { label: "下降", value: segment.descentM ? `${segment.descentM} m` : "" },
        { label: "地形", value: segment.terrain },
        { label: "接应/露营", value: segment.camp },
        { label: "关键风险", value: segment.risk },
        { label: "执行规则", value: segment.support },
        { label: "来源", value: segment.source },
        { label: "核查状态", value: segment.status === "draft_unverified" ? "文字日程生成，坐标和可通行性需复核" : "高德数据锚点路线" },
      ])}</dl>
    </article>
  `);
}

function clearHighlight() {
  if (state.overlays.highlight) {
    state.overlays.highlight.setMap(null);
    state.overlays.highlight = null;
  }
}

function drawHighlight(position) {
  clearHighlight();
  state.overlays.highlight = new state.amap.CircleMarker({
    center: position,
    radius: 18,
    strokeColor: "#14211d",
    strokeWeight: 3,
    fillColor: "#f7c948",
    fillOpacity: 0.45,
    zIndex: 2000,
  });
  state.map.add(state.overlays.highlight);
}

function fitVisibleRoutes() {
  const overlays = [...state.overlays.routeStopMarkers, ...state.overlays.routeLines];
  if (overlays.length) {
    state.map.setFitView(overlays, false, mapAvoidPadding(), 11);
  } else {
    const positions = visibleStops().map((stop) => stop.lnglat);
    if (positions.length) state.map.setBounds(routeBoundsFromPositions(positions), false, mapAvoidPadding());
  }
}

function renderMeasureStatus(text) {
  els.measureStatus.textContent = text;
}

function clearMeasureResult() {
  clearOverlays(state.overlays.measureMarkers);
  if (state.overlays.measureLine) {
    state.overlays.measureLine.setMap(null);
    state.overlays.measureLine = null;
  }
  state.measurePoints = [];
  renderMeasureStatus(state.measuring ? "请选择起点和终点。" : "测距未开启。");
}

function renderMeasureMarkers() {
  clearOverlays(state.overlays.measureMarkers);
  state.overlays.measureMarkers = state.measurePoints.map((point, index) =>
    new state.amap.Marker({
      position: point.lnglat,
      content: markerContent(index === 0 ? "marker marker-measure-start" : "marker marker-measure-end", index === 0 ? "起" : "终"),
      anchor: "center",
      offset: new state.amap.Pixel(0, 0),
    }),
  );
  if (state.overlays.measureMarkers.length) state.map.add(state.overlays.measureMarkers);
}

function routePathFromWalkingResult(result) {
  const route = result?.routes?.[0];
  const steps = route?.steps || [];
  const path = [];
  for (const step of steps) {
    for (const point of step.path || []) {
      if (Array.isArray(point)) path.push(point);
      else if (typeof point.getLng === "function") path.push([point.getLng(), point.getLat()]);
      else if ("lng" in point && "lat" in point) path.push([point.lng, point.lat]);
    }
  }
  return { route, path };
}

function searchWalkingDistance() {
  if (state.measurePoints.length !== 2) return;
  const [start, end] = state.measurePoints;
  renderMeasureStatus("正在用高德步行规划计算路线距离...");

  if (state.overlays.measureLine) {
    state.overlays.measureLine.setMap(null);
    state.overlays.measureLine = null;
  }

  state.walking.search(start.lnglat, end.lnglat, (status, result) => {
    if (status !== "complete") {
      renderMeasureStatus(`无法规划步行路线：${result?.info || result || "高德未返回可用路线"}`);
      renderDetail(`
        <article class="detail-card route">
          <span>路线测距</span>
          <h2>${escapeHtml(start.name)} -> ${escapeHtml(end.name)}</h2>
          <p>高德无法规划该步行路线；本工具不会用直线距离替代路线距离。</p>
        </article>
      `);
      return;
    }

    const { route, path } = routePathFromWalkingResult(result);
    if (!route || !path.length) {
      renderMeasureStatus("无法规划步行路线：高德没有返回可绘制路径。");
      return;
    }

    state.overlays.measureLine = new state.amap.Polyline({
      path,
      strokeColor: "#f7c948",
      strokeWeight: 7,
      strokeOpacity: 0.95,
      lineJoin: "round",
      lineCap: "round",
      zIndex: 180,
    });
    state.map.add(state.overlays.measureLine);
    state.map.setFitView([...state.overlays.measureMarkers, state.overlays.measureLine], false, mapAvoidPadding(), 13);

    const km = (Number(route.distance || 0) / 1000).toFixed(2);
    const hours = (Number(route.time || 0) / 3600).toFixed(1);
    renderMeasureStatus(`步行路线距离 ${km} km，预计 ${hours} h。`);
    renderDetail(`
      <article class="detail-card route">
        <span>路线测距 · 高德步行规划</span>
        <h2>${escapeHtml(start.name)} -> ${escapeHtml(end.name)}</h2>
        <dl>${detailRows([
          { label: "路线距离", value: `${km} km` },
          { label: "预计时间", value: `${hours} h` },
          { label: "起点", value: start.lnglat.join(", ") },
          { label: "终点", value: end.lnglat.join(", ") },
        ])}</dl>
      </article>
    `);
  });
}

function setMeasurePoint(kind, lnglat, name) {
  if (!state.measuring) toggleMeasure(true);
  const point = { lnglat: lnglat.map(Number), name };
  if (kind === "start") {
    state.measurePoints = [point, state.measurePoints[1]].filter(Boolean);
  } else if (kind === "end") {
    state.measurePoints = [state.measurePoints[0], point].filter(Boolean);
  } else if (state.measurePoints.length >= 2) {
    state.measurePoints = [point];
  } else {
    state.measurePoints.push(point);
  }
  renderMeasureMarkers();
  if (state.measurePoints.length === 1) renderMeasureStatus(`已选择起点：${state.measurePoints[0].name}。请选择终点。`);
  if (state.measurePoints.length === 2) searchWalkingDistance();
}

function handleMapClick(event) {
  if (!state.measuring) return;
  const lnglat = [event.lnglat.getLng(), event.lnglat.getLat()];
  setMeasurePoint("next", lnglat, state.measurePoints.length ? "地图终点" : "地图起点");
}

function toggleMeasure(force) {
  state.measuring = typeof force === "boolean" ? force : !state.measuring;
  els.measureToggle.classList.toggle("active", state.measuring);
  els.measureToggle.setAttribute("aria-pressed", String(state.measuring));
  clearMeasureResult();
}

function renderAll() {
  renderMetrics();
  renderRouteGroupControls();
  renderLayerButtons();
  renderRouteList();
  renderResults();
  renderMapObjects();
}

async function boot() {
  setLoading("正在读取地图配置...");
  const [config, data] = await Promise.all([getJson("/api/config"), getJson("../data/processed/map-data.json")]);
  state.data = data;
  ensureActiveRouteGroup();
  renderMetrics();
  renderRouteGroupControls();
  renderRouteList();
  renderResults();

  if (!config.ok) {
    showError("缺少高德 JS API 配置", `请在本地或服务器环境变量中设置：${config.missing.join(", ")}`);
    return;
  }

  setLoading("正在加载高德地图...");
  const AMap = await loadAmap(config);
  state.amap = AMap;
  state.walking = new AMap.Walking({ hideMarkers: true });
  state.map = new AMap.Map("map", {
    zoom: 6,
    center: [121.5, 48.6],
    viewMode: "2D",
    resizeEnable: true,
    mapStyle: "amap://styles/whitesmoke",
  });

  state.map.on("zoomend", () => {
    state.zoom = state.map.getZoom();
    renderMapObjects();
  });
  state.map.on("click", handleMapClick);

  state.map.on("complete", () => {
    state.zoom = state.map.getZoom();
    els.loading.hidden = true;
    renderAll();
    fitVisibleRoutes();
  });
}

els.layerButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const layer = button.dataset.layer;
    if (layer === "bureau") state.showBureau = !state.showBureau;
    if (layer === "farm") state.showFarm = !state.showFarm;
    if (layer === "unverified") state.showUnverified = !state.showUnverified;
    renderAll();
  });
});

els.searchInput.addEventListener("input", renderResults);
els.measureToggle.addEventListener("click", () => toggleMeasure());
els.measureClear.addEventListener("click", clearMeasureResult);
els.detailPanel.addEventListener("click", (event) => {
  const button = event.target.closest("[data-measure-point]");
  if (!button) return;
  const lnglat = button.dataset.lnglat.split(",").map(Number);
  setMeasurePoint(button.dataset.measurePoint, lnglat, button.dataset.name);
});

renderLayerButtons();
renderMeasureStatus("测距未开启。");
boot().catch((error) => {
  showError("地图初始化失败", error.message || String(error));
});
