import { element, escapeHtml, installCursor } from "./common.js";

type Theme = "red" | "cyan" | "green" | "purple";
type ServiceStatus = {
  id: string; name: string; type: "http" | "tcp"; target?: string;
  host?: string; port?: number; maintenance: boolean;
};

const loginScreen = element<HTMLElement>("login-screen");
const adminPanel = element<HTMLElement>("admin-panel");
const passwordInput = element<HTMLInputElement>("pwdInput");
const webhookInput = element<HTMLInputElement>("webhook");
const themeSelect = element<HTMLSelectElement>("themeSelect");
const adminGrid = element<HTMLElement>("adminGrid");
let authToken = sessionStorage.getItem("craftpick_token");
let refreshTimer: number | undefined;
installCursor();

async function request(url: string, method = "GET", body?: object): Promise<Response> {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401 && url !== "/api/admin/login") logout();
  return response;
}

function logout(): void {
  sessionStorage.removeItem("craftpick_token");
  authToken = null;
  if (refreshTimer) clearInterval(refreshTimer);
  adminPanel.style.display = "none";
  loginScreen.style.display = "flex";
  passwordInput.value = "";
}

async function verifyToken(token: string): Promise<void> {
  authToken = token;
  try {
    const response = await request("/api/admin/login", "POST");
    if (!response.ok) {
      authToken = null;
      alert(response.status === 429 ? "Trop de tentatives. Patientez une minute." : "Mot de passe incorrect.");
      return;
    }
    const data = await response.json() as { webhookUrl?: string; theme?: Theme };
    sessionStorage.setItem("craftpick_token", token);
    webhookInput.value = data.webhookUrl ?? "";
    if (data.theme) {
      themeSelect.value = data.theme;
      document.documentElement.dataset.theme = data.theme;
    }
    loginScreen.style.display = "none";
    adminPanel.style.display = "block";
    await loadAdmin();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => void loadAdmin(), 10_000);
  } catch {
    alert("Serveur indisponible.");
  }
}

async function loadAdmin(): Promise<void> {
  const response = await request("/api/status");
  if (!response.ok) return;
  const services = await response.json() as ServiceStatus[];
  adminGrid.innerHTML = services.map((service) => {
    const endpoint = service.type === "http" ? service.target : `${service.host}:${service.port}`;
    return `<div class="card ${service.maintenance ? "is-maintenance" : ""}">
      <div><div class="service-title">${escapeHtml(service.name)} <span>[${service.type}]</span></div>
      <div class="service-meta">${escapeHtml(endpoint)}</div></div>
      <div class="actions">
        <button class="btn-warn" data-action="maintenance" data-id="${escapeHtml(service.id)}">${service.maintenance ? "Fin maintenance" : "Maintenance"}</button>
        <button class="btn-secondary" data-action="reset" data-id="${escapeHtml(service.id)}">Réinitialiser</button>
        <button class="btn-danger" data-action="delete" data-id="${escapeHtml(service.id)}">Supprimer</button>
      </div></div>`;
  }).join("");
}

async function saveConfig(): Promise<void> {
  const theme = themeSelect.value as Theme;
  document.documentElement.dataset.theme = theme;
  const response = await request("/api/admin/config", "POST", { webhookUrl: webhookInput.value, theme });
  if (!response.ok) alert((await response.json() as { error?: string }).error ?? "Configuration refusée.");
}

async function addService(): Promise<void> {
  const nameInput = element<HTMLInputElement>("sName");
  const typeInput = element<HTMLSelectElement>("sType");
  const targetInput = element<HTMLInputElement>("sTarget");
  const portInput = element<HTMLInputElement>("sPort");
  const body = typeInput.value === "http"
    ? { name: nameInput.value, type: "http", target: targetInput.value }
    : { name: nameInput.value, type: "tcp", host: targetInput.value, port: Number(portInput.value) };
  const response = await request("/api/admin/service", "POST", body);
  if (!response.ok) {
    alert((await response.json() as { error?: string }).error ?? "Service invalide.");
    return;
  }
  nameInput.value = targetInput.value = portInput.value = "";
  await loadAdmin();
}

passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void verifyToken(passwordInput.value);
});
element<HTMLButtonElement>("loginButton").addEventListener("click", () => void verifyToken(passwordInput.value));
element<HTMLButtonElement>("logoutButton").addEventListener("click", logout);
element<HTMLButtonElement>("saveConfigButton").addEventListener("click", () => void saveConfig());
element<HTMLButtonElement>("addServiceButton").addEventListener("click", () => void addService());
themeSelect.addEventListener("change", () => void saveConfig());
adminGrid.addEventListener("click", async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-action]");
  const id = button?.dataset.id;
  if (!button || !id) return;
  const action = button.dataset.action;
  if (action === "delete" && !confirm("Supprimer ce service ?")) return;
  if (action === "reset" && !confirm("Vider son historique ?")) return;
  const endpoint = action === "delete" ? `/api/admin/service/${encodeURIComponent(id)}` : `/api/admin/${action}/${encodeURIComponent(id)}`;
  const response = await request(endpoint, action === "delete" ? "DELETE" : "POST");
  if (response.ok) await loadAdmin();
});

if (authToken) void verifyToken(authToken);
