/* =========================================
   TravelDogs — app.js
   ========================================= */

"use strict";

// ─── STATE ───────────────────────────────
const State = {
  trips: [],
  currentTrip: null,
  currentDayIdx: 0,
  currentItemIdx: 0,
  map: null,
  mapMarkers: [],
  routeLayer: null,
  mobilePanelExpanded: false,
  countdownTimers: [],
};

const setWindowHeight = () => {
  const doc = document.documentElement;
  doc.style.setProperty("--window-height", `${window.innerHeight}px`);
};
window.addEventListener("resize", setWindowHeight);
setWindowHeight();

document.addEventListener("DOMContentLoaded", () => {
  const handle = document.getElementById("pull-handle");
  const panel = document.getElementById("info-panel");
  if (!handle || !panel) return;

  let startY = 0,
    currentY = 0;
  let isDragging = false,
    wasDragged = false;
  let panelHeight = 0;

  handle.addEventListener(
    "touchstart",
    (e) => {
      if (window.innerWidth > 768) return;
      startY = e.touches[0].clientY;
      currentY = startY;
      isDragging = true;
      wasDragged = false; // Reset drag flag
      panelHeight = panel.offsetHeight;
      panel.style.transition = "none";
    },
    { passive: true },
  );

  handle.addEventListener(
    "touchmove",
    (e) => {
      if (!isDragging || window.innerWidth > 768) return;
      currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;

      // If finger moves more than 10px, it's a drag, not a tap
      if (Math.abs(deltaY) > 10) wasDragged = true;

      const baseTranslate = State.mobilePanelExpanded ? 0 : panelHeight - 78;
      let newTranslate = baseTranslate + deltaY;
      if (newTranslate < 0) newTranslate = 0;
      if (newTranslate > panelHeight - 78) newTranslate = panelHeight - 78;
      panel.style.transform = `translateY(${newTranslate}px)`;
    },
    { passive: true },
  );

  handle.addEventListener("touchend", () => {
    if (!isDragging || window.innerWidth > 768) return;
    isDragging = false;

    panel.style.transition = "transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)";
    panel.style.transform = "";

    // Only trigger toggle if it was an actual drag, otherwise let 'onclick' handle it
    if (wasDragged) {
      const deltaY = currentY - startY;
      if (deltaY < -40 && !State.mobilePanelExpanded) {
        window.toggleMobilePanel();
      } else if (deltaY > 40 && State.mobilePanelExpanded) {
        window.toggleMobilePanel();
      }
    }
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
// ─── LOAD DATA ────────────────────────────
async function loadData() {
  try {
    const res = await fetch("./data/trips.json");
    if (!res.ok) throw new Error("Failed to load trips.json");
    const json = await res.json();
    State.trips = json.trips;

    // Replace your URL check inside loadData() with this:
    const params = new URLSearchParams(window.location.search);
    const tripId = params.get("trip");
    const dayId = params.get("day");
    const detailId = params.get("detail");

    if (tripId) {
      const trip = State.trips.find((t) => t.id === tripId);
      if (trip) {
        State.currentTrip = trip;
        const dIdx = dayId ? trip.days.findIndex((d) => d.id === dayId) : -1;
        const resolvedDayIdx = dIdx !== -1 ? dIdx : 1; // Fallback to day 1

        if (detailId) {
          const iIdx = trip.days[resolvedDayIdx].items.findIndex(
            (i) => i.id === detailId,
          );
          if (iIdx !== -1) {
            openDetail(resolvedDayIdx, iIdx);
            return; // Exit early
          }
        }

        // If we only have trip/day, just open the timeline page
        openTrip(trip, resolvedDayIdx);
        return;
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
const fmt = {
  cost: (n) => (n != null ? n.toLocaleString("vi-VN") + " đ" : "–"),
};

const TYPE_META = {
  travel: { badge: "badge-travel", label: "✈️ Di chuyển", dot: "" },
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
        ${total > 0 ? `<div class="card-cost">💰 ~${fmt.cost(Math.round(total / (trip.persons || 1)))} / người</div>` : ""}
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
  document.getElementById("tl-trip-dates").textContent =
    trip.dates + " · " + trip.persons + " người";

  showPage("timeline-page");
  setNavBack("Trang chủ", true);
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
      <div><div class="label">Chi phí ngày này</div><div class="amount">${fmt.cost(dayTotal)}</div></div>
      <div style="text-align:right"><div class="label">Mỗi người</div><div class="amount">${fmt.cost(Math.round(dayTotal / State.currentTrip.persons))}</div></div>`;
    wrap.appendChild(banner);
  }

  day.items.forEach((item, idx) => {
    const meta = typeMeta(item.type);
    const el = document.createElement("div");
    el.className = "tl-item fade-up";
    el.style.animationDelay = idx * 0.04 + "s";
    el.innerHTML = `
      <div class="tl-time">${item.timeLabel}</div>
      <div class="tl-dot-wrap"><div class="tl-dot ${meta.dot}"></div></div>
      <div class="tl-card">
        <div class="tl-card-top">
          <h3>${item.task}</h3>
          <span class="type-badge ${meta.badge}">${meta.label}</span>
        </div>
        <div class="tl-location">📍 ${item.from.name}${item.to ? " → " + item.to.name : ""}</div>
        ${item.cost ? `<div class="tl-cost">💰 ${fmt.cost(item.cost.total)}${item.cost.perPerson != null ? " · " + fmt.cost(item.cost.perPerson) + "/người" : ""}</div>` : ""}
        ${item.note ? `<div class="tl-note">${item.note}</div>` : ""}
      </div>`;
    el.onclick = () => openDetail(State.currentDayIdx, idx);
    wrap.appendChild(el);
  });
}

// ─── DETAIL PAGE ──────────────────────────
function openDetail(dayIdx, itemIdx) {
  State.currentDayIdx = dayIdx;
  State.currentItemIdx = itemIdx;
  showPage("detail-page");
  setNavBack("Timeline", true);
  // setDropdownVisible(true);
  buildDropdown();
  renderDetail();

  const trip = State.currentTrip;
  const day = trip.days[dayIdx];
  const item = day.items[itemIdx];
  const url = new URL(window.location);
  url.searchParams.set("trip", trip.id);
  url.searchParams.set("day", day.id);
  url.searchParams.set("detail", item.id);
  window.history.pushState({}, "", url);
}

function renderDetail() {
  const day = State.currentTrip.days[State.currentDayIdx];
  const item = day.items[State.currentItemIdx];

  // Top bar
  // document.getElementById("detail-title").textContent = item.task;
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
  switchTab("info");
  renderInfoTab(item);
  renderDirectionTab(item);
  renderContentTab(item);

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
function renderDetailMap(item) {
  const mapEl = document.getElementById("detail-map");

  if (!State.map) {
    State.map = L.map(mapEl, { zoomControl: true }).setView(
      [item.from.lat, item.from.lng],
      15,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(State.map);
  }

  // Clear
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

  const mA = L.marker([item.from.lat, item.from.lng], {
    icon: makeIcon("A", "#3D5229"),
  })
    .addTo(State.map)
    .bindPopup(`<b>${item.from.name}</b><br>${item.timeLabel}`);
  State.mapMarkers.push(mA);

  if (item.to) {
    const mB = L.marker([item.to.lat, item.to.lng], {
      icon: makeIcon("B", "#C0392B"),
    })
      .addTo(State.map)
      .bindPopup(`<b>${item.to.name}</b>`);
    State.mapMarkers.push(mB);

    State.routeLayer = L.polyline(
      [
        [item.from.lat, item.from.lng],
        [item.to.lat, item.to.lng],
      ],
      { color: "#3D5229", weight: 4, opacity: 0.7, dashArray: "8,6" },
    ).addTo(State.map);

    State.map.fitBounds(State.routeLayer.getBounds(), { padding: [40, 40] });
  } else {
    State.map.setView([item.from.lat, item.from.lng], 16);
  }

  setTimeout(() => State.map.invalidateSize(), 120);
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
      <div class="info-label">📍 Địa điểm xuất phát</div>
      <div class="info-val">
        <span class="place-link" onclick="zoomToPlace(${item.from.lat},${item.from.lng})">🔍 ${item.from.name}</span>
        ${item.from.mapUrl ? `<br><a class="ext-link" href="${item.from.mapUrl}" target="_blank">🗺️ Mở Google Maps</a>` : ""}
      </div>
    </div>
    ${
      item.to
        ? `
    <div class="info-row">
      <div class="info-label">🏁 Điểm đến</div>
      <div class="info-val">
        <span class="place-link" onclick="zoomToPlace(${item.to.lat},${item.to.lng})">🔍 ${item.to.name}</span>
        ${item.to.mapUrl ? `<br><a class="ext-link" href="${item.to.mapUrl}" target="_blank">🗺️ Mở Google Maps</a>` : ""}
      </div>
    </div>`
        : ""
    }
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

  if (!item.to) {
    el.innerHTML = `<div style="text-align:center;padding:40px 16px;color:var(--text-light)">
      <div style="font-size:2.8rem;margin-bottom:12px">📍</div>
      <div style="font-weight:800;margin-bottom:6px">Chỉ có 1 địa điểm</div>
      <div style="font-size:.83rem">Hoạt động này không có điểm đến riêng biệt.</div>
    </div>`;
    return;
  }

  const dist = calcDist(item.from.lat, item.from.lng, item.to.lat, item.to.lng);
  const distText =
    dist < 1 ? Math.round(dist * 1000) + " m" : dist.toFixed(1) + " km";
  const mins = Math.round((dist / 30) * 60);

  el.innerHTML = `
    <div class="dir-header">
      <div style="margin-bottom:6px">
        <span>📍 ${item.from.name}</span>
        <span style="opacity:.6;margin:0 6px">→</span>
        <span>🏁 ${item.to.name}</span>
      </div>
      <div style="display:flex;gap:16px;font-size:.8rem;opacity:.85">
        <span>📏 ~${distText}</span>
        <span>⏱️ ~${mins} phút</span>
        <span>🚗 ${item.transport}</span>
      </div>
    </div>
    <div class="dir-step">
      <div class="dir-icon">🔵</div>
      <div><div class="dir-text">Xuất phát tại <b>${item.from.name}</b></div><div class="dir-sub">${item.timeLabel}</div></div>
    </div>
    <div class="dir-step">
      <div class="dir-icon">↗️</div>
      <div><div class="dir-text">Di chuyển theo hướng điểm đến (~${distText})</div><div class="dir-sub">Xem đường trên bản đồ bên trái</div></div>
    </div>
    <div class="dir-step">
      <div class="dir-icon">🔴</div>
      <div><div class="dir-text">Đến <b>${item.to.name}</b></div><div class="dir-sub">Điểm đến</div></div>
    </div>
    <div style="margin-top:14px;padding:10px 13px;background:var(--bamboo-cream);border-radius:var(--radius-sm);font-size:.8rem;color:var(--text-mid)">
      💡 Để có chỉ đường chi tiết, nhấn <b>Mở Google Maps</b> trong tab Info.
    </div>`;
}

// ─── CONTENT TAB ─────────────────────────
function renderContentTab(item) {
  const el = document.getElementById("tab-content");
  const hasContent = item.content && item.content.length > 0;

  el.innerHTML = `
    <div class="content-drop">
      <div class="drop-icon">📱</div>
      <div style="font-weight:800;margin-bottom:6px">Thêm nội dung</div>
      <p>Upload ảnh, video TikTok hoặc link cho hoạt động này.</p>
    </div>
    <div class="content-grid">
      <div class="content-thumb" title="Thêm ảnh">📷</div>
      <div class="content-thumb" title="Thêm video">🎬</div>
      <div class="content-thumb" title="Thêm link">🔗</div>
      <div class="content-thumb" title="Ghi chú">📝</div>
    </div>
    <div style="margin-top:14px;font-size:.78rem;color:var(--text-light);text-align:center">Tính năng upload sắp ra mắt 🚀</div>`;
}

// ─── TABS ─────────────────────────────────
window.switchTab = function (name) {
  document.querySelectorAll(".detail-tab").forEach((t, i) => {
    t.classList.toggle("active", ["info", "direction", "content"][i] === name);
  });
  document
    .querySelectorAll(".tab-pane")
    .forEach((p) => p.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
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
  renderDetail();
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
        renderDetail();
        closeDropdown();
      };
      menu.appendChild(div);
    });
  });
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

document.addEventListener("DOMContentLoaded", () => {
  waitForLeaflet(loadData);
});
