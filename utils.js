export const FUEL_TYPES = {
  gazole: { label: "Gazole", color: "#FFCC02" },
  sp95: { label: "SP95", color: "#00A651" },
  sp98: { label: "SP98", color: "#0072BC" },
  e10: { label: "E10", color: "#8CC63F" },
  e85: { label: "E85", color: "#F7941D" },
  gplc: { label: "GPLc", color: "#9B59B6" }
};

export const FUEL_KEYS = Object.keys(FUEL_TYPES);

export function formatPrice(price) {
  if (price == null || isNaN(price)) return "\u2014";
  return Number(price).toLocaleString("fr-FR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  }) + " \u20AC";
}

export function formatDate(dateStr) {
  if (!dateStr) return "\u2014";
  // L'API gouv stocke l'heure française avec un offset +00:00 erroné.
  const cleaned = String(dateStr).replace(/[+-]\d{2}:\d{2}$/, "").replace(/Z$/, "");
  const date = new Date(cleaned);
  if (isNaN(date.getTime())) return "\u2014";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function roundPrice(price) {
  return Math.round(price * 1000) / 1000;
}

export function getPriceChangeDirection(oldPrice, newPrice) {
  if (oldPrice == null || newPrice == null) return "stable";
  const old3 = roundPrice(oldPrice);
  const new3 = roundPrice(newPrice);
  if (new3 > old3) return "up";
  if (new3 < old3) return "down";
  return "stable";
}

export const DEFAULT_SETTINGS = {
  badgeFuelType: "gazole"
};

// --- localStorage helpers ---

export function storageGet(key) {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

export function storageSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function storageRemove(key) {
  localStorage.removeItem(key);
}

export function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Price history helpers ---

const HISTORY_MAX_DAYS = 90;

/**
 * Append a price point to the history object (mutates in place).
 * Deduplicates by day (keeps last value per day) and prunes entries older than 90 days.
 */
export function appendPriceHistory(history, stationId, fuelKey, price, timestamp) {
  const id = String(stationId);
  if (!history[id]) history[id] = {};
  if (!history[id][fuelKey]) history[id][fuelKey] = [];

  const points = history[id][fuelKey];
  const ts = typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  if (isNaN(ts)) return;

  // Day key for deduplication (YYYY-MM-DD)
  const dayKey = new Date(ts).toISOString().slice(0, 10);

  // Replace existing point for the same day, or append
  const existingIdx = points.findIndex(pt => new Date(pt.t).toISOString().slice(0, 10) === dayKey);
  if (existingIdx !== -1) {
    points[existingIdx] = { t: ts, p: roundPrice(price) };
  } else {
    points.push({ t: ts, p: roundPrice(price) });
  }

  // Sort by timestamp
  points.sort((a, b) => a.t - b.t);

  // Prune older than 90 days
  const cutoff = Date.now() - HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000;
  history[id][fuelKey] = points.filter(pt => pt.t >= cutoff);
}
