const state = {
  amap: null,
  map: null,
  walking: null,
  placeSearch: null,
  routebooks: [],
  activeRoutebookId: "",
  selectedDayId: "",
  expandedDayId: "",
  pickTarget: null,
  dirty: false,
  overlays: {
    markers: [],
    lines: [],
    labelsLayer: null,
  },
};

const els = {
  map: document.querySelector("#map"),
  loading: document.querySelector("#loadingState"),
  error: document.querySelector("#errorState"),
  errorTitle: document.querySelector("#errorTitle"),
  errorBody: document.querySelector("#errorBody"),
  saveState: document.querySelector("#saveState"),
  routebookSelect: document.querySelector("#routebookSelect"),
  newRoutebook: document.querySelector("#newRoutebook"),
  duplicateRoutebook: document.querySelector("#duplicateRoutebook"),
  deleteRoutebook: document.querySelector("#deleteRoutebook"),
  routebookForm: document.querySelector("#routebookForm"),
  dayCount: document.querySelector("#dayCount"),
  planKm: document.querySelector("#planKm"),
  walkingKm: document.querySelector("#walkingKm"),
  addDay: document.querySelector("#addDay"),
  calculateAll: document.querySelector("#calculateAll"),
  saveRoutebooks: document.querySelector("#saveRoutebooks"),
  dayList: document.querySelector("#dayList"),
  detailPanel: document.querySelector("#detailPanel"),
};

const DAY_FIELDS = [
  ["planKm", "计划 km", "number"],
  ["ascentM", "爬升 m", "number"],
  ["descentM", "下降 m", "number"],
  ["elevationMinM", "最低海拔", "number"],
  ["elevationMaxM", "最高海拔", "number"],
  ["terrain", "地貌", "textarea"],
  ["supply", "补给", "textarea"],
  ["lodging", "住宿", "textarea"],
  ["risk", "风险", "textarea"],
  ["culture", "风土人情", "textarea"],
  ["notes", "备注", "textarea"],
];

