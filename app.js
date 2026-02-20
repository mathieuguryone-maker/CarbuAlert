import { fetchStationsByIds } from "./api.js";
import {
  FUEL_TYPES, FUEL_KEYS, formatPrice, formatDate,
  getPriceChangeDirection, storageGet, storageSet, escapeHtml
} from "./utils.js";

const content = document.getElementById("content");
const lastCheckEl = document.getElementById("lastCheck");
const refreshBtn = document.getElementById("refreshBtn");

// --- Service Worker ---
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// --- Init ---
document.addEventListener("DOMContentLoaded", async () => {
  renderFromCache();
  await fetchAndRender();
});

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

  content.innerHTML = "";
  for (const id of sortedIds) {
    const station = stationData[String(id)];
    const stationPrices = prices[String(id)] || {};
    const oldStationPrices = prevPrices[String(id)] || {};
    const isRef = String(id) === refId;
    content.appendChild(
      buildStationCard(id, station, stationPrices, oldStationPrices, names[String(id)], isRef, refPrices, minPrices)
    );
  }
}

function buildStationCard(id, station, stationPrices, oldStationPrices, name, isRef, refPrices, minPrices) {
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
