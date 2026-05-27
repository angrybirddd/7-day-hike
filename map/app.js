const map = L.map("map", {
  zoomControl: true,
  preferCanvas: true,
}).setView([50.2, 122.2], 7);
window.__hikeMap = map;

L.tileLayer("https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}", {
  subdomains: ["1", "2", "3", "4"],
  maxZoom: 18,
  noWrap: true,
  attribution: "&copy; 高德地图",
}).addTo(map);

const state = {
  filter: "all",
  search: "",
  features: [],
  markerLayer: L.layerGroup().addTo(map),
  routeLayer: L.layerGroup().addTo(map),
};

const els = {
  poiCount: document.querySelector("#poiCount"),
  anchorCount: document.querySelector("#anchorCount"),
  routeKm: document.querySelector("#routeKm"),
  routeList: document.querySelector("#routeList"),
  searchInput: document.querySelector("#searchInput"),
  filters: [...document.querySelectorAll(".filter")],
};

function classify(feature) {
  const name = feature.properties.name || "";
  const query = feature.properties.query || "";
  if (name.includes("林业局") || query.includes("林业局") || name.includes("森工")) return "bureau";
  if (name.includes("林场") || query.includes("林场")) return "farm";
  return "other";
}

function markerIcon(kind) {
  return L.divIcon({
    className: "",
    html: `<span class="poi-marker ${kind}"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function featureVisible(feature) {
  const kind = classify(feature);
  const haystack = `${feature.properties.name} ${feature.properties.query} ${feature.properties.address} ${feature.properties.adname}`;
  const filterOk = state.filter === "all" || state.filter === kind;
  const searchOk = !state.search || haystack.toLowerCase().includes(state.search.toLowerCase());
  return filterOk && searchOk;
}

function renderMarkers() {
  state.markerLayer.clearLayers();
  const bounds = [];

  for (const feature of state.features.filter(featureVisible)) {
    const [lng, lat] = feature.geometry.coordinates;
    const kind = classify(feature);
    bounds.push([lat, lng]);
    L.marker([lat, lng], { icon: markerIcon(kind) })
      .bindPopup(
        `<strong>${feature.properties.name}</strong><br>` +
          `${feature.properties.type || ""}<br>` +
          `${feature.properties.address || ""}<br>` +
          `<small>${feature.properties.location || ""}</small>`,
      )
      .addTo(state.markerLayer);
  }

  els.poiCount.textContent = state.features.filter(featureVisible).length;
  map.invalidateSize();
  if (bounds.length) {
    const sidebarWidth = document.querySelector(".sidebar")?.getBoundingClientRect().width || 0;
    map.fitBounds(bounds, {
      paddingTopLeft: [sidebarWidth + 42, 52],
      paddingBottomRight: [52, 52],
      maxZoom: 8,
    });
  }
}

function parseLocation(location) {
  const [lng, lat] = location.split(",").map(Number);
  return [lat, lng];
}

async function init() {
  map.invalidateSize();
  const [places, anchors, routes] = await Promise.all([
    fetch("../data/processed/places-first-pass.geojson").then((r) => r.json()),
    fetch("../data/processed/anchor-towns.json").then((r) => r.json()),
    fetch("../data/processed/anchor-route-segments.json").then((r) => r.json()),
  ]);

  state.features = places.features;
  els.anchorCount.textContent = anchors.length;
  els.routeKm.textContent = Math.round(routes.reduce((sum, route) => sum + (route.distance_m || 0), 0) / 1000);

  const anchorLine = anchors.map((anchor) => parseLocation(anchor.location));
  L.polyline(anchorLine, {
    color: "#2d7190",
    weight: 4,
    opacity: 0.72,
  }).addTo(state.routeLayer);

  for (const anchor of anchors) {
    L.circleMarker(parseLocation(anchor.location), {
      radius: 5,
      color: "#14211d",
      weight: 2,
      fillColor: "#f7f4eb",
      fillOpacity: 1,
    })
      .bindPopup(`<strong>${anchor.name}</strong><br>${anchor.formatted_address}<br><small>${anchor.source}</small>`)
      .addTo(state.routeLayer);
  }

  els.routeList.innerHTML = routes
    .map((route) => {
      const km = (route.distance_m / 1000).toFixed(1);
      const hours = (route.duration_s / 3600).toFixed(1);
      return `<li><b>${route.from} -> ${route.to}</b><span>${km} km · ${hours} h</span></li>`;
    })
    .join("");

  renderMarkers();
  requestAnimationFrame(() => map.invalidateSize());
  setTimeout(() => map.invalidateSize(), 250);
}

els.filters.forEach((button) => {
  button.addEventListener("click", () => {
    els.filters.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.filter = button.dataset.filter;
    renderMarkers();
  });
});

els.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value.trim();
  renderMarkers();
});

init().catch((error) => {
  document.body.innerHTML = `<pre>${error.stack || error.message}</pre>`;
});
