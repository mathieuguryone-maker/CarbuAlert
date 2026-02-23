import { fetchStationsByIds } from "./api.js";
import {
  FUEL_TYPES, FUEL_KEYS, formatPrice, formatDate,
  getPriceChangeDirection, storageGet, storageSet, escapeHtml,
  appendPriceHistory, roundPrice
} from "./utils.js";

const content = document.getElementById("content");
const lastCheckEl = document.getElementById("lastCheck");
const refreshBtn = document.getElementById("refreshBtn");
const testRegularBtn = document.getElementById("testRegularBtn");
const testRefBtn = document.getElementById("testRefBtn");

// --- Service Worker ---
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// --- Init ---
document.addEventListener("DOMContentLoaded", async () => {
  renderFromCache();
  await fetchAndRender();
});

// --- Test notifications ---
testRegularBtn.addEventListener("click", () => sendTestNotif("regular"));
testRefBtn.addEventListener("click", () => sendTestNotif("alert"));

async function sendTestNotif(type) {
  const topic = storageGet("ntfyTopic");
  if (!topic) {
    alert("Configurez d'abord votre topic ntfy dans les Parametres.");
    return;
  }
  const isAlert = type === "alert";
  try {
    const resp = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        "Title": isAlert ? "CarbuAlert - Moins cher que votre ref !" : "CarbuAlert - Changement de prix",
        "Priority": isAlert ? "5" : "3",
        "Tags": isAlert ? "warning,fuelpump" : "fuelpump"
      },
      body: isAlert
        ? "\u2b07 Gazole: 1.549 < ref 1.589 (Station Test)"
        : "\u2b07 Gazole: 1.589 \u2192 1.549 (Station Test)"
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  } catch (err) {
    alert("Erreur d'envoi : " + err.message);
  }
}

// --- Refresh ---
refreshBtn.addEventListener("click", async () => {
  refreshBtn.classList.add("spinning");
  refreshBtn.disabled = true;
  try {
    await fetchAndRender();
  } finally {
    refreshBtn.classList.remove("spinning");
    refreshBtn.disabled = false;
  }
});

// --- Fetch from API and update storage ---
async function fetchAndRender() {
  const ids = storageGet("stationIds") || [];
  if (ids.length === 0) {
    renderFromCache();
    return;
  }

  try {
    const stations = await fetchStationsByIds(ids);

    const oldPrices = storageGet("lastPrices") || {};
    const newPrices = {};
    const newStationData = {};

    for (const station of stations) {
      const id = String(station.id);
      newStationData[id] = station;

      const stationPrices = {};
      for (const key of FUEL_KEYS) {
        const prixKey = `${key}_prix`;
        const majKey = `${key}_maj`;
        if (station[prixKey] != null) {
          stationPrices[prixKey] = station[prixKey];
          stationPrices[majKey] = station[majKey];
        }
      }
      newPrices[id] = stationPrices;
    }

    storageSet("previousPrices", oldPrices);
    storageSet("lastPrices", newPrices);
    storageSet("lastStationData", newStationData);
    storageSet("lastCheck", Date.now());

    // Append to price history
    const history = storageGet("priceHistory") || {};
    for (const station of stations) {
      const id = String(station.id);
      for (const key of FUEL_KEYS) {
        const price = station[`${key}_prix`];
        const maj = station[`${key}_maj`];
        if (price != null) {
          const cleaned = maj ? String(maj).replace(/[+-]\d{2}:\d{2}$/, "").replace(/Z$/, "") : null;
          const ts = cleaned ? new Date(cleaned).getTime() : Date.now();
          appendPriceHistory(history, id, key, price, ts);
        }
      }
    }
    storageSet("priceHistory", history);

    renderFromCache();
  } catch (err) {
    console.error("Fetch error:", err);
    // Still show cached data
    renderFromCache();
  }
}

// --- Render from localStorage ---
function renderFromCache() {
  const ids = storageGet("stationIds") || [];
  const prices = storageGet("lastPrices") || {};
  const prevPrices = storageGet("previousPrices") || {};
  const stationData = storageGet("lastStationData") || {};
  const names = storageGet("stationNames") || {};
  const referenceStationId = storageGet("referenceStationId");
  const lastCheck = storageGet("lastCheck");

  // Last check
  const span = lastCheckEl.querySelector("span");
  if (lastCheck && span) {
    span.textContent = `Derniere verification : ${formatDate(new Date(lastCheck).toISOString())}`;
  }

  if (ids.length === 0) {
    content.innerHTML = `
      <p class="empty-msg">
        Aucune station suivie.<br>
        <a href="settings.html">Ajouter des stations</a>
      </p>
    `;
    return;
  }

  const refId = referenceStationId ? String(referenceStationId) : null;
  const refPrices = refId ? (prices[refId] || {}) : {};

  // Min prices per fuel
  const minPrices = {};
  if (refId) {
    for (const key of FUEL_KEYS) {
      const prixKey = `${key}_prix`;
      let min = Infinity;
      for (const sp of Object.values(prices)) {
        if (sp[prixKey] != null && sp[prixKey] < min) min = sp[prixKey];
      }
      if (min !== Infinity) minPrices[prixKey] = min;
    }
  }

  // Sort: reference first
  const sortedIds = [...ids].sort((a, b) => {
    if (String(a) === refId) return -1;
    if (String(b) === refId) return 1;
    return 0;
  });

  const history = storageGet("priceHistory") || {};

  content.innerHTML = "";
  for (const id of sortedIds) {
    const station = stationData[String(id)];
    const stationPrices = prices[String(id)] || {};
    const oldStationPrices = prevPrices[String(id)] || {};
    const isRef = String(id) === refId;
    const stationHistory = history[String(id)] || {};
    content.appendChild(
      buildStationCard(id, station, stationPrices, oldStationPrices, names[String(id)], isRef, refPrices, minPrices, stationHistory)
    );
  }
}

