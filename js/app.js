/* =========================================
   TravelDogs — app.js
   ========================================= */

"use strict";

const State = {
  trips: [],
  contents: [],
  currentTrip: null,
  currentDayIdx: 0,
  currentItemIdx: 0,
  map: null,
  mapMarkers: [],
  routeLayer: null,
  mapRenderId: 0,

  // UI tracking
  mobilePanelExpanded: false,
  countdownTimers: [],
  weatherData: null,
  expenseInfo: { balance: null, totalSpent: null, isLoading: false },

  // Worker tracking
  routingWorker: null,
  isRoutingReady: false,
  routeCallbacks: new Map(), // Stores promises waiting for routes
  routeRequestId: 0,
};

// ─── MASSIVE DATA STORAGE (INDEXEDDB) ────────────────
const DB_NAME = "TravelDogsDB";
function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore("cache");
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}
async function saveToDB(key, data) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cache", "readwrite");
    tx.objectStore("cache").put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function loadFromDB(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cache", "readonly");
    const req = tx.objectStore("cache").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(tx.error);
  });
}
const setWindowHeight = () => {
  const doc = document.documentElement;
  doc.style.setProperty("--window-height", `${window.innerHeight}px`);
};
window.addEventListener("resize", setWindowHeight);
setWindowHeight();

document.addEventListener("DOMContentLoaded", () => {
  const panel = document.getElementById("info-panel");
  if (!panel) return;

  let startY = 0,
    currentY = 0;
  let isDragging = false,
    wasDragged = false;
  let panelHeight = 0;
  let startScrollTop = 0;
  let scrollTarget = null;

  // Listen on the entire panel, not just the handle
  panel.addEventListener(
    "touchstart",
    (e) => {
      if (window.innerWidth > 768) return;

      // 🛑 NEW: Ignore touch if it's inside the dropdown menu
      if (e.target.closest(".tl-dropdown")) return;

      startY = e.touches[0].clientY;
      currentY = startY;
      isDragging = false;
      wasDragged = false;
      panelHeight = panel.offsetHeight;

      // Find the element that actually scrolls (the active tab-pane or the panel itself)
      scrollTarget = e.target.closest(".tab-pane") || panel;
      startScrollTop = scrollTarget.scrollTop;

      panel.style.transition = "none";
    },
    { passive: true },
  );

  panel.addEventListener(
    "touchmove",
    (e) => {
      if (window.innerWidth > 768) return;

      // 🛑 NEW: Ignore touch if it's inside the dropdown menu
      if (e.target.closest(".tl-dropdown")) return;

      currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;

      // 3 conditions where we want to drag the panel instead of scrolling text:
      // 1. User is touching the pull-handle directly.
      // 2. The panel is collapsed and the user is dragging UP.
      // 3. The panel is expanded, the user is dragging DOWN, and the content is scrolled to the very top.
      const isHandle = e.target.closest("#pull-handle");
      const draggingUpWhenCollapsed = !State.mobilePanelExpanded && deltaY < 0;
      const draggingDownAtTop =
        State.mobilePanelExpanded && deltaY > 0 && startScrollTop <= 0;

      if (isHandle || draggingUpWhenCollapsed || draggingDownAtTop) {
        isDragging = true;
        if (Math.abs(deltaY) > 10) wasDragged = true;

        // Prevent the browser's native scroll/pull-to-refresh behavior while dragging the panel
        if (e.cancelable) e.preventDefault();

        const baseTranslate = State.mobilePanelExpanded ? 0 : panelHeight - 78;
        let newTranslate = baseTranslate + deltaY;

        if (newTranslate < 0) newTranslate = 0;
        if (newTranslate > panelHeight - 78) newTranslate = panelHeight - 78;

        panel.style.transform = `translateY(${newTranslate}px)`;
      }
    },
    { passive: false }, // Must be false to allow e.preventDefault()
  );

  panel.addEventListener("touchend", (e) => {
    if (window.innerWidth > 768) return;

    // 🛑 NEW: Ignore touch if it's inside the dropdown menu
    if (e.target.closest(".tl-dropdown")) return;

    panel.style.transition = "transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)";
    panel.style.transform = "";

    if (isDragging && wasDragged) {
      const deltaY = currentY - startY;
      if (deltaY < -40 && !State.mobilePanelExpanded) {
        window.toggleMobilePanel();
      } else if (deltaY > 40 && State.mobilePanelExpanded) {
        window.toggleMobilePanel();
      }
    }

    isDragging = false;
  });
});
// ─── MOBILE PANEL TOGGLE ─────────────────────────
window.toggleMobilePanel = function () {
  if (window.innerWidth > 768) return;
  State.mobilePanelExpanded = !State.mobilePanelExpanded;
  document
    .getElementById("info-panel")
    .classList.toggle("expanded", State.mobilePanelExpanded);

  // Close the dropdown if the panel moves so it doesn't float weirdly
  closeDropdown();

  setTimeout(() => State.map?.invalidateSize(), 340);
};
// ─── START BACKGROUND WORKER ─────────────────────────
function loadRoadsData() {
  if (State.routingWorker) return; // Already started

  // Adjust path if your app.js is in a /js/ folder (e.g., './routingWorker.js' or '../js/routingWorker.js')
  State.routingWorker = new Worker("./js/routingWorker.js");

  // Listen for answers from the worker
  State.routingWorker.onmessage = (e) => {
    const { type, id, route } = e.data;

    if (type === "INIT_SUCCESS") {
      console.log(
        "✅ Background Routing Engine Ready! (Zero Main Thread Block)",
      );
      State.isRoutingReady = true;

      // If user is looking at a map, trigger a redraw
      if (document.getElementById("detail-page").classList.contains("active")) {
        const item =
          State.currentTrip.days[State.currentDayIdx].items[
            State.currentItemIdx
          ];
        renderDetailMap(item);
      }
    }

    if (type === "ROUTE_RESULT") {
      // Find the callback waiting for this specific route and trigger it
      const callback = State.routeCallbacks.get(id);
      if (callback) {
        callback(route);
        State.routeCallbacks.delete(id);
      }
    }
  };

  // Tell the worker to start downloading & parsing
  // Adjust the URL if your geojson is located elsewhere
  State.routingWorker.postMessage({
    type: "INIT",
    payload: { url: window.location.origin + "/data/dalat-roads.geojson" },
  });
}
// ─── LOAD DATA ────────────────────────────
async function loadData() {
  try {
    // 1. Load ONLY the trips
    const res = await fetch("./data/trips.json");
    if (!res.ok) throw new Error("Failed to load trips.json");
    const json = await res.json();
    State.trips = json.trips;
    State.contents = json.contents || [];

    // ... (keep the State.trips.forEach parsing loop here) ...
    State.trips.forEach((trip) => {
      trip.days.forEach((day) => {
        day.items.forEach((item) => {
          if (item.locations) {
            item.locations.forEach((loc) => {
              if (loc.coords && typeof loc.coords === "string") {
                const [lat, lng] = loc.coords.split(",");
                loc.lat = parseFloat(lat.trim());
                loc.lng = parseFloat(lng.trim());
              }
            });
          }
        });
      });
    });

    fetchExpenseData();
    setTimeout(loadRoadsData, 1500);

    // 2. Handle URL parameters (Deep linking)
    const params = new URLSearchParams(window.location.search);
    const tripId = params.get("trip");
    const dayId = params.get("day");
    const detailId = params.get("detail");

    if (tripId) {
      const trip = State.trips.find((t) => t.id === tripId);
      if (trip) {
        State.currentTrip = trip;
        const dIdx = dayId ? trip.days.findIndex((d) => d.id === dayId) : -1;
        const resolvedDayIdx = dIdx !== -1 ? dIdx : 1;

        if (detailId) {
          const iIdx = trip.days[resolvedDayIdx].items.findIndex(
            (i) => i.id === detailId,
          );
          if (iIdx !== -1) {
            openDetail(resolvedDayIdx, iIdx);
            return; // Now it's safe to return early!
          }
        }
        openTrip(trip, resolvedDayIdx);
        return; // Now it's safe to return early!
      }
    }

    renderHome();
  } catch (err) {
    console.error("Data load error:", err);
    document.body.innerHTML = `<div style="padding:40px;text-align:center;font-family:sans-serif">
      <h2>⚠️ Không tải được dữ liệu</h2>
      <p style="margin-top:12px;color:#666">Hãy chạy app qua server (không mở file:// trực tiếp).<br>
      Dùng: <code>npx serve .</code> hoặc deploy lên GitHub Pages.</p>
    </div>`;
  }
}

