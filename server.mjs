import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { getRailRoute, validatePoints } from "./rail-route.mjs";
import { getActivities } from "./activities.mjs";
import { validActivityLocation } from "./activities-common.js";
import { createVisitCounter } from './visits.mjs';

const root = resolve(".");
const port = Number(process.env.PORT || 4173);
const databasePath = join(root, "data.json");
const visits = await createVisitCounter(process.env.VISITS_FILE || join(root, 'visits.json'));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    try { await visits.close(); process.exit(0); }
    catch (error) { console.error('Visits:', error.message); process.exit(1); }
  });
}
const publicFiles = new Set(['index.html', 'styles.css', 'app.js', 'adventure.js', 'activity-ui.js', 'activities-common.js',
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

const defaultData = {
  users: [],
  reports: [],
  telegramUpdateOffset: 0,
};

let writeQueue = Promise.resolve();

async function readDatabase() {
  if (!existsSync(databasePath)) return structuredClone(defaultData);

  try {
    const data = JSON.parse(await readFile(databasePath, "utf8"));
    return {
      users: Array.isArray(data.users) ? data.users : [],
      reports: Array.isArray(data.reports) ? data.reports : [],
      telegramUpdateOffset: Number.isFinite(Number(data.telegramUpdateOffset)) ? Number(data.telegramUpdateOffset) : 0,
    };
  } catch {
    return structuredClone(defaultData);
  }
}

async function writeDatabase(data) {
  writeQueue = writeQueue.then(() => writeFile(databasePath, JSON.stringify(data, null, 2)));
  return writeQueue;
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || "").split(":");
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = Buffer.from(hashPassword(password, salt).split(":")[1], "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

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

function cleanExpiredReports(reports) {
  const now = Date.now();
  return reports.filter((report) => new Date(report.expiresAt).getTime() > now);
}

function visibleReports(reports) {
  return reports.filter((report) => report.adminDecision === "approved");
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

async function notifyTelegram(report) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const reason = report.reason ? `\nCause: ${report.reason}` : "";
  const duration = report.durationMinutes ? `\nDuree: ${report.durationMinutes} min` : "\nDuree: 90 min par defaut";
  const text = [
    "Train signale comme supprime",
    `${report.trainTitle} vers ${report.destination}`,
    `Depart: ${report.departureLabel}`,
    `Gare: ${report.stationName}`,
    `Par: ${report.reportedBy}`,
    reason,
    duration,
    "",
    "Repondez a CE message avec OK pour confirmer la suppression, ou NON pour la refuser.",
  ].join("\n");

  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const payload = await telegramResponse.json();
    if (!payload.ok || !payload.result?.message_id) return null;
    return payload.result.message_id;
  } catch (error) {
    console.warn("Telegram notification failed:", error.message);
    return null;
  }
}

function applyAdminDecision(data, text, replyToMessageId) {
  const reportIndex = data.reports.findIndex((report) => report.telegramMessageId === replyToMessageId);
  if (reportIndex === -1) return "not_found";

  if (text === "ok") {
    data.reports[reportIndex].adminDecision = "approved";
  } else {
    data.reports.splice(reportIndex, 1);
  }

  return "updated";
}

async function syncTelegramReplies(data) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  try {
    const offset = Number(data.telegramUpdateOffset || 0);
    const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=0`);
    const payload = await response.json();
    if (!payload.ok || !Array.isArray(payload.result) || payload.result.length === 0) return false;

    let changed = false;
    for (const update of payload.result) {
      const message = update?.message;
      const text = String(message?.text || "").trim().toLowerCase();
      const replyToMessageId = message?.reply_to_message?.message_id;
      const fromChatId = String(message?.chat?.id || "");
      const updateId = Number(update?.update_id || 0);
      if (Number.isFinite(updateId) && updateId >= data.telegramUpdateOffset) {
        data.telegramUpdateOffset = updateId + 1;
      }

      if (!message || !["ok", "non"].includes(text) || fromChatId !== String(chatId)) continue;
      if (!replyToMessageId) continue;
      const status = applyAdminDecision(data, text, replyToMessageId);
      if (status === "updated") changed = true;
    }

    return changed;
  } catch (error) {
    console.warn("Telegram sync failed:", error.message);
    return false;
  }
}

async function handleApi(request, response, url) {
  if (url.pathname === '/api/visits' && ['GET', 'POST'].includes(request.method)) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'POST') {
      if (request.headers['x-aletrain-visit'] !== '1' || request.headers['sec-fetch-site'] === 'cross-site') {
        sendJson(response, 403, { error: 'Origine invalide.' });
        return;
      }
      visits.visit(request.headers.cookie);
      response.setHeader('Set-Cookie', 'aletrain_visit=1; Max-Age=1800; Path=/; HttpOnly; SameSite=Lax');
    }
    sendJson(response, 200, { visits: visits.count() });
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
  if (request.method === "POST" && url.pathname === "/api/profiles") {
    const body = await readRequestJson(request);
    const username = normalizeUsername(body.username);
    const password = String(body.password || "");

    if (username.length < 2 || password.length < 4) {
      sendJson(response, 400, { error: "Nom d'utilisateur ou mot de passe trop court." });
      return;
    }

    const data = await readDatabase();
    if (data.users.some((user) => user.username === username)) {
      sendJson(response, 409, { error: "Ce profil existe deja." });
      return;
    }

    data.users.push({
      username,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    });
    await writeDatabase(data);
    sendJson(response, 201, { username });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const body = await readRequestJson(request);
    const username = normalizeUsername(body.username);
    const password = String(body.password || "");
    const data = await readDatabase();
    const user = data.users.find((entry) => entry.username === username);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      sendJson(response, 401, { error: "Profil ou mot de passe incorrect." });
      return;
    }

    sendJson(response, 200, { username });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/reports") {
    const data = await readDatabase();
    const reports = cleanExpiredReports(data.reports);
    data.reports = reports;
    const telegramChanged = await syncTelegramReplies(data);
    if (reports.length !== data.reports.length || telegramChanged) await writeDatabase(data);
    sendJson(response, 200, { reports: visibleReports(data.reports) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reports") {
    const body = await readRequestJson(request);
    const trainId = String(body.trainId || "");
    const reportedBy = normalizeUsername(body.reportedBy);
    const durationMinutes = Number(body.durationMinutes || 90);
    const safeDuration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 90;

    if (!trainId || !reportedBy) {
      sendJson(response, 400, { error: "Signalement incomplet." });
      return;
    }

    const data = await readDatabase();
    data.reports = cleanExpiredReports(data.reports).filter(
      (report) => !(report.trainId === trainId && report.reportedBy === reportedBy),
    );

    const report = {
      trainId,
      reportedBy,
      reason: String(body.reason || ""),
      durationMinutes: body.durationMinutes ? safeDuration : null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + safeDuration * 60 * 1000).toISOString(),
      trainTitle: String(body.trainTitle || "Train"),
      destination: String(body.destination || "Destination inconnue"),
      departureLabel: String(body.departureLabel || "--:--"),
      stationName: String(body.stationName || "Gare inconnue"),
      confirmations: [],
      denials: [],
      adminDecision: "pending",
      telegramMessageId: null,
    };

    data.reports.push(report);
    const messageId = await notifyTelegram(report);
    report.telegramMessageId = messageId;
    await writeDatabase(data);
    sendJson(response, 201, { report });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/telegram/webhook") {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      sendJson(response, 503, { error: "Telegram non configure." });
      return;
    }

    const update = await readRequestJson(request);
    const message = update?.message;
    const text = String(message?.text || "").trim().toLowerCase();
    const replyToMessageId = message?.reply_to_message?.message_id;
    const fromChatId = String(message?.chat?.id || "");

    if (!message || !replyToMessageId || !["ok", "non"].includes(text) || fromChatId !== String(chatId)) {
      sendJson(response, 200, { status: "ignored" });
      return;
    }

    const data = await readDatabase();
    data.reports = cleanExpiredReports(data.reports);
    const status = applyAdminDecision(data, text, replyToMessageId);
    if (status !== "updated") {
      sendJson(response, 200, { status });
      return;
    }
    await writeDatabase(data);
    sendJson(response, 200, { status });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/reports/")) {
    const [, , , trainId, action] = url.pathname.split("/");
    const body = await readRequestJson(request);
    const username = normalizeUsername(body.username);

    if (!trainId || !["confirm", "deny"].includes(action) || !username) {
      sendJson(response, 400, { error: "Action de signalement invalide." });
      return;
    }

    const data = await readDatabase();
    data.reports = cleanExpiredReports(data.reports);
    const report = data.reports.find((entry) => entry.trainId === decodeURIComponent(trainId));
    if (!report) {
      sendJson(response, 404, { error: "Signalement introuvable." });
      return;
    }

    report.confirmations = (report.confirmations || []).filter((entry) => entry !== username);
    report.denials = (report.denials || []).filter((entry) => entry !== username);
    if (action === "confirm") report.confirmations.push(username);
    if (action === "deny") report.denials.push(username);

    await writeDatabase(data);
    sendJson(response, 200, { report });
    return;
  }

  sendJson(response, 404, { error: "API introuvable." });
}

createServer(async (request, response) => {
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
    const body = staticCache.get(requestedPath);
    response.writeHead(200, {
      "Content-Type": types[extname(filePath)] || "application/octet-stream",
      'Cache-Control': requestedPath === 'index.html' ? 'no-cache' : 'public, max-age=300',
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