function uid(prefix) {
  const value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function asNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sameOriginUrl(path) {
  return new URL(path, `${window.location.protocol}//${window.location.host}`).toString();
}

function getJson(url) {
  return fetch(sameOriginUrl(url), { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.json();
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.append(script);
  });
}

async function loadAmap(config) {
  if (!window.AMapLoader) await loadScript("https://webapi.amap.com/loader.js");
  window._AMapSecurityConfig = { securityJsCode: config.amap.securityJsCode };
  return window.AMapLoader.load({
    key: config.amap.key,
    version: "2.0",
    plugins: ["AMap.Walking", "AMap.PlaceSearch", "AMap.LabelsLayer"],
  });
}

function showError(title, body) {
  els.loading.hidden = true;
  els.error.hidden = false;
  els.errorTitle.textContent = title;
  els.errorBody.textContent = body;
}

function activeRoutebook() {
  return state.routebooks.find((item) => item.id === state.activeRoutebookId) || state.routebooks[0] || null;
}

function activeDays() {
  return activeRoutebook()?.days || [];
}

function findDay(dayId) {
  return activeDays().find((day) => day.id === dayId);
}

function selectDay(dayId, { expand = true } = {}) {
  const day = findDay(dayId);
  if (!day) return null;
  state.selectedDayId = day.id;
  if (expand) state.expandedDayId = day.id;
  return day;
}

function emptyPoint(name = "") {
  return {
    name,
    lnglat: null,
    source: "",
    status: "unresolved",
    candidates: [],
  };
}

function createDay(index = 1) {
  return {
    id: uid("day"),
    dayIndex: index,
    title: `Day${index}`,
    start: emptyPoint(""),
    end: emptyPoint(""),
    planKm: null,
    ascentM: null,
    descentM: null,
    elevationMinM: null,
    elevationMaxM: null,
    terrain: "",
    supply: "",
    lodging: "",
    risk: "",
    culture: "",
    notes: "",
    walkingDistanceM: null,
    walkingDurationS: null,
    walkingStatus: "idle",
    walkingPath: [],
  };
}

function createRoutebook(copyFrom) {
  if (copyFrom) {
    const cloned = structuredClone(copyFrom);
    cloned.id = uid("routebook");
    cloned.name = `${copyFrom.name || "未命名路书"} 副本`;
    cloned.updatedAt = new Date().toISOString();
    cloned.days = (cloned.days || []).map((day, index) => ({ ...day, id: uid("day"), dayIndex: index + 1 }));
    return cloned;
  }

  return {
    id: uid("routebook"),
    name: "未命名路书",
    region: "",
    status: "draft",
    notes: "",
    updatedAt: new Date().toISOString(),
    days: [createDay(1)],
  };
}

function normalizePoint(point) {
  const normalized = { ...emptyPoint(), ...(point || {}) };
  normalized.lnglat = Array.isArray(normalized.lnglat) ? normalized.lnglat.map(Number) : null;
  normalized.candidates = Array.isArray(normalized.candidates) ? normalized.candidates : [];
  return normalized;
}

function normalizeRoutebook(routebook) {
  return {
    id: routebook.id || uid("routebook"),
    name: routebook.name || "未命名路书",
    region: routebook.region || "",
    status: routebook.status || "draft",
    notes: routebook.notes || "",
    updatedAt: routebook.updatedAt || new Date().toISOString(),
    days: (routebook.days || []).map((day, index) => ({
      ...createDay(index + 1),
      ...day,
      id: day.id || uid("day"),
      dayIndex: index + 1,
      start: normalizePoint(day.start),
      end: normalizePoint(day.end),
      walkingPath: Array.isArray(day.walkingPath) ? day.walkingPath : [],
    })),
  };
}

function markDirty() {
  state.dirty = true;
  updateSaveState();
}

function updateSaveState(text) {
  els.saveState.textContent = text || (state.dirty ? "未保存" : "已保存");
  els.saveState.classList.toggle("dirty", state.dirty);
}

function clearOverlays(items) {
  for (const item of items) item.setMap?.(null);
  items.length = 0;
}

function markerContent(className, text) {
  return `<div class="${className}">${escapeHtml(text)}</div>`;
}

function formatKm(value) {
  const number = Number(value || 0);
  return number ? (number / 1000).toFixed(1) : "0";
}

function dayRouteLabel(day) {
  return `${day.start?.name || "起点"} → ${day.end?.name || "终点"}`;
}

function dayWalkingLabel(day) {
  if (day.walkingStatus === "ok") {
    return `${formatKm(day.walkingDistanceM)} km · ${((Number(day.walkingDurationS || 0)) / 3600).toFixed(1)} h`;
  }
  if (day.walkingStatus === "failed") return "未规划";
  if (day.walkingStatus === "calculating") return "计算中";
  if (day.walkingStatus === "missing_point") return "缺坐标";
  return "待计算";
}

function daySummary(day) {
  const plan = day.planKm ? `计划 ${day.planKm} km` : "计划 - km";
  return `${plan} · 高德 ${dayWalkingLabel(day)}`;
}

function routePathFromWalkingResult(result) {
  const route = result?.routes?.[0];
  const path = [];
  for (const step of route?.steps || []) {
    for (const point of step.path || []) {
      if (point?.lng !== undefined) path.push([point.lng, point.lat]);
      else if (point?.getLng) path.push([point.getLng(), point.getLat()]);
    }
  }
  return { route, path };
}

function routeBounds() {
  return activeDays().flatMap((day) => [day.start?.lnglat, day.end?.lnglat]).filter(Boolean);
}

function midpoint(start, end) {
  return [(Number(start[0]) + Number(end[0])) / 2, (Number(start[1]) + Number(end[1])) / 2];
}

function nonEmptyRows(rows) {
  return rows
    .filter((row) => row.value !== null && row.value !== undefined && String(row.value).trim() !== "")
    .map((row) => `<dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd>`)
    .join("");
}

function previewRows(day) {
  return nonEmptyRows([
    { label: "爬升", value: day.ascentM ? `${day.ascentM} m` : "" },
    { label: "下降", value: day.descentM ? `${day.descentM} m` : "" },
    {
      label: "海拔",
      value:
        day.elevationMinM || day.elevationMaxM
          ? `${day.elevationMinM || "-"} - ${day.elevationMaxM || "-"} m`
          : "",
    },
    { label: "地貌", value: day.terrain },
    { label: "补给", value: day.supply },
    { label: "住宿", value: day.lodging },
    { label: "风险", value: day.risk },
    { label: "风土", value: day.culture },
    { label: "备注", value: day.notes },
  ]);
}

function renderRoutebookPreview() {
  const routebook = activeRoutebook();
  if (!routebook) {
    els.detailPanel.innerHTML = "";
    return;
  }

  const days = activeDays();
  const planKm = days.reduce((sum, day) => sum + Number(day.planKm || 0), 0);
  const walkingM = days.reduce((sum, day) => sum + Number(day.walkingStatus === "ok" ? day.walkingDistanceM || 0 : 0), 0);

  els.detailPanel.innerHTML = `
    <article class="routebook-preview">
      <header>
        <span>完整文字路书</span>
        <h2>${escapeHtml(routebook.name || "未命名路书")}</h2>
        <p>${escapeHtml([routebook.region, `${days.length} 天`, `计划 ${planKm || 0} km`, `高德 ${formatKm(walkingM)} km`].filter(Boolean).join(" · "))}</p>
      </header>
      <ol>
        ${days
          .map((day) => {
            const selected = day.id === state.selectedDayId ? " selected" : "";
            const rows = previewRows(day);
            return `
              <li class="preview-day${selected}">
                <button type="button" data-preview-day-id="${escapeHtml(day.id)}">
                  <span>${escapeHtml(day.title || `Day${day.dayIndex}`)}</span>
                  <strong>${escapeHtml(dayRouteLabel(day))}</strong>
                  <em>${escapeHtml(daySummary(day))}</em>
                </button>
                ${rows ? `<dl>${rows}</dl>` : ""}
              </li>
            `;
          })
          .join("")}
      </ol>
    </article>
  `;
}

function renderRoutebookSelect() {
  els.routebookSelect.innerHTML = state.routebooks
    .map((routebook) => `<option value="${escapeHtml(routebook.id)}">${escapeHtml(routebook.name)}</option>`)
    .join("");
  els.routebookSelect.value = state.activeRoutebookId;
}

function renderRoutebookForm() {
  const routebook = activeRoutebook();
  if (!routebook) {
    els.routebookForm.innerHTML = `<div class="empty-panel"><h2>还没有路书</h2><p>新建后开始规划。</p></div>`;
    return;
  }

  els.routebookForm.innerHTML = `
    <label>
      <span>名称</span>
      <input data-book-field="name" value="${escapeHtml(routebook.name)}" />
    </label>
    <label>
      <span>区域</span>
      <input data-book-field="region" value="${escapeHtml(routebook.region)}" />
    </label>
    <label>
      <span>总备注</span>
      <textarea data-book-field="notes" rows="3">${escapeHtml(routebook.notes)}</textarea>
    </label>
  `;
}

function renderMetrics() {
  const days = activeDays();
  const planKm = days.reduce((sum, day) => sum + Number(day.planKm || 0), 0);
  const walkingM = days.reduce((sum, day) => sum + Number(day.walkingStatus === "ok" ? day.walkingDistanceM || 0 : 0), 0);
  els.dayCount.textContent = String(days.length);
  els.planKm.textContent = planKm.toFixed(planKm % 1 ? 1 : 0);
  els.walkingKm.textContent = formatKm(walkingM);
}

function endpointControls(day, key) {
  const point = day[key] || emptyPoint();
  const label = key === "start" ? "起点" : "终点";
  const coord = point.lnglat ? point.lnglat.map((item) => Number(item).toFixed(5)).join(", ") : "未定位";
  const candidates = (point.candidates || [])
    .map(
      (candidate, index) => `
        <button type="button" data-action="choose-candidate" data-day-id="${escapeHtml(day.id)}" data-endpoint="${key}" data-index="${index}">
          ${escapeHtml(candidate.name)} <span>${escapeHtml(candidate.address || candidate.adname || "")}</span>
        </button>
      `,
    )
    .join("");

  return `
    <div class="endpoint">
      <label>
        <span>${label}</span>
        <input data-day-id="${escapeHtml(day.id)}" data-endpoint="${key}" data-point-field="name" value="${escapeHtml(point.name)}" />
      </label>
      <div class="endpoint-actions">
        <button type="button" data-action="search-place" data-day-id="${escapeHtml(day.id)}" data-endpoint="${key}">搜索候选</button>
        <button type="button" data-action="pick-map" data-day-id="${escapeHtml(day.id)}" data-endpoint="${key}">地图点选</button>
        <button type="button" data-action="clear-point" data-day-id="${escapeHtml(day.id)}" data-endpoint="${key}">清坐标</button>
      </div>
      <p class="coord">${escapeHtml(coord)}</p>
      <div class="candidate-list">${candidates}</div>
    </div>
  `;
}

function dayField(day, [field, label, type]) {
  const value = day[field] ?? "";
  if (type === "textarea") {
    return `
      <label class="wide">
        <span>${label}</span>
        <textarea rows="2" data-day-id="${escapeHtml(day.id)}" data-day-field="${field}">${escapeHtml(value)}</textarea>
      </label>
    `;
  }
  return `
    <label>
      <span>${label}</span>
      <input type="${type}" data-day-id="${escapeHtml(day.id)}" data-day-field="${field}" value="${escapeHtml(value)}" />
    </label>
  `;
}

function renderDayList() {
  const days = activeDays();
  if (!days.length) {
    els.dayList.innerHTML = `<div class="empty-panel"><h2>没有 Day</h2><p>添加一个 Day。</p></div>`;
    return;
  }

  els.dayList.innerHTML = days
    .map((day, index) => {
      const selected = day.id === state.selectedDayId ? " selected" : "";
      const expanded = day.id === state.expandedDayId;
      const walking =
        day.walkingStatus === "ok"
          ? `高德 ${formatKm(day.walkingDistanceM)} km`
          : day.walkingStatus === "failed"
            ? "未规划"
            : "待计算";
      return `
        <article class="day-card${selected}${expanded ? " expanded" : " collapsed"}" data-day-id="${escapeHtml(day.id)}">
          <header>
            <button class="day-summary-button" type="button" data-action="select-day" data-day-id="${escapeHtml(day.id)}">
              <span>${escapeHtml(day.title || `Day${index + 1}`)}</span>
              <strong>${escapeHtml(dayRouteLabel(day))}</strong>
              <em>${escapeHtml(daySummary(day))}</em>
            </button>
            <div class="day-actions">
              <button type="button" data-action="toggle-day" data-day-id="${escapeHtml(day.id)}">${expanded ? "收起" : "编辑"}</button>
              <button type="button" data-action="move-day-up" data-day-id="${escapeHtml(day.id)}">上移</button>
              <button type="button" data-action="move-day-down" data-day-id="${escapeHtml(day.id)}">下移</button>
              <button type="button" data-action="calc-day" data-day-id="${escapeHtml(day.id)}">计算</button>
              <button type="button" data-action="delete-day" data-day-id="${escapeHtml(day.id)}">删除</button>
            </div>
          </header>
          ${
            expanded
              ? `
                <label>
                  <span>标题</span>
                  <input data-day-id="${escapeHtml(day.id)}" data-day-field="title" value="${escapeHtml(day.title || `Day${index + 1}`)}" />
                </label>
                <div class="endpoint-grid">
                  ${endpointControls(day, "start")}
                  ${endpointControls(day, "end")}
                </div>
                <div class="field-grid">
                  ${DAY_FIELDS.map((field) => dayField(day, field)).join("")}
                </div>
                <footer>
                  <span>计划 ${escapeHtml(day.planKm || "-")} km</span>
                  <span>${escapeHtml(walking)}</span>
                </footer>
              `
              : ""
          }
        </article>
      `;
    })
    .join("");
}

function renderAll() {
  renderRoutebookSelect();
  renderRoutebookForm();
  renderMetrics();
  renderDayList();
  renderMapObjects();
  renderRoutebookPreview();
}

function makePointMarker(day, endpoint, label) {
  const point = day[endpoint];
  if (!point?.lnglat) return null;
  const marker = new state.amap.Marker({
    position: point.lnglat,
    draggable: true,
    content: markerContent(endpoint === "start" ? "marker start" : "marker end", label),
    anchor: "center",
    offset: new state.amap.Pixel(0, 0),
    zIndex: day.id === state.selectedDayId ? 120 : 100,
  });
  marker.on("click", () => {
    selectDay(day.id);
    renderAll();
  });
  marker.on("dragend", (event) => {
    point.lnglat = [event.lnglat.getLng(), event.lnglat.getLat()];
    point.source = "map_drag";
    point.status = "resolved";
    clearDayWalking(day);
    selectDay(day.id);
    markDirty();
    renderAll();
  });
  return marker;
}

function makeDistanceLabel(day) {
  const start = day.start?.lnglat;
  const end = day.end?.lnglat;
  if (!start || !end) return null;
  const content =
    day.walkingStatus === "ok"
      ? `${formatKm(day.walkingDistanceM)} km`
      : day.walkingStatus === "failed"
        ? "未规划"
        : day.planKm
          ? `计划 ${day.planKm} km`
          : "待核查";
  return new state.amap.LabelMarker({
    position: midpoint(start, end),
    rank: day.id === state.selectedDayId ? 100 : 70,
    icon: { type: "image", image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", size: [1, 1], anchor: "center" },
    text: {
      content,
      direction: "top",
      offset: [0, -4],
      style: {
        fontSize: 13,
        fontWeight: "800",
        fillColor: day.walkingStatus === "failed" ? "#9a5a2f" : "#1d6774",
        strokeColor: "#fffdf7",
        strokeWidth: 5,
      },
    },
  });
}

function renderMapObjects() {
  if (!state.map) return;
  clearOverlays(state.overlays.markers);
  clearOverlays(state.overlays.lines);
  if (state.overlays.labelsLayer) {
    state.overlays.labelsLayer.setMap(null);
    state.overlays.labelsLayer = null;
  }

  const labelMarkers = [];
  for (const day of activeDays()) {
    const path = day.walkingStatus === "ok" && day.walkingPath?.length ? day.walkingPath : [day.start?.lnglat, day.end?.lnglat].filter(Boolean);
    if (path.length >= 2) {
      const planned = day.walkingStatus === "ok";
      const selected = day.id === state.selectedDayId;
      const line = new state.amap.Polyline({
        path,
        strokeColor: planned ? "#1d7f8c" : "#c99455",
        strokeWeight: selected ? 8 : 5,
        strokeOpacity: planned ? 0.9 : 0.58,
        strokeStyle: planned ? "solid" : "dashed",
        lineJoin: "round",
        lineCap: "round",
        zIndex: selected ? 90 : 60,
      });
      line.on("click", () => {
        selectDay(day.id);
        renderAll();
      });
      state.overlays.lines.push(line);
    }

    const startMarker = makePointMarker(day, "start", `${day.dayIndex}起`);
    const endMarker = makePointMarker(day, "end", `${day.dayIndex}终`);
    if (startMarker) state.overlays.markers.push(startMarker);
    if (endMarker) state.overlays.markers.push(endMarker);
    const label = makeDistanceLabel(day);
    if (label) labelMarkers.push(label);
  }

  if (state.overlays.lines.length) state.map.add(state.overlays.lines);
  if (state.overlays.markers.length) state.map.add(state.overlays.markers);
  if (labelMarkers.length) {
    state.overlays.labelsLayer = new state.amap.LabelsLayer({ collision: true, animation: false });
    state.overlays.labelsLayer.add(labelMarkers);
    state.map.add(state.overlays.labelsLayer);
  }

  const fitItems = [...state.overlays.markers, ...state.overlays.lines];
  if (fitItems.length) state.map.setFitView(fitItems, false, [88, 96, 88, 460], 13);
}

function clearDayWalking(day) {
  day.walkingDistanceM = null;
  day.walkingDurationS = null;
  day.walkingStatus = "idle";
  day.walkingPath = [];
}

function setPoint(day, endpoint, point) {
  const previous = day[endpoint]?.lnglat?.join(",");
  const next = point.lnglat ? point.lnglat.map(Number).join(",") : "";
  day[endpoint] = {
    ...normalizePoint(day[endpoint]),
    ...point,
    lnglat: point.lnglat ? point.lnglat.map(Number) : null,
    status: point.lnglat ? "resolved" : "unresolved",
  };
  if (previous !== next) clearDayWalking(day);
  markDirty();
}

function searchPlace(day, endpoint) {
  const point = day[endpoint];
  const keyword = point?.name?.trim();
  if (!keyword) return;
  selectDay(day.id);
  point.status = "searching";
  renderDayList();

  state.placeSearch.search(keyword, (status, result) => {
    const pois = status === "complete" ? result?.poiList?.pois || [] : [];
    point.candidates = pois
      .filter((poi) => poi.location)
      .slice(0, 6)
      .map((poi) => ({
        id: poi.id || "",
        name: poi.name,
        address: poi.address || "",
        adname: poi.adname || "",
        lnglat: [poi.location.lng, poi.location.lat],
        source: "amap_place_search",
        status: "candidate",
      }));
    point.status = point.candidates.length ? "candidate" : "unresolved";
    markDirty();
    renderAll();
  });
}

function calculateDay(day) {
  if (!day.start?.lnglat || !day.end?.lnglat) {
    day.walkingStatus = "missing_point";
    markDirty();
    renderAll();
    return Promise.resolve();
  }

  day.walkingStatus = "calculating";
  renderAll();

  return new Promise((resolve) => {
    state.walking.search(day.start.lnglat, day.end.lnglat, (status, result) => {
      const { route, path } = routePathFromWalkingResult(result);
      if (status === "complete" && route && path.length) {
        day.walkingDistanceM = Number(route.distance || 0);
        day.walkingDurationS = Number(route.time || 0);
        day.walkingStatus = "ok";
        day.walkingPath = path;
      } else {
        day.walkingDistanceM = null;
        day.walkingDurationS = null;
        day.walkingStatus = "failed";
        day.walkingPath = [];
      }
      markDirty();
      renderAll();
      resolve();
    });
  });
}

async function saveRoutebooks() {
  updateSaveState("保存中");
  const now = new Date().toISOString();
  for (const routebook of state.routebooks) routebook.updatedAt = now;
  const response = await fetch(sameOriginUrl("/api/routebooks"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ routebooks: state.routebooks }),
  });
  if (!response.ok) throw new Error(`保存失败：${response.status}`);
  const data = await response.json();
  state.routebooks = data.routebooks.map(normalizeRoutebook);
  state.dirty = false;
  updateSaveState("已保存");
  renderAll();
}

