const BASE_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
const BATCH_SIZE = 20;

async function apiFetch(params) {
  const url = new URL(BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function fetchStationsByIds(ids) {
  if (!ids || ids.length === 0) return [];

  const batches = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    batches.push(ids.slice(i, i + BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map(batch => {
      const idList = batch.join(",");
      return apiFetch({
        where: `id in (${idList})`,
        limit: String(batch.length)
      });
    })
  );

  return results.flatMap(r => r.results || []);
}

export async function searchStations(query, type) {
  if (!query || !query.trim()) return [];

  const where = type === "cp"
    ? `cp="${query.trim()}"`
    : `search(ville,"${query.trim()}")`;

  const data = await apiFetch({ where, limit: "30" });
  return data.results || [];
}

export async function fetchSingleStation(id) {
  const data = await apiFetch({
    where: `id=${id}`,
    limit: "1"
  });
  return (data.results && data.results[0]) || null;
}

/**
 * Fetch station name (enseigne) via CORS proxy.
 */
export async function fetchStationName(id) {
  try {
    const targetUrl = `https://www.prix-carburants.gouv.fr/station/${id}`;
    const response = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`);
    if (!response.ok) return null;
    const html = await response.text();
    const match = html.match(/<p\s+class="fr-h2[^"]*">([^<]+)<\/p>/i);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}
