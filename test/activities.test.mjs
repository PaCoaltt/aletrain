import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { normalizeActivities, createActivityService } from "../activities.mjs";
import { validActivityLocation, filterActivities, chooseActivity, walkingMinutes } from "../activities-common.js";

const origin = [46.46, 6.84];
const element = (id, tags = {}, extras = {}) => ({ type: "node", id, lat: 46.461, lon: 6.84, tags: { name: `Lieu ${id}`, leisure: "park", ...tags }, ...extras });
const response = elements => ({ ok: true, json: async () => ({ elements }) });

test("validates arrival coordinates", () => {
  assert.equal(validActivityLocation(origin), true);
  for (const point of [null, [], [46], [46, "6"], [NaN, 6], [90, 6]]) assert.equal(validActivityLocation(point), false);
});

test("classifies named OSM places, centers, access and explicit fees", () => {
  const result = normalizeActivities([
    element(1, { fee: "no" }),
    element(2, { leisure: null, tourism: "museum", fee: "yes", charge: "0" }),
    element(3, { leisure: null, amenity: "cafe" }),
    element(4, { charge: "0 CHF" }),
    element(5, { access: "private" }), element(6, { access: "no" }), element(7, { name: " " }),
    element(8, {}, { lat: null, lon: null }), element(9, { disused: "yes" }),
    element(10, { leisure: null, historic: "castle" }, { type: "way", lat: undefined, lon: undefined, center: { lat: 46.462, lon: 6.84 } }),
  ]);
  assert.deepEqual(result.map(p => p.category), ["walk", "discover", "food", "walk", "discover"]);
  assert.deepEqual(result.map(p => p.free), [true, false, null, true, null]);
  assert.equal(result.at(-1).id, "way/10");
});

test("deduplicates OSM IDs and nearby copies of the same named place", () => {
  assert.equal(normalizeActivities([element(1), element(1), element(2, { name: "Lieu 1" }), element(3, { name: "Lieu 1" }, { lat: 46.47 })]).length, 2);
});

test("free entry to a cafe does not qualify as a free food activity; inaccessible foot access is excluded", () => {
  const places = normalizeActivities([element(1, { leisure: null, amenity: "cafe", fee: "no" }), element(2, { foot: "no" })]);
  assert.equal(places.length, 1);
  assert.equal(places[0].free, null);
  assert.deepEqual(filterActivities(places, origin, { category: "all", minutes: 30, budget: "free" }), []);
});

test("filters exact walking thresholds, categories and known free places", () => {
  const places = normalizeActivities([element(1, { fee: "no" }), element(2), element(3, { leisure: null, amenity: "cafe" })]);
  const threshold = walkingMinutes(origin, places[0].coords);
  const options = { category: "all", minutes: threshold, budget: "any" };
  assert.equal(filterActivities(places, origin, options).length, 3);
  assert.equal(filterActivities(places, origin, { ...options, minutes: threshold - .001 }).length, 0);
  assert.deepEqual(filterActivities(places, origin, { ...options, budget: "free" }).map(p => p.id), ["node/1"]);
  assert.deepEqual(filterActivities(places, origin, { ...options, category: "food" }).map(p => p.id), ["node/3"]);
});

test("draws without repetition until exhaustion and handles an empty selection", () => {
  const places = normalizeActivities([element(1), element(2), element(3)]), seen = new Set();
  assert.deepEqual(Array.from({ length: 3 }, () => chooseActivity(places, seen, () => 0).id), places.map(p => p.id));
  assert.equal(chooseActivity(places, seen, () => 0).id, places[0].id);
  assert.equal(chooseActivity([], seen), null);
});

test("shares concurrent requests, caches empty results and expires after six hours", async () => {
  let calls = 0, time = 0;
  const service = createActivityService({ now: () => time, fetchImpl: async (_url, options) => {
    calls++;
    assert.ok(options.body.get("data").includes("around:1700"));
    return response([]);
  } });
  assert.deepEqual(await Promise.all([service(origin), service(origin)]), [[], []]);
  await service(origin);
  assert.equal(calls, 1);
  time = 6 * 60 * 60 * 1000;
  await service(origin);
  assert.equal(calls, 2);
});

test("does not cache supplier failures or incomplete Overpass data", async () => {
  let calls = 0;
  const service = createActivityService({ endpoints: ["https://example.invalid/overpass"], fetchImpl: async () => {
    calls++;
    if (calls === 1) return { ok: false };
    if (calls === 2) return { ok: true, json: async () => ({ elements: [], remark: "timeout" }) };
    return response([element(1)]);
  } });
  await assert.rejects(service(origin));
  await assert.rejects(service(origin));
  assert.equal((await service(origin)).length, 1);
  assert.equal(calls, 3);
});

test("falls back when the primary supplier fails and caches the successful result", async () => {
  const urls = [];
  const service = createActivityService({ endpoints: ["https://primary.invalid", "https://backup.invalid"], fetchImpl: async url => {
    urls.push(url);
    return url.includes("primary") ? { ok: false, status: 502 } : response([element(1)]);
  } });
  assert.equal((await service(origin)).length, 1);
  await service(origin);
  assert.deepEqual(urls, ["https://primary.invalid", "https://backup.invalid"]);
});

test("falls back after a timeout or invalid JSON without caching the failure", async () => {
  for (const error of [new DOMException("Timed out", "TimeoutError"), new SyntaxError("Invalid JSON")]) {
    let calls = 0;
    const service = createActivityService({ endpoints: ["https://primary.invalid", "https://backup.invalid"], fetchImpl: async () => {
      if (++calls === 1) throw error;
      return response([element(1)]);
    } });
    assert.equal((await service(origin)).length, 1);
    assert.equal(calls, 2);
  }
});

test("a network permission failure is reported accurately without trying another blocked host", async () => {
  let calls = 0;
  const service = createActivityService({ fetchImpl: async () => {
    calls++;
    throw new TypeError("fetch failed", { cause: { code: "EACCES" } });
  } });
  await assert.rejects(service(origin), /EACCES/);
  assert.equal(calls, 1);
});

test("bounds cache size to 100 stations", async () => {
  let calls = 0;
  const service = createActivityService({ fetchImpl: async () => { calls++; return response([]); } });
  for (let i = 0; i <= 100; i++) await service([46 + i * .001, 7]);
  await service([46, 7]);
  assert.equal(calls, 102);
});

test("HTTP endpoint validates input and returns real normalized supplier data", async () => {
  let supplierCalls = 0;
  const supplier = createServer(async (req, res) => {
    for await (const _chunk of req) { /* Consume the request. */ }
    supplierCalls++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ elements: [element(1, { fee: "no" })] }));
  });
  await new Promise(resolve => supplier.listen(0, "127.0.0.1", resolve));
  const reserve = createServer();
  await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const child = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, PORT: String(port), OVERPASS_URL: `http://127.0.0.1:${supplier.address().port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Server startup timeout")), 5000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
      child.stdout.once("data", () => { clearTimeout(timer); resolve(); });
    });
    const request = body => fetch(`http://127.0.0.1:${port}/api/activities`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal((await request({ location: [46, null] })).status, 400);
    const first = await request({ location: origin });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).activities[0].id, "node/1");
    await request({ location: origin });
    assert.equal(supplierCalls, 1);
  } finally {
    const stopped = once(child, "exit");
    child.kill();
    await stopped;
    await new Promise(resolve => supplier.close(resolve));
  }
});
