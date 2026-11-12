export function validActivityLocation(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
    point[0] >= 45 && point[0] <= 49 && point[1] >= 5 && point[1] <= 12;
}

export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const lat = (b[0] - a[0]) * rad, lon = (b[1] - a[1]) * rad;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function walkingMinutes(from, to) {
  return distanceMeters(from, to) * 1.35 / 75;
}

export function filterActivities(activities, origin, { category, minutes, budget }) {
  return activities.filter(place =>
    (category === "all" || place.category === category) &&
    (budget !== "free" || place.free === true) && walkingMinutes(origin, place.coords) <= minutes);
}

export function chooseActivity(places, seen, random = Math.random) {
  if (!places.length) return null;
  let remaining = places.filter(place => !seen.has(place.id));
  if (!remaining.length) { seen.clear(); remaining = places; }
  const place = remaining[Math.floor(random() * remaining.length)];
  seen.add(place.id);
  return place;
}