function buildStationCard(id, station, stationPrices, oldStationPrices, name, isRef, refPrices, minPrices, stationHistory) {
  const card = document.createElement("div");
  card.className = "station-card" + (isRef ? " station-ref" : "");

  const header = document.createElement("div");
  header.className = "station-header";
  const refBadge = isRef ? '<span class="ref-badge">REF</span> ' : "";
  header.innerHTML = `
    <div class="station-name">${refBadge}${escapeHtml(name || station?.adresse || `Station ${id}`)}</div>
    ${name ? `<div class="station-location">${escapeHtml(station?.adresse || "")}</div>` : ""}
    <div class="station-location">${escapeHtml(station?.cp || "")} ${escapeHtml(station?.ville || "")}</div>
  `;
  card.appendChild(header);

  const table = document.createElement("table");
  table.className = "fuel-table";

  for (const key of FUEL_KEYS) {
    const fuel = FUEL_TYPES[key];
    const prixKey = `${key}_prix`;
    const majKey = `${key}_maj`;
    const price = stationPrices[prixKey];
    const maj = stationPrices[majKey];

    if (price == null && !maj) continue;

    const tr = document.createElement("tr");

    // Label
    const tdLabel = document.createElement("td");
    tdLabel.className = "fuel-label";
    tdLabel.innerHTML = `<span class="fuel-dot" style="background:${fuel.color}"></span>${fuel.label}`;
    tr.appendChild(tdLabel);

    // Price
    const tdPrice = document.createElement("td");
    tdPrice.className = "fuel-price";
    if (price != null) {
      tdPrice.textContent = formatPrice(price);
      const refPrice = refPrices && refPrices[prixKey];
      if (isRef && refPrice != null && minPrices[prixKey] != null && price <= minPrices[prixKey]) {
        tdPrice.classList.add("cheaper");
      } else if (!isRef && refPrice != null && price < refPrice) {
        tdPrice.classList.add("more-expensive");
      }
    } else {
      tdPrice.innerHTML = '<span class="no-price">\u2014</span>';
    }
    tr.appendChild(tdPrice);

    // Arrow
    const tdArrow = document.createElement("td");
    tdArrow.style.width = "24px";
    tdArrow.style.textAlign = "center";
    const oldPrice = oldStationPrices[prixKey];
    if (price != null && oldPrice != null) {
      const dir = getPriceChangeDirection(oldPrice, price);
      if (dir === "up") {
        tdArrow.innerHTML = '<span class="arrow direction-up">\u25B2</span>';
      } else if (dir === "down") {
        tdArrow.innerHTML = '<span class="arrow direction-down">\u25BC</span>';
      } else {
        tdArrow.innerHTML = '<span class="arrow direction-stable">=</span>';
      }
    }
    tr.appendChild(tdArrow);

    // History icon
    const points = (stationHistory && stationHistory[key]) || [];
    if (points.length >= 2) {
      const tdChart = document.createElement("td");
      tdChart.className = "fuel-chart-btn";
      tdChart.innerHTML = "\u{1F4C8}";
      const stationName = name || station?.adresse || `Station ${id}`;
      tdChart.addEventListener("click", () => showHistoryModal(stationName, fuel.label, fuel.color, points));
      tr.appendChild(tdChart);
    } else {
      tr.appendChild(document.createElement("td"));
    }

    // Date
    const tdDate = document.createElement("td");
    tdDate.className = "fuel-date";
    tdDate.textContent = maj ? formatDate(maj) : "";
    tr.appendChild(tdDate);

    table.appendChild(tr);
  }

  card.appendChild(table);
  return card;
}

