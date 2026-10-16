import { element, escapeHtml, installCursor } from "./common.js";

type Check = { online: boolean; ping: number };
type ServiceStatus = {
  id: string;
  name: string;
  online: boolean;
  ping: number;
  maintenance: boolean;
  uptimePercent: string;
  avgPing: number;
  history: Check[];
  graphData: Array<{ time: string; ping: number }>;
};

const expanded = new Set<string>();
const grid = element<HTMLElement>("grid");
installCursor(element<HTMLElement>("cursor-ring"));

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

async function syncTheme(): Promise<void> {
  try {
    const config = await readJson<{ theme?: string }>("/api/config");
    if (config.theme) document.documentElement.dataset.theme = config.theme;
  } catch (error) {
    console.error("Impossible de charger le thème", error);
  }
}

function drawGraph(id: string, data: ServiceStatus["graphData"]): void {
  const canvas = document.getElementById(`cvs-${CSS.escape(id)}`) as HTMLCanvasElement | null;
  if (!canvas || data.length === 0) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const scale = Math.min(devicePixelRatio, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * scale;
  canvas.height = height * scale;
  context.scale(scale, scale);
  const maxPing = Math.max(...data.map((point) => point.ping), 15);
  context.strokeStyle = "rgba(255,255,255,0.05)";
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  const styles = getComputedStyle(document.documentElement);
  context.beginPath();
  context.strokeStyle = styles.getPropertyValue("--accent").trim();
  context.lineWidth = 2.5;
  data.forEach((point, index) => {
    const x = index * (width / Math.max(data.length - 1, 1));
    const y = height - (point.ping / maxPing) * (height - 25) - 12;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.lineTo(width, height);
  context.lineTo(0, height);
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, styles.getPropertyValue("--accent-glow").trim());
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fill();
}

function cardTemplate(service: ServiceStatus): string {
  const isExpanded = expanded.has(service.id);
  const stateClass = service.maintenance ? "status-maint" : service.online ? "status-online" : "status-offline";
  const badge = service.maintenance ? "MAINTENANCE" : service.online ? `${service.ping} ms` : "DOWN";
  const bars = Array.from({ length: 30 }, (_, index) => {
    const check = service.history[service.history.length - 30 + index];
    if (service.maintenance) return '<div class="bar empty maintenance-bar"></div>';
    if (!check) return '<div class="bar empty"></div>';
    return `<div class="bar ${check.online ? "online" : "offline"}" title="${check.ping} ms"></div>`;
  }).join("");
  const details = service.maintenance
    ? '<div class="maint-banner">⚠ INTERVENTION EN COURS SUR L’INFRASTRUCTURE</div>'
    : `<div class="stats">
        <div class="stat-box"><div class="stat-label">Uptime récent</div><div class="stat-val status-online">${service.uptimePercent}%</div></div>
        <div class="stat-box"><div class="stat-label">Latence moyenne</div><div class="stat-val">${service.avgPing} ms</div></div>
      </div><canvas id="cvs-${escapeHtml(service.id)}"></canvas>`;
  return `<article class="card ${isExpanded ? "expanded" : ""}" data-service-id="${escapeHtml(service.id)}" tabindex="0" role="button" aria-expanded="${isExpanded}">
    <div class="card-header"><div class="service-name"><div class="dot"></div>${escapeHtml(service.name)}</div>
    <div class="badge ${stateClass}">${badge}</div></div>
    <div class="history-bars">${bars}</div>
    <div class="card-footer-info"><span>Historique récent (30 sondages)</span>
    <span class="click-hint">${isExpanded ? "▲ Masquer les métriques" : "▼ Inspecter la latence"}</span></div>
    <div class="details">${details}</div>
  </article>`;
}

async function fetchStatus(): Promise<void> {
  try {
    const services = await readJson<ServiceStatus[]>("/api/status");
    grid.innerHTML = services.map(cardTemplate).join("");
    services.forEach((service) => {
      if (expanded.has(service.id) && !service.maintenance) drawGraph(service.id, service.graphData);
    });
  } catch (error) {
    console.error("Impossible de charger les statuts", error);
  }
}

function toggleCard(card: HTMLElement): void {
  const id = card.dataset.serviceId;
  if (!id) return;
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  void fetchStatus();
}

grid.addEventListener("click", (event) => {
  const card = (event.target as Element).closest<HTMLElement>("[data-service-id]");
  if (card) toggleCard(card);
});
grid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = (event.target as Element).closest<HTMLElement>("[data-service-id]");
  if (card) {
    event.preventDefault();
    toggleCard(card);
  }
});

void syncTheme();
void fetchStatus();
setInterval(() => void syncTheme(), 10_000);
setInterval(() => void fetchStatus(), 5_000);