function addRoutebook(routebook) {
  state.routebooks.push(routebook);
  state.activeRoutebookId = routebook.id;
  state.selectedDayId = routebook.days[0]?.id || "";
  state.expandedDayId = state.selectedDayId;
  markDirty();
  renderAll();
}

function reindexDays(routebook) {
  routebook.days.forEach((day, index) => {
    day.dayIndex = index + 1;
    if (!day.title) day.title = `Day${index + 1}`;
  });
}

function handleBookField(event) {
  const field = event.target.dataset.bookField;
  if (!field) return;
  const routebook = activeRoutebook();
  routebook[field] = event.target.value;
  markDirty();
  renderRoutebookSelect();
  renderRoutebookPreview();
}

function handleDayInput(event) {
  const dayId = event.target.dataset.dayId;
  if (!dayId) return;
  const day = findDay(dayId);
  if (!day) return;

  const endpoint = event.target.dataset.endpoint;
  const pointField = event.target.dataset.pointField;
  if (endpoint && pointField) {
    selectDay(day.id);
    day[endpoint][pointField] = event.target.value;
    day[endpoint].candidates = [];
    markDirty();
    renderMetrics();
    renderRoutebookPreview();
    return;
  }

  const field = event.target.dataset.dayField;
  if (!field) return;
  selectDay(day.id);
  const numeric = ["planKm", "ascentM", "descentM", "elevationMinM", "elevationMaxM"].includes(field);
  day[field] = numeric ? asNumber(event.target.value) : event.target.value;
  markDirty();
  renderMetrics();
  renderRoutebookPreview();
}

function handleDayAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const routebook = activeRoutebook();
  const day = findDay(button.dataset.dayId);
  const action = button.dataset.action;

  if (action === "select-day" && day) {
    selectDay(day.id);
    renderAll();
  } else if (action === "toggle-day" && day) {
    state.selectedDayId = day.id;
    state.expandedDayId = state.expandedDayId === day.id ? "" : day.id;
    renderAll();
  } else if (action === "move-day-up" && day) {
    const index = routebook.days.indexOf(day);
    if (index > 0) [routebook.days[index - 1], routebook.days[index]] = [routebook.days[index], routebook.days[index - 1]];
    reindexDays(routebook);
    selectDay(day.id);
    markDirty();
    renderAll();
  } else if (action === "move-day-down" && day) {
    const index = routebook.days.indexOf(day);
    if (index < routebook.days.length - 1) [routebook.days[index + 1], routebook.days[index]] = [routebook.days[index], routebook.days[index + 1]];
    reindexDays(routebook);
    selectDay(day.id);
    markDirty();
    renderAll();
  } else if (action === "delete-day" && day && confirm(`删除 ${day.title || `Day${day.dayIndex}`}？`)) {
    routebook.days = routebook.days.filter((item) => item.id !== day.id);
    reindexDays(routebook);
    state.selectedDayId = routebook.days[0]?.id || "";
    state.expandedDayId = state.selectedDayId;
    markDirty();
    renderAll();
  } else if (action === "calc-day" && day) {
    selectDay(day.id);
    void calculateDay(day);
  } else if (action === "search-place" && day) {
    searchPlace(day, button.dataset.endpoint);
  } else if (action === "pick-map" && day) {
    selectDay(day.id);
    state.pickTarget = { dayId: day.id, endpoint: button.dataset.endpoint };
    updateSaveState(`${button.dataset.endpoint === "start" ? "点选起点" : "点选终点"}`);
  } else if (action === "clear-point" && day) {
    selectDay(day.id);
    setPoint(day, button.dataset.endpoint, emptyPoint(day[button.dataset.endpoint]?.name || ""));
    renderAll();
  } else if (action === "choose-candidate" && day) {
    const endpoint = button.dataset.endpoint;
    const candidate = day[endpoint].candidates[Number(button.dataset.index)];
    if (!candidate) return;
    setPoint(day, endpoint, {
      name: candidate.name,
      lnglat: candidate.lnglat,
      source: candidate.source,
      status: "resolved",
      candidates: [],
    });
    selectDay(day.id);
    renderAll();
  }
}