// ─── HELPERS ──────────────────────────────
const WMO_ICONS = {
  0: "☀️",
  1: "🌤️",
  2: "⛅",
  3: "☁️",
  45: "🌫️",
  48: "🌫️",
  51: "🌧️",
  53: "🌧️",
  55: "🌧️",
  56: "🌧️",
  57: "🌧️",
  61: "☔",
  63: "☔",
  65: "☔",
  66: "☔",
  67: "☔",
  71: "🌨️",
  73: "🌨️",
  75: "🌨️",
  77: "🌨️",
  80: "🌦️",
  81: "🌦️",
  82: "🌦️",
  85: "🌨️",
  86: "🌨️",
  95: "⛈️",
  96: "⛈️",
  99: "⛈️",
};

function getDayISODate(dateStr, year) {
  if (!dateStr) return null;
  const match = dateStr.match(/([a-zA-Z]+)\s+(\d+)(?:\s*(?:–|—|-)\s*(\d+))?/);
  if (match) {
    const monthStr = match[1];
    const dayNum = match[2]; // always take the first day in case of range M-N
    const d = new Date(`${monthStr} ${dayNum}, ${year}`);
    if (d && !isNaN(d.getTime())) {
      const tzOffset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - tzOffset).toISOString().split("T")[0];
    }
  }
  return null;
}

