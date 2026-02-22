import { searchStations, fetchSingleStation, fetchStationName } from "./api.js";
import {
  FUEL_TYPES, FUEL_KEYS, formatPrice, DEFAULT_SETTINGS,
  storageGet, storageSet, storageRemove, escapeHtml
} from "./utils.js";

// --- DOM elements ---
const searchType = document.getElementById("searchType");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const searchResults = document.getElementById("searchResults");

const stationIdInput = document.getElementById("stationIdInput");
const addByIdBtn = document.getElementById("addByIdBtn");
const addByIdStatus = document.getElementById("addByIdStatus");

const trackedStations = document.getElementById("trackedStations");

const badgeFuel = document.getElementById("badgeFuel");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const settingsStatus = document.getElementById("settingsStatus");

const ntfyTopicInput = document.getElementById("ntfyTopic");
const saveNtfyBtn = document.getElementById("saveNtfyBtn");
const ntfyStatus = document.getElementById("ntfyStatus");
const testNtfyStatus = document.getElementById("testNtfyStatus");

// --- State ---
let debounceTimer = null;

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  renderTrackedStations();
  autoFetchMissingNames();
});

// --- Search ---
searchBtn.addEventListener("click", performSearch);
searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(performSearch, 300);
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") performSearch();
});

async function performSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    searchResults.innerHTML = "";
    return;
  }

  searchResults.innerHTML = '<span class="spinner"></span> Recherche en cours...';
  try {
    const stations = await searchStations(query, searchType.value);
    if (stations.length === 0) {
      searchResults.innerHTML = '<p style="color:#999;font-size:13px;">Aucun resultat</p>';
      return;
    }

    const tracked = new Set((storageGet("stationIds") || []).map(String));

    searchResults.innerHTML = "";
    for (const station of stations) {
      const id = String(station.id);
      const alreadyTracked = tracked.has(id);

      const item = document.createElement("div");
      item.className = "result-item";

      const fuels = FUEL_KEYS
        .filter(k => station[`${k}_prix`] != null)
        .map(k => `${FUEL_TYPES[k].label}: ${formatPrice(station[`${k}_prix`])}`)
        .join(" \u00B7 ");

      const nameSpan = document.createElement("span");
      nameSpan.className = "station-name-label";

      item.innerHTML = `
        <div class="station-info">
          <div class="station-name">${escapeHtml(station.adresse || "\u2014")}</div>
          <div class="station-detail">${escapeHtml(station.cp || "")} ${escapeHtml(station.ville || "")} \u00B7 ID: ${id}</div>
          <div class="station-detail">${fuels || "Aucun prix disponible"}</div>
        </div>
      `;

      // Insert name label before address (best-effort, loaded async)
      const infoDiv = item.querySelector(".station-info");
      infoDiv.prepend(nameSpan);

      const btn = document.createElement("button");
      btn.className = "add-btn";
      btn.textContent = alreadyTracked ? "Ajoutee" : "Ajouter";
      btn.disabled = alreadyTracked;
      btn.addEventListener("click", () => addStation(id, btn, nameSpan.textContent || null));
      item.appendChild(btn);

      searchResults.appendChild(item);

      // Best-effort: fetch station name in background
      fetchStationName(id).then(name => {
        if (name) {
          nameSpan.textContent = name;
          nameSpan.className = "station-name";
        }
      }).catch(() => {});
    }
  } catch (err) {
    searchResults.innerHTML = `<p class="status-msg error">Erreur : ${escapeHtml(err.message)}</p>`;
  }
}

// --- Add by ID ---
addByIdBtn.addEventListener("click", async () => {
  const id = stationIdInput.value.trim();
  if (!id || isNaN(id)) {
    showStatus(addByIdStatus, "Veuillez entrer un ID numerique valide.", "error");
    return;
  }

  addByIdBtn.disabled = true;
  showStatus(addByIdStatus, '<span class="spinner"></span> Verification...', "");
  try {
    const station = await fetchSingleStation(id);
    if (!station) {
      showStatus(addByIdStatus, "Station introuvable.", "error");
      return;
    }
    // Try to fetch station name (best-effort)
    let name = null;
    try { name = await fetchStationName(id); } catch {}
    addStationId(id, name);
    showStatus(addByIdStatus, `Station ajoutee : ${name || station.adresse || station.ville || id}`, "success");
    stationIdInput.value = "";
    renderTrackedStations();
  } catch (err) {
    showStatus(addByIdStatus, `Erreur : ${err.message}`, "error");
  } finally {
    addByIdBtn.disabled = false;
  }
});

// --- Add / remove stations ---
function addStation(id, btn, name) {
  btn.disabled = true;
  btn.textContent = "Ajoutee";
  addStationId(id, name);
  renderTrackedStations();
}

function addStationId(id, name) {
  const ids = storageGet("stationIds") || [];
  if (!ids.map(String).includes(String(id))) {
    ids.push(Number(id));
    storageSet("stationIds", ids);
  }
  if (name) {
    const names = storageGet("stationNames") || {};
    names[String(id)] = name;
    storageSet("stationNames", names);
  }
}

function renameStation(id) {
  const names = storageGet("stationNames") || {};
  const current = names[String(id)] || "";
  const newName = prompt("Nom de la station :", current);
  if (newName === null) return; // annulé
  if (newName.trim()) {
    names[String(id)] = newName.trim();
  } else {
    delete names[String(id)];
  }
  storageSet("stationNames", names);
  renderTrackedStations();
}

