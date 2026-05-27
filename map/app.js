const state = {
  filter: "all",
  search: "",
  features: [],
  anchors: [],
  routes: [],
  fullViewBox: null,
  viewBox: null,
  dragging: null,
};

const els = {
  poiCount: document.querySelector("#poiCount"),
  anchorCount: document.querySelector("#anchorCount"),
  routeKm: document.querySelector("#routeKm"),
  routeList: document.querySelector("#routeList"),
  searchInput: document.querySelector("#searchInput"),
  filters: [...document.querySelectorAll(".filter")],
  svg: document.querySelector("#mapSvg"),
  tip: document.querySelector("#mapTip"),
  zoomIn: document.querySelector("#zoomIn"),
  zoomOut: document.querySelector("#zoomOut"),
  resetView: document.querySelector("#resetView"),
};

const NS = "http://www.w3.org/2000/svg";

function classify(feature) {
  const name = feature.properties.name || "";
  const query = feature.properties.query || "";
  if (name.includes("林业局") || query.includes("林业局") || name.includes("森工")) return "bureau";
  if (name.includes("林场") || query.includes("林场")) return "farm";
  return "other";
}

function parseLocation(location) {
  const [lng, lat] = location.split(",").map(Number);
  return { lng, lat };
}

function mercator({ lng, lat }) {
  const x = (lng + 180) / 360;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return { x: x * 100000, y: y * 100000 };
}

function featureVisible(feature) {
  const kind = classify(feature);
  const props = feature.properties;
  const haystack = `${props.name} ${props.query} ${props.address} ${props.adname}`;
  const filterOk = state.filter === "all" || state.filter === kind;
  const searchOk = !state.search || haystack.toLowerCase().includes(state.search.toLowerCase());
  return filterOk && searchOk;
}

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  return node;
}

function setViewBox(box) {
  state.viewBox = { ...box };
  els.svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
}

function dataBounds(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX || 1000;
  const height = maxY - minY || 1000;
  return {
    x: minX - width * 0.16,
    y: minY - height * 0.16,
    width: width * 1.32,
    height: height * 1.32,
  };
}

function presentationBox(box) {
  const viewport = els.svg.getBoundingClientRect();
  const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
  if (!viewport.width || !sidebar) return box;

  const covered = Math.min(0.62, Math.max(0, (sidebar.right + 28) / viewport.width));
  const targetWidthFraction = Math.max(0.28, 0.94 - covered);
  const width = box.width / targetWidthFraction;
  return {
    x: box.x - covered * width,
    y: box.y,
    width,
    height: box.height,
  };
}

function zoom(factor, center = null) {
  const box = state.viewBox;
  const c = center || { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const next = {
    width: box.width * factor,
    height: box.height * factor,
  };
  next.x = c.x - (c.x - box.x) * factor;
  next.y = c.y - (c.y - box.y) * factor;
  setViewBox(next);
}

function screenToSvg(event) {
  const rect = els.svg.getBoundingClientRect();
  const box = state.viewBox;
  return {
    x: box.x + ((event.clientX - rect.left) / rect.width) * box.width,
    y: box.y + ((event.clientY - rect.top) / rect.height) * box.height,
  };
}

function routePath(anchors) {
  return anchors.map((anchor, index) => `${index === 0 ? "M" : "L"} ${anchor.point.x} ${anchor.point.y}`).join(" ");
}

function renderBackground(svg, box) {
  const defs = svgEl("defs");
  defs.append(
    svgEl("pattern", {
      id: "paperGrid",
      width: 1400,
      height: 1400,
      patternUnits: "userSpaceOnUse",
    }),
  );
  const pattern = defs.querySelector("pattern");
  pattern.append(svgEl("path", { d: "M 1400 0 L 0 0 0 1400", fill: "none", stroke: "#d8d0bd", "stroke-width": 28, opacity: 0.32 }));
  svg.append(defs);

  svg.append(svgEl("rect", { x: box.x, y: box.y, width: box.width, height: box.height, fill: "#f7f4eb" }));
  svg.append(svgEl("rect", { x: box.x, y: box.y, width: box.width, height: box.height, fill: "url(#paperGrid)" }));
}

function renderRoutes(svg, anchors) {
  const route = svgEl("path", {
    d: routePath(anchors),
    class: "route-main",
    fill: "none",
  });
  svg.append(route);

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i].point;
    const b = anchors[i + 1].point;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const routeInfo = state.routes[i];
    if (!routeInfo) continue;
    const text = svgEl("text", {
      x: mid.x,
      y: mid.y,
      class: "route-label",
      "text-anchor": "middle",
    });
    text.textContent = `${(routeInfo.distance_m / 1000).toFixed(0)} km`;
    svg.append(text);
  }
}