async function fetchWeatherForTrip(trip) {
  if (State.weatherData && State.weatherData.tripId === trip.id) return;
  State.weatherData = null;

  let lat = null,
    lng = null;

  // Find the trip's main destination by looking for the first hotel,
  // since the very first location in the timeline might be the departure point (e.g. Can Tho).
  for (let day of trip.days) {
    for (let item of day.items) {
      if (
        item.type === "hotel" &&
        item.locations &&
        item.locations.length > 0
      ) {
        lat = item.locations[0].lat;
        lng = item.locations[0].lng;
        break;
      }
    }
    if (lat) break;
  }

  // Fallback if no hotel is found
  if (!lat) {
    for (let day of trip.days) {
      for (let item of day.items) {
        if (item.locations && item.locations.length > 0) {
          lat = item.locations[0].lat;
          lng = item.locations[0].lng;
          break;
        }
      }
      if (lat) break;
    }
  }

  if (!lat) return;

  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,weather_code,precipitation_probability&timezone=Asia%2FBangkok&forecast_days=16`,
    );
    const data = await res.json();
    if (data && data.hourly) {
      const forecast = {};
      data.hourly.time.forEach((t, i) => {
        forecast[t] = {
          temp: Math.round(data.hourly.temperature_2m[i]),
          code: data.hourly.weather_code[i],
          precip: data.hourly.precipitation_probability[i] || 0,
        };
      });
      State.weatherData = { tripId: trip.id, forecast };
      if (
        document.getElementById("timeline-page").classList.contains("active")
      ) {
        renderTimeline();
      }
    }
  } catch (e) {
    console.warn("Could not fetch weather", e);
  }
}

const fmt = {
  cost: (n) => (n != null ? n.toLocaleString("vi-VN") + " đ" : "–"),
};

const TYPE_META = {
  travel: { badge: "badge-travel", label: "🚌 Di chuyển", dot: "" },
  food: { badge: "badge-food", label: "🍜 Ăn uống", dot: "type-food" },
  photo: { badge: "badge-photo", label: "📸 Check-in", dot: "type-photo" },
  hotel: { badge: "badge-hotel", label: "🏨 Khách sạn", dot: "type-hotel" },
  shop: { badge: "badge-shop", label: "🛍️ Mua sắm", dot: "type-shop" },
  coffee: { badge: "badge-coffee", label: "☕ Cà phê", dot: "type-coffee" },
  night: { badge: "badge-night", label: "🌃 Buổi tối", dot: "type-night" },
  sleep: { badge: "badge-sleep", label: "😴 Nghỉ ngơi", dot: "type-sleep" },
};
function typeMeta(type) {
  return TYPE_META[type] || TYPE_META.travel;
}

function calcTripCost(trip) {
  return trip.days
    .flatMap((d) => d.items)
    .reduce((s, i) => s + (i.cost?.total ?? 0), 0);
}

function calcDist(lat1, lng1, lat2, lng2) {
  const R = 6371,
    dLat = ((lat2 - lat1) * Math.PI) / 180,
    dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── COUNTDOWN ────────────────────────────
function startCountdown(dateStr, elId) {
  if (!dateStr) return;
  const target = new Date(dateStr);

  function tick() {
    const el = document.getElementById(elId);
    if (!el) return;
    const diff = target - Date.now();
    if (diff <= 0) {
      el.innerHTML =
        '<div style="text-align:center;font-weight:800;color:var(--bamboo-mid);font-size:1rem">🎉 Đang đi rồi!</div>';
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.innerHTML = ["Days", "Hrs", "Min", "Sec"]
      .map((lbl, i) => {
        const n = [d, h, m, s][i];
        return `<div class="countdown-unit">
          <div class="countdown-num">${String(n).padStart(2, "0")}</div>
          <div class="countdown-label">${lbl}</div>
        </div>`;
      })
      .join("");
  }
  tick();
  const id = setInterval(tick, 1000);
  State.countdownTimers.push(id);
}

function clearCountdowns() {
  State.countdownTimers.forEach(clearInterval);
  State.countdownTimers = [];
}

// ─── NAV HELPERS ──────────────────────────
function showPage(id) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  if (id === "detail-page") setTimeout(() => State.map?.invalidateSize(), 120);
}

function setNavBack(label, show) {
  const el = document.getElementById("nav-back");
  el.textContent = "← " + label;
  el.classList.toggle("show", show);
}

// function setDropdownVisible(v) {
//   document.getElementById("tl-dropdown").style.display = v ? "flex" : "none";
// }

// ─── HOME PAGE ────────────────────────────
function renderHome() {
  window.history.pushState({}, "", window.location.pathname);
  clearCountdowns();
  showPage("home-page");
  setNavBack("", false);
  // setDropdownVisible(false);

  const grid = document.getElementById("projects-grid");
  grid.innerHTML = "";

  State.trips.forEach((trip, i) => {
    const total = calcTripCost(trip);
    const cdId = `cd-${trip.id}`;

    const card = document.createElement("div");
    card.className =
      "project-card fade-up" + (trip.placeholder ? " coming-soon" : "");
    card.style.animationDelay = i * 0.07 + "s";

    card.innerHTML = `
      ${trip.placeholder ? '<div class="coming-soon-badge">Coming Soon</div>' : ""}
      <div class="card-banner">${trip.emoji}</div>
      <div class="card-body">
        <h2>${trip.name}</h2>
        <div class="card-meta">${trip.dates}${trip.persons ? " · " + trip.persons + " người" : ""}</div>
        ${trip.departDate ? `<div class="countdown-box" id="${cdId}"></div>` : ""}
        ${total > 0 ? `<div class="card-cost">💰 ~${fmt.cost(Math.round(trip.budget / (trip.persons || 1)))} / người</div>` : ""}
        <div class="card-status">${trip.placeholder ? "🔒 Chưa lên lịch" : "✅ Đã có lịch"}</div>
      </div>`;

    if (!trip.placeholder) card.onclick = () => openTrip(trip);
    grid.appendChild(card);
    if (trip.departDate)
      setTimeout(() => startCountdown(trip.departDate, cdId), 10);
  });

  // Add-trip placeholder
  const add = document.createElement("div");
  add.className = "add-project-card";
  add.innerHTML =
    '<div class="add-icon">＋</div><div>Thêm chuyến mới</div><div style="font-size:0.75rem;opacity:0.7">Coming soon</div>';
  grid.appendChild(add);
}

// ─── TIMELINE PAGE ────────────────────────
// Replace the openTrip function signature and top lines:
function openTrip(trip, startDayIdx = null) {
  State.currentTrip = trip;
  State.currentDayIdx = startDayIdx !== null ? startDayIdx : 1;
  State.currentItemIdx = 0;

  document.getElementById("tl-trip-name").textContent = trip.name;

  const totalCost = calcTripCost(trip);
  const costStr = totalCost > 0 ? ` · 💸 Tổng: ${fmt.cost(totalCost)}` : "";
  document.getElementById("tl-trip-dates").textContent =
    trip.dates + " · " + trip.persons + " người" + costStr;

  const sheetLink = document.getElementById("tl-sheet-link");
  if (trip.sheetUrl) {
    sheetLink.href = trip.sheetUrl;
    sheetLink.style.display = "inline-block";
  } else {
    sheetLink.style.display = "none";
  }

  showPage("timeline-page");
  setNavBack("Trang chủ", true);

  fetchWeatherForTrip(trip);

  renderDayTabs();
  renderTimeline();

  // Update URL for timeline view
  const url = new URL(window.location);
  url.searchParams.set("trip", trip.id);
  url.searchParams.set("day", trip.days[State.currentDayIdx].id);
  url.searchParams.delete("detail");
  window.history.pushState({}, "", url);
}

function renderDayTabs() {
  const wrap = document.getElementById("day-tabs");
  wrap.innerHTML = "";

  State.currentTrip.days.forEach((day, i) => {
    const btn = document.createElement("div");
    btn.className = "day-tab" + (i === State.currentDayIdx ? " active" : "");
    btn.textContent = day.label;

    // Inside renderDayTabs(), update the btn.onclick block:
    btn.onclick = () => {
      State.currentDayIdx = i;
      renderDayTabs();
      renderTimeline();

      // Push Day change to URL
      const url = new URL(window.location);
      url.searchParams.set("day", State.currentTrip.days[i].id);
      url.searchParams.delete("detail");
      window.history.pushState({}, "", url);
    };
    wrap.appendChild(btn);
  });
}

function renderTimeline() {
  const wrap = document.getElementById("timeline-wrap");
  const day = State.currentTrip.days[State.currentDayIdx];
  wrap.innerHTML = "";

  // Day cost banner
  const dayTotal = day.items.reduce((s, i) => s + (i.cost?.total ?? 0), 0);
  if (dayTotal > 0) {
    const banner = document.createElement("div");
    banner.className = "day-cost-banner fade-up";
    banner.innerHTML = `
      <div><div class="label">Tổng thiệt hại</div><div class="amount">${fmt.cost(dayTotal)}</div></div>
      <div style="text-align:right"><div class="label">Mỗi người</div><div class="amount">${fmt.cost(Math.round(dayTotal / State.currentTrip.persons))}</div></div>`;
    wrap.appendChild(banner);
  }

  const tripYear = State.currentTrip.departDate
    ? new Date(State.currentTrip.departDate).getFullYear()
    : new Date().getFullYear();
  const isoDay = getDayISODate(day.date, tripYear);

  day.items.forEach((item, idx) => {
    const meta = typeMeta(item.type);

    let wHtml = "";
    if (
      State.weatherData &&
      State.weatherData.forecast &&
      isoDay &&
      item.time
    ) {
      let currentIso = isoDay;
      if (item.timeLabel && item.timeLabel.includes("+1")) {
        const d = new Date(isoDay);
        d.setDate(d.getDate() + 1);
        currentIso = d.toISOString().split("T")[0];
      }
      const hourStr = item.time.split(":")[0];
      const timeKey = `${currentIso}T${hourStr}:00`;
      const w = State.weatherData.forecast[timeKey];
      if (w) {
        const icon = WMO_ICONS[w.code] || "☁️";
        let precipHtml = "";
        if (w.precip > 25) {
          precipHtml = `<div style="color:#3498db;margin-top:2px;font-weight:800;">💧${w.precip}%</div>`;
        }
        wHtml = `<div class="tl-weather">${icon} ${w.temp}°C${precipHtml}</div>`;
      }
    }

    const el = document.createElement("div");
    el.className = "tl-item fade-up";
    el.style.animationDelay = idx * 0.04 + "s";
    el.innerHTML = `
      <div class="tl-time">
        <div>${item.timeLabel}</div>
        ${wHtml}
      </div>
      <div class="tl-dot-wrap"><div class="tl-dot ${meta.dot}"></div></div>
      <div class="tl-card">
        <div class="tl-card-top">
          <h3>${item.task}</h3>
          <button class="expense-nav-btn" onclick="event.stopPropagation(); openDetail(State.currentDayIdx, ${idx}, 'expense')">
            💸 Chi tiêu
          </button>
        </div>
        <div class="tl-location">
          📍 ${(item.locations || [])
            .map((l) => {
              const mapHref =
                l.mapUrl ||
                (l.coords ? `https://maps.google.com/?q=${l.coords}` : "");
              if (mapHref) {
                return `<a href="${mapHref}" target="_blank" class="loc-map-link" onclick="event.stopPropagation()">${l.name} <i class="fa-solid fa-map-location-dot"></i></a>`;
              }
              return `<span>${l.name}</span>`;
            })
            .join(' <span style="opacity:0.5; margin:0 4px;">→</span> ')}
        </div>
        ${item.cost ? `<div class="tl-cost">💰 ${fmt.cost(item.cost.total)}${item.cost.perPerson != null ? " · " + fmt.cost(item.cost.perPerson) + "/người" : ""}</div>` : ""}
        ${item.note ? `<div class="tl-note">${item.note}</div>` : ""}
      </div>`;
    el.onclick = () => openDetail(State.currentDayIdx, idx);
    wrap.appendChild(el);
  });
}

// ─── DETAIL PAGE ──────────────────────────
function openDetail(dayIdx, itemIdx, targetTab = "info") {
  State.currentDayIdx = dayIdx;
  State.currentItemIdx = itemIdx;
  showPage("detail-page");
  setNavBack("Timeline", true);
  buildDropdown();

  // 1. Instantly render the map (draws straight lines if roads aren't loaded yet)
  renderDetail(targetTab);

  // 2. Auto-expand the info panel on mobile
  if (window.innerWidth <= 768) {
    State.mobilePanelExpanded = true;
    document.getElementById("info-panel").classList.add("expanded");
    // Invalidate map size after the CSS transition finishes
    setTimeout(() => State.map?.invalidateSize(), 340);
  }

  // 3. Trigger lazy load in the background (will silently re-render snapped roads when done)
  loadRoadsData();

  // 4. Update URL
  const trip = State.currentTrip;
  const day = trip.days[dayIdx];
  const item = day.items[itemIdx];
  const url = new URL(window.location);
  url.searchParams.set("trip", trip.id);
  url.searchParams.set("day", day.id);
  url.searchParams.set("detail", item.id);
  window.history.pushState({}, "", url);
}

function renderDetail(targetTab = "info") {
  const day = State.currentTrip.days[State.currentDayIdx];
  const item = day.items[State.currentItemIdx];

  // Top bar
  document.getElementById("detail-time-text").textContent = item.timeLabel;
  document.getElementById("detail-title-text").textContent = item.task;
  document.getElementById("btn-prev").disabled =
    State.currentDayIdx === 0 && State.currentItemIdx === 0;
  document.getElementById("btn-next").disabled =
    State.currentDayIdx === State.currentTrip.days.length - 1 &&
    State.currentItemIdx === day.items.length - 1;

  // Mobile summary
  // document.getElementById("mobile-summary").textContent =
  //   item.timeLabel + " – " + item.task;

  // Render map (must happen before tabs)
  renderDetailMap(item);

  // Default to info tab
  switchTab(targetTab);
  renderInfoTab(item);
  renderDirectionTab(item);
  renderContentTab(item);
  renderExpenseTab(item);

  // Sync dropdown active state
  document.querySelectorAll(".dropdown-item").forEach((el) => {
    const [di, ii] = el.dataset.pos.split(",").map(Number);
    el.classList.toggle(
      "active",
      di === State.currentDayIdx && ii === State.currentItemIdx,
    );
  });
}

// ─── MAP ──────────────────────────────────
async function renderDetailMap(item) {
  const mapEl = document.getElementById("detail-map");

  const prevLoc = getPrevLocation(State.currentDayIdx, State.currentItemIdx);
  const pathPoints = [];
  if (prevLoc) pathPoints.push(prevLoc);
  if (item.locations) pathPoints.push(...item.locations);

  if (pathPoints.length === 0) return;

  State.mapRenderId++;
  const currentRenderId = State.mapRenderId;

  if (!State.map) {
    State.map = L.map(mapEl, { zoomControl: true }).setView(
      [pathPoints[0].lat, pathPoints[0].lng],
      15,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(State.map);
  }

  State.mapMarkers.forEach((m) => m.remove());
  State.mapMarkers = [];
  if (State.routeLayer) {
    State.routeLayer.remove();
    State.routeLayer = null;
  }

  const makeIcon = (label, color) =>
    L.divIcon({
      html: `<div style="background:${color};color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:800;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)">${label}</div>`,
      className: "",
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  pathPoints.forEach((loc, idx) => {
    const isImplicitStart = prevLoc && idx === 0;
    const color = isImplicitStart
      ? "#7f8c8d"
      : idx === pathPoints.length - 1
        ? "#C0392B"
        : "#3D5229";
    const label = isImplicitStart ? "📍" : letters[prevLoc ? idx - 1 : idx];

    const m = L.marker([loc.lat, loc.lng], { icon: makeIcon(label, color) })
      .addTo(State.map)
      .bindPopup(`<b>${loc.name}</b>`);
    State.mapMarkers.push(m);
  });

  if (pathPoints.length > 1) {
    // 1. INSTANTLY draw dashed straight line placeholder
    let straightPath = [];
    pathPoints.forEach((loc) => straightPath.push([loc.lat, loc.lng]));

    State.routeLayer = L.polyline(straightPath, {
      color: "#3D5229",
      weight: 4,
      opacity: 0.5,
      dashArray: "8, 8",
    }).addTo(State.map);
    State.map.fitBounds(State.routeLayer.getBounds(), { padding: [40, 40] });

    // 2. ASK WORKER for real route (Non-blocking!)
    if (State.isRoutingReady && State.routingWorker) {
      let finalPathLatLangs = [];

      for (let i = 0; i < pathPoints.length - 1; i++) {
        if (currentRenderId !== State.mapRenderId) return; // User moved on

        const startLoc = pathPoints[i];
        const endLoc = pathPoints[i + 1];

        // Create a promise that waits for the worker to respond
        const routePromise = new Promise((resolve) => {
          State.routeRequestId++;
          const reqId = State.routeRequestId;
          State.routeCallbacks.set(reqId, resolve);

          State.routingWorker.postMessage({
            type: "ROUTE",
            id: reqId,
            payload: {
              startLat: startLoc.lat,
              startLng: startLoc.lng,
              endLat: endLoc.lat,
              endLng: endLoc.lng,
            },
          });
        });

        // Wait for worker without freezing UI
        const segmentRoute = await routePromise;

        if (segmentRoute) {
          finalPathLatLangs.push(...segmentRoute);
        } else {
          // Fallback straight line
          finalPathLatLangs.push(
            [startLoc.lat, startLoc.lng],
            [endLoc.lat, endLoc.lng],
          );
        }
      }

      // 3. Replace placeholder with final road route
      if (currentRenderId === State.mapRenderId) {
        if (State.routeLayer) State.routeLayer.remove();
        State.routeLayer = L.polyline(finalPathLatLangs, {
          color: "#3D5229",
          weight: 5,
          opacity: 0.8,
        }).addTo(State.map);
      }
    }
  } else {
    State.map.setView([pathPoints[0].lat, pathPoints[0].lng], 16);
  }

  setTimeout(() => {
    if (currentRenderId === State.mapRenderId && State.map)
      State.map.invalidateSize();
  }, 120);
}

window.zoomToPlace = function (lat, lng) {
  State.map.setView([lat, lng], 17);
  State.mapMarkers.forEach((m) => {
    const ll = m.getLatLng();
    if (Math.abs(ll.lat - lat) < 0.0001 && Math.abs(ll.lng - lng) < 0.0001)
      m.openPopup();
  });
  if (window.innerWidth <= 768) collapseMobilePanel();
};

// ─── INFO TAB ─────────────────────────────
function renderInfoTab(item) {
  const el = document.getElementById("tab-info");
  const meta = typeMeta(item.type);

  // Generate HTML for all locations
  const locationsHtml = (item.locations || [])
    .map(
      (loc, i) => `
    <div class="info-val" style="${i > 0 ? "margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--bamboo-cream);" : ""}">
      <span class="place-link" onclick="zoomToPlace(${loc.lat},${loc.lng})">🔍 ${loc.name}</span>
      ${loc.mapUrl ? `<br><a class="ext-link" href="${loc.mapUrl}" target="_blank">🗺️ Mở Google Maps</a>` : ""}
    </div>
  `,
    )
    .join("");

  el.innerHTML = `
    <div class="info-row">
      <div class="info-label">⏰ Thời gian</div>
      <div class="info-val">${item.timeLabel}</div>
    </div>
    <div class="info-row">
      <div class="info-label">📋 Hoạt động</div>
      <div class="info-val">${item.task}</div>
    </div>

    <div class="info-row">
      <div class="info-label">📍 Địa điểm (${(item.locations || []).length})</div>
      ${locationsHtml}
    </div>

    <div class="info-row">
      <div class="info-label">🚗 Phương tiện</div>
      <div class="info-val">${item.transport || "–"}</div>
    </div>
    ${
      item.cost
        ? `
    <div class="info-row">
      <div class="info-label">💰 Chi phí</div>
      <div class="info-val">
        <span class="cost-chip">${fmt.cost(item.cost.total)} tổng</span>
        ${item.cost.perPerson != null ? `<br><span style="font-size:.8rem;color:var(--text-light);margin-top:4px;display:block">${fmt.cost(item.cost.perPerson)}/người · ${item.cost.note || ""}</span>` : ""}
      </div>
    </div>`
        : ""
    }
    ${
      item.note
        ? `
    <div class="info-row">
      <div class="info-label">📝 Ghi chú</div>
      <div class="note-box">${item.note}</div>
    </div>`
        : ""
    }
    <div class="info-row">
      <div class="info-label">🏷️ Loại</div>
      <div class="info-val"><span class="type-badge ${meta.badge}">${meta.label}</span></div>
    </div>
    ${item.preBook ? `<div style="margin-top:4px;padding:8px 12px;background:#FEF9E7;border-radius:8px;font-size:.8rem;color:#9A7D0A;font-weight:700">⚠️ Cần đặt trước</div>` : ""}
  `;
}

// ─── DIRECTION TAB ────────────────────────
function renderDirectionTab(item) {
  const el = document.getElementById("tab-direction");

  const prevLoc = getPrevLocation(State.currentDayIdx, State.currentItemIdx);
  const pathPoints = [];
  if (prevLoc) pathPoints.push(prevLoc);
  if (item.locations) pathPoints.push(...item.locations);

  if (pathPoints.length <= 1) {
    el.innerHTML = `<div style="text-align:center;padding:40px 16px;color:var(--text-light)">
      <div style="font-size:2.8rem;margin-bottom:12px">📍</div>
      <div style="font-weight:800;margin-bottom:6px">Chỉ có 1 địa điểm</div>
      <div style="font-size:.83rem">Không cần di chuyển hoặc không có dữ liệu chặng đường.</div>
    </div>`;
    return;
  }

  // Calculate total distance
  let totalDist = 0;
  for (let i = 0; i < pathPoints.length - 1; i++) {
    totalDist += calcDist(
      pathPoints[i].lat,
      pathPoints[i].lng,
      pathPoints[i + 1].lat,
      pathPoints[i + 1].lng,
    );
  }
  const distText =
    totalDist < 1
      ? Math.round(totalDist * 1000) + " m"
      : totalDist.toFixed(1) + " km";
  const mins = Math.round((totalDist / 30) * 60);

  let stepsHtml = "";
  pathPoints.forEach((loc, i) => {
    if (i === 0) {
      stepsHtml += `<div class="dir-step"><div class="dir-icon">🔵</div><div><div class="dir-text">Xuất phát tại <b>${loc.name}</b></div><div class="dir-sub">${prevLoc ? "Từ hoạt động trước" : item.timeLabel}</div></div></div>`;
    } else {
      const d = calcDist(
        pathPoints[i - 1].lat,
        pathPoints[i - 1].lng,
        loc.lat,
        loc.lng,
      );
      const dTxt = d < 1 ? Math.round(d * 1000) + " m" : d.toFixed(1) + " km";
      const isLast = i === pathPoints.length - 1;

      stepsHtml += `<div class="dir-step">
        <div class="dir-icon">${isLast ? "🔴" : "↗️"}</div>
        <div><div class="dir-text">${isLast ? "Đến" : "Ghé ngang"} <b>${loc.name}</b></div><div class="dir-sub">Di chuyển ~${dTxt}</div></div>
      </div>`;
    }
  });

  el.innerHTML = `
    <div class="dir-header">
      <div style="margin-bottom:6px">
        <span>📍 ${pathPoints[0].name}</span>
        <span style="opacity:.6;margin:0 6px">→</span>
        <span>🏁 ${pathPoints[pathPoints.length - 1].name}</span>
      </div>
      <div style="display:flex;gap:16px;font-size:.8rem;opacity:.85">
        <span>📏 Tổng ~${distText}</span>
        <span>⏱️ ~${mins} phút</span>
        <span>🏍️ ${item.transport || "Tự túc"}</span>
      </div>
    </div>
    ${stepsHtml}
    <div style="margin-top:14px;padding:10px 13px;background:var(--bamboo-cream);border-radius:var(--radius-sm);font-size:.8rem;color:var(--text-mid)">
      💡 Để có chỉ đường chính xác, nhấn <b>Mở Google Maps</b> trong tab Info.
    </div>`;
}
function buildMediaHtml(url) {
  if (url.includes("tiktok.com")) {
    const match = url.match(/video\/(\d+)/);
    if (match && match[1]) {
      return `
        <div class="content-item" style="border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); margin-bottom: 16px;">
          <iframe src="https://www.tiktok.com/embed/v3/${match[1]}" 
                  style="width: 100%; height: 580px; border: none; background: #000;" 
                  allow="fullscreen"></iframe>
        </div>`;
    }
    return `
      <div class="content-item" style="padding: 12px; background: var(--bamboo-cream); border-radius: 8px; margin-bottom: 16px;">
        <a href="${url}" target="_blank" class="ext-link">🎵 Xem video TikTok</a>
      </div>`;
  } else {
    return `
      <div class="content-item" style="border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); margin-bottom: 16px;">
        <img src="${url}" style="width: 100%; display: block; object-fit: cover;" alt="Trip Content" loading="lazy" />
      </div>`;
  }
}
// ─── CONTENT TAB ─────────────────────────
// ─── CONTENT TAB ─────────────────────────
function renderContentTab(item) {
  const el = document.getElementById("tab-content");

  if (!State.contents || State.contents.length === 0) {
    el.innerHTML = `
      <div class="content-drop" style="text-align:center; padding: 40px 16px;">
        <div class="drop-icon" style="font-size:2.8rem; margin-bottom:12px;">📱</div>
        <div style="font-weight:800; margin-bottom:6px;">Chưa có nội dung</div>
        <p style="font-size:.85rem; color:var(--text-light);">Chưa có hình ảnh hoặc TikTok nào được thêm vào kho dữ liệu.</p>
      </div>`;
    return;
  }

  const mustDoContents = State.contents.filter(
    (c) => c.must_do && c.must_do.includes(item.id),
  );
  const otherContents = State.contents.filter(
    (c) => !c.must_do || !c.must_do.includes(item.id),
  );

  // We will store tasks here to fetch thumbnails AFTER the HTML is rendered
  const oembedTasks = [];

  const buildMediaContent = (c) => {
    if (c.url.includes("tiktok.com")) {
      const match = c.url.match(/video\/(\d+)/);
      if (match && match[1]) {
        const videoId = match[1];
        const facadeId = "tt-" + Math.random().toString(36).substr(2, 9);

        // Push to our fetch queue
        oembedTasks.push({ id: facadeId, url: c.url });

        return `
          <div class="content-item tiktok-container" style="border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); margin-bottom: 16px; background: #111; height: 580px; position: relative;">
            <div id="${facadeId}" class="tiktok-facade" onclick="playTikTok(this, '${videoId}')" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; color: white; background-color: #222; background-size: cover; background-position: center; z-index: 2;">
              
              <div style="width: 60px; height: 60px; background: rgba(254, 44, 85, 0.9); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
                <div style="width: 0; height: 0; border-top: 10px solid transparent; border-bottom: 10px solid transparent; border-left: 16px solid white; margin-left: 5px;"></div>
              </div>
              <div style="font-weight: 800; font-size: 1rem; text-shadow: 0 2px 4px rgba(0,0,0,0.8); letter-spacing: 0.5px;">Nhấn để xem</div>
            
            </div>
          </div>`;
      }
      return `
        <div class="content-item" style="padding: 12px; background: var(--bamboo-cream); border-radius: 8px; margin-bottom: 16px;">
          <a href="${c.url}" target="_blank" class="ext-link">🎵 Xem video TikTok</a>
        </div>`;
    } else {
      return `
        <div class="content-item" style="border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); margin-bottom: 16px;">
          <img src="${c.url}" style="width: 100%; display: block; object-fit: cover;" alt="Trip Content" loading="lazy" />
        </div>`;
    }
  };

  let html = `<div id="content-flex-container" style="display: flex; flex-direction: column; gap: 16px;">`;
  if (mustDoContents.length > 0) {
    html += `<div style="font-weight: 800; color: #C0392B; text-transform: uppercase; font-size: 0.9rem; margin-bottom: -4px;">🔥 Must Do</div>`;
    html += mustDoContents.map(buildMediaContent).join("");
  }
  if (otherContents.length > 0) {
    html += `<div style="font-weight: 800; color: var(--text-dark); text-transform: uppercase; font-size: 0.9rem; margin-top: 8px; margin-bottom: -4px;">✨ Tất cả nội dung</div>`;
    html += otherContents.map(buildMediaContent).join("");
  }
  html += `</div>`;
  el.innerHTML = html;

  // FETCH THUMBNAILS AFTER DOM IS READY
  setTimeout(() => {
    oembedTasks.forEach((task) => {
      fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(task.url)}`)
        .then((res) => res.json())
        .then((data) => {
          const facadeEl = document.getElementById(task.id);
          if (facadeEl && data.thumbnail_url) {
            // Apply image with a dark gradient overlay so the play button stays visible
            facadeEl.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.6)), url('${data.thumbnail_url}')`;
          }
        })
        .catch((err) =>
          console.warn("Could not load thumbnail for", task.url, err),
        );
    });
  }, 50);
}

// Global function to play the video by hiding the thumbnail and injecting the iframe
window.playTikTok = function (facadeEl, videoId) {
  const container = facadeEl.parentElement;
  facadeEl.style.display = "none"; // Hide the thumbnail layer

  let iframe = container.querySelector("iframe");
  if (!iframe) {
    // Create the iframe only once
    iframe = document.createElement("iframe");
    iframe.src = `https://www.tiktok.com/embed/v3/${videoId}`;
    iframe.style.cssText =
      "width: 100%; height: 100%; border: none; z-index: 1;";
    iframe.allow = "fullscreen";
    container.appendChild(iframe);
  } else {
    // If it already exists, just restore it
    iframe.src = `https://www.tiktok.com/embed/v3/${videoId}`;
    iframe.style.display = "block";
  }
};

