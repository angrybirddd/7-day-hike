const state = {
  amap: null,
  map: null,
  data: null,
  zoom: 7,
  showBureau: true,
  showFarm: true,
  showUnverified: false,
  overlays: {
    routeLines: [],
    anchorMarkers: [],
    placeMarkers: [],
    labelsLayer: null,
    unverifiedCluster: null,
    highlight: null,
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
  routeList: document.querySelector("#routeList"),
  resultsList: document.querySelector("#resultsList"),
  detailPanel: document.querySelector("#detailPanel"),
  zoomHint: document.querySelector("#zoomHint"),
};

const CATEGORY_LABELS = {
  anchor: "路线锚点",
  bureau: "林业局",
  farm: "林场",
  related: "待核查",
};

const STATUS_LABELS = {
  trusted: "可信",
  unverified: "待核查",
};

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
    plugins: ["AMap.MarkerCluster"],
  });
}

function totalRouteKm() {
  return Math.round(state.data.routes.reduce((sum, route) => sum + route.distance_m, 0) / 1000);
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

function clearOverlays(items) {
  for (const item of items) item.setMap?.(null);
  items.length = 0;
}

function clearLayer(layer) {
  if (layer) layer.setMap(null);
}

function markerContent(className, text = "") {
  const label = text ? `<span>${text}</span>` : "";
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

function renderMetrics() {
  const trusted = state.data.places.filter((place) => place.status === "trusted").length;
  els.poiCount.textContent = state.data.places.length;
  els.trustedCount.textContent = trusted;
  els.routeKm.textContent = totalRouteKm();
}

function renderRoutes() {
  clearOverlays(state.overlays.routeLines);

  for (const route of state.data.routes) {
    const line = new state.amap.Polyline({
      path: [route.origin, route.destination],
      strokeColor: "#2d7190",
      strokeWeight: 7,
      strokeOpacity: 0.9,
      lineJoin: "round",
      lineCap: "round",
      extData: route,
      zIndex: 80,
    });
    line.on("click", () => selectRoute(route));
    state.overlays.routeLines.push(line);
  }

  state.map.add(state.overlays.routeLines);
}

function renderAnchors() {
  clearOverlays(state.overlays.anchorMarkers);
  state.overlays.anchorMarkers = state.data.anchors.map((anchor, index) => makeMarker(anchor, "marker marker-anchor", String(index + 1)));
  state.map.add(state.overlays.anchorMarkers);
}

function labelIcon(category, status) {
  const color = category === "bureau" ? "#b55b32" : category === "farm" ? "#145c3d" : category === "anchor" ? "#2d7190" : "#6e8f3d";
  const opacity = status === "unverified" ? 0.58 : 0.96;
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

function makeRouteDistanceLabel(route) {
  const midpoint = [(route.origin[0] + route.destination[0]) / 2, (route.origin[1] + route.destination[1]) / 2];
  const emptyIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`;
  const marker = new state.amap.LabelMarker({
    position: midpoint,
    rank: 80,
    icon: {
      type: "image",
      image: `data:image/svg+xml;utf8,${encodeURIComponent(emptyIcon)}`,
      size: [1, 1],
      anchor: "center",
    },
    text: {
      content: `${Math.round(route.distance_m / 1000)} km`,
      direction: "center",
      offset: [0, 0],
      style: {
        fontSize: 12,
        fontWeight: "800",
        fillColor: "#2d7190",
        strokeColor: "#fffdf7",
        strokeWidth: 5,
      },
    },
    extData: route,
  });
  marker.on("click", () => selectRoute(route));
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

  const anchorLabels = state.data.anchors.map((anchor) => {
    const marker = new state.amap.LabelMarker({
      position: anchor.lnglat,
      rank: 100,
      icon: labelIcon("anchor", "trusted"),
      text: {
        content: anchor.name,
        direction: "top",
        offset: [0, -10],
        style: {
          fontSize: 14,
          fontWeight: "800",
          fillColor: "#14211d",
          strokeColor: "#fffdf7",
          strokeWidth: 5,
        },
      },
      extData: anchor,
    });
    marker.on("click", () => selectItem(anchor));
    return marker;
  });

  const routeLabels = state.data.routes.map(makeRouteDistanceLabel);
  state.overlays.labelsLayer.add([...anchorLabels, ...routeLabels, ...visibleLabelPlaces().map(makeLabelMarker)]);
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
  renderTrustedMarkers();
  renderLabels();
  renderUnverifiedCluster();
  renderZoomHint();
}

function renderZoomHint() {
  if (state.zoom < 8) {
    els.zoomHint.textContent = "当前只显示路线骨架。放大到 8 级显示林业局，10 级显示林场。";
  } else if (state.zoom < 10) {
    els.zoomHint.textContent = "当前显示可信林业局。继续放大到 10 级显示林场。";
  } else if (state.zoom < 12) {
    els.zoomHint.textContent = "当前显示可信林业局和林场。12 级后可查看待核查点。";
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

function renderRouteList() {
  els.routeList.innerHTML = state.data.routes
    .map((route) => {
      const km = (route.distance_m / 1000).toFixed(1);
      const hours = (route.duration_s / 3600).toFixed(1);
      return `<li><button type="button" data-route="${route.id}"><b>${routeLabel(route)}</b><span>${km} km · ${hours} h</span></button></li>`;
    })
    .join("");

  els.routeList.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      const route = state.data.routes.find((item) => item.id === button.dataset.route);
      selectRoute(route);
    });
  });
}

function matchesSearch(item, term) {
  const text = [item.name, item.from, item.to, item.address, item.adname, item.category, item.status, item.query].filter(Boolean).join(" ");
  return text.toLowerCase().includes(term.toLowerCase());
}

function renderResults() {
  const term = els.searchInput.value.trim();
  if (!term) {
    els.resultsList.innerHTML = "";
    return;
  }

  const items = [
    ...state.data.anchors.map((item) => ({ type: "item", item })),
    ...state.data.routes.map((item) => ({ type: "route", item })),
    ...state.data.places.map((item) => ({ type: "item", item })),
  ]
    .filter(({ item }) => matchesSearch(item, term))
    .slice(0, 30);

  els.resultsList.innerHTML = items
    .map(({ type, item }) => {
      const title = type === "route" ? routeLabel(item) : item.name;
      const meta = type === "route" ? `${Math.round(item.distance_m / 1000)} km` : `${CATEGORY_LABELS[item.category]} · ${STATUS_LABELS[item.status]}`;
      return `<li><button type="button" data-kind="${type}" data-id="${item.id}"><b>${title}</b><span>${meta}</span></button></li>`;
    })
    .join("");

  els.resultsList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.kind === "route") {
        selectRoute(state.data.routes.find((item) => item.id === button.dataset.id));
      } else {
        selectItem([...state.data.anchors, ...state.data.places].find((item) => item.id === button.dataset.id));
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
    .map((row) => `<dt>${row.label}</dt><dd>${row.value}</dd>`)
    .join("");
}

function selectItem(item) {
  if (!item) return;
  state.map.setZoomAndCenter(Math.max(state.zoom, item.category === "anchor" ? 8 : 12), item.lnglat);
  drawHighlight(item.lnglat);

  renderDetail(`
    <article class="detail-card ${item.status}">
      <span>${CATEGORY_LABELS[item.category]} · ${STATUS_LABELS[item.status]}</span>
      <h2>${item.name}</h2>
      <dl>${detailRows([
        { label: "地址", value: item.address },
        { label: "区域", value: item.adname },
        { label: "来源", value: item.source },
        { label: "查询词", value: item.query },
        { label: "判断", value: item.reason },
        { label: "坐标", value: item.lnglat.join(", ") },
      ])}</dl>
    </article>
  `);
}

function routeBounds(route) {
  const minLng = Math.min(route.origin[0], route.destination[0]);
  const maxLng = Math.max(route.origin[0], route.destination[0]);
  const minLat = Math.min(route.origin[1], route.destination[1]);
  const maxLat = Math.max(route.origin[1], route.destination[1]);
  return new state.amap.Bounds([minLng, minLat], [maxLng, maxLat]);
}

function mapAvoidPadding() {
  const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
  if (!sidebar) return [72, 72, 72, 72];

  // AMap's avoid array order is top, bottom, left, right.
  if (window.innerWidth <= 680) {
    return [72, Math.min(Math.round(sidebar.height + 32), Math.round(window.innerHeight * 0.48)), 48, 48];
  }

  return [72, 72, Math.min(Math.round(sidebar.width + 48), Math.round(window.innerWidth * 0.45)), 72];
}

function selectRoute(route) {
  if (!route) return;
  state.map.setBounds(routeBounds(route), false, mapAvoidPadding());
  clearHighlight();

  renderDetail(`
    <article class="detail-card route">
      <span>路线段</span>
      <h2>${routeLabel(route)}</h2>
      <dl>${detailRows([
        { label: "距离", value: `${(route.distance_m / 1000).toFixed(1)} km` },
        { label: "预计时间", value: `${(route.duration_s / 3600).toFixed(1)} h` },
        { label: "来源", value: route.source },
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

function fitRoute() {
  const overlays = [...state.overlays.anchorMarkers, ...state.overlays.routeLines];
  if (overlays.length) {
    state.map.setFitView(overlays, false, mapAvoidPadding(), 11);
  } else if (state.data.anchors.length) {
    state.map.setCenter(state.data.anchors[0].lnglat);
  }
}

async function boot() {
  setLoading("正在读取地图配置...");
  const [config, data] = await Promise.all([getJson("/api/config"), getJson("../data/processed/map-data.json")]);
  state.data = data;
  renderMetrics();
  renderRouteList();
  renderResults();

  if (!config.ok) {
    showError("缺少高德 JS API 配置", `请在本地或服务器环境变量中设置：${config.missing.join(", ")}`);
    return;
  }

  setLoading("正在加载高德地图...");
  const AMap = await loadAmap(config);
  state.amap = AMap;
  state.map = new AMap.Map("map", {
    zoom: 7,
    center: [122.2, 50.1],
    viewMode: "2D",
    resizeEnable: true,
    mapStyle: "amap://styles/whitesmoke",
  });

  state.map.on("zoomend", () => {
    state.zoom = state.map.getZoom();
    renderMapObjects();
  });

  state.map.on("complete", () => {
    state.zoom = state.map.getZoom();
    els.loading.hidden = true;
    renderRoutes();
    renderAnchors();
    renderMapObjects();
    fitRoute();
  });
}

els.layerButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const layer = button.dataset.layer;
    if (layer === "bureau") state.showBureau = !state.showBureau;
    if (layer === "farm") state.showFarm = !state.showFarm;
    if (layer === "unverified") state.showUnverified = !state.showUnverified;
    renderLayerButtons();
    renderMapObjects();
  });
});

els.searchInput.addEventListener("input", renderResults);

renderLayerButtons();
boot().catch((error) => {
  showError("地图初始化失败", error.message || String(error));
});
