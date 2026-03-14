import {
  FUEL_TYPES, FUEL_KEYS, formatPrice,
  storageGet, storageSet, escapeHtml
} from "./utils.js";
import { fetchNearbyStations, fetchStationName } from "./api.js";

const fuelSelect = document.getElementById("fuelSelect");
const nearMeBtn = document.getElementById("nearMeBtn");

// --- State ---
let map;
let markers = []; // { marker, stationId, prices, isRef, isNearby }
let userMarker = null;
let nearbyMode = false;

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  const settings = storageGet("settings");
  if (settings && settings.badgeFuelType) {
    fuelSelect.value = settings.badgeFuelType;
  }

  initMap();
  fuelSelect.addEventListener("change", updateMarkerLabels);
  nearMeBtn.addEventListener("click", handleNearMe);
});

function initMap() {
  map = L.map("map", {
    zoomControl: true,
    attributionControl: true
  }).setView([46.6, 2.3], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    maxZoom: 18
  }).addTo(map);

  showTrackedStations();
}

function showTrackedStations() {
  const stationData = storageGet("lastStationData") || {};
  const prices = storageGet("lastPrices") || {};
  const names = storageGet("stationNames") || {};
  const ids = storageGet("stationIds") || [];
  const refId = storageGet("referenceStationId");
  const refIdStr = refId ? String(refId) : null;

  clearMarkers();
  const bounds = [];

  for (const id of ids) {
    const idStr = String(id);
    const station = stationData[idStr];
    if (!station) continue;

    const geom = station.geom;
    if (!geom || geom.lat == null || geom.lon == null) continue;
    const lat = parseFloat(geom.lat);
    const lng = parseFloat(geom.lon);
    if (isNaN(lat) || isNaN(lng)) continue;

    const isRef = idStr === refIdStr;
    const stationPrices = prices[idStr] || {};
    const name = names[idStr];

    addStationMarker(idStr, station, stationPrices, name, isRef, lat, lng, false);
    bounds.push([lat, lng]);
  }

  if (bounds.length > 0) {
    if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    } else {
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  }
}

function addStationMarker(idStr, station, stationPrices, name, isRef, lat, lng, isNearby) {
  const selectedFuel = fuelSelect.value;
  const priceLabel = getPriceLabel(stationPrices, selectedFuel);
  const popupHtml = buildPopup(idStr, station, stationPrices, name, isRef, lat, lng, isNearby);

  const refClass = isRef ? " ref" : "";
  const nearbyClass = isNearby ? " nearby" : "";
  const icon = L.divIcon({
    className: "price-marker-wrapper",
    html: `<div class="price-marker${refClass}${nearbyClass}" data-station="${idStr}">${priceLabel}</div>`,
    iconSize: null,
    iconAnchor: [0, 0]
  });

  const marker = L.marker([lat, lng], { icon }).addTo(map);
  marker.bindPopup(popupHtml, { maxWidth: 280, className: "station-popup" });

  markers.push({ marker, stationId: idStr, prices: stationPrices, isRef, isNearby });
}

// --- Near me ---
async function handleNearMe() {
  nearMeBtn.disabled = true;
  nearMeBtn.textContent = "\u23F3";

  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000
      });
    });

    const { latitude, longitude } = pos.coords;

    // Show user position
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.circleMarker([latitude, longitude], {
      radius: 10,
      fillColor: "#4285f4",
      fillOpacity: 1,
      color: "#fff",
      weight: 3
    }).addTo(map).bindPopup("Vous \u00eates ici");

    // Fetch nearby stations
    const stations = await fetchNearbyStations(latitude, longitude, 10);

    if (stations.length === 0) {
      alert("Aucune station trouvee dans un rayon de 10 km.");
      return;
    }

    // Merge with tracked stations
    clearMarkers();

    const trackedIds = new Set((storageGet("stationIds") || []).map(String));
    const names = storageGet("stationNames") || {};
    const refId = storageGet("referenceStationId");
    const refIdStr = refId ? String(refId) : null;
    const bounds = [[latitude, longitude]];

    for (const station of stations) {
      const idStr = String(station.id);
      const geom = station.geom;
      if (!geom || geom.lat == null || geom.lon == null) continue;
      const lat = parseFloat(geom.lat);
      const lng = parseFloat(geom.lon);
      if (isNaN(lat) || isNaN(lng)) continue;

      const stationPrices = {};
      for (const key of FUEL_KEYS) {
        const prixKey = `${key}_prix`;
        const majKey = `${key}_maj`;
        if (station[prixKey] != null) {
          stationPrices[prixKey] = station[prixKey];
          stationPrices[majKey] = station[majKey];
        }
      }

      const isRef = idStr === refIdStr;
      const isTracked = trackedIds.has(idStr);
      const name = names[idStr] || null;

      addStationMarker(idStr, station, stationPrices, name, isRef, lat, lng, !isTracked);
      bounds.push([lat, lng]);
    }

    // Highlight cheapest
    highlightCheapest();

    map.fitBounds(bounds, { padding: [30, 30] });
    nearbyMode = true;

  } catch (err) {
    if (err.code === 1) {
      alert("Geolocalisation refusee. Activez la localisation dans les parametres.");
    } else {
      alert("Erreur de geolocalisation : " + err.message);
    }
  } finally {
    nearMeBtn.disabled = false;
    nearMeBtn.textContent = "\uD83D\uDCCD";
  }
}