// Global function to swap the placeholder with the actual video
window.playTikTok = function (facadeEl, videoId) {
  const container = facadeEl.parentElement;
  container.innerHTML = `<iframe src="https://www.tiktok.com/embed/v3/${videoId}" style="width: 100%; height: 100%; border: none;" allow="fullscreen"></iframe>`;
};

// ─── TABS ─────────────────────────────────
// ─── TABS ─────────────────────────────────
window.switchTab = function (name) {
  document.querySelectorAll(".detail-tab").forEach((t, i) => {
    t.classList.toggle(
      "active",
      ["info", "direction", "content", "expense"][i] === name,
    );
  });

  document.querySelectorAll(".tab-pane").forEach((p) => {
    p.classList.remove("active");
  });

  const activeTab = document.getElementById("tab-" + name);
  activeTab.classList.add("active");

  // FIX: Kill background playing TikToks and restore thumbnails when leaving the content tab
  if (name !== "content") {
    const contentTab = document.getElementById("tab-content");
    if (contentTab) {
      contentTab.querySelectorAll(".tiktok-container").forEach((container) => {
        const iframe = container.querySelector("iframe");
        const facade = container.querySelector(".tiktok-facade");

        // Clear the source to instantly kill the video/audio
        if (iframe) {
          iframe.src = "";
          iframe.style.display = "none";
        }
        // Show the thumbnail layer again
        if (facade) {
          facade.style.display = "flex";
        }
      });
    }
  }

  // Reset scroll position right after the tab becomes visible
  activeTab.scrollTop = 0;

  const infoPanel = document.getElementById("info-panel");
  if (infoPanel) {
    infoPanel.scrollTop = 0;
  }
};