function renderAnchors(svg, anchors) {
  const group = svgEl("g", { class: "anchors" });
  for (const anchor of anchors) {
    group.append(svgEl("circle", { cx: anchor.point.x, cy: anchor.point.y, r: 18, class: "anchor-dot" }));
    const label = svgEl("text", {
      x: anchor.point.x + 32,
      y: anchor.point.y - 22,
      class: "anchor-label",
    });
    label.textContent = anchor.name;
    group.append(label);
  }
  svg.append(group);
}

function showTip(event, props, kind) {
  els.tip.hidden = false;
  els.tip.innerHTML = `<strong>${props.name}</strong><span>${kind === "bureau" ? "林业局" : kind === "farm" ? "林场" : "其他"}</span><small>${props.address || props.adname || ""}</small>`;
  els.tip.style.left = `${event.clientX + 14}px`;
  els.tip.style.top = `${event.clientY + 14}px`;
}

function hideTip() {
  els.tip.hidden = true;
}

function renderPois(svg) {
  const group = svgEl("g", { class: "pois" });
  const visible = state.features.filter(featureVisible);
  for (const feature of visible) {
    const [lng, lat] = feature.geometry.coordinates;
    const point = mercator({ lng, lat });
    const kind = classify(feature);
    const marker = svgEl("circle", {
      cx: point.x,
      cy: point.y,
      r: kind === "other" ? 7 : 10,
      class: `poi ${kind}`,
      tabindex: 0,
    });
    marker.addEventListener("pointermove", (event) => showTip(event, feature.properties, kind));
    marker.addEventListener("pointerleave", hideTip);
    group.append(marker);
  }
  svg.append(group);
  els.poiCount.textContent = visible.length;
}

function renderMap() {
  const svg = els.svg;
  svg.replaceChildren();
  const anchorPoints = state.anchors.map((anchor) => ({ ...anchor, point: mercator(parseLocation(anchor.location)) }));
  const poiPoints = state.features.map((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    return mercator({ lng, lat });
  });
  const box = dataBounds([...anchorPoints.map((anchor) => anchor.point), ...poiPoints]);
  state.fullViewBox = presentationBox(box);
  if (!state.viewBox) setViewBox(state.fullViewBox);

  renderBackground(svg, box);
  renderRoutes(svg, anchorPoints);
  renderPois(svg);
  renderAnchors(svg, anchorPoints);
}

function renderRouteList() {
  els.routeList.innerHTML = state.routes
    .map((route) => {
      const km = (route.distance_m / 1000).toFixed(1);
      const hours = (route.duration_s / 3600).toFixed(1);
      return `<li><b>${route.from} -> ${route.to}</b><span>${km} km · ${hours} h</span></li>`;
    })
    .join("");
}

async function init() {
  const [places, anchors, routes] = await Promise.all([
    fetch("../data/processed/places-first-pass.geojson").then((r) => r.json()),
    fetch("../data/processed/anchor-towns.json").then((r) => r.json()),
    fetch("../data/processed/anchor-route-segments.json").then((r) => r.json()),
  ]);

  state.features = places.features;
  state.anchors = anchors;
  state.routes = routes;
  els.anchorCount.textContent = anchors.length;
  els.routeKm.textContent = Math.round(routes.reduce((sum, route) => sum + (route.distance_m || 0), 0) / 1000);
  renderRouteList();
  renderMap();
}

els.filters.forEach((button) => {
  button.addEventListener("click", () => {
    els.filters.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.filter = button.dataset.filter;
    renderMap();
  });
});

els.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value.trim();
  renderMap();
});

els.zoomIn.addEventListener("click", () => zoom(0.72));
els.zoomOut.addEventListener("click", () => zoom(1.38));
els.resetView.addEventListener("click", () => {
  setViewBox(state.fullViewBox);
});

els.svg.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoom(event.deltaY < 0 ? 0.82 : 1.22, screenToSvg(event));
});

els.svg.addEventListener("pointerdown", (event) => {
  els.svg.setPointerCapture(event.pointerId);
  state.dragging = { start: screenToSvg(event), box: { ...state.viewBox } };
});

els.svg.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  const current = screenToSvg(event);
  const dx = current.x - state.dragging.start.x;
  const dy = current.y - state.dragging.start.y;
  setViewBox({
    ...state.dragging.box,
    x: state.dragging.box.x - dx,
    y: state.dragging.box.y - dy,
  });
});

els.svg.addEventListener("pointerup", () => {
  state.dragging = null;
});

els.svg.addEventListener("pointercancel", () => {
  state.dragging = null;
});

init().catch((error) => {
  document.body.innerHTML = `<pre>${error.stack || error.message}</pre>`;
});