function handleDayFocus(event) {
  const holder = event.target.closest("[data-day-id]");
  const dayId = holder?.dataset.dayId || event.target.dataset.dayId;
  const day = findDay(dayId);
  if (!day || state.selectedDayId === day.id) return;
  selectDay(day.id);
  for (const item of els.dayList.querySelectorAll(".day-card")) {
    item.classList.toggle("selected", item.dataset.dayId === day.id);
  }
  renderMapObjects();
  renderRoutebookPreview();
}

function handlePreviewClick(event) {
  const button = event.target.closest("button[data-preview-day-id]");
  if (!button) return;
  selectDay(button.dataset.previewDayId);
  renderAll();
}

function handleMapClick(event) {
  if (!state.pickTarget) return;
  const day = findDay(state.pickTarget.dayId);
  if (!day) return;
  const endpoint = state.pickTarget.endpoint;
  const oldName = day[endpoint]?.name || (endpoint === "start" ? "地图起点" : "地图终点");
  setPoint(day, endpoint, {
    name: oldName,
    lnglat: [event.lnglat.getLng(), event.lnglat.getLat()],
    source: "map_click",
    status: "resolved",
    candidates: [],
  });
  selectDay(day.id);
  state.pickTarget = null;
  renderAll();
}

async function boot() {
  const [config, routebookData] = await Promise.all([getJson("/api/config"), getJson("/api/routebooks")]);
  if (!config.ok) {
    showError("缺少高德 JS API 配置", `请设置：${config.missing.join(", ")}`);
    return;
  }

  state.routebooks = (routebookData.routebooks || []).map(normalizeRoutebook);
  if (!state.routebooks.length) state.routebooks = [createRoutebook()];
  state.activeRoutebookId = state.routebooks[0].id;
  state.selectedDayId = state.routebooks[0].days[0]?.id || "";
  state.expandedDayId = state.selectedDayId;
  state.dirty = !routebookData.routebooks?.length;

  state.amap = await loadAmap(config);
  state.map = new state.amap.Map("map", {
    viewMode: "2D",
    mapStyle: "amap://styles/whitesmoke",
    zoom: 8,
    center: [117.54157, 43.25862],
  });
  state.walking = new state.amap.Walking({ hideMarkers: true });
  state.placeSearch = new state.amap.PlaceSearch({ pageSize: 8, pageIndex: 1, citylimit: false });
  state.map.on("click", handleMapClick);

  els.loading.hidden = true;
  updateSaveState();
  renderAll();
}