// ─── NAVIGATION ───────────────────────────
window.navigateDetail = function (dir) {
  const trip = State.currentTrip;
  let di = State.currentDayIdx,
    ii = State.currentItemIdx + dir;

  if (ii < 0) {
    di--;
    if (di < 0) return;
    ii = trip.days[di].items.length - 1;
  } else if (ii >= trip.days[State.currentDayIdx].items.length) {
    di++;
    if (di >= trip.days.length) return;
    ii = 0;
  }

  State.currentDayIdx = di;
  State.currentItemIdx = ii;
  openDetail(di, ii);
};

// ─── DROPDOWN ─────────────────────────────
function buildDropdown() {
  const menu = document.getElementById("dropdown-menu");
  menu.innerHTML = "";

  State.currentTrip.days.forEach((day, di) => {
    const grp = document.createElement("div");
    grp.className = "dropdown-group-label";
    grp.textContent = day.label;
    menu.appendChild(grp);

    day.items.forEach((item, ii) => {
      const div = document.createElement("div");
      div.className =
        "dropdown-item" +
        (di === State.currentDayIdx && ii === State.currentItemIdx
          ? " active"
          : "");
      div.dataset.pos = `${di},${ii}`;
      div.innerHTML = `<span class="dropdown-item-time">${item.timeLabel}</span><span>${item.task}</span>`;
      div.onclick = () => {
        State.currentDayIdx = di;
        State.currentItemIdx = ii;
        openDetail(di, ii);
        closeDropdown();
      };
      menu.appendChild(div);
    });
  });
}
function getPrevLocation(dayIdx, itemIdx) {
  const trip = State.currentTrip;
  const currentItem = trip.days[dayIdx].items[itemIdx];

  // If explicitly disabled, or it's the very first item of the whole trip
  if (currentItem.fromLocation === false) return null;

  // Search backwards to find the last valid location
  let d = dayIdx;
  let i = itemIdx - 1;

  while (d >= 0) {
    while (i >= 0) {
      const prevItem = trip.days[d].items[i];
      if (prevItem.locations && prevItem.locations.length > 0) {
        // Return the LAST location in the previous item's array
        return prevItem.locations[prevItem.locations.length - 1];
      }
      i--;
    }
    d--;
    if (d >= 0) i = trip.days[d].items.length - 1;
  }
  return null;
}

