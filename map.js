import {
  FUEL_TYPES, FUEL_KEYS, formatPrice,
  storageGet, escapeHtml
} from "./utils.js";

const fuelSelect = document.getElementById("fuelSelect");

// --- State ---
let map;
let markers = []; // { marker, stationId, prices, isRef }

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  // Restore last fuel selection
  const settings = storageGet("settings");
  if (settings && settings.badgeFuelType) {
    fuelSelect.value = settings.badgeFuelType;
  }

  initMap();
  fuelSelect.addEventListener("change", updateMarkerLabels);
});

function initMap() {
  const stationData = storageGet("lastStationData") || {};
  const prices = storageGet("lastPrices") || {};
  const names = storageGet("stationNames") || {};
  const ids = storageGet("stationIds") || [];
  const refId = storageGet("referenceStationId");
  const refIdStr = refId ? String(refId) : null;

  // Init Leaflet map
  map = L.map("map", {
    zoomControl: true,
    attributionControl: true
  }).setView([46.6, 2.3], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    maxZoom: 18
  }).addTo(map);

  const bounds = [];
  const selectedFuel = fuelSelect.value;

  for (const id of ids) {
    const idStr = String(id);
    const station = stationData[idStr];
    if (!station) continue;

    const lat = parseFloat(station.latitude);
    const lng = parseFloat(station.longitude);
    if (isNaN(lat) || isNaN(lng)) continue;

    const isRef = idStr === refIdStr;
    const stationPrices = prices[idStr] || {};
    const name = names[idStr];

    // Build popup content
    const popupHtml = buildPopup(idStr, station, stationPrices, name, isRef);

    // Build marker
    const priceLabel = getPriceLabel(stationPrices, selectedFuel);
    const icon = L.divIcon({
      className: "price-marker-wrapper",
      html: `<div class="price-marker${isRef ? " ref" : ""}" data-station="${idStr}">${priceLabel}</div>`,
      iconSize: null,
      iconAnchor: [0, 0]
    });

    const marker = L.marker([lat, lng], { icon }).addTo(map);
    marker.bindPopup(popupHtml, { maxWidth: 280, className: "station-popup" });

    markers.push({ marker, stationId: idStr, prices: stationPrices, isRef });
    bounds.push([lat, lng]);
  }

  // Fit bounds
  if (bounds.length > 0) {
    if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    } else {
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  }
}

function getPriceLabel(stationPrices, fuelKey) {
  const price = stationPrices[`${fuelKey}_prix`];
  if (price == null) return "---";
  return Number(price).toFixed(3);
}

function buildPopup(id, station, stationPrices, name, isRef) {
  const refBadge = isRef ? '<span class="popup-ref-badge">REF</span> ' : "";
  const stationName = name || station.adresse || `Station ${id}`;

  let fuelsHtml = "";
  for (const key of FUEL_KEYS) {
    const price = stationPrices[`${key}_prix`];
    if (price == null) continue;
    const fuel = FUEL_TYPES[key];
    fuelsHtml += `
      <tr>
        <td><span class="fuel-dot" style="background:${fuel.color}"></span>${fuel.label}</td>
        <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${formatPrice(price)}</td>
      </tr>`;
  }

  if (!fuelsHtml) {
    fuelsHtml = '<tr><td colspan="2" style="color:#999">Aucun prix disponible</td></tr>';
  }

  return `
    <div class="popup-content">
      <div class="popup-title">${refBadge}${escapeHtml(stationName)}</div>
      <div class="popup-address">${escapeHtml(station.adresse || "")} - ${escapeHtml(station.cp || "")} ${escapeHtml(station.ville || "")}</div>
      <table class="popup-prices">${fuelsHtml}</table>
    </div>
  `;
}

function updateMarkerLabels() {
  const selectedFuel = fuelSelect.value;
  for (const { stationId, prices, isRef } of markers) {
    const priceLabel = getPriceLabel(prices, selectedFuel);
    const el = document.querySelector(`.price-marker[data-station="${stationId}"]`);
    if (el) {
      el.textContent = priceLabel;
    }
  }
}