function highlightCheapest() {
  const selectedFuel = fuelSelect.value;
  const prixKey = `${selectedFuel}_prix`;

  let cheapestId = null;
  let cheapestPrice = Infinity;

  for (const { stationId, prices } of markers) {
    const price = prices[prixKey];
    if (price != null && price < cheapestPrice) {
      cheapestPrice = price;
      cheapestId = stationId;
    }
  }

  // Update marker styles
  for (const { stationId } of markers) {
    const el = document.querySelector(`.price-marker[data-station="${stationId}"]`);
    if (el) {
      el.classList.toggle("cheapest", stationId === cheapestId);
    }
  }
}

// --- Helpers ---

function getPriceLabel(stationPrices, fuelKey) {
  const price = stationPrices[`${fuelKey}_prix`];
  if (price == null) return "---";
  return Number(price).toFixed(3);
}

function buildPopup(id, station, stationPrices, name, isRef, lat, lng, isNearby) {
  const refBadge = isRef ? '<span class="popup-ref-badge">REF</span> ' : "";
  const stationName = name || station.adresse || `Station ${id}`;
  const trackedIds = new Set((storageGet("stationIds") || []).map(String));
  const isTracked = trackedIds.has(String(id));

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

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const trackBtn = (isNearby && !isTracked)
    ? `<button class="popup-track-btn" data-track-id="${id}" onclick="window._trackStation('${id}', this)">+ Suivre</button>`
    : "";

  return `
    <div class="popup-content">
      <div class="popup-title">${refBadge}${escapeHtml(stationName)}</div>
      <div class="popup-address">${escapeHtml(station.adresse || "")} - ${escapeHtml(station.cp || "")} ${escapeHtml(station.ville || "")}</div>
      <table class="popup-prices">${fuelsHtml}</table>
      <div class="popup-actions">
        <a href="${mapsUrl}" onclick="window.open(this.href);return false;" class="popup-navigate">Y aller \u2192</a>
        ${trackBtn}
      </div>
    </div>
  `;
}

// --- Track station from map popup ---
window._trackStation = async function(id, btn) {
  btn.disabled = true;
  btn.textContent = "...";
  try {
    const ids = storageGet("stationIds") || [];
    if (!ids.map(String).includes(String(id))) {
      ids.push(Number(id));
      storageSet("stationIds", ids);
    }
    // Fetch station name (best-effort)
    let name = null;
    try { name = await fetchStationName(id); } catch {}
    if (name) {
      const names = storageGet("stationNames") || {};
      names[String(id)] = name;
      storageSet("stationNames", names);
    }
    btn.textContent = "Suivie \u2713";
    btn.classList.add("tracked");
  } catch {
    btn.disabled = false;
    btn.textContent = "+ Suivre";
  }
};

function updateMarkerLabels() {
  const selectedFuel = fuelSelect.value;
  for (const { stationId, prices } of markers) {
    const priceLabel = getPriceLabel(prices, selectedFuel);
    const el = document.querySelector(`.price-marker[data-station="${stationId}"]`);
    if (el) {
      el.textContent = priceLabel;
    }
  }
  if (nearbyMode) highlightCheapest();
}

function clearMarkers() {
  for (const { marker } of markers) map.removeLayer(marker);
  markers = [];
}