window.toggleDropdown = function () {
  const menu = document.getElementById("dropdown-menu");

  // Check if we are opening or closing
  const isOpening = !menu.classList.contains("open");
  menu.classList.toggle("open");

  // If we just opened it, scroll manually to avoid layout jumping
  if (isOpening) {
    setTimeout(() => {
      const activeItem = menu.querySelector(".dropdown-item.active");
      if (activeItem) {
        // Mathematically center the item purely inside the dropdown container
        menu.scrollTop =
          activeItem.offsetTop -
          menu.clientHeight / 2 +
          activeItem.clientHeight / 2;
      }
    }, 10);
  }
};

function closeDropdown() {
  document.getElementById("dropdown-menu").classList.remove("open");
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".tl-dropdown")) closeDropdown();
});

// ─── MOBILE PANEL ─────────────────────────
window.toggleMobilePanel = function () {
  if (window.innerWidth > 768) return;
  State.mobilePanelExpanded = !State.mobilePanelExpanded;
  document
    .getElementById("info-panel")
    .classList.toggle("expanded", State.mobilePanelExpanded);
  setTimeout(() => State.map?.invalidateSize(), 340);
};
function collapseMobilePanel() {
  State.mobilePanelExpanded = false;
  document.getElementById("info-panel").classList.remove("expanded");
}

