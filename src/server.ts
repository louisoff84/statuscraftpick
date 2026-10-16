import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";

type Theme = "red" | "cyan" | "green" | "purple";
type Service =
  | { id: string; name: string; type: "http"; target: string; maintenance: boolean }
  | { id: string; name: string; type: "tcp"; host: string; port: number; maintenance: boolean };
type Database = { webhookUrl: string; theme: Theme; services: Service[] };
type Check = { online: boolean; ping: number };
type Status = Check & Service & {
  uptimePercent: string;
  avgPing: number;
  history: Check[];
  graphData: Array<{ time: string; ping: number }>;
};

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_FILE = path.resolve(process.env.DATA_FILE ?? path.join(ROOT, "data.json"));
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = readInteger(process.env.PORT, 3000, 1, 65_535);
const HOST = process.env.HOST ?? "0.0.0.0";
const CHECK_INTERVAL_MS = readInteger(process.env.CHECK_INTERVAL_MS, 10_000, 1_000, 3_600_000);
const CHECK_TIMEOUT_MS = readInteger(process.env.CHECK_TIMEOUT_MS, 3_000, 250, 60_000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD est obligatoire. Consultez .env.example.");
  process.exit(1);
}

const defaultDb: Database = {
  webhookUrl: "",
  theme: "red",
  services: [
    { id: "1", name: "Site Web principal", type: "http", target: "https://craftpick.fr", maintenance: false },
    { id: "2", name: "Panel Pterodactyl", type: "http", target: "https://panel.craftpick.fr", maintenance: false },
  ],
};

let db = loadDatabase();
const historyStore: Record<string, Check[]> = {};
const responseTimesStore: Record<string, Array<{ time: string; ping: number }>> = {};
let statusData: Status[] = [];
let updatePromise: Promise<void> | undefined;

function readInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function isTheme(value: unknown): value is Theme {
  return ["red", "cyan", "green", "purple"].includes(String(value));
}

function parseService(value: unknown): Service | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  const id = String(item.id ?? "").trim();
  const name = String(item.name ?? "").trim();
  if (!id || !name || name.length > 100) return;
  if (item.type === "http") {
    try {
      const target = new URL(String(item.target ?? ""));
      if (!["http:", "https:"].includes(target.protocol)) return;
      return { id, name, type: "http", target: target.toString(), maintenance: Boolean(item.maintenance) };
    } catch {
      return;
    }
  }
  if (item.type === "tcp") {
    const host = String(item.host ?? "").trim();
    const port = Number(item.port);
    if (!host || host.length > 253 || !Number.isInteger(port) || port < 1 || port > 65_535) return;
    return { id, name, type: "tcp", host, port, maintenance: Boolean(item.maintenance) };
  }
}

function loadDatabase(): Database {
  try {
    if (!fs.existsSync(DATA_FILE)) return structuredClone(defaultDb);
    const value = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as Record<string, unknown>;
    const services = Array.isArray(value.services)
      ? value.services.map(parseService).filter((service): service is Service => Boolean(service))
      : defaultDb.services;
    return {
      webhookUrl: typeof value.webhookUrl === "string" ? value.webhookUrl : "",
      theme: isTheme(value.theme) ? value.theme : "red",
      services,
    };
  } catch (error) {
    console.error("data.json invalide, configuration par défaut chargée :", error);
    return structuredClone(defaultDb);
  }
}

function saveData(): void {
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(tempFile, `${JSON.stringify(db, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempFile, DATA_FILE);
}

async function sendDiscordWebhook(serviceName: string, isMaintenance: boolean): Promise<void> {
  if (!db.webhookUrl) return;
  try {
    const response = await fetch(db.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: isMaintenance ? "⚠️ Maintenance initiée" : "✅ Maintenance terminée",
          description: `Le service **${serviceName.replaceAll("*", "\\*")}** a changé d'état.`,
          color: isMaintenance ? 16_753_920 : 3_066_993,
          timestamp: new Date().toISOString(),
        }],
      }),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!response.ok) console.error(`Webhook Discord refusé (${response.status}).`);
  } catch (error) {
    console.error("Erreur webhook :", error);
  }
}

function checkService(service: Service): Promise<Check> {
  if (service.maintenance) return Promise.resolve({ online: false, ping: 0 });
  return new Promise((resolve) => {
    const start = performance.now();
    let settled = false;
    const finish = (online: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ online, ping: online ? Math.round(performance.now() - start) : 0 });
    };

    if (service.type === "http") {
      const client = service.target.startsWith("https:") ? https : http;
      const request = client.get(service.target, {
        timeout: CHECK_TIMEOUT_MS,
        headers: { "user-agent": "Craftpick-Status/2.0" },
      }, (response) => {
        response.resume();
        finish(Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 400));
      });
      request.once("error", () => finish(false));
      request.once("timeout", () => {
        request.destroy();
        finish(false);
      });
      return;
    }

    const socket = net.createConnection({ host: service.host, port: service.port });
    socket.setTimeout(CHECK_TIMEOUT_MS);
    socket.once("connect", () => {
      socket.destroy();
      finish(true);
    });
    socket.once("error", () => finish(false));
    socket.once("timeout", () => {
      socket.destroy();
      finish(false);
    });
  });
}