// --- Sparkline SVG ---
function buildSparkline(points, color, width = 60, height = 20) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const prices = points.map(pt => pt.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 0.001;
  const pad = 2;

  const coords = points.map((pt, i) => {
    const x = points.length === 1 ? width / 2 : (i / (points.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((pt.p - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = document.createElementNS(ns, "polyline");
  polyline.setAttribute("points", coords.join(" "));
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", color);
  polyline.setAttribute("stroke-width", "1.5");
  polyline.setAttribute("stroke-linecap", "round");
  polyline.setAttribute("stroke-linejoin", "round");
  svg.appendChild(polyline);

  // Last point dot
  const last = points[points.length - 1];
  const lastX = (width - pad * 2) + pad;
  const lastY = height - pad - ((last.p - min) / range) * (height - pad * 2);
  const dot = document.createElementNS(ns, "circle");
  dot.setAttribute("cx", lastX.toFixed(1));
  dot.setAttribute("cy", lastY.toFixed(1));
  dot.setAttribute("r", "2");
  dot.setAttribute("fill", color);
  svg.appendChild(dot);

  return svg;
}

// --- History Modal ---
function showHistoryModal(stationName, fuelLabel, fuelColor, points) {
  // Remove existing modal
  const existing = document.querySelector(".history-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.className = "history-modal";

  const prices = points.map(pt => pt.p);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const lastPrice = prices[prices.length - 1];

  const content = document.createElement("div");
  content.className = "history-modal-content";

  // Header
  const header = document.createElement("div");
  header.className = "history-modal-header";
  header.innerHTML = `
    <button class="history-close">&times;</button>
    <div class="history-title">${escapeHtml(stationName)}</div>
    <div class="history-subtitle"><span class="fuel-dot" style="background:${fuelColor}"></span>${escapeHtml(fuelLabel)} &mdash; ${points.length} releves</div>
  `;
  content.appendChild(header);

  // Chart
  const chartW = 340;
  const chartH = 180;
  const chartPadL = 50;
  const chartPadR = 10;
  const chartPadT = 10;
  const chartPadB = 30;
  const plotW = chartW - chartPadL - chartPadR;
  const plotH = chartH - chartPadT - chartPadB;

  const range = maxPrice - minPrice || 0.001;
  const niceMin = Math.floor(minPrice * 1000 - 5) / 1000;
  const niceMax = Math.ceil(maxPrice * 1000 + 5) / 1000;
  const niceRange = niceMax - niceMin || 0.001;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${chartW} ${chartH}`);
  svg.setAttribute("class", "history-chart");

  // Y-axis labels & grid
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const val = niceMin + (niceRange / ySteps) * i;
    const y = chartPadT + plotH - (i / ySteps) * plotH;

    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", chartPadL);
    line.setAttribute("x2", chartW - chartPadR);
    line.setAttribute("y1", y.toFixed(1));
    line.setAttribute("y2", y.toFixed(1));
    line.setAttribute("stroke", "#eee");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);

    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", chartPadL - 5);
    text.setAttribute("y", (y + 4).toFixed(1));
    text.setAttribute("text-anchor", "end");
    text.setAttribute("class", "chart-label");
    text.textContent = val.toFixed(3);
    svg.appendChild(text);
  }

  // X-axis labels (a few date markers)
  const xLabels = Math.min(points.length, 5);
  for (let i = 0; i < xLabels; i++) {
    const idx = Math.round((i / (xLabels - 1)) * (points.length - 1));
    const pt = points[idx];
    const x = chartPadL + (idx / (points.length - 1)) * plotW;
    const d = new Date(pt.t);
    const label = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", x.toFixed(1));
    text.setAttribute("y", (chartH - 5).toFixed(1));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "chart-label");
    text.textContent = label;
    svg.appendChild(text);
  }

  // Line
  const coords = points.map((pt, i) => {
    const x = chartPadL + (i / (points.length - 1)) * plotW;
    const y = chartPadT + plotH - ((pt.p - niceMin) / niceRange) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = document.createElementNS(ns, "polyline");
  polyline.setAttribute("points", coords.join(" "));
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", fuelColor);
  polyline.setAttribute("stroke-width", "2");
  polyline.setAttribute("stroke-linecap", "round");
  polyline.setAttribute("stroke-linejoin", "round");
  svg.appendChild(polyline);

  // Points
  points.forEach((pt, i) => {
    const x = chartPadL + (i / (points.length - 1)) * plotW;
    const y = chartPadT + plotH - ((pt.p - niceMin) / niceRange) * plotH;
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", x.toFixed(1));
    circle.setAttribute("cy", y.toFixed(1));
    circle.setAttribute("r", points.length > 30 ? "2" : "3");
    circle.setAttribute("fill", fuelColor);
    svg.appendChild(circle);
  });

  content.appendChild(svg);

  // Stats
  const stats = document.createElement("div");
  stats.className = "history-stats";
  stats.innerHTML = `
    <div><span class="stat-label">Min</span><br><strong>${formatPrice(minPrice)}</strong></div>
    <div><span class="stat-label">Max</span><br><strong>${formatPrice(maxPrice)}</strong></div>
    <div><span class="stat-label">Actuel</span><br><strong>${formatPrice(lastPrice)}</strong></div>
  `;
  content.appendChild(stats);

  modal.appendChild(content);
  document.body.appendChild(modal);

  // Close handlers
  const closeBtn = content.querySelector(".history-close");
  closeBtn.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
}