// ─── BACK NAV ─────────────────────────────
window.handleBack = function () {
  const txt = document.getElementById("nav-back").textContent;
  if (txt.includes("Trang chủ")) {
    window.history.pushState({}, "", window.location.pathname);
    renderHome();
  } else if (txt.includes("Timeline")) {
    // Re-call openTrip to correctly reset the UI and URL!
    openTrip(State.currentTrip, State.currentDayIdx);
  }
};

window.goHome = function () {
  renderHome();
};

// ─── BOOT ─────────────────────────────────
// Wait for Leaflet to be available
function waitForLeaflet(cb, retries = 20) {
  if (typeof L !== "undefined") {
    cb();
  } else if (retries > 0) {
    setTimeout(() => waitForLeaflet(cb, retries - 1), 150);
  } else {
    console.error("Leaflet failed to load");
    cb();
  }
}

// ─── EXPENSE TAB ─────────────────────────
const GAS_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbyv1AaL-9FmbPDTEzVk9HFaaM3bgO7DczO6bDoU2oK6A2dkZ0Haecbr5Zy19KRPL5E/exec";

window.fetchExpenseData = function () {
  State.expenseInfo.isLoading = true;
  updateExpenseUI(); // Make icon spin

  fetch(GAS_WEB_APP_URL)
    .then((res) => res.json())
    .then((data) => {
      if (data.status === "success") {
        State.expenseInfo.balance = data.balance || 0;
        State.expenseInfo.totalSpent = data.totalSpent || 0;
      }
    })
    .catch((err) => console.error("Lỗi lấy dữ liệu chi tiêu:", err))
    .finally(() => {
      State.expenseInfo.isLoading = false;
      updateExpenseUI(); // Stop spinning and apply numbers
    });
};

