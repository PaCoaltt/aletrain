import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { getRailRoute, validatePoints } from "./rail-route.mjs";
import { getActivities } from "./activities.mjs";
import { validActivityLocation } from "./activities-common.js";
import { createVisitCounter } from './visits.mjs';

const root = resolve(".");
const port = Number(process.env.PORT || 4173);
const visits = await createVisitCounter(process.env.VISITS_FILE || join(root, 'visits.json'), { requireExisting: process.env.REQUIRE_VISITS_FILE === '1' });
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const publicFiles = new Set(['index.html', 'styles.css', 'app-loader.js', 'app.js', 'i18n.js', 'locales/fr.js', 'locales/de.js', 'locales/it.js', 'locales/en.js', 'locales/gsw.js', 'visit-counter.js', 'adventure.js', 'activity-ui.js', 'activities-common.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png']);
const staticCache = new Map();
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw Object.assign(new Error('Requête trop volumineuse.'), { status: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleApi(request, response, url) {
  if (url.pathname === '/api/health' && request.method === 'GET') {
    response.setHeader('Cache-Control', 'no-store');
    const storage = visits.status().storage;
    sendJson(response, storage === 'ok' ? 200 : 503, { status: storage === 'ok' ? 'ok' : 'degraded', version, revision: process.env.APP_REVISION || 'development', storage });
    return;
  }
  if (url.pathname === '/api/visits' && ['GET', 'POST'].includes(request.method)) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'POST') {
      if (request.headers['x-aletrain-visit'] !== '1' || request.headers['sec-fetch-site'] === 'cross-site') {
        sendJson(response, 403, { error: 'Origine invalide.' });
        return;
      }
      if (visits.status().storage === 'error') {
        sendJson(response, 503, { visits: visits.count(), ...visits.status() });
        return;
      }
      visits.visit(request.headers.cookie);
      response.setHeader('Set-Cookie', 'aletrain_visit=1; Max-Age=1800; Path=/; HttpOnly; SameSite=Lax');
    }
    sendJson(response, 200, { visits: visits.count(), ...visits.status() });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/activities") {
    const body = await readRequestJson(request);
    if (!validActivityLocation(body.location)) {
      sendJson(response, 400, { error: "Coordonnées d'arrivée invalides." });
      return;
    }
    try {
      sendJson(response, 200, { activities: await getActivities(body.location), source: "OpenStreetMap" });
    } catch (error) {
      console.warn("Activities:", error.message);
      sendJson(response, 503, { error: "Les idées de sortie sont indisponibles pour le moment. Réessaie dans un instant." });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/rail-route") {
    const body = await readRequestJson(request);
    try {
      validatePoints(body.points);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }
    try {
      sendJson(response, 200, await getRailRoute(body.points));
    } catch (error) {
      console.warn("Rail routing:", error.message);
      sendJson(response, 503, { error: "Tracé ferroviaire indisponible pour le moment." });
    }
    return;
  }
  sendJson(response, 404, { error: "API introuvable." });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!['GET', 'HEAD'].includes(request.method) || !publicFiles.has(requestedPath)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const filePath = resolve(join(root, requestedPath));

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    if (!staticCache.has(requestedPath)) staticCache.set(requestedPath, await readFile(filePath));
    const cachedBody = staticCache.get(requestedPath);
    const body = requestedPath === 'index.html'
      ? Buffer.from(cachedBody.toString('utf8')
        .replace('id="visitCount"', `id="visitCount" data-visits="${visits.count()}"`)
        .replace('<!--visits-->Visites : ...', new Intl.NumberFormat('fr-CH').format(visits.count()) + ' visites'))
      : cachedBody;
    response.writeHead(200, {
      "Content-Type": types[extname(filePath)] || "application/octet-stream",
      'Cache-Control': requestedPath === 'index.html' ? 'no-store' : requestedPath.startsWith('vendor/') ? 'public, max-age=86400' : 'no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.status === 413) {
      sendJson(response, 413, { error: error.message });
      return;
    }
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: "JSON invalide." });
      return;
    }

    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Aletrain running at http://127.0.0.1:${port}`);
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(async () => {
      try { await visits.close(); process.exit(0); }
      catch (error) { console.error('Visits:', error.message); process.exit(1); }
    });
    server.closeIdleConnections();
  });
}