els.routebookSelect.addEventListener("change", () => {
  state.activeRoutebookId = els.routebookSelect.value;
  state.selectedDayId = activeDays()[0]?.id || "";
  state.expandedDayId = state.selectedDayId;
  renderAll();
});
els.newRoutebook.addEventListener("click", () => addRoutebook(createRoutebook()));
els.duplicateRoutebook.addEventListener("click", () => {
  const routebook = activeRoutebook();
  if (routebook) addRoutebook(createRoutebook(routebook));
});
els.deleteRoutebook.addEventListener("click", () => {
  const routebook = activeRoutebook();
  if (!routebook || !confirm(`删除路书「${routebook.name}」？`)) return;
  state.routebooks = state.routebooks.filter((item) => item.id !== routebook.id);
  if (!state.routebooks.length) state.routebooks = [createRoutebook()];
  state.activeRoutebookId = state.routebooks[0].id;
  state.selectedDayId = state.routebooks[0].days[0]?.id || "";
  state.expandedDayId = state.selectedDayId;
  markDirty();
  renderAll();
});
els.routebookForm.addEventListener("input", handleBookField);
els.dayList.addEventListener("input", handleDayInput);
els.dayList.addEventListener("focusin", handleDayFocus);
els.dayList.addEventListener("click", handleDayAction);
els.detailPanel.addEventListener("click", handlePreviewClick);
els.addDay.addEventListener("click", () => {
  const routebook = activeRoutebook();
  const day = createDay(routebook.days.length + 1);
  routebook.days.push(day);
  state.selectedDayId = day.id;
  state.expandedDayId = day.id;
  markDirty();
  renderAll();
});
els.calculateAll.addEventListener("click", async () => {
  for (const day of activeDays()) await calculateDay(day);
});
els.saveRoutebooks.addEventListener("click", () => {
  saveRoutebooks().catch((error) => {
    updateSaveState("保存失败");
    alert(error.message);
  });
});

boot().catch((error) => {
  showError("地图初始化失败", error.message || String(error));
});
