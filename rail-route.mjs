// Rail geometry comes from OSM ways, never from straight station-to-station lines.
const cache = new Map();
const pending = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

export function validatePoints(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 80 ||
    points.some(p => !Array.isArray(p) || p.length !== 2 ||
      !p.every(Number.isFinite) || p[0] < 45 || p[0] > 49 || p[1] < 5 || p[1] > 12)) {
    throw new Error("Coordonnées du trajet invalides.");
  }
  return points;
}

export function distance(a, b) {
  const radians = Math.PI / 180;
  const x = (b[1] - a[1]) * radians * Math.cos((a[0] + b[0]) * radians / 2);
  const y = (b[0] - a[0]) * radians;
  return 6371000 * Math.hypot(x, y);
}

export function buildGraph(elements) {
  const nodes = new Map();
  for (const way of elements) {
    if (way.type !== "way" || !["rail", "narrow_gauge"].includes(way.tags?.railway) ||
      way.tags?.service ||
      !Array.isArray(way.nodes) || !Array.isArray(way.geometry)) continue;
    way.nodes.forEach((id, index) => {
      const point = way.geometry[index];
      if (point && Number.isFinite(point.lat) && Number.isFinite(point.lon) && !nodes.has(id)) {
        nodes.set(id, { coords: [point.lat, point.lon], edges: new Map() });
      }
    });
    for (let i = 1; i < way.nodes.length; i++) {
      const a = nodes.get(way.nodes[i - 1]), b = nodes.get(way.nodes[i]);
      if (!a || !b) continue;
      const length = distance(a.coords, b.coords);
      a.edges.set(way.nodes[i], length);
      b.edges.set(way.nodes[i - 1], length);
    }
  }
  return nodes;
}

class MinHeap {
  items = [];
  push(value) {
    let i = this.items.length;
    this.items.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].cost <= value.cost) break;
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.items[i] = value;
  }
  pop() {
    const first = this.items[0], last = this.items.pop();
    if (!this.items.length) return first;
    let i = 0;
    while (i * 2 + 1 < this.items.length) {
      let child = i * 2 + 1;
      if (child + 1 < this.items.length && this.items[child + 1].cost < this.items[child].cost) child++;
      if (last.cost <= this.items[child].cost) break;
      this.items[i] = this.items[child];
      i = child;
    }
    this.items[i] = last;
    return first;
  }
}

function nearestNodes(graph, point) {
  return [...graph].map(([id, node]) => ({ id, cost: distance(point, node.coords) }))
    .filter(node => node.cost <= 500)
    .sort((a, b) => a.cost - b.cost).slice(0, 12);
}

function routeLeg(graph, from, to) {
  const starts = nearestNodes(graph, from), ends = nearestNodes(graph, to);
  if (!starts.length || !ends.length) throw new Error("Gare non raccordée au réseau disponible.");
  const targets = new Map(ends.map(node => [node.id, node.cost * 4]));
  const queue = new MinHeap(), costs = new Map(), previous = new Map();
  for (const start of starts) {
    const cost = start.cost * 4;
    costs.set(start.id, cost);
    queue.push({ id: start.id, cost });
  }
  let bestId = null, bestCost = Infinity;
  while (queue.items.length) {
    const current = queue.pop();
    if (current.cost !== costs.get(current.id)) continue;
    if (current.cost >= bestCost) break;
    if (targets.has(current.id) && current.cost + targets.get(current.id) < bestCost) {
      bestId = current.id;
      bestCost = current.cost + targets.get(current.id);
    }
    for (const [id, length] of graph.get(current.id).edges) {
      const cost = current.cost + length;
      if (cost < (costs.get(id) ?? Infinity)) {
        costs.set(id, cost);
        previous.set(id, current.id);
        queue.push({ id, cost });
      }
    }
  }
  if (bestId === null) throw new Error("Voies non reliées dans les données disponibles.");
  const line = [];
  for (let id = bestId; id !== undefined; id = previous.get(id)) line.push(graph.get(id).coords);
  line.reverse();
  if (line.length < 2) throw new Error("Tracé ferroviaire trop court.");
  let length = 0;
  for (let i = 1; i < line.length; i++) length += distance(line[i - 1], line[i]);
  if (length > Math.max(15000, distance(from, to) * 5)) throw new Error("Détour ferroviaire incohérent.");
  return line;
}

export function routeOnGraph(graph, points) {
  // Separate legs avoid inventing a connecting line between parallel station tracks.
  return points.slice(1).map((to, i) => routeLeg(graph, points[i], to));
}

async function loadGraph(points) {
  const latitudes = points.map(p => p[0]), longitudes = points.map(p => p[1]);
  // Round outwards so nearby requests share a cached network.
  const bounds = [
    Math.floor((Math.min(...latitudes) - .06) * 10) / 10,
    Math.floor((Math.min(...longitudes) - .06) * 10) / 10,
    Math.ceil((Math.max(...latitudes) + .06) * 10) / 10,
    Math.ceil((Math.max(...longitudes) + .06) * 10) / 10,
  ];
  if ((bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) > 6) throw new Error("Zone du trajet trop étendue.");
  const key = bounds.join(",");
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.graph;
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 2) throw new Error("Service de tracé occupé. Réessaie dans un instant.");
  const task = (async () => {
    const query = `[out:json][timeout:25][maxsize:33554432];way[railway~"^(rail|narrow_gauge)$"][!service](${key});out geom;`;
    const response = await fetch(process.env.OVERPASS_URL || "https://overpass.private.coffee/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Aletrain/2.0 (+https://aletrain.lupachat.ch)" },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("Données ferroviaires temporairement indisponibles.");
    const data = await response.json();
    if (data.remark || !Array.isArray(data.elements)) throw new Error("Données ferroviaires incomplètes.");
    const graph = buildGraph(data.elements);
    if (!graph.size) throw new Error("Aucune voie disponible pour ce trajet.");
    if (cache.size >= 12) cache.delete(cache.keys().next().value);
    cache.set(key, { graph, expires: Date.now() + CACHE_TTL });
    return graph;
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

export async function getRailRoute(points) {
  validatePoints(points);
  const graph = await loadGraph(points);
  return { lines: routeOnGraph(graph, points), source: "OpenStreetMap", approximate: true };
}