// Global function to update just the numbers in the DOM
function updateExpenseUI() {
  const balEl = document.getElementById("remainingBalance");
  const spentEl = document.getElementById("totalSpent");
  const syncIcon = document.getElementById("syncExpenseBtn");

  if (!balEl || !spentEl) return; // Tab not rendered yet

  if (State.expenseInfo.isLoading) {
    if (syncIcon) syncIcon.classList.add("fa-spin");
  } else {
    if (syncIcon) syncIcon.classList.remove("fa-spin");

    // Only update if we have data, otherwise show "..."
    if (State.expenseInfo.balance !== null) {
      balEl.innerText = fmt.cost(State.expenseInfo.balance);
      balEl.style.color = State.expenseInfo.balance < 0 ? "#c0392b" : "white";
      spentEl.innerText = fmt.cost(State.expenseInfo.totalSpent);
    } else {
      balEl.innerText = "...";
      spentEl.innerText = "...";
    }
  }
}

function renderExpenseTab(item) {
  const el = document.getElementById("tab-expense");

  el.innerHTML = `
    <div style="background: var(--bamboo-darkest); color: white; padding: 16px; border-radius: var(--radius-sm); margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: var(--shadow);">
      <div>
        <div style="font-size: 0.75rem; opacity: 0.8; text-transform: uppercase;">Còn lại</div>
        <div id="remainingBalance" style="font-size: 1.4rem; font-weight: 800; font-family: 'Playfair Display', serif;">...</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 0.75rem; opacity: 0.8; text-transform: uppercase;">
          Đã chi <i class="fas fa-sync-alt" id="syncExpenseBtn" style="cursor:pointer; margin-left: 6px; padding: 4px;" onclick="fetchExpenseData()"></i>
        </div>
        <div id="totalSpent" style="font-size: 1.1rem; font-weight: 700;">...</div>
      </div>
    </div>

    <form id="expenseForm" class="expense-form">
      <div class="form-group">
        <label class="form-label">Event</label>
        <input type="text" id="expEvent" class="form-input" value="${item.task}" required placeholder="Văn bản câu trả lời ngắn" />
      </div>

      <div class="form-group">
        <label class="form-label">Hình thức thanh toán</label>
        <div class="radio-group">
          <label class="radio-label">
            <input type="radio" name="payMethod" value="Tiền mặt" required> Tiền mặt
          </label>
          <label class="radio-label">
            <input type="radio" name="payMethod" value="Chuyển khoản"> Chuyển khoản
          </label>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Số tiền</label>
        <input type="number" id="expAmount" class="form-input" required placeholder="Ví dụ: 50000" />
      </div>

      <div class="form-group">
        <label class="form-label">Minh chứng</label>
        <div class="file-upload-wrap">
          <input type="file" id="expFile" accept="image/*,.pdf" style="font-size: 0.8rem; max-width: 100%;" required />
        </div>
        <div style="font-size: 0.7rem; color: var(--text-light); margin-top: 4px;">Kích thước tệp tối đa 10 MB</div>
      </div>

      <button type="submit" id="expSubmitBtn" class="submit-btn">Gửi</button>
      <div id="expStatus" class="status-msg"></div>
    </form>
  `;

  // Apply the data instantly if we already fetched it on app boot
  updateExpenseUI();

  document
    .getElementById("expenseForm")
    .addEventListener("submit", function (e) {
      e.preventDefault();

      const submitBtn = document.getElementById("expSubmitBtn");
      const statusMsg = document.getElementById("expStatus");
      const fileInput = document.getElementById("expFile");
      const file = fileInput.files[0];

      if (file && file.size > 10 * 1024 * 1024) {
        statusMsg.innerText = "Tệp vượt quá 10MB. Vui lòng chọn tệp nhỏ hơn.";
        statusMsg.style.color = "var(--accent-red)";
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Đang gửi...';
      statusMsg.innerText = "";

      const payload = {
        event: document.getElementById("expEvent").value,
        method: document.querySelector('input[name="payMethod"]:checked').value,
        amount: document.getElementById("expAmount").value,
        fileName: file ? file.name : "",
        mimeType: file ? file.type : "",
        base64: "",
      };

      const reader = new FileReader();
      reader.onload = function (event) {
        payload.base64 = event.target.result.split(",")[1];

        fetch(GAS_WEB_APP_URL, {
          method: "POST",
          body: JSON.stringify(payload),
          headers: { "Content-Type": "text/plain;charset=utf-8" },
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.status === "success") {
              statusMsg.innerText = "🎉 Đã ghi nhận chi tiêu thành công!";
              statusMsg.style.color = "var(--bamboo-mid)";
              document.getElementById("expenseForm").reset();

              // NEW: Fetch new data after successful submission
              fetchExpenseData();
            } else {
              statusMsg.innerText = "❌ Lỗi server: " + data.message;
              statusMsg.style.color = "var(--accent-red)";
            }
          })
          .catch(() => {
            statusMsg.innerText = "❌ Lỗi kết nối mạng.";
            statusMsg.style.color = "var(--accent-red)";
          })
          .finally(() => {
            submitBtn.disabled = false;
            submitBtn.innerText = "Gửi";
          });
      };

      reader.readAsDataURL(file);
    });
}

document.addEventListener("DOMContentLoaded", () => {
  waitForLeaflet(loadData);
});
