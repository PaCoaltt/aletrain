import { validActivityLocation, distanceMeters } from "./activities-common.js";

export function classifyActivity(tags) {
  if (["park", "garden", "nature_reserve"].includes(tags.leisure) || tags.tourism === "viewpoint") return "walk";
  if (["museum", "gallery", "attraction"].includes(tags.tourism) ||
      ["monument", "castle", "ruins"].includes(tags.historic)) return "discover";
  if (["cafe", "restaurant"].includes(tags.amenity) || tags.shop === "bakery") return "food";
  return null;
}

export function normalizeActivities(elements) {
  const places = [], ids = new Set();
  for (const element of elements) {
    if (!["node", "way", "relation"].includes(element.type) || !Number.isSafeInteger(element.id)) continue;
    const tags = element.tags || {}, name = (tags.name || tags["name:fr"] || "").trim();
    const category = classifyActivity(tags);
    const coords = [element.lat ?? element.center?.lat, element.lon ?? element.center?.lon];
    if (!name || !category || !validActivityLocation(coords) ||
      ["private", "no"].includes(tags.access) || ["private", "no"].includes(tags.foot) ||
      tags.disused === "yes" || tags.abandoned === "yes") continue;
    const id = `${element.type}/${element.id}`;
    if (ids.has(id) || places.some(place => place.name.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr") &&
      distanceMeters(place.coords, coords) < 60)) continue;
    ids.add(id);
    // Free admission to a café does not make a meal or drink free.
    const free = category === "food" ? null : tags.fee === "yes" ? false : tags.fee === "no" || /^0([.,]0+)?(\s*(CHF|EUR))?$/i.test(tags.charge || "") ? true : null;
    places.push({ id, name, coords, category, free });
  }
  return places;
}

export function createActivityService({ fetchImpl = (...args) => fetch(...args), now = Date.now, endpoints = null } = {}) {
  const cache = new Map(), pending = new Map();
  return async function getActivities(location) {
    if (!validActivityLocation(location)) throw new Error("Coordonnées d'arrivée invalides.");
    const key = location.map(value => value.toFixed(4)).join(",");
    const existing = cache.get(key);
    if (existing && existing.expires > now()) return existing.places;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 2) throw new Error("Recherche d'activités occupée.");
    const task = (async () => {
      const around = `(around:1700,${location.join(",")})`;
      const query = `[out:json][timeout:10][maxsize:8388608];(nwr[leisure~"^(park|garden|nature_reserve)$"]${around};nwr[tourism~"^(viewpoint|museum|gallery|attraction)$"]${around};nwr[historic~"^(monument|castle|ruins)$"]${around};nwr[amenity~"^(cafe|restaurant)$"]${around};nwr[shop=bakery]${around};);out center;`;
      const providers = endpoints ?? (process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
        "https://overpass.osm.ch/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
      ]);
      let places, lastError;
      for (const endpoint of providers) {
        try {
          const response = await fetchImpl(endpoint, {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Aletrain/2.0 (+https://aletrain.lupachat.ch)" },
            body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(12000),
          });
          if (!response.ok) throw new Error(`Fournisseur d'activités : HTTP ${response.status}`);
          const data = await response.json();
          if (data.remark || !Array.isArray(data.elements)) throw new Error("Données d'activités incomplètes.");
          places = normalizeActivities(data.elements);
          break;
        } catch (error) {
          lastError = error;
          // A blocked process cannot reach any provider; preserve the actual cause in logs.
          if (error.cause?.code === "EACCES") throw new Error("Accès réseau du serveur refusé (EACCES).", { cause: error });
        }
      }
      if (!places) throw lastError || new Error("Recherche d'activités indisponible.");
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { places, expires: now() + 6 * 60 * 60 * 1000 });
      return places;
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
}

export const getActivities = createActivityService();
