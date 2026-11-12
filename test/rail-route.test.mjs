import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, routeOnGraph, validatePoints, getRailRoute } from "../rail-route.mjs";

const a = [46, 6], b = [46.01, 6], c = [46.01, 6.02], d = [46, 6.02];
const way = (ids, points, tags = {}) => ({
  type: "way", nodes: ids, tags: { railway: "rail", ...tags },
  geometry: points.map(([lat, lon]) => ({ lat, lon })),
});

test("follows curved track geometry through intermediate nodes, in both directions", () => {
  const graph = buildGraph([way([1, 2, 3, 4], [a, b, c, d])]);
  assert.deepEqual(routeOnGraph(graph, [a, d]), [[a, b, c, d]]);
  assert.deepEqual(routeOnGraph(graph, [d, a]), [[d, c, b, a]]);
});

test("respects intermediate stops and keeps legs separate", () => {
  const graph = buildGraph([way([1, 2, 3, 4], [a, b, c, d])]);
  assert.deepEqual(routeOnGraph(graph, [a, c, d]), [[a, b, c], [c, d]]);
});

test("ignores sidings and abandoned tracks; supports narrow gauge", () => {
  const graph = buildGraph([
    way([1, 2, 3, 4], [a, b, c, d], { railway: "narrow_gauge" }),
    way([1, 4], [a, d], { service: "siding" }),
    way([1, 4], [a, d], { railway: "abandoned" }),
  ]);
  assert.deepEqual(routeOnGraph(graph, [a, d]), [[a, b, c, d]]);
});

test("does not invent a connection across disconnected tracks", () => {
  const graph = buildGraph([way([1, 2], [a, b]), way([3, 4], [c, d])]);
  assert.throws(() => routeOnGraph(graph, [a, d]), /non reliées/);
});

test("rejects missing, malformed, nonnumeric, distant and excessive waypoints", () => {
  for (const points of [undefined, [], [a], [a, [null, 6]], [a, [46, "6"]], [a, [90, 0]], Array(81).fill(a)]) {
    assert.throws(() => validatePoints(points));
  }
  assert.deepEqual(validatePoints([a, d]), [a, d]);
});

test("shares concurrent network loads and caches the graph for subsequent routes", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.ok(options.body.get("data").includes("out geom"));
    return { ok: true, json: async () => ({ elements: [way([1, 2, 3, 4], [a, b, c, d])] }) };
  };
  try {
    const [first, second] = await Promise.all([getRailRoute([a, d]), getRailRoute([a, d])]);
    assert.deepEqual(first.lines, [[a, b, c, d]]);
    assert.deepEqual(second, first);
    await getRailRoute([d, a]);
    assert.equal(calls, 1);
    assert.equal(first.source, "OpenStreetMap");
    assert.equal(first.approximate, true);
  } finally { globalThis.fetch = originalFetch; }
});