async function updateStatuses(): Promise<void> {
  if (updatePromise) return updatePromise;
  updatePromise = (async () => {
    const now = new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date());
    const checks = await Promise.all(db.services.map(async (service): Promise<Status> => {
      const history = historyStore[service.id] ??= [];
      const graphData = responseTimesStore[service.id] ??= [];
      const result = await checkService(service);
      if (!service.maintenance) {
        history.push(result);
        if (history.length > 30) history.shift();
        graphData.push({ time: now, ping: result.ping });
        if (graphData.length > 50) graphData.shift();
      }
      const online = history.filter((check) => check.online);
      const avgPing = online.length
        ? Math.round(online.reduce((total, check) => total + check.ping, 0) / online.length)
        : 0;
      return {
        ...service,
        ...result,
        uptimePercent: history.length ? ((online.length / history.length) * 100).toFixed(1) : "100.0",
        avgPing,
        history: [...history],
        graphData: [...graphData],
      };
    }));
    statusData = checks;
  })().finally(() => {
    updatePromise = undefined;
  });
  return updatePromise;
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = crypto.createHash("sha256").update(left).digest();
  const rightHash = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.static(PUBLIC_DIR, { maxAge: "1h", etag: true }));

const failures = new Map<string, { count: number; blockedUntil: number }>();
function auth(request: Request, response: Response, next: NextFunction): void {
  const ip = request.ip ?? "unknown";
  const state = failures.get(ip);
  if (state && state.blockedUntil > Date.now()) {
    response.status(429).json({ error: "Trop de tentatives. Réessayez plus tard." });
    return;
  }
  const supplied = request.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!safeEqual(supplied, ADMIN_PASSWORD)) {
    const count = (state?.count ?? 0) + 1;
    failures.set(ip, { count, blockedUntil: count >= 5 ? Date.now() + 60_000 : 0 });
    response.status(401).json({ error: "Non autorisé" });
    return;
  }
  failures.delete(ip);
  next();
}

app.get("/api/health", (_request, response) => response.json({ ok: true }));
app.get("/api/status", (_request, response) => response.json(statusData));
app.get("/api/config", (_request, response) => response.json({ theme: db.theme }));
app.post("/api/admin/login", auth, (_request, response) => {
  response.json({ success: true, webhookUrl: db.webhookUrl, theme: db.theme });
});
app.post("/api/admin/config", auth, (request, response) => {
  if (request.body.webhookUrl !== undefined) {
    const webhookUrl = String(request.body.webhookUrl).trim();
    if (webhookUrl && !/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//.test(webhookUrl)) {
      response.status(400).json({ error: "Webhook Discord invalide." });
      return;
    }
    db.webhookUrl = webhookUrl;
  }
  if (request.body.theme !== undefined) {
    if (!isTheme(request.body.theme)) {
      response.status(400).json({ error: "Thème invalide." });
      return;
    }
    db.theme = request.body.theme;
  }
  saveData();
  response.json({ success: true });
});
app.post("/api/admin/service", auth, async (request, response) => {
  const service = parseService({ ...request.body, id: crypto.randomUUID(), maintenance: false });
  if (!service) {
    response.status(400).json({ error: "Service invalide." });
    return;
  }
  db.services.push(service);
  saveData();
  await updateStatuses();
  response.status(201).json({ success: true, id: service.id });
});
app.delete("/api/admin/service/:id", auth, async (request, response) => {
  const before = db.services.length;
  db.services = db.services.filter((service) => service.id !== request.params.id);
  if (db.services.length === before) {
    response.status(404).json({ error: "Service introuvable." });
    return;
  }
  delete historyStore[request.params.id];
  delete responseTimesStore[request.params.id];
  saveData();
  await updateStatuses();
  response.json({ success: true });
});
app.post("/api/admin/maintenance/:id", auth, async (request, response) => {
  const service = db.services.find((item) => item.id === request.params.id);
  if (!service) {
    response.status(404).json({ error: "Service introuvable." });
    return;
  }
  service.maintenance = !service.maintenance;
  saveData();
  await Promise.all([sendDiscordWebhook(service.name, service.maintenance), updateStatuses()]);
  response.json({ success: true, maintenance: service.maintenance });
});
app.post("/api/admin/reset/:id", auth, async (request, response) => {
  if (!db.services.some((service) => service.id === request.params.id)) {
    response.status(404).json({ error: "Service introuvable." });
    return;
  }
  historyStore[request.params.id] = [];
  responseTimesStore[request.params.id] = [];
  await updateStatuses();
  response.json({ success: true });
});
app.use("/api", (_request, response) => response.status(404).json({ error: "Route introuvable." }));

await updateStatuses();
const interval = setInterval(() => void updateStatuses(), CHECK_INTERVAL_MS);
interval.unref();
const server = app.listen(PORT, HOST, () => {
  console.log(`Craftpick Status écoute sur http://${HOST}:${PORT}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(interval);
    server.close(() => process.exit(0));
  });
}
