import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { extname, join, resolve } from "node:path";

const root = resolve(".");
const port = Number(process.env.PORT || 4173);
const databasePath = join(root, "data.json");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const defaultData = {
  users: [],
  reports: [],
};

let writeQueue = Promise.resolve();

async function readDatabase() {
  if (!existsSync(databasePath)) return structuredClone(defaultData);

  try {
    const data = JSON.parse(await readFile(databasePath, "utf8"));
    return {
      users: Array.isArray(data.users) ? data.users : [],
      reports: Array.isArray(data.reports) ? data.reports : [],
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
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function cleanExpiredReports(reports) {
  const now = Date.now();
  return reports.filter((report) => new Date(report.expiresAt).getTime() > now);
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
  ].join("\n");

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (error) {
    console.warn("Telegram notification failed:", error.message);
  }
}

async function handleApi(request, response, url) {
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
    if (reports.length !== data.reports.length) {
      data.reports = reports;
      await writeDatabase(data);
    }
    sendJson(response, 200, { reports });
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
    };

    data.reports.push(report);
    await writeDatabase(data);
    notifyTelegram(report);
    sendJson(response, 201, { report });
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
    const filePath = resolve(join(root, requestedPath));

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": types[extname(filePath)] || "application/octet-stream",
    });
    response.end(body);
  } catch (error) {
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