function setReference(id) {
  if (id) {
    storageSet("referenceStationId", Number(id));
  } else {
    storageRemove("referenceStationId");
  }
  renderTrackedStations();
}

function removeStation(id) {
  const ids = (storageGet("stationIds") || []).filter(i => String(i) !== String(id));
  storageSet("stationIds", ids);

  const names = storageGet("stationNames") || {};
  delete names[String(id)];
  storageSet("stationNames", names);

  renderTrackedStations();
}

function renderTrackedStations() {
  const ids = storageGet("stationIds") || [];
  const data = storageGet("lastStationData") || {};
  const names = storageGet("stationNames") || {};
  const referenceStationId = storageGet("referenceStationId");
  const refId = referenceStationId ? String(referenceStationId) : null;

  if (ids.length === 0) {
    trackedStations.innerHTML = '<p class="empty-msg">Aucune station suivie</p>';
    return;
  }

  trackedStations.innerHTML = "";
  for (const id of ids) {
    const station = data[String(id)];
    const name = names[String(id)];
    const isRef = String(id) === refId;
    const item = document.createElement("div");
    item.className = "tracked-item";
    item.innerHTML = `
      <div class="station-info">
        ${name ? `<div class="station-name">${escapeHtml(name)}</div>` : ""}
        <div class="${name ? "station-detail" : "station-name"}">${escapeHtml(station?.adresse || `Station ${id}`)}</div>
        <div class="station-detail">${escapeHtml(station?.cp || "")} ${escapeHtml(station?.ville || "")} \u00B7 ID: ${id}</div>
      </div>
    `;

    const renameBtn = document.createElement("button");
    renameBtn.className = "ref-btn";
    renameBtn.textContent = "\u270E";
    renameBtn.title = "Renommer";
    renameBtn.addEventListener("click", () => renameStation(id));
    item.appendChild(renameBtn);

    const refBtn = document.createElement("button");
    refBtn.className = "ref-btn" + (isRef ? " active" : "");
    refBtn.textContent = "Ref";
    refBtn.addEventListener("click", () => setReference(isRef ? null : id));
    item.appendChild(refBtn);

    const btn = document.createElement("button");
    btn.className = "danger";
    btn.textContent = "Suppr";
    btn.style.fontSize = "12px";
    btn.style.padding = "6px 10px";
    btn.addEventListener("click", () => removeStation(id));
    item.appendChild(btn);

    trackedStations.appendChild(item);
  }
}

// --- Auto-fetch missing station names (best-effort) ---
async function autoFetchMissingNames() {
  const ids = storageGet("stationIds") || [];
  const names = storageGet("stationNames") || {};
  const missing = ids.filter(id => !names[String(id)]);
  if (missing.length === 0) return;

  let updated = false;
  await Promise.all(missing.map(id =>
    fetchStationName(id).then(name => {
      if (name) {
        names[String(id)] = name;
        updated = true;
      }
    }).catch(() => {})
  ));

  if (updated) {
    storageSet("stationNames", names);
    renderTrackedStations();
  }
}

// --- Settings ---
function loadSettings() {
  const s = storageGet("settings") || DEFAULT_SETTINGS;
  badgeFuel.value = s.badgeFuelType;

  // Load ntfy topic
  const topic = storageGet("ntfyTopic") || "";
  ntfyTopicInput.value = topic;
}

saveSettingsBtn.addEventListener("click", () => {
  const newSettings = {
    badgeFuelType: badgeFuel.value
  };
  storageSet("settings", newSettings);
  showStatus(settingsStatus, "Preferences enregistrees.", "success");
  setTimeout(() => showStatus(settingsStatus, "", ""), 2000);
});

// --- Ntfy ---
saveNtfyBtn.addEventListener("click", () => {
  const topic = ntfyTopicInput.value.trim();
  if (!topic) {
    storageRemove("ntfyTopic");
    showStatus(ntfyStatus, "Topic supprime.", "success");
  } else {
    storageSet("ntfyTopic", topic);
    showStatus(ntfyStatus, "Topic enregistre.", "success");
  }
  setTimeout(() => showStatus(ntfyStatus, "", ""), 2000);
});

// --- Test notifications from settings ---
document.getElementById("testRegularBtn").addEventListener("click", () => sendTestNotif("regular"));
document.getElementById("testRefBtn").addEventListener("click", () => sendTestNotif("alert"));

async function sendTestNotif(type) {
  const topic = storageGet("ntfyTopic");
  if (!topic) {
    showStatus(testNtfyStatus, "Enregistrez d'abord un topic ntfy ci-dessus.", "error");
    return;
  }
  const isAlert = type === "alert";
  showStatus(testNtfyStatus, "Envoi en cours...", "");
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
    showStatus(testNtfyStatus, "Notification envoyee !", "success");
  } catch (err) {
    showStatus(testNtfyStatus, `Erreur : ${err.message}`, "error");
  }
  setTimeout(() => showStatus(testNtfyStatus, "", ""), 3000);
}

// --- Helpers ---
function showStatus(el, msg, cls) {
  el.innerHTML = msg;
  el.className = "status-msg" + (cls ? ` ${cls}` : "");
}
