const state = {
  token: localStorage.getItem("token") || "",
  user: JSON.parse(localStorage.getItem("user") || "null"),
  tab: "dashboard",
  dashboardFilters: {
    mode: "day",
    date: new Date().toISOString().slice(0, 10),
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    month: new Date().toISOString().slice(0, 7),
  },
  collaborators: [],
  activities: [],
  checklists: [],
  pendencies: [],
  sectorAudits: [],
  sectorAuditSummary: { evaluatedByUser: 0, evaluatedTotal: 0 },
  users: [],
  auditFilters: {
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    focus: "abastecimento",
    sector: "",
    completion: "",
  },
  dashboard: null,
  repo: {
    sectors: [],
    activities: [],
    repoCollaboratorIds: [],
    commercialCollaboratorIds: [],
    repoUsers: [],
    commercialUsers: [],
    dashboard: null,
    tasks: [],
    ruptures: [],
    expirations: [],
    damages: [],
    goals: [],
    filters: {
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
    },
  },
  agenda: {
    rows: [],
    publicRows: [],
    filters: {
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
    },
  },
  management: {
    data: null,
    entryData: null,
    filters: {
      period: new Date().toISOString().slice(0, 7),
      comparePeriod: (() => {
        const date = new Date();
        date.setMonth(date.getMonth() - 1);
        return date.toISOString().slice(0, 7);
      })(),
      entryPeriod: new Date().toISOString().slice(0, 7),
      sector: "",
      operatorName: "",
    },
  },
  openNavGroup: "",
};
let sessionRefreshTimer = null;

const app = document.getElementById("app");
const PRICE_DIVERGENCE_ACTIVITY = "Confer\u00eancia de precifica\u00e7\u00e3o";
const EXPIRED_PRODUCTS_ACTIVITY = "Verifica\u00e7\u00e3o de validades";
const SECTOR_REQUIRED_ACTIVITY_TERMS = ["validade", "ruptura", "precificacao", "preco"];
const PHOTO_REQUIRED_ACTIVITY_TERMS = ["cotacao", "precificacao", "preco"];
const AUDIT_FOCUS_OPTIONS = [
  ["limpeza", "Limpeza"],
  ["organizacao", "Organização"],
  ["abastecimento", "Abastecimento"],
  ["precificacao", "Precificação"],
  ["validade", "Validade"],
  ["ruptura", "Ruptura"],
  ["avaria", "Avaria"],
  ["tudo", "Tudo"],
];
function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  }).then(async (response) => {
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("json") ? await response.json() : await response.blob();
    if (!response.ok) {
      const message = data.error || "Falha ao processar solicitação.";
      if (response.status === 401 && path !== "/api/login" && state.token) {
        expireSession(message);
      }
      throw new Error(message);
    }
    return data;
  });
}

function fmtMoney(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(value) {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function monthRange(month) {
  const [year, monthIndex] = String(month || new Date().toISOString().slice(0, 7)).split("-").map(Number);
  const start = new Date(year, monthIndex - 1, 1);
  const end = new Date(year, monthIndex, 0);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function canCorrect() {
  return ["administrador", "encarregada"].includes(state.user?.role);
}

function canEditChecklist(row) {
  return canCorrect() || Number(row.created_by) === Number(state.user?.id);
}

function canDeleteChecklist() {
  return state.user?.role === "administrador";
}

function isLinkedCollaborator() {
  return state.user?.role === "colaborador" && state.user?.collaborator_id;
}

function canAccessSummary() {
  return ["administrador", "encarregada"].includes(state.user?.role);
}

function canAccessPrevention() {
  return ["administrador", "prevencao", "colaborador", "encarregada"].includes(state.user?.role);
}

function canAccessReposition() {
  return ["administrador", "encarregada", "gerente", "reposicao", "comercial"].includes(state.user?.role);
}

function canAccessAgenda(type) {
  if (["administrador", "encarregada"].includes(state.user?.role)) return true;
  if (type === "comercial") return state.user?.role === "comercial";
  if (type === "recebimento") return state.user?.role === "recebimento";
  return false;
}

function canManageRepoGoals() {
  return ["administrador", "encarregada"].includes(state.user?.role);
}

function canFillEncarregadaOnly() {
  return state.user?.role === "encarregada";
}

function canFillLaraOnlyActivities() {
  const linkedCollaborator = state.user?.collaborator_id
    ? state.collaborators.find((item) => Number(item.id) === Number(state.user.collaborator_id))
    : null;
  const name = normalizeText(`${state.user?.display_name || ""} ${state.user?.username || ""}`)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const collaboratorName = normalizeText(linkedCollaborator?.name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return state.user?.role === "encarregada" && (name.includes("lara") || collaboratorName.includes("lara"));
}

function checklistActivitiesForUser() {
  return state.activities;
}

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = withoutAccents(message);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function escapeHtml(value) {
  return normalizeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeText(value) {
  let text = String(value ?? "");
  for (let index = 0; index < 3 && /[ÃÂ]/.test(text); index += 1) {
    const decoded = decodeBrokenUtf8(text);
    if (!decoded || decoded === text) break;
    text = decoded;
  }
  return text;
}

function withoutAccents(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function decodeBrokenUtf8(text) {
  try {
    if (typeof TextDecoder !== "undefined") {
      const bytes = Uint8Array.from(Array.from(text, (char) => char.charCodeAt(0) & 255));
      return new TextDecoder("utf-8").decode(bytes);
    }
    return decodeURIComponent(escape(text));
  } catch {
    return text;
  }
}

function fixVisibleText(root = app) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    if (node.parentElement?.tagName === "OPTION") {
      const option = node.parentElement;
      if (!option.hasAttribute("value")) option.value = normalizeText(node.nodeValue);
      node.nodeValue = withoutAccents(node.nodeValue);
    } else {
      node.nodeValue = withoutAccents(node.nodeValue);
    }
  });
  root.querySelectorAll("input[placeholder], textarea[placeholder], [title], [aria-label]").forEach((field) => {
    if (field.hasAttribute("placeholder")) field.placeholder = withoutAccents(field.placeholder);
    if (field.title) field.title = withoutAccents(field.title);
    if (field.getAttribute("aria-label")) field.setAttribute("aria-label", withoutAccents(field.getAttribute("aria-label")));
  });
}

let isFixingVisibleText = false;

function scheduleVisibleTextFix() {
  if (isFixingVisibleText) return;
  requestAnimationFrame(() => {
    isFixingVisibleText = true;
    fixVisibleText(app);
    isFixingVisibleText = false;
  });
}

if (typeof MutationObserver !== "undefined") {
  new MutationObserver(() => scheduleVisibleTextFix()).observe(app, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function loginAreaMatches(area, role) {
  const areaRoles = {
    prevencao: ["prevencao", "colaborador"],
    gerente: ["gerente"],
    reposicao: ["reposicao"],
    recebimento: ["recebimento"],
    comercial: ["comercial"],
    administrador: ["administrador"],
  };
  return (areaRoles[area] || []).includes(role);
}

function renderLogin(error = "") {
  app.innerHTML = `
    <section class="login-screen">
      <form class="login-panel" id="loginForm">
        <div class="brand">
          <div class="brand-mark">CA</div>
          <div>
            <h1>Controle Atacarejo</h1>
            <div class="muted">Atacarejo AntÃ´nio de OzÃ³rio</div>
          </div>
        </div>
        <div class="grid">
          <label>UsuÃ¡rio
            <input name="username" autocomplete="username" required>
          </label>
          <label>Senha
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
          <button class="btn primary" type="submit">Entrar</button>
        </div>
      </form>
    </section>
  `;
  const loginForm = document.getElementById("loginForm");
  loginForm.querySelector("h1").textContent = "Controle Atacarejo";
  loginForm.querySelector(".brand .muted").textContent = "Atacarejo AntÃ´nio de OzÃ³rio";
  loginForm.querySelector('input[name="username"]').closest("label").insertAdjacentHTML("beforebegin", `
    <label>Ãrea de acesso
      <select name="accessArea" required>
        <option value="prevencao">PrevenÃ§Ã£o de perdas</option>
        <option value="gerente">Gerente</option>
        <option value="reposicao">ReposiÃ§Ã£o da loja</option>
        <option value="recebimento">Recebimento</option>
        <option value="comercial">Comercial</option>
        <option value="administrador">Administrador</option>
      </select>
    </label>
  `);
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const data = await api("/api/login", { method: "POST", body: JSON.stringify(body) });
      if (!loginAreaMatches(body.accessArea, data.user.role)) {
        const labels = {
          prevencao: "PrevenÃ§Ã£o de perdas",
          gerente: "Gerente",
          reposicao: "ReposiÃ§Ã£o da loja",
          recebimento: "Recebimento",
          comercial: "Comercial",
          administrador: "Administrador",
        };
        return renderLogin(`Este usuÃ¡rio nÃ£o pertence ao acesso ${labels[body.accessArea] || "selecionado"}.`);
      }
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      await bootstrap();
    } catch (err) {
      renderLogin(err.message);
    }
  });
  fixVisibleText(app);
}

async function bootstrap() {
  if (isPublicAgendaPage()) return renderPublicAgenda();
  if (!state.token) return renderLogin();
  try {
    const me = await api("/api/me");
    state.user = me.user;
    state.activities = me.activities;
    state.repo.sectors = me.sectors || state.repo.sectors;
    if (canAccessReposition()) {
      const repoOptions = await api("/api/reposition/options");
      state.repo.sectors = repoOptions.sectors;
      state.repo.activities = repoOptions.activities;
      state.repo.repoCollaboratorIds = repoOptions.repoCollaboratorIds || [];
      state.repo.commercialCollaboratorIds = repoOptions.commercialCollaboratorIds || [];
      state.repo.repoUsers = repoOptions.repoUsers || [];
      state.repo.commercialUsers = repoOptions.commercialUsers || [];
    }
    state.tab = defaultTab();
    await loadCollaborators();
    if (state.tab === "dashboard") await loadDashboard();
    if (state.tab === "reposition" || state.tab === "repoDashboard" || state.tab === "commercial" || state.tab === "commercialDashboard") await loadReposition();
    renderShell();
    startSessionKeepAlive();
  } catch (error) {
    expireSession(error.message);
  }
}

function stopSessionKeepAlive() {
  if (sessionRefreshTimer) clearInterval(sessionRefreshTimer);
  sessionRefreshTimer = null;
}

async function refreshSession() {
  if (!state.token || document.visibilityState === "hidden") return;
  try {
    const data = await api("/api/session/refresh", { method: "POST" });
    state.token = data.token;
    localStorage.setItem("token", data.token);
  } catch {
    // A API direciona para o login quando a sessao realmente expira.
  }
}

function startSessionKeepAlive() {
  stopSessionKeepAlive();
  sessionRefreshTimer = setInterval(refreshSession, 30 * 60 * 1000);
}

function expireSession(message = "Sua sessão expirou. Entre novamente.") {
  logout(message);
}

function logout(message = "") {
  stopSessionKeepAlive();
  state.token = "";
  state.user = null;
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  if (isPublicAgendaPage()) return renderPublicAgenda();
  renderLogin(message);
}

function isPublicAgendaPage() {
  return window.location.pathname.startsWith("/agendar/");
}

function publicAgendaType() {
  return window.location.pathname.includes("recebimento") ? "recebimento" : "comercial";
}

function tabIcon(id) {
  const icons = {
    dashboard: "&#128200;",
    repoDashboard: "&#9673;",
    commercialDashboard: "&#128188;",
    commercialAgenda: "&#128197;",
    receivingAgenda: "&#128666;",
    checklist: "&#9745;",
    summary: "&#128221;",
    reports: "&#128202;",
    repoReports: "&#128202;",
    reposition: "&#128230;",
    commercial: "&#128179;",
    managementIndicators: "&#128202;",
    managementStore: "&#128181;",
    managementDelivery: "&#128666;",
    managementQuotations: "&#128196;",
    managementSectors: "&#128230;",
    managementProductivity: "&#128200;",
    managementOperators: "&#128101;",
    sectorAudit: "&#128269;",
    pendencies: "&#9888;",
    collaborators: "&#128101;",
    users: "&#9881;",
  };
  return icons[id] || "&#8226;";
}

function roleLabel(role) {
  const labels = {
    administrador: "Administrador",
    prevencao: "Prevenção",
    colaborador: "Colaborador",
    encarregada: "Encarregada",
    gerente: "Gerente",
    reposicao: "Reposição",
    recebimento: "Recebimento",
    comercial: "Comercial",
  };
  return labels[role] || role || "";
}

function userInitial(name) {
  return normalizeText(name || "A").trim().charAt(0).toUpperCase() || "A";
}

function renderShell() {
  const tabs = allowedTabs();
  const groups = navGroups(tabs);
  if (!tabs.some(([id]) => id === state.tab)) state.tab = tabs[0][0];
  const openGroup = state.openNavGroup || "";
  app.innerHTML = `
    <section class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="brand-mark">CA</div>
          <div>
            <h3>Controle Atacarejo</h3>
            <div class="muted">Gestão operacional</div>
          </div>
        </div>
        <div class="nav-title">Menu principal</div>
        <nav class="nav">
          ${groups.map((group) => `
            <div class="nav-group ${openGroup === group.id ? "open" : ""}">
              <button class="nav-group-title" type="button" data-nav-group="${group.id}">
                <span class="nav-icon" aria-hidden="true">${group.icon}</span>
                <span>${group.label}</span>
                <span class="nav-chevron" aria-hidden="true"></span>
              </button>
              <div class="nav-subitems">
                ${group.items.map(([id, label]) => `
                  <button class="${state.tab === id ? "active" : ""}" data-tab="${id}" data-tab-group="${group.id}">
                    <span class="nav-icon" aria-hidden="true">${tabIcon(id)}</span>
                    <span class="nav-label">${label}</span>
                  </button>
                `).join("")}
              </div>
            </div>
          `).join("")}
        </nav>
        <div class="sidebar-user">
          <div class="user-avatar">${escapeHtml(userInitial(state.user.display_name))}</div>
          <div class="user-info">
            <strong>${escapeHtml(state.user.display_name)}</strong>
            <span>${escapeHtml(roleLabel(state.user.role))}</span>
          </div>
        </div>
        <button class="btn danger logout-btn" id="logoutBtn">Sair</button>
      </aside>
      <section class="main">
        <div id="view"></div>
      </section>
    </section>
  `;
  document.querySelectorAll("[data-nav-group]").forEach((button) => {
    button.addEventListener("click", () => {
      state.openNavGroup = state.openNavGroup === button.dataset.navGroup ? "" : button.dataset.navGroup;
      renderShell();
    });
  });
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.tab = button.dataset.tab;
      state.openNavGroup = button.dataset.tabGroup || "";
      await refreshForTab();
      renderShell();
    });
  });
  document.getElementById("logoutBtn").addEventListener("click", () => logout());
  renderView();
}

function navGroups(tabs) {
  const tabMap = new Map(tabs);
  const tabOrder = new Map(tabs.map(([id], index) => [id, index]));
  const groupDefs = [
    {
      id: "prevention",
      label: "Prevenção",
      icon: "📈",
      tabs: ["dashboard", "checklist", "summary", "reports"],
    },
    {
      id: "reposition",
      label: "Reposição",
      icon: "📦",
      tabs: ["repoDashboard", "reposition", "repoGoals", "repoReports"],
    },
    {
      id: "commercial",
      label: "Comercial",
      icon: "💼",
      tabs: ["commercialDashboard", "commercial", "commercialAgenda"],
    },
    {
      id: "receiving",
      label: "Recebimento",
      icon: "🚚",
      tabs: ["receivingAgenda"],
    },
    {
      id: "management",
      label: "Gerencial",
      icon: "🔎",
      tabs: ["sectorAudit", "pendencies"],
    },
    {
      id: "admin",
      label: "Administração",
      icon: "⚙",
      tabs: [
        "managementIndicators", "managementStore", "managementDelivery",
        "managementQuotations", "managementSectors", "managementProductivity",
        "managementOperators",
        "collaborators", "users",
      ],
    },
  ];
  const used = new Set();
  const groups = groupDefs.map((group) => {
    const items = group.tabs.filter((id) => tabMap.has(id)).map((id) => {
      used.add(id);
      return [id, tabMap.get(id)];
    });
    const order = items.length ? Math.min(...items.map(([id]) => tabOrder.get(id) ?? 999)) : 999;
    return { ...group, items, order };
  }).filter((group) => group.items.length).sort((a, b) => a.order - b.order);
  const remaining = tabs.filter(([id]) => !used.has(id));
  if (remaining.length) groups.push({ id: "other", label: "Outros", icon: "•", items: remaining });
  return groups;
}

async function refreshForTab() {
  if (state.tab === "dashboard") await loadDashboard();
  if (state.tab === "repoDashboard" || state.tab === "commercialDashboard" || state.tab === "repoGoals") await Promise.all([loadCollaborators(), loadReposition()]);
  if (state.tab === "sectorAudit") await Promise.all([loadCollaborators(), loadSectorAudits()]);
  if (state.tab === "collaborators" || state.tab === "checklist" || state.tab === "pendencies") await loadCollaborators();
  if (state.tab === "reposition" || state.tab === "commercial") await Promise.all([loadCollaborators(), loadReposition()]);
  if (state.tab === "repoReports") await Promise.all([loadCollaborators(), loadReposition()]);
  if (state.tab === "commercialAgenda") await loadAgenda("comercial");
  if (state.tab === "receivingAgenda") await loadAgenda("recebimento");
  if (state.tab === "reports") await loadChecklists();
  if (state.tab === "pendencies") await loadPendencies();
  if (state.tab === "users") await Promise.all([loadUsers(), loadCollaborators()]);
  if (state.tab.startsWith("management")) await loadManagementIndicators();
}

function renderView() {
  const permittedTabs = new Set(allowedTabs().map(([id]) => id));
  if (!permittedTabs.has(state.tab)) state.tab = defaultTab();
  const map = {
    dashboard: renderDashboard,
    repoDashboard: renderRepoDashboard,
    commercialDashboard: renderCommercialDashboard,
    commercialAgenda: () => renderAgenda("comercial"),
    receivingAgenda: () => renderAgenda("recebimento"),
    checklist: renderChecklist,
    summary: renderSummary,
    reports: renderReports,
    repoReports: renderRepoReports,
    reposition: renderReposition,
    commercial: renderCommercial,
    repoGoals: renderRepoGoals,
    sectorAudit: renderSectorAudit,
    pendencies: renderPendencies,
    collaborators: renderCollaborators,
    users: renderUsers,
    managementIndicators: renderManagementIndicators,
    managementStore: renderManagementStore,
    managementDelivery: renderManagementDelivery,
    managementQuotations: renderManagementQuotations,
    managementSectors: renderManagementSectors,
    managementProductivity: renderManagementProductivity,
    managementOperators: renderManagementOperators,
  };
  map[state.tab]();
  bindMoneyInputs(app);
  fixVisibleText(app);
}

function allowedTabs() {
  if (state.user?.role === "reposicao") return [["repoDashboard", "Painel Reposi\u00e7\u00e3o"], ["reposition", "Reposi\u00e7\u00e3o"], ["repoReports", "Relatórios Reposição"]];
  if (state.user?.role === "recebimento") return [["receivingAgenda", "Agenda Recebimento"]];
  if (state.user?.role === "comercial") return [["commercialDashboard", "Painel Comercial"], ["commercial", "Comercial"], ["commercialAgenda", "Agenda Comercial"]];
  if (state.user?.role === "gerente") return [["sectorAudit", "Conferência Gerencial"], ["repoReports", "Relatórios Reposição"], ["pendencies", "Pendências"]];
  if (state.user?.role === "encarregada") {
    const tabs = [
      ["sectorAudit", "Conferência Gerencial"],
      ["repoGoals", "Metas Reposição"],
      ["commercialAgenda", "Agenda Comercial"],
      ["receivingAgenda", "Agenda Recebimento"],
      ["repoReports", "Relatórios Reposição"],
      ["reports", "Relatórios Prevenção"],
      ["pendencies", "Pendências"],
    ];
    if (canFillLaraOnlyActivities()) tabs.splice(1, 0, ["checklist", "Checklist"]);
    return tabs;
  }
  if (state.user?.role !== "administrador") {
    const tabs = [
      ["dashboard", "Painel PrevenÃ§Ã£o"],
      ["checklist", "Checklist"],
      ["reposition", "ReposiÃ§Ã£o"],
      ["pendencies", "PendÃªncias"],
    ];
    if (canAccessSummary()) tabs.splice(2, 0, ["summary", "Resumo"]);
    return tabs.filter(([id]) => id !== "reposition");
  }
  const tabs = [
    ["dashboard", "Painel PrevenÃ§Ã£o"],
    ["repoDashboard", "Painel Reposi\u00e7\u00e3o"],
    ["repoGoals", "Metas Reposição"],
    ["commercialDashboard", "Painel Comercial"],
    ["sectorAudit", "Confer\u00eancia Gerencial"],
    ["checklist", "Checklist"],
    ["reposition", "ReposiÃ§Ã£o"],
    ["commercial", "Comercial"],
    ["commercialAgenda", "Agenda Comercial"],
    ["receivingAgenda", "Agenda Recebimento"],
    ["repoReports", "Relatórios Reposição"],
    ["summary", "Resumo"],
    ["reports", "Relatórios Prevenção"],
    ["pendencies", "PendÃªncias"],
    ["collaborators", "Colaboradores"],
    ["managementIndicators", "Visao Geral"],
    ["managementStore", "Venda Loja"],
    ["managementDelivery", "Delivery"],
    ["managementQuotations", "Cotacoes"],
    ["managementSectors", "Perdas e Consumo"],
    ["managementProductivity", "Produtividade Setor"],
    ["managementOperators", "Operadores"],
  ];
  tabs.push(["users", "Acessos"]);
  return tabs;
}

function defaultTab() {
  if (state.user?.role === "reposicao") return "repoDashboard";
  if (state.user?.role === "recebimento") return "receivingAgenda";
  if (state.user?.role === "comercial") return "commercialDashboard";
  if (state.user?.role === "gerente") return "sectorAudit";
  if (state.user?.role === "encarregada") return "sectorAudit";
  return "dashboard";
}

async function loadCollaborators() {
  const data = await api("/api/collaborators");
  state.collaborators = data.rows;
}

async function loadDashboard() {
  const filters = state.dashboardFilters;
  let range;
  if (filters.mode === "month") {
    range = monthRange(filters.month);
  } else if (filters.mode === "period") {
    range = {
      startDate: filters.startDate || filters.date || todayInputValue(),
      endDate: filters.endDate || filters.startDate || filters.date || todayInputValue(),
    };
  } else {
    const date = filters.date || todayInputValue();
    range = { startDate: date, endDate: date };
  }
  const qs = new URLSearchParams(range);
  const data = await api(`/api/dashboard?${qs.toString()}`);
  state.dashboard = data;
}

async function loadChecklists(params = "") {
  const data = await api(`/api/checklists${params}`);
  state.checklists = data.rows;
}

async function loadPendencies() {
  const data = await api("/api/pendencies");
  state.pendencies = data.rows;
}

async function loadUsers() {
  const data = await api("/api/users");
  state.users = data.rows;
}

async function loadManagementIndicators() {
  const filters = state.management.filters;
  const qs = new URLSearchParams({
    period: filters.period,
    comparePeriod: filters.comparePeriod,
  });
  const entryQs = new URLSearchParams({
    period: filters.entryPeriod,
    comparePeriod: filters.entryPeriod,
  });
  [state.management.data, state.management.entryData] = await Promise.all([
    api(`/api/management-indicators?${qs.toString()}`),
    api(`/api/management-indicators?${entryQs.toString()}`),
  ]);
}

async function loadManagementEntryPeriod() {
  const period = state.management.filters.entryPeriod;
  const qs = new URLSearchParams({ period, comparePeriod: period });
  state.management.entryData = await api(`/api/management-indicators?${qs.toString()}`);
}

async function loadReposition() {
  const qs = new URLSearchParams(state.repo.filters);
  const [dashboard, tasks, ruptures, expirations] = await Promise.all([
    api(`/api/reposition/dashboard?${qs.toString()}`),
    api(`/api/reposition/tasks?${qs.toString()}`),
    api(`/api/reposition/ruptures?${qs.toString()}`),
    api(`/api/reposition/expirations?${qs.toString()}`),
  ]);
  const goals = ["gerente", "comercial"].includes(state.user?.role)
    ? { rows: [] }
    : await api("/api/reposition/goals");
  state.repo.dashboard = dashboard;
  state.repo.tasks = tasks.rows;
  state.repo.ruptures = ruptures.rows;
  state.repo.expirations = expirations.rows;
  state.repo.damages = [];
  state.repo.goals = goals.rows || [];
}

async function loadAgenda(type) {
  const qs = new URLSearchParams({
    type,
    startDate: state.agenda.filters.startDate,
    endDate: state.agenda.filters.endDate,
  });
  const data = await api(`/api/agenda?${qs.toString()}`);
  state.agenda.rows = data.rows || [];
}

async function loadSectorAudits() {
  const qs = new URLSearchParams(state.auditFilters);
  const data = await api(`/api/sector-audits?${qs.toString()}`);
  state.sectorAudits = data.rows || [];
  state.sectorAuditSummary = data.summary || { evaluatedByUser: 0, evaluatedTotal: 0 };
}

function renderDashboard() {
  const data = state.dashboard || {
    summary: {},
    totalsByDay: [],
    byCollaborator: [],
    collaboratorCompletion: [],
    activityCompletion: [],
    pendingToday: 0,
    expectedChecklistTotal: 0,
    completedChecklistTotal: 0,
  };
  const monthLabel = data.month?.label || "mÃªs atual";
  const completedChecklistTotal = Number(data.completedChecklistTotal || 0);
  const expectedChecklistTotal = Number(data.expectedChecklistTotal || 0);
  const checklistPercent = expectedChecklistTotal ? Math.round((completedChecklistTotal / expectedChecklistTotal) * 100) : 0;
  const metrics = [
    ["Checklists preenchidos", `${completedChecklistTotal}/${expectedChecklistTotal}`],
  ];
  const max = Math.max(...data.totalsByDay.map((row) => row.total), 1);
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Dashboard gerencial</h2>
        <div class="muted">Indicadores operacionais do perÃ­odo registrado e percentuais de ${escapeHtml(monthLabel)}</div>
      </div>
      <div class="toolbar">
        <button class="btn" id="exportDashboardPdf">PDF</button>
        <button class="btn" id="exportDashboardExcel">Excel</button>
        <button class="btn" id="refreshDashboard">Atualizar</button>
      </div>
    </div>
    <form class="panel grid" id="dashboardFilterForm" style="margin-bottom:14px">
      <div class="grid four">
        <label>Visualizar
          <select name="mode">
            <option value="day" ${state.dashboardFilters.mode === "day" ? "selected" : ""}>Dia</option>
            <option value="period" ${state.dashboardFilters.mode === "period" ? "selected" : ""}>PerÃ­odo</option>
            <option value="month" ${state.dashboardFilters.mode === "month" ? "selected" : ""}>MÃªs</option>
          </select>
        </label>
        <label data-dashboard-day>Data <input name="date" type="date" value="${escapeHtml(state.dashboardFilters.date)}"></label>
        <label data-dashboard-period>InÃ­cio <input name="startDate" type="date" value="${escapeHtml(state.dashboardFilters.startDate)}"></label>
        <label data-dashboard-period>Fim <input name="endDate" type="date" value="${escapeHtml(state.dashboardFilters.endDate)}"></label>
        <label data-dashboard-month>MÃªs <input name="month" type="month" value="${escapeHtml(state.dashboardFilters.month)}"></label>
      </div>
      <button class="btn primary" type="submit">Aplicar filtro</button>
    </form>
    <div class="metrics dashboard-summary">${metrics.map(([label, value]) => `<div class="metric"><span class="muted">${label}</span><strong>${value}</strong><small>${checklistPercent}% realizado no período</small></div>`).join("")}</div>
    <section class="panel" style="margin-top:14px">
        <h3>Total de checklists por dia</h3>
        <div class="mini-bars" style="margin-top:12px">
          ${data.totalsByDay.map((row) => `
            <div class="bar-row"><span>${fmtDate(row.date)}</span><div class="bar"><span style="width:${(row.total / max) * 100}%"></span></div><strong>${row.total}</strong></div>
          `).join("") || `<div class="muted">Sem registros.</div>`}
        </div>
    </section>
    <section class="panel" style="margin-top:14px">
      <h3>Engajamento por colaborador</h3>
      <div class="muted" style="margin-top:4px">ParticipaÃ§Ã£o nos preenchimentos do mÃªs, sem considerar perdas, consumos e vasilhames</div>
      <div class="table-wrap" style="margin-top:12px">
        <table><thead><tr><th>Colaborador</th><th>Preenchimentos</th><th>Engajamento</th></tr></thead><tbody>
          ${data.collaboratorCompletion.map((row) => `
            <tr>
              <td data-label="Colaborador">${escapeHtml(row.name)}</td>
              <td data-label="Preenchimentos">${row.total}</td>
              <td data-label="Engajamento">${percentBar(row.percent)}</td>
            </tr>
          `).join("") || `<tr><td colspan="3">Nenhum colaborador ativo.</td></tr>`}
        </tbody></table>
      </div>
    </section>
    <section class="panel" style="margin-top:14px">
      <h3>Percentual de realizaÃ§Ã£o das atividades</h3>
      <div class="muted" style="margin-top:4px">Meta: dias do mÃªs; conta o dia quando a atividade foi registrada ao menos uma vez</div>
      <div class="table-wrap" style="margin-top:12px">
        <table><thead><tr><th>Atividade</th><th>Realizado</th><th>Percentual</th></tr></thead><tbody>
          ${data.activityCompletion.map((row) => `
            <tr>
              <td data-label="Atividade">${escapeHtml(row.activity)}</td>
              <td data-label="Realizado">${row.total}/${row.expected}</td>
              <td data-label="Percentual">${percentBar(row.percent)}</td>
            </tr>
          `).join("") || `<tr><td colspan="3">Nenhuma atividade cadastrada.</td></tr>`}
        </tbody></table>
      </div>
    </section>
  `;
  document.getElementById("refreshDashboard").addEventListener("click", async () => {
    await loadDashboard();
    renderDashboard();
  });
  const dashboardFilterForm = document.getElementById("dashboardFilterForm");
  const syncDashboardMode = () => {
    const mode = dashboardFilterForm.mode.value;
    dashboardFilterForm.querySelectorAll("[data-dashboard-day]").forEach((item) => item.classList.toggle("hidden", mode !== "day"));
    dashboardFilterForm.querySelectorAll("[data-dashboard-period]").forEach((item) => item.classList.toggle("hidden", mode !== "period"));
    dashboardFilterForm.querySelectorAll("[data-dashboard-month]").forEach((item) => item.classList.toggle("hidden", mode !== "month"));
  };
  dashboardFilterForm.mode.addEventListener("change", syncDashboardMode);
  syncDashboardMode();
  dashboardFilterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.dashboardFilters = Object.fromEntries(new FormData(event.currentTarget).entries());
    await loadDashboard();
    renderDashboard();
  });
  document.getElementById("exportDashboardPdf").addEventListener("click", printDashboardReport);
  document.getElementById("exportDashboardExcel").addEventListener("click", exportDashboardCsv);
}

function percentBar(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return `
    <div class="percent-cell">
      <div class="bar"><span style="width:${value}%"></span></div>
      <strong>${value}%</strong>
    </div>
  `;
}

function exportDashboardCsv() {
  const data = state.dashboard || {};
  const lines = [
    ["RelatÃ³rio do painel", data.month?.label || ""],
    [],
    ["Indicador", "Valor"],
    ["Checklists preenchidos", `${data.completedChecklistTotal || 0}/${data.expectedChecklistTotal || 0}`],
    [],
    ["Engajamento por colaborador"],
    ["Colaborador", "Preenchimentos", "Percentual"],
    ...(data.collaboratorCompletion || []).map((row) => [row.name, row.total, `${row.percent}%`]),
    [],
    ["RealizaÃ§Ã£o das atividades"],
    ["Atividade", "Realizado", "Meta", "Percentual"],
    ...(data.activityCompletion || []).map((row) => [row.activity, row.total, row.expected, `${row.percent}%`]),
  ];
  const csv = lines.map((line) => line.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "relatorio-painel.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function printDashboardReport() {
  window.print();
}

function downloadCsv(filename, lines) {
  const csv = lines.map((line) => line.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportRepoPanelCsv(kind) {
  const data = state.repo.dashboard || { summary: {}, bySector: [] };
  const summary = data.summary || {};
  const period = `${fmtDate(state.repo.filters.startDate)} a ${fmtDate(state.repo.filters.endDate)}`;
  if (kind === "comercial") {
    const total = Number(summary.ruptures || 0) + Number(summary.expirations || 0);
    const done = Number(summary.rupturesPurchased || 0) + Number(summary.expirationsActioned || 0);
    return downloadCsv("painel-comercial.csv", [
      ["Painel Comercial", period],
      [],
      ["Resumo", "Valor"],
      ["Retornos comerciais", `${done}/${total}`],
      ["Rupturas", summary.ruptures || 0],
      ["Validades", summary.expirations || 0],
      [],
      ["Itens identificados por setor"],
      ["Setor", "Itens identificados", "Rupturas", "Validades"],
      ...commercialSectorRows().map((row) => [row.sector, row.total, row.ruptures, row.expirations]),
      [],
      ["Engajamento dos compradores"],
      ["Usuário", "Registros", "Percentual"],
      ...(data.commercialUserEngagement || []).map((row) => [row.name, row.total, `${row.percent}%`]),
    ]);
  }
  return downloadCsv("painel-reposicao.csv", [
    ["Painel Reposição", period],
    [],
    ["Resumo", "Valor"],
    ["Atividades realizadas", `${summary.completed || 0}/${summary.taskTotal || 0}`],
    [],
    ["Itens identificados por setor"],
    ["Setor", "Itens identificados", "Rupturas", "Validades"],
    ...(data.bySector || []).map((row) => [
      row.sector,
      Number(row.ruptures || 0) + Number(row.expirations || 0),
      row.ruptures || 0,
      row.expirations || 0,
    ]),
    [],
    ["Engajamento da reposição"],
    ["Usuário", "Registros", "Percentual"],
    ...(data.repoUserEngagement || []).map((row) => [row.name, row.total, `${row.percent}%`]),
    [],
    ["Realização das atividades"],
    ["Atividade", "Realizado", "Meta", "Percentual"],
    ...(data.repoActivityCompletion || []).map((row) => [row.activity, row.total, row.expected, `${row.percent}%`]),
  ]);
}

function collaboratorOptions(activeOnly = true) {
  return state.collaborators
    .filter((item) => !activeOnly || item.status === "ativo")
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)} - ${escapeHtml(item.role)}</option>`)
    .join("");
}

function preventionCollaboratorOptions(activeOnly = true) {
  const repo = new Set((state.repo.repoCollaboratorIds || []).map((id) => Number(id)));
  const commercial = new Set((state.repo.commercialCollaboratorIds || []).map((id) => Number(id)));
  return state.collaborators
    .filter((item) => (
      (!activeOnly || item.status === "ativo")
      && !repo.has(Number(item.id))
      && !commercial.has(Number(item.id))
      && !isCommercialCollaborator(item)
      && isPreventionCollaborator(item)
    ))
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)} - ${escapeHtml(item.role)}</option>`)
    .join("");
}

function repoCollaboratorOptions() {
  const allowed = new Set((state.repo.repoCollaboratorIds || []).map((id) => Number(id)));
  const commercial = new Set((state.repo.commercialCollaboratorIds || []).map((id) => Number(id)));
  const rows = state.collaborators.filter((item) => (
    item.status === "ativo"
    && !commercial.has(Number(item.id))
    && !isCommercialCollaborator(item)
    && (allowed.has(Number(item.id)) || collaboratorSectors(item).length > 0)
  ));
  if (!rows.length) return `<option value="">Cadastre e vincule usuÃ¡rios de reposiÃ§Ã£o</option>`;
  return rows
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)} - ${escapeHtml(item.role)}</option>`)
    .join("");
}

function isCommercialCollaborator(collaborator) {
  const role = normalizedRole(collaborator);
  return role.includes("comprador") || role.includes("compradora") || role.includes("comercial");
}

function isPreventionCollaborator(collaborator) {
  const role = normalizedRole(collaborator);
  const preventionTerms = ["prevencao", "perdas", "fiscal"];
  const repositionTerms = [
    "comprador",
    "compradora",
    "comercial",
    "reposicao",
    "mercearia",
    "frios",
    "perfumaria",
    "acougue",
    "flv",
    "bazar",
    "bebidas",
    "limpeza",
    "padaria",
    "pereciveis",
  ];
  return preventionTerms.some((term) => role.includes(term)) && !repositionTerms.some((term) => role.includes(term));
}

function normalizedRole(collaborator) {
  return normalizeText(collaborator?.role || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function collaboratorSectors(collaborator) {
  const value = collaborator?.sector || "";
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => normalizeText(item).trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => normalizeText(item).trim()).filter(Boolean);
  } catch (error) {
    // Mantem compatibilidade com cadastros antigos que tinham apenas um setor em texto.
  }
  return String(value).split("||").map((item) => normalizeText(item).trim()).filter(Boolean);
}

function displayCollaboratorSectors(collaborator) {
  const sectors = collaboratorSectors(collaborator);
  return sectors.length ? sectors.join(", ") : "-";
}

function collaboratorSectorCheckboxes(selected = []) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : [selected].filter(Boolean));
  return (state.repo.sectors || []).map((sector) => `
    <label class="check-option">
      <input type="checkbox" name="sector" value="${escapeHtml(sector)}" ${selectedSet.has(sector) ? "checked" : ""}>
      <span>${escapeHtml(sector)}</span>
    </label>
  `).join("");
}

function repoTaskSectorOptions(collaborator) {
  const assigned = collaboratorSectors(collaborator);
  if (
    state.user?.role === "reposicao"
    && collaborator
    && Number(collaborator.id) === Number(state.user.collaborator_id)
  ) {
    return assigned.length ? repoOptions(assigned) : `<option value="">Nenhum setor atribuido</option>`;
  }
  const sectors = assigned.length ? assigned : state.repo.sectors;
  return repoOptions(sectors || []);
}

function repoSectorsForCurrentUser() {
  if (state.user?.role !== "reposicao" || !state.user?.collaborator_id) return state.repo.sectors || [];
  const collaborator = state.collaborators.find((item) => Number(item.id) === Number(state.user.collaborator_id));
  const assigned = collaboratorSectors(collaborator);
  return assigned;
}

function repoSectorOptionsForCurrentUser() {
  const sectors = repoSectorsForCurrentUser();
  if (state.user?.role === "reposicao" && !sectors.length) return `<option value="">Nenhum setor atribuido</option>`;
  return repoOptions(sectors);
}

function activityNeedsProductSector(activity) {
  const normalized = normalizeText(activity)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized === normalizeText(PRICE_DIVERGENCE_ACTIVITY).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()) return true;
  return SECTOR_REQUIRED_ACTIVITY_TERMS.some((term) => normalized.includes(term));
}

function checklistNeedsPhoto(activity) {
  const normalized = normalizeText(activity)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return PHOTO_REQUIRED_ACTIVITY_TERMS.some((term) => normalized.includes(term));
}

function renderChecklist() {
  const availableActivities = checklistActivitiesForUser();
  const linkedCollaborator = state.user?.collaborator_id
    ? state.collaborators.find((item) => Number(item.id) === Number(state.user.collaborator_id))
    : null;
  const collaboratorField = linkedCollaborator
    ? `
      <label>Colaborador
        <input value="${escapeHtml(linkedCollaborator.name)} - ${escapeHtml(linkedCollaborator.role)}" disabled>
        <input type="hidden" name="collaboratorId" value="${linkedCollaborator.id}">
      </label>
    `
    : `
      <label>Colaborador
        <select name="collaboratorId" required>${preventionCollaboratorOptions()}</select>
      </label>
    `;
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Checklist diÃ¡rio</h2>
        <div class="muted">${linkedCollaborator ? "Acesso vinculado ao seu cadastro" : "Data e horÃ¡rio sÃ£o registrados automaticamente no envio"}</div>
      </div>
    </div>
    <form class="panel grid" id="checklistForm">
      <div class="grid two">
        ${collaboratorField}
        <label>Atividade
          <select name="activity" required>${availableActivities.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}</select>
        </label>
      </div>
      <div class="grid two">
        <label>Sim / NÃ£o
          <select name="answer" required><option>Sim</option><option>NÃ£o</option></select>
        </label>
        <label data-price-divergence-field>Produtos com divergÃªncia de preÃ§os <textarea name="priceDivergenceProducts"></textarea></label>
      </div>
      <label data-expired-products-field>Produtos vencidos encontrados <textarea name="expiredProducts"></textarea></label>
      <label data-product-sector-field>Setor do produto
        <select name="sector">${repoOptions(state.repo.sectors || [])}</select>
      </label>
      <label data-checklist-photo-field>Foto da conferencia
        <input name="photoFile" type="file" accept="image/*" capture="environment">
        <span class="field-help">Use para acompanhamento de cotacoes e conferencia de precificacao.</span>
      </label>
      <label>ObservaÃ§Ã£o
        <textarea name="observation"></textarea>
      </label>
      <button class="btn primary" type="submit">Enviar checklist</button>
    </form>
    <form class="panel grid general-store-observation" id="generalStoreObservationForm">
      <div>
        <h3>Observação geral da loja</h3>
        <div class="muted">Registre situações da loja, estoque, estrutura ou qualquer ponto que precise ficar documentado.</div>
      </div>
      <div class="grid two">
        ${linkedCollaborator
          ? `<label>Colaborador
              <input value="${escapeHtml(linkedCollaborator.name)} - ${escapeHtml(linkedCollaborator.role)}" disabled>
              <input type="hidden" name="collaboratorId" value="${linkedCollaborator.id}">
            </label>`
          : `<label>Colaborador
              <select name="collaboratorId" required>${preventionCollaboratorOptions()}</select>
            </label>`}
        <label>Assunto
          <select name="category" required>
            <option>Loja em geral</option>
            <option>Estoque</option>
            <option>Situação operacional</option>
            <option>Estrutura e manutenção</option>
            <option>Outros</option>
          </select>
        </label>
      </div>
      <label>Descrição
        <textarea name="description" required placeholder="Descreva o que foi observado, onde ocorreu e qualquer ação necessária."></textarea>
      </label>
      <button class="btn primary" type="submit">Registrar observação</button>
    </form>
  `;
  const checklistForm = document.getElementById("checklistForm");
  const activitySelect = checklistForm.elements.activity;
  const priceField = checklistForm.querySelector("[data-price-divergence-field]");
  const expiredField = checklistForm.querySelector("[data-expired-products-field]");
  const sectorField = checklistForm.querySelector("[data-product-sector-field]");
  const photoField = checklistForm.querySelector("[data-checklist-photo-field]");
  const syncChecklistSpecificFields = () => {
    const activity = activitySelect.value;
    const showPrice = activity === PRICE_DIVERGENCE_ACTIVITY;
    const showExpired = activity === EXPIRED_PRODUCTS_ACTIVITY;
    const showSector = activityNeedsProductSector(activity);
    const showPhoto = checklistNeedsPhoto(activity);
    priceField.hidden = !showPrice;
    expiredField.hidden = !showExpired;
    sectorField.hidden = !showSector;
    photoField.hidden = !showPhoto;
    priceField.classList.toggle("hidden", !showPrice);
    expiredField.classList.toggle("hidden", !showExpired);
    sectorField.classList.toggle("hidden", !showSector);
    photoField.classList.toggle("hidden", !showPhoto);
    checklistForm.elements.sector.required = showSector;
    if (!showPrice) checklistForm.elements.priceDivergenceProducts.value = "";
    if (!showExpired) checklistForm.elements.expiredProducts.value = "";
    if (!showSector) checklistForm.elements.sector.value = "";
    if (!showPhoto) checklistForm.elements.photoFile.value = "";
  };
  activitySelect.addEventListener("change", syncChecklistSpecificFields);
  syncChecklistSpecificFields();
  checklistForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    delete body.photoFile;
    const photoFile = form.elements.photoFile?.files?.[0];
    if (photoFile) {
      if (photoFile.size > 8 * 1024 * 1024) {
        toast("Foto muito grande. Envie uma imagem de ate 8 MB.");
        return;
      }
      body.photoName = photoFile.name;
      body.photoDataUrl = await fileToDataUrl(photoFile);
    }
    await api("/api/checklists", { method: "POST", body: JSON.stringify(body) });
    form.reset();
    syncChecklistSpecificFields();
    toast("Checklist enviado com data e hora registradas.");
  });
  const generalObservationForm = document.getElementById("generalStoreObservationForm");
  generalObservationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    await api("/api/checklists", {
      method: "POST",
      body: JSON.stringify({
        collaboratorId: values.collaboratorId,
        activity: "Observação geral da loja",
        answer: "Sim",
        observation: `${values.category}: ${values.description}`,
      }),
    });
    form.elements.category.value = "Loja em geral";
    form.elements.description.value = "";
    toast("Observação geral registrada.");
  });
}

function renderSummary() {
  const summaryLocked = !canFillEncarregadaOnly();
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Resumo operacional diÃ¡rio</h2>
        <div class="muted">ConsolidaÃ§Ã£o do dia para acompanhamento gerencial</div>
      </div>
    </div>
    ${summaryLocked ? `<div class="panel muted" style="margin-bottom:14px">Somente a encarregada pode preencher, alterar ou excluir o resumo operacional.</div>` : ""}
    <form class="panel grid" id="summaryForm">
      <div class="grid two">
        <label>Data do resumo <input name="date" type="date" required value="${todayInputValue()}"></label>
        <label>Contagem de vasilhames do dia <input name="bottlesCount" type="number" min="0"></label>
      </div>
      <label>Qual vasilhame
        <textarea name="bottlesDetails" placeholder="Ex.: garrafa 1L, garrafa 2L, caixas, engradados"></textarea>
      </label>
      <div class="grid two">
        <label>OcorrÃªncias identificadas <textarea name="occurrences"></textarea></label>
        <label>AÃ§Ãµes corretivas realizadas <textarea name="correctiveActions"></textarea></label>
      </div>
      <div class="toolbar">
        <button class="btn primary" type="submit" ${summaryLocked ? "disabled" : ""}>Salvar / corrigir resumo</button>
        <button class="btn" type="button" id="loadSummary">Carregar data</button>
        <button class="btn danger" type="button" id="deleteSummary" ${summaryLocked ? "disabled" : ""}>Excluir resumo da data</button>
      </div>
    </form>
    <div class="table-wrap" style="margin-top:14px" id="summaryTable"></div>
  `;
  const form = document.getElementById("summaryForm");
  if (summaryLocked) {
    ["bottlesCount", "bottlesDetails", "occurrences", "correctiveActions"].forEach((name) => {
      form.elements[name].disabled = true;
    });
  }
  const clearSummaryFields = () => {
    form.bottlesCount.value = "";
    form.bottlesDetails.value = "";
    form.occurrences.value = "";
    form.correctiveActions.value = "";
  };
  const fillSummaryForm = (row) => {
    clearSummaryFields();
    if (!row) return;
    form.date.value = row.date || form.date.value;
    form.bottlesCount.value = row.bottles_count ?? "";
    form.bottlesDetails.value = row.bottles_details || "";
    form.occurrences.value = row.occurrences || "";
    form.correctiveActions.value = row.corrective_actions || "";
  };
  const loadSummaryForDate = async () => {
    const data = await api(`/api/summary?date=${encodeURIComponent(form.date.value)}`);
    fillSummaryForm(data.row);
    toast(data.row ? "Resumo carregado para ediÃ§Ã£o." : "Nenhum resumo encontrado para essa data.");
  };
  const refreshSummaryTable = async () => {
    const data = await api("/api/summaries");
    document.getElementById("summaryTable").innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Vasilhames</th>
            <th>Qual vasilhame</th>
            <th>AÃ§Ãµes</th>
          </tr>
        </thead>
        <tbody>
          ${data.rows.map((row) => `
            <tr>
              <td data-label="Data">${fmtDate(row.date)}</td>
              <td data-label="Vasilhames">${row.bottles_count || 0}</td>
              <td data-label="Qual vasilhame">${escapeHtml(row.bottles_details || "")}</td>
              <td data-label="AÃ§Ãµes">
                <div class="toolbar">
                  <button class="btn" type="button" data-edit-summary="${row.date}">Editar</button>
                  ${canFillEncarregadaOnly() ? `<button class="btn danger" type="button" data-delete-summary="${row.date}">Excluir</button>` : ""}
                </div>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="4">Nenhum resumo lanÃ§ado.</td></tr>`}
        </tbody>
      </table>
    `;
    document.querySelectorAll("[data-edit-summary]").forEach((button) => {
      button.addEventListener("click", async () => {
        form.date.value = button.dataset.editSummary;
        await loadSummaryForDate();
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    document.querySelectorAll("[data-delete-summary]").forEach((button) => {
      button.addEventListener("click", async () => {
        const date = button.dataset.deleteSummary;
        const confirmed = confirm(`Excluir o resumo operacional de ${fmtDate(date)}?`);
        if (!confirmed) return;
        const result = await api(`/api/summary?date=${encodeURIComponent(date)}`, { method: "DELETE" });
        if (form.date.value === date) clearSummaryFields();
        await loadDashboard();
        await refreshSummaryTable();
        toast(result.message || "Resumo excluÃ­do.");
      });
    });
  };
  form.date.addEventListener("change", loadSummaryForDate);
  document.getElementById("loadSummary").addEventListener("click", loadSummaryForDate);
  document.getElementById("deleteSummary").addEventListener("click", async () => {
    const confirmed = confirm(`Excluir o resumo operacional de ${fmtDate(form.date.value)}?`);
    if (!confirmed) return;
    const result = await api(`/api/summary?date=${encodeURIComponent(form.date.value)}`, { method: "DELETE" });
    clearSummaryFields();
    await loadDashboard();
    await refreshSummaryTable();
    toast(result.message || "Resumo excluÃ­do.");
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    await api("/api/summary", { method: "POST", body: JSON.stringify(body) });
    await loadDashboard();
    await refreshSummaryTable();
    toast("Resumo operacional salvo.");
  });
  loadSummaryForDate();
  refreshSummaryTable();
}

function reportFiltersHtml() {
  return `
    <div class="grid four">
      <label>Data <input name="date" type="date"></label>
      <label>InÃ­cio <input name="startDate" type="date"></label>
      <label>Fim <input name="endDate" type="date"></label>
      <label>Colaborador <select name="collaboratorId"><option value="">Todos</option>${preventionCollaboratorOptions(false)}</select></label>
    </div>
    <div class="grid two">
      <label>Atividade <select name="activity"><option value="">Todas</option>${state.activities.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}</select></label>
      <label>Setor <select name="sector"><option value="">Todos</option>${repoOptions(state.repo.sectors || [])}</select></label>
    </div>
  `;
}

function renderReports() {
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Relatórios Prevenção</h2>
        <div class="muted">Filtros por data, colaborador, perÃ­odo e atividade</div>
      </div>
      <div class="toolbar">
        <button class="btn" id="exportPdf">PDF</button>
        <button class="btn" id="exportExcel">Excel</button>
      </div>
    </div>
    <form class="panel grid" id="filterForm">${reportFiltersHtml()}<button class="btn primary" type="submit">Filtrar</button></form>
    <div class="table-wrap" style="margin-top:14px" id="reportTable"></div>
  `;
  const form = document.getElementById("filterForm");
  const refresh = async () => {
    const qs = new URLSearchParams(Object.fromEntries(new FormData(form).entries()));
    await loadChecklists(`?${qs.toString()}`);
    drawReportTable();
    return qs;
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await refresh();
  });
  document.getElementById("exportPdf").addEventListener("click", async () => exportReport("pdf", form));
  document.getElementById("exportExcel").addEventListener("click", async () => exportReport("excel", form));
  refresh();
}

function checklistProductDetails(row) {
  if (row.activity === PRICE_DIVERGENCE_ACTIVITY) return row.price_divergence_products || "";
  if (row.activity === EXPIRED_PRODUCTS_ACTIVITY) return row.expired_products || "";
  return "";
}

function drawReportTable() {
  const showActions = state.checklists.some((row) => canEditChecklist(row) || canDeleteChecklist());
  document.getElementById("reportTable").innerHTML = `
    <table><thead><tr><th>Data</th><th>Colaborador</th><th>Atividade</th><th>Setor</th><th>Produtos identificados</th><th>Foto</th><th>Resposta</th><th>ObservaÃ§Ã£o</th><th>Enviado em</th>${showActions ? "<th>AÃ§Ãµes</th>" : ""}</tr></thead><tbody>
      ${state.checklists.map((row) => `
        <tr>
          <td data-label="Data">${fmtDate(row.date)}</td>
          <td data-label="Colaborador">${escapeHtml(row.collaborator)}</td>
          <td data-label="Atividade">${escapeHtml(row.activity)}</td>
          <td data-label="Setor">${escapeHtml(row.sector || "-")}</td>
          <td data-label="Produtos identificados">${escapeHtml(checklistProductDetails(row) || "-")}</td>
          <td data-label="Foto">${row.photo_path ? `<a class="report-photo" href="${escapeHtml(row.photo_path)}" target="_blank" rel="noopener"><img src="${escapeHtml(row.photo_path)}" alt="Foto do checklist"></a>` : "-"}</td>
          <td data-label="Resposta"><span class="status ${row.answer === "Sim" ? "ok" : "danger"}">${row.answer}</span></td>
          <td data-label="ObservaÃ§Ã£o">${escapeHtml(row.observation || "")}</td>
          <td data-label="Enviado em">${new Date(row.sent_at).toLocaleString("pt-BR")}</td>
          ${showActions ? `
            <td data-label="AÃ§Ãµes">
              <div class="toolbar">
                ${canEditChecklist(row) ? `<button class="btn" type="button" data-edit-checklist="${row.id}">Editar</button>` : ""}
                ${canDeleteChecklist() ? `<button class="btn danger" type="button" data-delete-checklist="${row.id}">Excluir</button>` : ""}
              </div>
            </td>
          ` : ""}
        </tr>
      `).join("") || `<tr><td colspan="${showActions ? 10 : 9}">Nenhum registro encontrado.</td></tr>`}
    </tbody></table>
  `;
  document.querySelectorAll("[data-edit-checklist]").forEach((button) => {
    button.addEventListener("click", () => editChecklist(Number(button.dataset.editChecklist)));
  });
  document.querySelectorAll("[data-delete-checklist]").forEach((button) => {
    button.addEventListener("click", () => deleteChecklist(Number(button.dataset.deleteChecklist)));
  });
}

async function exportReport(format, form) {
  const qs = new URLSearchParams(Object.fromEntries(new FormData(form).entries()));
  qs.set("format", format);
  const response = await fetch(`/api/reports/export?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = format === "pdf" ? "relatorio-prevencao-perdas.pdf" : "relatorio-prevencao-perdas.xls";
  a.click();
  URL.revokeObjectURL(url);
}

function renderRepoReports() {
  const scopedSectors = repoSectorsForCurrentUser();
  const isRepoUser = state.user?.role === "reposicao";
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Relatórios Reposição</h2>
        <div class="muted">Checklists, rupturas e validades registradas pela reposição</div>
      </div>
      <button class="btn" id="refreshRepoReports">Atualizar</button>
    </div>
    <form class="panel grid" id="repoReportsFilterForm">
      <div class="grid three">
        <label>Início <input name="startDate" type="date" value="${escapeHtml(state.repo.filters.startDate)}"></label>
        <label>Fim <input name="endDate" type="date" value="${escapeHtml(state.repo.filters.endDate)}"></label>
        <label>Setor <select name="sector"><option value="">Todos</option>${repoOptions(scopedSectors || [])}</select></label>
      </div>
      <div class="grid two">
        ${isRepoUser ? `<input type="hidden" name="collaborator" value="">` : `<label>Colaborador <select name="collaborator"><option value="">Todos</option>${repoCollaboratorReportOptions()}</select></label>`}
        <label>Atividade <select name="activity"><option value="">Todas</option>${repoOptions(["Checklist", "Ruptura", "Verificacao de validades", ...(state.repo.activities || [])])}</select></label>
      </div>
      <button class="btn primary" type="submit">Filtrar</button>
    </form>
    <section class="panel" style="margin-top:14px">
      <h3>Registros da reposição</h3>
      <div class="table-wrap" style="margin-top:12px" id="repoReportTable"></div>
    </section>
  `;
  const form = document.getElementById("repoReportsFilterForm");
  const draw = () => drawRepoReportTable({
    sector: form.elements.sector.value,
    collaborator: form.elements.collaborator.value,
    activity: form.elements.activity.value,
  });
  document.getElementById("refreshRepoReports").addEventListener("click", async () => {
    await loadReposition();
    renderRepoReports();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.repo.filters = {
      startDate: form.elements.startDate.value,
      endDate: form.elements.endDate.value,
    };
    await loadReposition();
    draw();
  });
  draw();
  fixVisibleText(view);
}

function repoCollaboratorReportOptions() {
  const names = Array.from(new Set((state.repo.tasks || []).map((row) => row.collaborator).filter(Boolean))).sort();
  return names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
}

function repoReportRows(filters = {}) {
  const allowedSectors = state.user?.role === "reposicao" ? repoSectorsForCurrentUser() : [];
  const allowedSet = new Set(allowedSectors);
  const tasks = (state.repo.tasks || []).map((row) => ({
    date: row.date,
    type: "Checklist",
    sector: row.sector,
    collaborator: row.collaborator || "",
    activity: row.activity,
    product: "",
    detail: row.status === "Realizado" ? "Sim" : "Nao",
    quantity: "",
    observation: row.observation || "",
    sentAt: row.sent_at,
  }));
  const ruptures = (state.repo.ruptures || []).map((row) => ({
    date: row.date,
    type: "Ruptura",
    sector: row.sector,
    collaborator: "",
    activity: "Ruptura",
    product: row.product || "",
    detail: row.type || "",
    quantity: row.quantity || "",
    observation: row.observation || "",
    sentAt: row.sent_at,
  }));
  const expirations = (state.repo.expirations || []).map((row) => ({
    date: row.date,
    type: "Validade",
    sector: row.sector,
    collaborator: "",
    activity: "Verificacao de validades",
    product: row.product || "",
    detail: row.expiration_date ? `Validade: ${fmtDate(row.expiration_date)}` : "",
    quantity: row.quantity || "",
    observation: row.observation || "",
    sentAt: row.sent_at,
  }));
  return [...tasks, ...ruptures, ...expirations]
    .filter((row) => state.user?.role !== "reposicao" || allowedSet.has(row.sector))
    .filter((row) => !filters.sector || row.sector === filters.sector)
    .filter((row) => !filters.collaborator || row.collaborator === filters.collaborator)
    .filter((row) => {
      if (!filters.activity) return true;
      const selected = withoutAccents(filters.activity).toLowerCase();
      const activity = withoutAccents(row.activity || "").toLowerCase();
      const type = withoutAccents(row.type || "").toLowerCase();
      if (selected === "checklist") return type === "checklist";
      if (selected.includes("ruptura")) return activity.includes("ruptura") || type.includes("ruptura");
      if (selected.includes("validade")) return activity.includes("validade") || type.includes("validade");
      return activity === selected;
    })
    .sort((a, b) => String(b.sentAt || b.date).localeCompare(String(a.sentAt || a.date)));
}

function drawRepoReportTable(filters = {}) {
  const rows = repoReportRows(filters);
  document.getElementById("repoReportTable").innerHTML = `
    <table><thead><tr><th>Data</th><th>Tipo</th><th>Setor</th><th>Colaborador</th><th>Atividade</th><th>Produto</th><th>Detalhe</th><th>Quantidade</th><th>Observação</th><th>Enviado em</th></tr></thead><tbody>
      ${rows.map((row) => `<tr>
        <td data-label="Data">${fmtDate(row.date)}</td>
        <td data-label="Tipo">${escapeHtml(row.type)}</td>
        <td data-label="Setor">${escapeHtml(row.sector || "-")}</td>
        <td data-label="Colaborador">${escapeHtml(row.collaborator || "-")}</td>
        <td data-label="Atividade">${escapeHtml(row.activity || "-")}</td>
        <td data-label="Produto">${escapeHtml(row.product || "-")}</td>
        <td data-label="Detalhe">${escapeHtml(row.detail || "-")}</td>
        <td data-label="Quantidade">${escapeHtml(row.quantity || "-")}</td>
        <td data-label="Observação">${escapeHtml(row.observation || "-")}</td>
        <td data-label="Enviado em">${row.sentAt ? new Date(row.sentAt).toLocaleString("pt-BR") : "-"}</td>
      </tr>`).join("") || `<tr><td colspan="10">Nenhum registro encontrado.</td></tr>`}
    </tbody></table>
  `;
}

function editChecklist(id) {
  const row = state.checklists.find((item) => item.id === id);
  const answer = prompt("Resposta corrigida: Sim ou NÃ£o", row.answer);
  if (!answer) return;
  const observation = prompt("ObservaÃ§Ã£o corrigida", row.observation || "") || "";
  const priceDivergenceProducts = row.activity === PRICE_DIVERGENCE_ACTIVITY
    ? prompt("Produtos com divergÃªncia de preÃ§os", row.price_divergence_products || "") || ""
    : "";
  const expiredProducts = row.activity === EXPIRED_PRODUCTS_ACTIVITY
    ? prompt("Produtos vencidos encontrados", row.expired_products || "") || ""
    : "";
  const sector = activityNeedsProductSector(row.activity)
    ? prompt("Setor do produto", row.sector || "") || ""
    : "";
  api(`/api/checklists/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      collaboratorId: row.collaborator_id,
      activity: row.activity,
      answer,
      observation,
      sector,
      priceDivergenceProducts,
      expiredProducts,
    }),
  }).then(async () => {
    await loadChecklists();
    drawReportTable();
    toast("Registro corrigido.");
  });
}

async function deleteChecklist(id) {
  const row = state.checklists.find((item) => item.id === id);
  if (!row) return;
  const confirmed = confirm(`Excluir o preenchimento "${row.activity}" de ${row.collaborator}?`);
  if (!confirmed) return;
  const result = await api(`/api/checklists/${id}`, { method: "DELETE" });
  await loadChecklists();
  drawReportTable();
  await loadDashboard();
  toast(result.message || "Preenchimento excluÃ­do.");
}

function repoOptions(items, selected = "") {
  return items.map((item) => `<option value="${escapeHtml(item)}" ${item === selected ? "selected" : ""}>${escapeHtml(withoutAccents(item))}</option>`).join("");
}

function agendaLabel(type) {
  return type === "recebimento" ? "Agenda Recebimento" : "Agenda Comercial";
}

function agendaPublicPath(type) {
  return type === "recebimento" ? "/agendar/recebimento" : "/agendar/comercial";
}

async function renderPublicAgenda() {
  const type = publicAgendaType();
  const label = agendaLabel(type);
  if (type === "recebimento") {
    app.innerHTML = `
      <section class="login-screen">
        <div class="login-panel">
          <div class="brand">
            <div class="brand-mark">CA</div>
            <div>
              <h1>Agenda Recebimento</h1>
              <div class="muted">O recebimento e controlado internamente pela loja.</div>
            </div>
          </div>
          <p class="muted">Para agendar uma entrega, entre em contato com a equipe do recebimento.</p>
        </div>
      </section>
    `;
    fixVisibleText(app);
    return;
  }
  try {
    const data = await api(`/api/public/agenda?type=${type}`);
    state.agenda.publicRows = data.rows || [];
  } catch (error) {
    state.agenda.publicRows = [];
  }
  app.innerHTML = `
    <section class="login-screen">
      <form class="login-panel" id="publicAgendaForm">
        <div class="brand">
          <div class="brand-mark">CA</div>
          <div>
            <h1>${label}</h1>
            <div class="muted">Escolha uma data e horario disponivel</div>
          </div>
        </div>
        <label>Horario
          <select name="slotId" required>
            ${state.agenda.publicRows.map((row) => `<option value="${row.id}">${fmtDate(row.date)} - ${escapeHtml(row.start_time)} as ${escapeHtml(row.end_time)}</option>`).join("") || `<option value="">Nenhum horario disponivel</option>`}
          </select>
        </label>
        <label>Nome <input name="name" required autocomplete="name"></label>
        <label>Empresa / fornecedor <input name="company" required></label>
        <label>Telefone <input name="phone" required autocomplete="tel"></label>
        <label>${type === "recebimento" ? "NF / pedido / placa" : "Assunto"} <input name="document"></label>
        <label>Observacao <textarea name="observation"></textarea></label>
        <button class="btn primary" type="submit" ${state.agenda.publicRows.length ? "" : "disabled"}>Confirmar agendamento</button>
      </form>
    </section>
  `;
  document.getElementById("publicAgendaForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/public/agenda/book", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())),
    });
    app.innerHTML = `
      <section class="login-screen">
        <div class="login-panel">
          <div class="brand">
            <div class="brand-mark">CA</div>
            <div>
              <h1>Agendamento confirmado</h1>
              <div class="muted">Seu horario foi reservado com sucesso.</div>
            </div>
          </div>
        </div>
      </section>
    `;
    fixVisibleText(app);
  });
  fixVisibleText(app);
}

function renderAgenda(type) {
  const label = agendaLabel(type);
  const isReceiving = type === "recebimento";
  const publicLink = `${window.location.origin}${agendaPublicPath(type)}`;
  const statusOptions = type === "recebimento"
    ? ["Disponivel", "Agendado", "Recebido", "Atrasado", "Cancelado"]
    : ["Disponivel", "Agendado", "Atendido", "Cancelado"];
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>${label}</h2>
        <div class="muted">${isReceiving ? "Controle interno de entregas agendadas" : "Organize horarios e envie o link para vendedores"}</div>
      </div>
      <button class="btn" type="button" id="refreshAgenda">Atualizar</button>
    </div>
    ${isReceiving ? "" : `<section class="panel agenda-share">
      <div>
        <h3>Link para enviar</h3>
        <div class="muted" style="margin-top:4px">Envie este link pelo WhatsApp para o vendedor escolher um horario disponivel.</div>
        <div class="agenda-link">${escapeHtml(publicLink)}</div>
      </div>
      <div class="toolbar">
        <button class="btn primary" type="button" id="copyAgendaLink">Copiar link</button>
        <button class="btn" type="button" id="openAgendaLink">Abrir link</button>
      </div>
    </section>`}
    <div class="grid two" style="margin-top:14px">
      <form class="panel grid" id="agendaForm">
        <h3>${isReceiving ? "Novo recebimento agendado" : "Novo horario disponivel"}</h3>
        ${isReceiving ? "" : `
          <div class="agenda-mode" role="group" aria-label="Tipo de cadastro">
            <button class="active" type="button" data-agenda-mode="available">Horario disponivel</button>
            <button type="button" data-agenda-mode="manual">Agendamento manual</button>
          </div>
          <input type="hidden" name="bookingMode" value="available">
        `}
        <label>Data <input name="date" type="date" value="${todayInputValue()}" required></label>
        ${isReceiving
          ? `<label>Horario <input name="startTime" type="time" required></label>`
          : `<div class="grid two">
              <label>Inicio <input name="startTime" type="time" required></label>
              <label>Fim <input name="endTime" type="time" required></label>
            </div>`}
        ${isReceiving ? `
          <label>Fornecedor / empresa <input name="company" required></label>
          <div class="grid two">
            <label>Contato / motorista <input name="name"></label>
            <label>Telefone <input name="phone"></label>
          </div>
          <label>NF / pedido / placa <input name="document"></label>
          <label>Observacao <textarea name="observation"></textarea></label>
        ` : `
          <div class="grid agenda-manual-fields hidden" data-agenda-manual-fields>
            <label>Vendedor <input name="name" autocomplete="name"></label>
            <label>Empresa / fornecedor <input name="company"></label>
            <label>Telefone <input name="phone" autocomplete="tel"></label>
            <label>Assunto <input name="document"></label>
            <label>Observacao <textarea name="observation"></textarea></label>
          </div>
        `}
        <button class="btn primary" type="submit">${isReceiving ? "Salvar recebimento" : "Adicionar horario"}</button>
      </form>
      <form class="panel grid" id="agendaFilterForm">
        <h3>Periodo exibido</h3>
        <label>Inicio <input name="startDate" type="date" value="${escapeHtml(state.agenda.filters.startDate)}"></label>
        <label>Fim <input name="endDate" type="date" value="${escapeHtml(state.agenda.filters.endDate)}"></label>
        <button class="btn primary" type="submit">Aplicar periodo</button>
      </form>
    </div>
    <section style="margin-top:14px">
      <div class="section-title-row">
        <div>
          <h3>Horarios e agendamentos</h3>
          <div class="muted">Acompanhe reservas, telefone e status de atendimento.</div>
        </div>
      </div>
      <div class="agenda-cards">${agendaCards(state.agenda.rows, statusOptions, type)}</div>
    </section>
  `;
  document.getElementById("copyAgendaLink")?.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(publicLink);
    toast("Link da agenda copiado.");
  });
  document.getElementById("openAgendaLink")?.addEventListener("click", () => window.open(publicLink, "_blank"));
  if (!isReceiving) {
    const agendaForm = document.getElementById("agendaForm");
    const manualFields = agendaForm.querySelector("[data-agenda-manual-fields]");
    const submitButton = agendaForm.querySelector('button[type="submit"]');
    const modeInput = agendaForm.elements.bookingMode;
    const setAgendaMode = (mode) => {
      const isManual = mode === "manual";
      modeInput.value = mode;
      agendaForm.querySelectorAll("[data-agenda-mode]").forEach((button) => {
        button.classList.toggle("active", button.dataset.agendaMode === mode);
      });
      manualFields.classList.toggle("hidden", !isManual);
      ["name", "company", "phone"].forEach((name) => {
        agendaForm.elements[name].required = isManual;
      });
      submitButton.textContent = isManual ? "Salvar agendamento" : "Adicionar horario";
    };
    agendaForm.querySelectorAll("[data-agenda-mode]").forEach((button) => {
      button.addEventListener("click", () => setAgendaMode(button.dataset.agendaMode));
    });
  }
  document.getElementById("refreshAgenda").addEventListener("click", async () => {
    await loadAgenda(type);
    renderAgenda(type);
  });
  document.getElementById("agendaForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (isReceiving) body.endTime = body.startTime;
    await api("/api/agenda", { method: "POST", body: JSON.stringify({ type, ...body }) });
    await loadAgenda(type);
    renderAgenda(type);
    toast(isReceiving ? "Recebimento agendado." : (body.bookingMode === "manual" ? "Agendamento cadastrado." : "Horario criado."));
  });
  document.getElementById("agendaFilterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.agenda.filters = Object.fromEntries(new FormData(event.currentTarget).entries());
    await loadAgenda(type);
    renderAgenda(type);
  });
  document.querySelectorAll("[data-agenda-status]").forEach((select) => {
    select.addEventListener("change", async () => {
      await api(`/api/agenda/${select.dataset.agendaStatus}`, { method: "PUT", body: JSON.stringify({ status: select.value }) });
      await loadAgenda(type);
      renderAgenda(type);
      toast("Status atualizado.");
    });
  });
  fixVisibleText(view);
}

function agendaCards(rows, statusOptions, type = "comercial") {
  const isReceiving = type === "recebimento";
  return `
    ${rows.map((row) => `
      <article class="agenda-card">
        <div class="agenda-card-main">
          <div>
            <div class="agenda-date">${fmtDate(row.date)}</div>
            <strong>${isReceiving ? escapeHtml(row.start_time) : `${escapeHtml(row.start_time)} as ${escapeHtml(row.end_time)}`}</strong>
          </div>
          <select data-agenda-status="${row.id}">
            ${statusOptions.map((status) => `<option value="${status}" ${status === row.status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
        </div>
        <div class="agenda-booking">
          <div><span>${isReceiving ? "Contato" : "Nome"}</span><strong>${escapeHtml(row.booked_name || (isReceiving ? "-" : "Horario livre"))}</strong></div>
          <div><span>${isReceiving ? "Fornecedor" : "Empresa"}</span><strong>${escapeHtml(row.booked_company || "-")}</strong></div>
          <div><span>Telefone</span><strong>${escapeHtml(row.booked_phone || "-")}</strong></div>
          <div><span>Detalhe</span><strong>${escapeHtml(row.booked_document || "-")}</strong></div>
        </div>
        ${row.booked_observation ? `<div class="agenda-note">${escapeHtml(row.booked_observation)}</div>` : ""}
      </article>
    `).join("") || `<div class="empty-state">Nenhum horario no periodo.</div>`}
  `;
}

function renderCommercial() {
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Comercial</h2>
        <div class="muted">Retorno de rupturas, compras, acoes e rebaixas de validade</div>
      </div>
      <button class="btn" id="refreshCommercial">Atualizar</button>
    </div>
    <section class="panel">
      <h3>Retornos pendentes e resolvidos</h3>
      <div class="table-wrap" style="margin-top:12px">${repoCommercialTable()}</div>
    </section>
  `;
  document.getElementById("refreshCommercial").addEventListener("click", async () => {
    await loadReposition();
    renderCommercial();
  });
  bindRepoCommercialButtons();
  fixVisibleText(view);
}

function renderRepoGoals() {
  if (!canManageRepoGoals()) {
    view.innerHTML = `<section class="panel"><h3>Acesso restrito</h3><p class="muted">Apenas administrador ou gerente pode definir metas.</p></section>`;
    fixVisibleText(view);
    return;
  }
  const goalsBySector = new Map((state.repo.goals || []).map((row) => [row.sector, row]));
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Metas Reposição</h2>
        <div class="muted">Definição de meta diária de atividades por setor</div>
      </div>
      <button class="btn" id="refreshRepoGoals">Atualizar</button>
    </div>
    <section class="panel">
      <h3>Definir meta por setor</h3>
      <div class="muted" style="margin-top:4px">Informe quantas atividades de checklist o setor deve realizar por dia.</div>
      <form class="grid" id="repoGoalForm" style="margin-top:12px">
        <div class="grid three">
          <label>Setor <select name="sector">${repoOptions(state.repo.sectors || [])}</select></label>
          <label>Meta diária <input name="targetDaily" type="number" min="0" step="1" required placeholder="Ex.: 11"></label>
          <label>Status
            <select name="status">
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </label>
        </div>
        <button class="btn primary" type="submit">Salvar meta</button>
      </form>
    </section>
    <section class="panel" style="margin-top:14px">
      <h3>Metas cadastradas</h3>
      <div class="table-wrap" style="margin-top:12px">${repoGoalsTable(state.repo.goals || [])}</div>
    </section>
    <section class="panel" style="margin-top:14px">
      <h3>Sugestão rápida</h3>
      <div class="table-wrap" style="margin-top:12px">
        <table><thead><tr><th>Setor</th><th>Meta atual</th><th>Sugestão</th></tr></thead><tbody>
          ${(state.repo.sectors || []).map((sector) => {
            const current = goalsBySector.get(sector);
            return `<tr>
              <td data-label="Setor">${escapeHtml(sector)}</td>
              <td data-label="Meta atual">${current ? `${current.target_daily || 0} por dia` : "Sem meta"}</td>
              <td data-label="Sugestão">${state.repo.activities.length} atividades por dia</td>
            </tr>`;
          }).join("")}
        </tbody></table>
      </div>
    </section>
  `;
  document.getElementById("refreshRepoGoals").addEventListener("click", async () => {
    await loadReposition();
    renderRepoGoals();
  });
  document.getElementById("repoGoalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/reposition/goals", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
    await loadReposition();
    renderRepoGoals();
    toast("Meta da reposição salva.");
  });
  document.querySelectorAll("[data-repo-goal-sector]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = (state.repo.goals || []).find((item) => item.sector === button.dataset.repoGoalSector);
      const form = document.getElementById("repoGoalForm");
      form.elements.sector.value = row.sector;
      form.elements.targetDaily.value = row.target_daily || 0;
      form.elements.status.value = row.status || "ativo";
      form.elements.targetDaily.focus();
    });
  });
  fixVisibleText(view);
}

function renderRepoDashboard() {
  const data = state.repo.dashboard || { summary: {}, bySector: [] };
  const summary = data.summary || {};
  const completed = Number(summary.completed || 0);
  const taskTotal = Number(summary.taskTotal || 0);
  const percent = taskTotal ? Math.round((completed / taskTotal) * 100) : 0;
  const metrics = [
    ["Atividades realizadas", `${completed}/${taskTotal}`],
  ];
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Painel Reposição</h2>
        <div class="muted">Indicadores de checklists, setores e realização das atividades da reposição</div>
      </div>
      <div class="toolbar">
        <button class="btn" id="exportRepoDashboardPdf">PDF</button>
        <button class="btn" id="exportRepoDashboardExcel">Excel</button>
        <button class="btn" id="refreshRepoDashboard">Atualizar</button>
      </div>
    </div>
    <form class="panel grid" id="repoDashboardFilterForm" style="margin-bottom:14px">
      <div class="grid two">
        <label>Início <input name="startDate" type="date" value="${escapeHtml(state.repo.filters.startDate)}"></label>
        <label>Fim <input name="endDate" type="date" value="${escapeHtml(state.repo.filters.endDate)}"></label>
      </div>
      <button class="btn primary" type="submit">Aplicar período</button>
    </form>
    <div class="metrics dashboard-summary">${metrics.map(([label, value]) => `<div class="metric"><span class="muted">${label}</span><strong>${value}</strong><small>${percent}% realizado no período</small></div>`).join("")}</div>
    <div class="grid two" style="margin-top:14px">
      <section class="panel">
        <h3>Itens identificados por setor</h3>
        <div class="muted" style="margin-top:4px">Soma de rupturas e validades registradas no período</div>
        <div class="table-wrap" style="margin-top:12px">${repoSectorTable(data.bySector || [])}</div>
      </section>
      <section class="panel">
        <h3>Engajamento da reposição</h3>
        <div class="muted" style="margin-top:4px">Participação dos usuários de reposição nos checklists do período</div>
        <div class="table-wrap" style="margin-top:12px">${repoUserEngagementTable(data.repoUserEngagement || [])}</div>
      </section>
    </div>
    <section class="panel" style="margin-top:14px">
      <h3>Metas por setor</h3>
      <div class="muted" style="margin-top:4px">Compara a meta diária definida com as atividades registradas no período</div>
      <div class="table-wrap" style="margin-top:12px">${repoGoalProgressTable(data.repoGoalProgress || [])}</div>
    </section>
    <section class="panel" style="margin-top:14px">
      <h3>Percentual de realização das atividades da reposição</h3>
      <div class="muted" style="margin-top:4px">Conta o dia quando a atividade foi marcada como Sim ao menos uma vez</div>
      <div class="table-wrap" style="margin-top:12px">${repoActivityCompletionTable(data.repoActivityCompletion || [])}</div>
    </section>
  `;
  document.getElementById("refreshRepoDashboard").addEventListener("click", async () => {
    await loadReposition();
    renderRepoDashboard();
  });
  document.getElementById("exportRepoDashboardPdf").addEventListener("click", printDashboardReport);
  document.getElementById("exportRepoDashboardExcel").addEventListener("click", () => exportRepoPanelCsv("reposicao"));
  document.getElementById("repoDashboardFilterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.repo.filters = Object.fromEntries(new FormData(event.currentTarget).entries());
    await loadReposition();
    renderRepoDashboard();
  });
  fixVisibleText(view);
}

function renderCommercialDashboard() {
  const data = state.repo.dashboard || { summary: {} };
  const summary = data.summary || {};
  const commercialTotal = Number(summary.ruptures || 0) + Number(summary.expirations || 0);
  const commercialCompleted = Number(summary.rupturesPurchased || 0) + Number(summary.expirationsActioned || 0);
  const percent = commercialTotal ? Math.round((commercialCompleted / commercialTotal) * 100) : 0;
  const metrics = [
    ["Retornos comerciais", `${commercialCompleted}/${commercialTotal}`],
  ];
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Painel Comercial</h2>
        <div class="muted">Engajamento dos compradores e retornos comerciais registrados</div>
      </div>
      <div class="toolbar">
        <button class="btn" id="exportCommercialDashboardPdf">PDF</button>
        <button class="btn" id="exportCommercialDashboardExcel">Excel</button>
        <button class="btn" id="refreshCommercialDashboard">Atualizar</button>
      </div>
    </div>
    <form class="panel grid" id="commercialDashboardFilterForm" style="margin-bottom:14px">
      <div class="grid two">
        <label>Início <input name="startDate" type="date" value="${escapeHtml(state.repo.filters.startDate)}"></label>
        <label>Fim <input name="endDate" type="date" value="${escapeHtml(state.repo.filters.endDate)}"></label>
      </div>
      <button class="btn primary" type="submit">Aplicar período</button>
    </form>
    <div class="metrics dashboard-summary">${metrics.map(([label, value]) => `<div class="metric"><span class="muted">${label}</span><strong>${value}</strong><small>${percent}% retornado no período</small></div>`).join("")}</div>
    <div class="grid two" style="margin-top:14px">
      <section class="panel">
        <h3>Engajamento dos compradores</h3>
        <div class="muted" style="margin-top:4px">Participação dos usuários comerciais nos retornos do período</div>
        <div class="table-wrap" style="margin-top:12px">${repoUserEngagementTable(data.commercialUserEngagement || [])}</div>
      </section>
      <section class="panel">
        <h3>Itens identificados por setor</h3>
        <div class="muted" style="margin-top:4px">Rupturas e validades direcionadas ao comercial no período</div>
        <div class="table-wrap" style="margin-top:12px">${commercialSectorTable()}</div>
      </section>
    </div>
    <section class="panel" style="margin-top:14px">
      <h3>Retorno comercial</h3>
      <div class="table-wrap" style="margin-top:12px">${repoCommercialTable()}</div>
    </section>
  `;
  document.getElementById("refreshCommercialDashboard").addEventListener("click", async () => {
    await loadReposition();
    renderCommercialDashboard();
  });
  document.getElementById("exportCommercialDashboardPdf").addEventListener("click", printDashboardReport);
  document.getElementById("exportCommercialDashboardExcel").addEventListener("click", () => exportRepoPanelCsv("comercial"));
  document.getElementById("commercialDashboardFilterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.repo.filters = Object.fromEntries(new FormData(event.currentTarget).entries());
    await loadReposition();
    renderCommercialDashboard();
  });
  bindRepoCommercialButtons();
  fixVisibleText(view);
}
function renderReposition() {
  const data = state.repo.dashboard || { summary: {}, bySector: [] };
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>ReposiÃ§Ã£o da loja</h2>
        <div class="muted">Atividades, rupturas, validades e retorno comercial</div>
      </div>
      <button class="btn" id="refreshReposition">Atualizar</button>
    </div>
    <form class="panel grid" id="repoFilterForm" style="margin-bottom:14px">
      <div class="grid two">
        <label>InÃ­cio <input name="startDate" type="date" value="${escapeHtml(state.repo.filters.startDate)}"></label>
        <label>Fim <input name="endDate" type="date" value="${escapeHtml(state.repo.filters.endDate)}"></label>
      </div>
      <button class="btn primary" type="submit">Aplicar perÃ­odo</button>
    </form>
    <div class="grid" style="margin-top:14px">
      <section class="panel">${repoTaskForm()}</section>
    </div>
    <div class="grid two" style="margin-top:14px">
      <section class="panel">
        <h3>Indicadores por setor</h3>
        <div class="table-wrap" style="margin-top:12px">${repoSectorTable(data.bySector || [])}</div>
      </section>
      <section class="panel">
        <h3>Retorno comercial</h3>
        <div class="table-wrap" style="margin-top:12px">${repoCommercialTable()}</div>
      </section>
    </div>
    <section class="panel" style="margin-top:14px">
      <h3>Atividades registradas</h3>
      <div class="table-wrap" style="margin-top:12px">${repoTasksTable()}</div>
    </section>
  `;
  document.getElementById("refreshReposition").addEventListener("click", async () => {
    await loadReposition();
    renderReposition();
  });
  document.getElementById("repoFilterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.repo.filters = Object.fromEntries(new FormData(event.currentTarget).entries());
    await loadReposition();
    renderReposition();
  });
  bindRepoForms();
  fixVisibleText(view);
}

function repoTaskForm() {
  const linked = state.user?.collaborator_id ? state.collaborators.find((item) => Number(item.id) === Number(state.user.collaborator_id)) : null;
  const linkedSectors = collaboratorSectors(linked);
  const collaboratorField = linked
    ? `<input value="${escapeHtml(linked.name)}" disabled><input type="hidden" name="collaboratorId" value="${linked.id}">`
    : `<select name="collaboratorId" required>${repoCollaboratorOptions()}</select>`;
  const sectorField = linked && linkedSectors.length === 1
    ? `<input value="${escapeHtml(linkedSectors[0])}" disabled><input type="hidden" name="sector" value="${escapeHtml(linkedSectors[0])}">`
    : `<select name="sector" required>${repoTaskSectorOptions(linked)}</select>`;
  return `
    <h3>Checklist diÃ¡rio da reposiÃ§Ã£o</h3>
    <div class="muted" style="margin-top:4px">${linked ? "Acesso vinculado ao seu cadastro" : "Data e horÃ¡rio sÃ£o registrados automaticamente no envio"}</div>
    <form class="grid" id="repoTaskForm" style="margin-top:12px">
      <div class="grid two">
        <label>Colaborador ${collaboratorField}</label>
        <label>Setor ${sectorField}</label>
      </div>
      <div class="grid two">
        <label>Atividade <select name="activity">${repoOptions(state.repo.activities)}</select></label>
        <label>Sim / NÃ£o
          <select name="answer" required><option>Sim</option><option>NÃ£o</option></select>
        </label>
      </div>
      <div class="grid hidden" data-repo-issue-fields>
        <div class="grid two">
          <label>Produto <input name="product"></label>
          <label data-repo-rupture-type>Tipo
            <select name="type">
              <option>Ruptura total</option>
              <option>Proximo de ruptura</option>
            </select>
          </label>
          <label data-repo-expiration-date>Data de validade <input name="expirationDate" type="date"></label>
          <label>Quantidade <input name="quantity"></label>
        </div>
      </div>
      <label>ObservaÃ§Ã£o <textarea name="observation"></textarea></label>
      <button class="btn primary" type="submit">Enviar checklist</button>
    </form>
  `;
}

function repoIssueForm(kind, title, productLabel, fields) {
  return `
    <h3>${title}</h3>
    <form class="grid" id="repo-${kind}-form" data-repo-kind="${kind}" style="margin-top:12px">
      <div class="grid two">
        <label>Data <input name="date" type="date" value="${todayInputValue()}"></label>
        <label>Setor <select name="sector">${repoSectorOptionsForCurrentUser()}</select></label>
      </div>
      <label>${productLabel} <input name="product" required></label>
      <div class="grid two">
        ${fields.map(([name, label, typeOrOptions]) => Array.isArray(typeOrOptions)
          ? `<label>${label} <select name="${name}">${repoOptions(typeOrOptions)}</select></label>`
          : `<label>${label} <input name="${name}" type="${typeOrOptions || "text"}"></label>`).join("")}
      </div>
      <label>ObservaÃ§Ã£o <textarea name="observation"></textarea></label>
      <button class="btn primary" type="submit">Salvar</button>
    </form>
  `;
}

function bindRepoForms() {
  const taskForm = document.getElementById("repoTaskForm");
  const syncRepoIssueFields = () => {
    const activity = withoutAccents(taskForm.elements.activity?.value || "").toLowerCase();
    const isRupture = activity.includes("ruptura");
    const isExpiration = activity.includes("validade");
    const wrapper = taskForm.querySelector("[data-repo-issue-fields]");
    const product = taskForm.elements.product;
    const expirationDate = taskForm.elements.expirationDate;
    if (!wrapper) return;
    wrapper.classList.toggle("hidden", !isRupture && !isExpiration);
    taskForm.querySelector("[data-repo-rupture-type]")?.classList.toggle("hidden", !isRupture);
    taskForm.querySelector("[data-repo-expiration-date]")?.classList.toggle("hidden", !isExpiration);
    if (product) product.required = isRupture || isExpiration;
    if (expirationDate) expirationDate.required = isExpiration;
  };
  const syncRepoTaskSector = () => {
    const collaboratorId = taskForm.elements.collaboratorId?.value;
    const sectorField = taskForm.elements.sector;
    const collaborator = state.collaborators.find((item) => Number(item.id) === Number(collaboratorId));
    const assigned = collaboratorSectors(collaborator);
    if (!sectorField || sectorField.tagName !== "SELECT") return;
    sectorField.innerHTML = repoOptions(assigned.length ? assigned : state.repo.sectors);
  };
  taskForm.elements.collaboratorId?.addEventListener("change", syncRepoTaskSector);
  taskForm.elements.activity?.addEventListener("change", syncRepoIssueFields);
  syncRepoTaskSector();
  syncRepoIssueFields();

  taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/reposition/tasks", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
    await loadReposition();
    renderReposition();
    toast("Checklist da reposiÃ§Ã£o enviado.");
  });
  document.querySelectorAll("[data-repo-kind]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const kind = event.currentTarget.dataset.repoKind;
      await api(`/api/reposition/${kind}`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
      await loadReposition();
      renderReposition();
      toast("Registro salvo.");
    });
  });
  bindRepoCommercialButtons();
}

function bindRepoCommercialButtons() {
  document.querySelectorAll("[data-repo-commercial]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [kind, id] = button.dataset.repoCommercial.split(":");
      const commercialStatus = kind === "ruptures"
        ? (confirm("O pedido foi realizado?") ? "Pedido realizado" : "Pedido nÃ£o realizado")
        : (confirm("Foi feita aÃ§Ã£o ou rebaixa?") ? "AÃ§Ã£o ou rebaixa realizada" : "AÃ§Ã£o nÃ£o realizada");
      const commercialObservation = prompt("ObservaÃ§Ã£o do comercial") || "";
      await api(`/api/reposition/${kind}/${id}`, { method: "PUT", body: JSON.stringify({ commercialStatus, commercialObservation }) });
      await loadReposition();
      renderReposition();
      toast("Retorno comercial atualizado.");
    });
  });
}

function repoSectorTable(rows) {
  return `
    <table><thead><tr><th>Setor</th><th>Itens identificados</th><th>Rupturas</th><th>Validades</th></tr></thead><tbody>
      ${rows.map((row) => {
        const identified = Number(row.ruptures || 0) + Number(row.expirations || 0);
        return `<tr><td data-label="Setor">${escapeHtml(row.sector)}</td><td data-label="Itens identificados">${identified}</td><td data-label="Rupturas">${row.ruptures || 0}</td><td data-label="Validades">${row.expirations || 0}</td></tr>`;
      }).join("") || `<tr><td colspan="4">Sem registros.</td></tr>`}
    </tbody></table>
  `;
}

function commercialSectorRows() {
  const map = new Map();
  const ensure = (sector) => {
    const key = sector || "Sem setor";
    if (!map.has(key)) map.set(key, { sector: key, ruptures: 0, expirations: 0 });
    return map.get(key);
  };
  state.repo.ruptures.forEach((row) => {
    ensure(row.sector).ruptures += 1;
  });
  state.repo.expirations.forEach((row) => {
    ensure(row.sector).expirations += 1;
  });
  return Array.from(map.values())
    .map((row) => ({ ...row, total: row.ruptures + row.expirations }))
    .sort((a, b) => b.total - a.total || a.sector.localeCompare(b.sector));
}

function commercialSectorTable() {
  const rows = commercialSectorRows();
  return `
    <table><thead><tr><th>Setor</th><th>Itens identificados</th><th>Rupturas</th><th>Validades</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td data-label="Setor">${escapeHtml(row.sector)}</td><td data-label="Itens identificados">${row.total}</td><td data-label="Rupturas">${row.ruptures}</td><td data-label="Validades">${row.expirations}</td></tr>`).join("") || `<tr><td colspan="4">Sem registros.</td></tr>`}
    </tbody></table>
  `;
}

function repoGoalsTable(rows) {
  return `
    <table><thead><tr><th>Setor</th><th>Meta diária</th><th>Status</th><th>Ação</th></tr></thead><tbody>
      ${rows.map((row) => `<tr>
        <td data-label="Setor">${escapeHtml(row.sector)}</td>
        <td data-label="Meta diária">${row.target_daily || 0}</td>
        <td data-label="Status"><span class="status ${row.status === "ativo" ? "ok" : "warn"}">${escapeHtml(row.status || "")}</span></td>
        <td data-label="Ação"><button class="btn" type="button" data-repo-goal-sector="${escapeHtml(row.sector)}">Editar</button></td>
      </tr>`).join("") || `<tr><td colspan="4">Nenhuma meta cadastrada.</td></tr>`}
    </tbody></table>
  `;
}

function repoGoalProgressTable(rows) {
  return `
    <table><thead><tr><th>Setor</th><th>Realizado</th><th>Meta</th><th>Pendente</th><th>Percentual</th></tr></thead><tbody>
      ${rows.map((row) => `<tr>
        <td data-label="Setor">${escapeHtml(row.sector)}</td>
        <td data-label="Realizado">${row.done || 0}</td>
        <td data-label="Meta">${row.target || 0}</td>
        <td data-label="Pendente">${row.pending || 0}</td>
        <td data-label="Percentual">${percentBar(row.percent || 0)}</td>
      </tr>`).join("") || `<tr><td colspan="5">Nenhuma meta ativa cadastrada.</td></tr>`}
    </tbody></table>
  `;
}

function repoUserEngagementTable(rows) {
  return `
    <table><thead><tr><th>UsuÃ¡rio</th><th>Registros</th><th>Engajamento</th></tr></thead><tbody>
      ${rows.map((row) => `<tr>
        <td data-label="UsuÃ¡rio">${escapeHtml(row.name)}</td>
        <td data-label="Registros">${row.total || 0}</td>
        <td data-label="Engajamento">${percentBar(row.percent || 0)}</td>
      </tr>`).join("") || `<tr><td colspan="3">Nenhum usuÃ¡rio cadastrado para este perfil.</td></tr>`}
    </tbody></table>
  `;
}

function repoActivityCompletionTable(rows) {
  return `
    <table><thead><tr><th>Atividade</th><th>Realizado</th><th>Percentual</th></tr></thead><tbody>
      ${rows.map((row) => `<tr>
        <td data-label="Atividade">${escapeHtml(row.activity)}</td>
        <td data-label="Realizado">${row.total || 0}/${row.expected || 0}</td>
        <td data-label="Percentual">${percentBar(row.percent || 0)}</td>
      </tr>`).join("") || `<tr><td colspan="3">Sem atividades cadastradas.</td></tr>`}
    </tbody></table>
  `;
}

function repoCommercialTable() {
  const rows = [
    ...state.repo.ruptures.map((row) => ({ ...row, kind: "ruptures", origin: "Ruptura", detail: row.type || "" })),
    ...state.repo.expirations.map((row) => ({ ...row, kind: "expirations", origin: "Validade", detail: row.expiration_date ? fmtDate(row.expiration_date) : "" })),
  ].slice(0, 30);
  return `
    <table><thead><tr><th>Origem</th><th>Produto</th><th>Setor</th><th>Detalhe</th><th>Status</th><th>Retorno</th><th>AÃ§Ã£o</th></tr></thead><tbody>
      ${rows.map((row) => `<tr>
        <td data-label="Origem">${row.origin}</td>
        <td data-label="Produto">${escapeHtml(row.product)}</td>
        <td data-label="Setor">${escapeHtml(row.sector)}</td>
        <td data-label="Detalhe">${escapeHtml(row.detail)}</td>
        <td data-label="Status"><span class="status ${row.status === "Resolvido" ? "ok" : "warn"}">${escapeHtml(row.status)}</span></td>
        <td data-label="Retorno">${escapeHtml(row.commercial_status || "")}</td>
        <td data-label="AÃ§Ã£o"><button class="btn" type="button" data-repo-commercial="${row.kind}:${row.id}">Atualizar</button></td>
      </tr>`).join("") || `<tr><td colspan="7">Sem registros comerciais.</td></tr>`}
    </tbody></table>
  `;
}

function repoTasksTable() {
  return `
    <table><thead><tr><th>Data</th><th>Colaborador</th><th>Setor</th><th>Atividade</th><th>Resposta</th><th>ObservaÃ§Ã£o</th></tr></thead><tbody>
      ${state.repo.tasks.map((row) => `<tr>
        <td data-label="Data">${fmtDate(row.date)}</td>
        <td data-label="Colaborador">${escapeHtml(row.collaborator)}</td>
        <td data-label="Setor">${escapeHtml(row.sector)}</td>
        <td data-label="Atividade">${escapeHtml(row.activity)}</td>
        <td data-label="Resposta"><span class="status ${row.status === "Realizado" ? "ok" : "danger"}">${row.status === "Realizado" ? "Sim" : "NÃ£o"}</span></td>
        <td data-label="ObservaÃ§Ã£o">${escapeHtml(row.observation || "")}</td>
      </tr>`).join("") || `<tr><td colspan="6">Sem atividades registradas.</td></tr>`}
    </tbody></table>
  `;
}

function auditStatusClass(status) {
  if (status === "Em conformidade" || status === "Confere") return "ok";
  if (status === "Aten\u00e7\u00e3o" || status === "Corrigir") return "warn";
  if (status === "Cr\u00edtico" || status === "N\u00e3o confere") return "danger";
  return "";
}

function renderSectorAudit() {
  const auditSummary = state.sectorAuditSummary || { evaluatedByUser: 0, evaluatedTotal: 0 };
  const isManager = ["gerente", "encarregada"].includes(state.user?.role);
  const managerMetricLabel = isManager ? "Avaliações feitas por você" : "Avaliações registradas";
  const managerMetricValue = isManager ? auditSummary.evaluatedByUser : auditSummary.evaluatedTotal;
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Conferência Gerencial</h2>
        <div class="muted">Confronto entre o que a reposição informou e a validação da gerente</div>
      </div>
      <button class="btn" id="refreshSectorAudit">Atualizar</button>
    </div>
    <form class="panel grid" id="sectorAuditFilterForm" style="margin-bottom:14px">
      <div class="grid five">
        <label>Início <input name="startDate" type="date" value="${escapeHtml(state.auditFilters.startDate)}"></label>
        <label>Fim <input name="endDate" type="date" value="${escapeHtml(state.auditFilters.endDate)}"></label>
        <label>O que deseja conferir?
          <select name="focus">
            ${AUDIT_FOCUS_OPTIONS.map(([value, label]) => `<option value="${value}" ${state.auditFilters.focus === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label>Setor
          <select name="sector">
            <option value="">Todos</option>
            ${repoOptions(state.repo.sectors || [], state.auditFilters.sector || "")}
          </select>
        </label>
        <label>Situação da atividade
          <select name="completion">
            <option value="" ${!state.auditFilters.completion ? "selected" : ""}>Todas</option>
            <option value="realizada" ${state.auditFilters.completion === "realizada" ? "selected" : ""}>Realizadas</option>
            <option value="nao-realizada" ${state.auditFilters.completion === "nao-realizada" ? "selected" : ""}>Não realizadas</option>
          </select>
        </label>
      </div>
      <button class="btn primary" type="submit">Aplicar período</button>
    </form>
    <div class="metrics dashboard-summary" style="margin-bottom:14px">
      <div class="metric">
        <span class="muted">${managerMetricLabel}</span>
        <strong>${managerMetricValue || 0}</strong>
        <small>${state.auditFilters.startDate === state.auditFilters.endDate ? "no dia selecionado" : "no período selecionado"}</small>
      </div>
    </div>
    <section class="panel">
      <h3>Auditoria por setor</h3>
      <div class="muted" style="margin-top:4px">Escolha um ponto de conferência para comparar o que a reposição apontou com a realidade do setor.</div>
      <div class="table-wrap" style="margin-top:12px">${sectorAuditTable()}</div>
    </section>
  `;
  document.getElementById("refreshSectorAudit").addEventListener("click", async () => {
    await loadSectorAudits();
    renderSectorAudit();
  });
  document.getElementById("sectorAuditFilterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.auditFilters = Object.fromEntries(new FormData(event.currentTarget).entries());
    await loadSectorAudits();
    renderSectorAudit();
  });
  bindSectorAuditButtons();
  fixVisibleText(view);
}

function sectorAuditTable() {
  const completionFilter = state.auditFilters.completion || "";
  const rows = (state.sectorAudits || []).filter((row) => {
    if (!completionFilter) return true;
    const performed = Number(row.completedTasks || 0) > 0
      || Number(row.ruptures || 0) + Number(row.expirations || 0) + Number(row.damages || 0) > 0;
    return completionFilter === "realizada" ? performed : !performed;
  });
  return `
    <table>
      <thead>
        <tr>
          <th>Setor</th>
          <th>Conferência</th>
          <th>Apontamentos</th>
          <th>Validação gerente</th>
          <th>Ação</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => {
          const hasExpectedTasks = Number(row.expectedTasks || 0) > 0;
          const performed = Number(row.completedTasks || 0) > 0;
          const occurrenceCount = Number(row.ruptures || 0) + Number(row.expirations || 0) + Number(row.damages || 0);
          const hasOccurrence = occurrenceCount > 0;
          const resultLabel = hasExpectedTasks
            ? (performed ? "Sim" : "Não")
            : (hasOccurrence ? "Sim" : "Não");
          const resultClass = resultLabel === "Sim" ? "yes" : "no";
          const resultDetail = hasExpectedTasks
            ? `${row.completedTasks || 0}/${row.expectedTasks || 0} atividade(s) realizada(s)`
            : `${occurrenceCount} apontamento(s) registrado(s)`;
          const combinedObservation = [
            row.managerObservation || "",
            row.actionRequired ? `Ação cobrada: ${row.actionRequired}` : "",
          ].filter(Boolean).join("\n");
          return `
          <tr>
            <td data-label="Setor">
              <strong>${escapeHtml(row.sector)}</strong>
              <div class="muted">Última atualização: ${row.lastUpdate ? new Date(row.lastUpdate).toLocaleString("pt-BR") : "-"}</div>
            </td>
            <td data-label="Conferência">${escapeHtml(row.focusLabel || "")}</td>
            <td data-label="Apontamentos">
              <div class="audit-result ${resultClass}">
                <span>Atividade realizada</span>
                <strong>${resultLabel}</strong>
              </div>
              <div class="muted" style="margin:6px 0">${resultDetail}</div>
              ${(row.motives || []).map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
              ${(row.notes || []).length ? `<div class="muted" style="margin-top:6px">${row.notes.map(escapeHtml).join("<br>")}</div>` : ""}
              ${(row.taskObservations || []).length ? `
                <div class="repo-observations">
                  <strong>Observação do repositor</strong>
                  ${row.taskObservations.map((item) => `
                    <div class="repo-observation-item">
                      <strong class="repo-observation-activity">Atividade: ${escapeHtml(item.activity || row.focusLabel || "Não informada")}</strong>
                      <span>${escapeHtml(item.collaborator || "Repositor")} · ${item.date ? new Date(`${item.date}T00:00:00`).toLocaleDateString("pt-BR") : ""}</span>
                      <p>${escapeHtml(item.observation || "")}</p>
                    </div>
                  `).join("")}
                </div>
              ` : ""}
            </td>
            <td data-label="Validação gerente">
              <div class="grid" style="gap:8px">
                <select data-audit-status="${escapeHtml(row.sector)}">
                  ${["Pendente", "Confere", "N\u00e3o confere", "Corrigir"].map((status) => `<option ${status === row.managerStatus ? "selected" : ""}>${status}</option>`).join("")}
                </select>
                <textarea data-audit-observation="${escapeHtml(row.sector)}" placeholder="Observação e ação necessária">${escapeHtml(combinedObservation)}</textarea>
                <div class="muted">${row.auditedAt ? `Última validação: ${new Date(row.auditedAt).toLocaleString("pt-BR")} por ${escapeHtml(row.auditedBy || "-")}` : "Ainda não validado pela gerente."}</div>
              </div>
            </td>
            <td data-label="Ação"><button class="btn primary" type="button" data-save-sector-audit="${escapeHtml(row.sector)}">Salvar</button></td>
          </tr>
        `;
        }).join("") || `<tr><td colspan="5">Sem setores para conferência.</td></tr>`}
      </tbody>
    </table>
  `;
}

function bindSectorAuditButtons() {
  document.querySelectorAll("[data-save-sector-audit]").forEach((button) => {
    button.addEventListener("click", async () => {
      const sector = button.dataset.saveSectorAudit;
      const body = {
        date: state.auditFilters.endDate || state.auditFilters.startDate || todayInputValue(),
        sector,
        focus: state.auditFilters.focus || "abastecimento",
        managerStatus: document.querySelector(`[data-audit-status="${CSS.escape(sector)}"]`).value,
        observation: document.querySelector(`[data-audit-observation="${CSS.escape(sector)}"]`).value,
        actionRequired: "",
        responsible: "",
        dueDate: "",
      };
      await api("/api/sector-audits", { method: "POST", body: JSON.stringify(body) });
      await loadSectorAudits();
      renderSectorAudit();
      toast("Conferência gerencial salva.");
    });
  });
}

function renderPendencies() {
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>PendÃªncias</h2>
        <div class="muted">Controle de abertura, andamento e soluÃ§Ã£o</div>
      </div>
    </div>
    <form class="panel grid" id="pendencyForm">
      <div class="grid three">
        <label>ResponsÃ¡vel <select name="responsibleId" required>${preventionCollaboratorOptions()}</select></label>
        <label>Data de abertura <input name="openedAt" type="date" required value="${new Date().toISOString().slice(0, 10)}"></label>
        <label>Status <select name="status"><option>Aberto</option><option>Em andamento</option><option>Resolvido</option></select></label>
      </div>
      <label>DescriÃ§Ã£o <textarea name="description" required></textarea></label>
      <label>ObservaÃ§Ã£o da soluÃ§Ã£o <textarea name="solutionObservation"></textarea></label>
      <button class="btn primary" type="submit">Salvar pendÃªncia</button>
    </form>
    <div class="table-wrap" style="margin-top:14px" id="pendenciesTable"></div>
  `;
  drawPendenciesTable();
  document.getElementById("pendencyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    await api("/api/pendencies", { method: "POST", body: JSON.stringify(body) });
    await loadPendencies();
    form.reset();
    renderPendencies();
    toast("PendÃªncia salva.");
  });
}

function drawPendenciesTable() {
  document.getElementById("pendenciesTable").innerHTML = `
    <table><thead><tr><th>DescriÃ§Ã£o</th><th>ResponsÃ¡vel</th><th>Abertura</th><th>Status</th><th>SoluÃ§Ã£o</th></tr></thead><tbody>
      ${state.pendencies.map((row) => `
        <tr>
          <td data-label="DescriÃ§Ã£o">${escapeHtml(row.description)}</td>
          <td data-label="ResponsÃ¡vel">${escapeHtml(row.responsible)}</td>
          <td data-label="Abertura">${fmtDate(row.opened_at)}</td>
          <td data-label="Status"><span class="status ${row.status === "Resolvido" ? "ok" : row.status === "Em andamento" ? "warn" : "danger"}">${escapeHtml(row.status)}</span></td>
          <td data-label="SoluÃ§Ã£o">${escapeHtml(row.solution_observation || "")}</td>
        </tr>
      `).join("") || `<tr><td colspan="5">Nenhuma pendÃªncia cadastrada.</td></tr>`}
    </tbody></table>
  `;
}

function renderCollaborators() {
  view.innerHTML = `
      <div class="topbar">
      <div>
        <h2>Colaboradores</h2>
        <div class="muted">Cadastro de colaboradores, compradores e setores direcionados</div>
      </div>
    </div>
    <form class="panel grid" id="collaboratorForm">
      <input type="hidden" name="id">
      <div class="grid four">
        <label>Nome <input name="name" required></label>
        <label>Cargo <input name="role" required></label>
        <div class="field-group">
          <div class="field-label">Setores direcionados</div>
          <div class="check-grid sector-picker">${collaboratorSectorCheckboxes()}</div>
        </div>
        <label>Status <select name="status"><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
      </div>
      <div class="toolbar">
        <button class="btn primary" type="submit" id="collaboratorSubmit">Cadastrar colaborador</button>
        <button class="btn hidden" type="button" id="cancelCollaboratorEdit">Cancelar ediÃ§Ã£o</button>
      </div>
    </form>
    <div class="table-wrap" style="margin-top:14px">
      <table><thead><tr><th>Nome</th><th>Cargo</th><th>Setores direcionados</th><th>Status</th><th>AÃ§Ãµes</th></tr></thead><tbody>
        ${state.collaborators.map((row) => `
          <tr>
            <td data-label="Nome">${escapeHtml(row.name)}</td>
            <td data-label="Cargo">${escapeHtml(row.role)}</td>
            <td data-label="Setores direcionados">${escapeHtml(displayCollaboratorSectors(row))}</td>
            <td data-label="Status"><span class="status ${row.status === "ativo" ? "ok" : ""}">${row.status}</span></td>
            <td data-label="AÃ§Ãµes">
              <div class="toolbar">
                <button class="btn" type="button" data-edit-collaborator="${row.id}">Editar</button>
                <button class="btn danger" type="button" data-delete-collaborator="${row.id}">Excluir</button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody></table>
    </div>
  `;
  const form = document.getElementById("collaboratorForm");
  const submitButton = document.getElementById("collaboratorSubmit");
  const cancelButton = document.getElementById("cancelCollaboratorEdit");

  function clearCollaboratorEdit() {
    form.reset();
    form.id.value = "";
    submitButton.textContent = "Cadastrar colaborador";
    cancelButton.classList.add("hidden");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form).entries());
    const selectedSectors = Array.from(form.querySelectorAll('input[name="sector"]:checked')).map((option) => option.value).filter(Boolean);
    body.sector = selectedSectors.length ? JSON.stringify(selectedSectors) : "";
    const id = body.id;
    delete body.id;
    await api(id ? `/api/collaborators/${id}` : "/api/collaborators", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    await loadCollaborators();
    renderCollaborators();
    toast(id ? "Colaborador atualizado." : "Colaborador cadastrado.");
  });

  cancelButton.addEventListener("click", clearCollaboratorEdit);

  document.querySelectorAll("[data-edit-collaborator]").forEach((button) => {
    button.addEventListener("click", () => {
      const collaborator = state.collaborators.find((item) => item.id === Number(button.dataset.editCollaborator));
      if (!collaborator) return;
      form.id.value = collaborator.id;
      form.name.value = collaborator.name;
      form.role.value = collaborator.role;
      const selectedSectors = new Set(collaboratorSectors(collaborator));
      form.querySelectorAll('input[name="sector"]').forEach((option) => {
        option.checked = selectedSectors.has(option.value);
      });
      form.status.value = collaborator.status;
      submitButton.textContent = "Salvar alterações";
      cancelButton.classList.remove("hidden");
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  document.querySelectorAll("[data-delete-collaborator]").forEach((button) => {
    button.addEventListener("click", async () => {
      const collaborator = state.collaborators.find((item) => item.id === Number(button.dataset.deleteCollaborator));
      if (!collaborator) return;
      const confirmed = confirm(`Excluir o colaborador ${collaborator.name}?`);
      if (!confirmed) return;
      const result = await api(`/api/collaborators/${collaborator.id}`, { method: "DELETE" });
      await loadCollaborators();
      renderCollaborators();
      toast(result.message || "Colaborador excluÃ­do.");
    });
  });
  fixVisibleText(view);
}

const MANAGEMENT_SECTORS = [
  "Acougue", "Avariado deposito", "Avariado loja", "Bazar", "Bebidas",
  "FLV e Granjeiro", "Frente de loja", "Frios", "Inventario", "Limpeza",
  "Mercearia doce", "Mercearia salgada", "Mercearia seca", "Ovos de aves",
  "Padaria", "Pereciveis", "Perfumaria", "Rota Fortaleza", "Rota Solonopole",
  "Vencido", "Loja", "Outros",
];

function managementPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function managementVariation(comparison, inverted = false) {
  const value = Number(comparison?.percent || 0);
  const good = inverted ? value <= 0 : value >= 0;
  const signal = value > 0 ? "+" : "";
  return `<span class="management-variation ${good ? "positive" : "negative"}">${signal}${(value * 100).toFixed(1)}%</span>`;
}

const MANAGEMENT_MONEY_FIELDS = new Set([
  "grossSales", "cancelledSales", "discounts", "netSales", "averageTicket",
  "deliveryNetSales", "deliveryCancelledSales", "deliveryDiscounts", "deliveryOtherCheckouts",
  "deliveryGoalNormal", "deliveryGoalPlus", "quotationCost", "quotationSales",
  "sales", "losses", "consumption", "productivityTarget",
]);

function formatMoneyInputValue(value) {
  const numeric = Number(value || 0);
  if (!numeric) return "";
  return numeric.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeMoneyValue(value) {
  const raw = String(value || "").replace(/[R$\s]/g, "").trim();
  if (!raw) return "";
  if (raw.includes(",")) return raw.replace(/\./g, "").replace(",", ".");
  const onlyDigits = raw.replace(/[^\d.-]/g, "");
  return onlyDigits || "";
}

function managementFormValues(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll("[data-money-input]").forEach((input) => {
    values[input.name] = normalizeMoneyValue(input.value);
  });
  return values;
}

function bindMoneyInputs(container = document) {
  container.querySelectorAll("[data-money-input]").forEach((input) => {
    input.addEventListener("focus", () => {
      if (input.value === "0,00") input.value = "";
      input.select();
    });
    input.addEventListener("blur", () => {
      const normalized = normalizeMoneyValue(input.value);
      input.value = normalized === "" ? "" : formatMoneyInputValue(normalized);
    });
  });
}

function managementNumberInput(name, label, value, step = "0.01") {
  if (MANAGEMENT_MONEY_FIELDS.has(name)) {
    return `<label>${label}<input type="text" inputmode="decimal" name="${name}" value="${formatMoneyInputValue(value)}" data-money-input placeholder="0,00"></label>`;
  }
  return `<label>${label}<input type="number" name="${name}" value="${Number(value || 0)}" min="0" step="${step}"></label>`;
}

function renderManagementLegacy() {
  const data = state.management.data;
  const view = document.getElementById("view");
  if (!data) {
    view.innerHTML = `<div class="empty-state">Carregando indicadores gerenciais...</div>`;
    return;
  }
  const monthly = data.monthly || {};
  const comparison = data.monthlyComparison || {};
  const allSectors = [...new Set([...MANAGEMENT_SECTORS, ...(data.sectors || []).map((row) => row.sector)])].sort();
  const filteredSectors = state.management.filters.sector
    ? (data.sectors || []).filter((row) => row.sector === state.management.filters.sector)
    : (data.sectors || []);
  const totalLosses = (data.sectors || []).reduce((sum, row) => sum + Number(row.losses || 0), 0);
  const selectedSector = (data.sectors || []).find((row) => row.sector === state.management.filters.sector) || {};

  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Indicadores Gerenciais</h2>
        <div class="muted">Vendas, perdas, consumo e produtividade com comparativo mensal por setor</div>
      </div>
      <button class="btn" type="button" id="managementPdf">PDF</button>
    </div>

    <form class="panel grid management-filter" id="managementFilter">
      <label>Mes analisado
        <input type="month" name="period" value="${escapeHtml(state.management.filters.period)}" required>
      </label>
      <label>Comparar com
        <input type="month" name="comparePeriod" value="${escapeHtml(state.management.filters.comparePeriod)}" required>
      </label>
      <label>Setor
        <select name="sector">
          <option value="">Todos os setores</option>
          ${allSectors.map((sector) => `<option value="${escapeHtml(sector)}" ${state.management.filters.sector === sector ? "selected" : ""}>${escapeHtml(sector)}</option>`).join("")}
        </select>
      </label>
      <button class="btn primary" type="submit">Aplicar comparativo</button>
    </form>

    <div class="metrics management-metrics">
      <div class="metric"><span>Venda liquida</span><strong>${fmtMoney(monthly.net_sales)}</strong><small>Comparativo ${managementVariation(comparison.net_sales)}</small></div>
      <div class="metric"><span>Delivery</span><strong>${fmtMoney(monthly.delivery_total)}</strong><small>${managementPercent(monthly.delivery_participation)} da venda liquida</small></div>
      <div class="metric"><span>Venda cotacoes</span><strong>${fmtMoney(monthly.quotation_sales)}</strong><small>Lucro ${fmtMoney(monthly.quotation_profit)}</small></div>
      <div class="metric"><span>Perdas dos setores</span><strong>${fmtMoney(totalLosses)}</strong><small>Mes selecionado</small></div>
    </div>

    <section class="panel management-analysis">
      <div class="section-heading">
        <div>
          <h3>Comparativo por setor</h3>
          <div class="muted">O filtro acima tambem limita esta tabela e o relatorio em PDF.</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setor</th><th>Venda atual</th><th>Venda anterior</th><th>Variacao</th><th>Perdas</th><th>Consumo</th><th>Produtividade</th><th>Equipe</th></tr></thead>
          <tbody>
            ${filteredSectors.map((row) => `
              <tr>
                <td data-label="Setor"><strong>${escapeHtml(row.sector)}</strong></td>
                <td data-label="Venda atual">${fmtMoney(row.sales)}</td>
                <td data-label="Venda anterior">${fmtMoney(row.previous?.sales)}</td>
                <td data-label="Variacao">${managementVariation(row.comparison?.sales)}</td>
                <td data-label="Perdas">${fmtMoney(row.losses)} <small class="muted">(${managementPercent(row.loss_rate)})</small></td>
                <td data-label="Consumo">${fmtMoney(row.consumption)} <small class="muted">(${managementPercent(row.consumption_rate)})</small></td>
                <td data-label="Produtividade">${fmtMoney(row.sales_per_employee)} / funcionario</td>
                <td data-label="Equipe">${Number(row.employee_count || 0)} atual / ${Number(row.suggested_employees || 0).toFixed(1)} sugerido</td>
              </tr>
            `).join("") || `<tr><td colspan="8">Nenhum setor lancado neste mes.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel management-analysis">
      <h3>Desempenho dos operadores</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Operador</th><th>Venda liquida</th><th>Participacao</th><th>Cupons</th><th>Cancelados</th><th>Taxa cancelamento</th><th>VIP</th></tr></thead>
          <tbody>
            ${(data.operators || []).map((row) => `
              <tr>
                <td data-label="Operador"><strong>${escapeHtml(row.operator_name)}</strong></td>
                <td data-label="Venda liquida">${fmtMoney(row.net_sales)}</td>
                <td data-label="Participacao">${managementPercent(row.participation)}</td>
                <td data-label="Cupons">${Number(row.coupons || 0)}</td>
                <td data-label="Cancelados">${Number(row.cancelled_coupons || 0)}</td>
                <td data-label="Taxa">${managementPercent(row.cancellation_rate)}</td>
                <td data-label="VIP">${Number(row.vip || 0)}</td>
              </tr>
            `).join("") || `<tr><td colspan="7">Nenhum operador lancado neste mes.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <div class="management-entry-grid">
      <details class="panel management-entry">
        <summary>Registrar resumo mensal da loja</summary>
        <form class="grid" id="managementMonthlyForm">
          <input type="hidden" name="period" value="${escapeHtml(state.management.filters.period)}">
          <h4>Venda da loja</h4>
          <div class="grid three">
            ${managementNumberInput("grossSales", "Venda bruta", monthly.gross_sales)}
            ${managementNumberInput("cancelledSales", "Venda cancelada", monthly.cancelled_sales)}
            ${managementNumberInput("discounts", "Descontos", monthly.discounts)}
            ${managementNumberInput("netSales", "Venda liquida", monthly.net_sales)}
            ${managementNumberInput("coupons", "Cupons", monthly.coupons, "1")}
            ${managementNumberInput("averageTicket", "Cupom medio", monthly.average_ticket)}
            ${managementNumberInput("cancelledCoupons", "Cupons cancelados", monthly.cancelled_coupons, "1")}
            ${managementNumberInput("greenCoupons", "Cupons verdes", monthly.green_coupons, "1")}
            ${managementNumberInput("identifiedGreenCoupons", "Cupons verdes identificados", monthly.identified_green_coupons, "1")}
          </div>
          <h4>Delivery</h4>
          <div class="grid three">
            ${managementNumberInput("deliveryNetSales", "Venda liquida", monthly.delivery_net_sales)}
            ${managementNumberInput("deliveryCancelledSales", "Venda cancelada", monthly.delivery_cancelled_sales)}
            ${managementNumberInput("deliveryDiscounts", "Descontos", monthly.delivery_discounts)}
            ${managementNumberInput("deliveryCoupons", "Cupons", monthly.delivery_coupons, "1")}
            ${managementNumberInput("deliveryCancelledCoupons", "Cupons cancelados", monthly.delivery_cancelled_coupons, "1")}
            ${managementNumberInput("deliveryOtherCheckouts", "Outros checkouts", monthly.delivery_other_checkouts)}
            ${managementNumberInput("deliveryGoalNormal", "Meta normal", monthly.delivery_goal_normal)}
            ${managementNumberInput("deliveryGoalPlus", "Meta plus", monthly.delivery_goal_plus)}
          </div>
          <h4>Cotacoes</h4>
          <div class="grid two">
            ${managementNumberInput("quotationCost", "Custo", monthly.quotation_cost)}
            ${managementNumberInput("quotationSales", "Venda", monthly.quotation_sales)}
          </div>
          <button class="btn primary" type="submit">Salvar resumo mensal</button>
        </form>
      </details>

      <details class="panel management-entry" ${state.management.filters.sector ? "open" : ""}>
        <summary>Registrar indicadores de um setor</summary>
        <form class="grid" id="managementSectorForm">
          <input type="hidden" name="period" value="${escapeHtml(state.management.filters.period)}">
          <label>Setor
            <select name="sector" required>
              <option value="">Selecione</option>
              ${allSectors.map((sector) => `<option value="${escapeHtml(sector)}" ${selectedSector.sector === sector ? "selected" : ""}>${escapeHtml(sector)}</option>`).join("")}
            </select>
          </label>
          <div class="grid two">
            ${managementNumberInput("sales", "Venda do setor", selectedSector.sales)}
            ${managementNumberInput("losses", "Perdas", selectedSector.losses)}
            ${managementNumberInput("consumption", "Consumo", selectedSector.consumption)}
            ${managementNumberInput("employeeCount", "Quantidade de funcionarios", selectedSector.employee_count, "1")}
            ${managementNumberInput("productivityTarget", "Meta de venda por funcionario", selectedSector.productivity_target)}
            ${managementNumberInput("inventories", "Inventarios realizados", selectedSector.inventories, "1")}
          </div>
          <button class="btn primary" type="submit">Salvar setor</button>
        </form>
      </details>

      <details class="panel management-entry">
        <summary>Registrar venda por operador</summary>
        <form class="grid" id="managementOperatorForm">
          <input type="hidden" name="period" value="${escapeHtml(state.management.filters.period)}">
          <label>Operador <input name="operatorName" required></label>
          <div class="grid two">
            ${managementNumberInput("netSales", "Venda liquida", 0)}
            ${managementNumberInput("coupons", "Cupons", 0, "1")}
            ${managementNumberInput("cancelledCoupons", "Cupons cancelados", 0, "1")}
            ${managementNumberInput("vip", "Identificacoes VIP", 0, "1")}
          </div>
          <button class="btn primary" type="submit">Salvar operador</button>
        </form>
      </details>
    </div>
  `;

  document.getElementById("managementFilter").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.management.filters.period = form.get("period");
    state.management.filters.comparePeriod = form.get("comparePeriod");
    state.management.filters.sector = form.get("sector");
    await loadManagementIndicators();
    renderManagementIndicators();
  });

  document.getElementById("managementMonthlyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/management-indicators/monthly", {
      method: "POST",
      body: JSON.stringify(managementFormValues(event.currentTarget)),
    });
    await loadManagementIndicators();
    renderManagementIndicators();
    toast("Resumo mensal salvo.");
  });

  const sectorForm = document.getElementById("managementSectorForm");
  sectorForm.sector.addEventListener("change", () => {
    const row = (data.sectors || []).find((item) => item.sector === sectorForm.sector.value) || {};
    ["sales", "losses", "consumption"].forEach((name) => { sectorForm[name].value = formatMoneyInputValue(row[name]); });
    sectorForm.employeeCount.value = Number(row.employee_count || 0);
    sectorForm.productivityTarget.value = formatMoneyInputValue(row.productivity_target);
    sectorForm.inventories.value = Number(row.inventories || 0);
  });
  sectorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/management-indicators/sector", {
      method: "POST",
      body: JSON.stringify(managementFormValues(event.currentTarget)),
    });
    await loadManagementIndicators();
    renderManagementIndicators();
    toast("Indicadores do setor salvos.");
  });

  document.getElementById("managementOperatorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/management-indicators/operator", {
      method: "POST",
      body: JSON.stringify(managementFormValues(event.currentTarget)),
    });
    await loadManagementIndicators();
    renderManagementIndicators();
    toast("Venda do operador salva.");
  });

  document.getElementById("managementPdf").addEventListener("click", async () => {
    const qs = new URLSearchParams({
      period: state.management.filters.period,
      comparePeriod: state.management.filters.comparePeriod,
      sector: state.management.filters.sector,
    });
    const response = await fetch(`/api/management-indicators/pdf?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (!response.ok) throw new Error("Nao foi possivel gerar o PDF.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `indicadores-gerenciais-${state.management.filters.period}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  });
}

function managementMonthLabel(period) {
  if (!period) return "-";
  const [year, month] = period.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function managementDirectComparison(current, previous, field) {
  const value = Number(current?.[field] || 0);
  const previousValue = Number(previous?.[field] || 0);
  return {
    value,
    previous: previousValue,
    difference: value - previousValue,
    percent: previousValue ? (value - previousValue) / Math.abs(previousValue) : 0,
  };
}

function managementScreenHeader(title, subtitle, type, includeSector = false) {
  const data = state.management.data || { sectors: [] };
  const sectors = [...new Set([...MANAGEMENT_SECTORS, ...(data.sectors || []).map((row) => row.sector)])].sort();
  return `
    <div class="topbar">
      <div>
        <h2>${title}</h2>
        <div class="muted">${subtitle}</div>
      </div>
      <button class="btn" type="button" id="managementPdf" data-pdf-type="${type}">PDF</button>
    </div>
    <form class="panel grid management-filter ${includeSector ? "" : "without-sector"}" id="managementPeriodFilter">
      <label>Periodo analisado
        <input type="month" name="period" value="${escapeHtml(state.management.filters.period)}" required>
      </label>
      <label>Comparar com
        <input type="month" name="comparePeriod" value="${escapeHtml(state.management.filters.comparePeriod)}" required>
      </label>
      ${includeSector ? `
        <label>Setor
          <select name="sector">
            <option value="">Todos os setores</option>
            ${sectors.map((sector) => `<option value="${escapeHtml(sector)}" ${state.management.filters.sector === sector ? "selected" : ""}>${escapeHtml(sector)}</option>`).join("")}
          </select>
        </label>
      ` : ""}
      <button class="btn primary" type="submit">Comparar periodos</button>
    </form>
  `;
}

function managementEntryPeriodField() {
  const filters = state.management.filters;
  return `
    <label>Mes que deseja cadastrar ou editar
      <input type="month" name="period" value="${escapeHtml(filters.entryPeriod)}" data-management-entry-period required>
    </label>
  `;
}

function managementEntryMonthlyData() {
  return state.management.entryData?.monthly || {};
}

function managementComparisonCard(label, current, previous, comparison, format = fmtMoney, inverted = false) {
  return `
    <div class="metric">
      <span>${label}</span>
      <strong>${format(current)}</strong>
      <small>${managementMonthLabel(state.management.filters.comparePeriod)}: ${format(previous)}</small>
      <small>${managementVariation(comparison, inverted)}</small>
    </div>
  `;
}

function managementComparisonTable(rows) {
  return `
    <section class="panel management-analysis">
      <div class="section-heading">
        <div>
          <h3>Comparativo completo</h3>
          <div class="muted">Todos os indicadores do relatório original, comparados campo a campo.</div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="management-comparison-table">
          <thead>
            <tr><th>Indicador</th><th>${escapeHtml(managementMonthLabel(state.management.filters.period))}</th><th>${escapeHtml(managementMonthLabel(state.management.filters.comparePeriod))}</th><th>Diferença</th><th>Variação</th></tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
              const format = row.format || fmtMoney;
              const comparison = row.comparison || managementDirectComparison(
                { value: row.current },
                { value: row.previous },
                "value"
              );
              return `
                <tr>
                  <td data-label="Indicador"><strong>${escapeHtml(row.label)}</strong></td>
                  <td data-label="Periodo atual">${format(row.current)}</td>
                  <td data-label="Periodo comparado">${format(row.previous)}</td>
                  <td data-label="Diferenca">${format(comparison.difference)}</td>
                  <td data-label="Variacao">${managementVariation(comparison, Boolean(row.inverted))}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function bindManagementScreen(renderFunction, pdfType, includeSector = false) {
  document.getElementById("managementPeriodFilter").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.management.filters.period = form.get("period");
    state.management.filters.comparePeriod = form.get("comparePeriod");
    if (includeSector) state.management.filters.sector = form.get("sector");
    await loadManagementIndicators();
    renderFunction();
  });
  document.querySelectorAll("[data-management-entry-period]").forEach((select) => {
    select.addEventListener("change", async () => {
      state.management.filters.entryPeriod = select.value;
      await loadManagementEntryPeriod();
      renderFunction();
    });
  });
  document.getElementById("managementPdf").addEventListener("click", () => downloadManagementPdf(pdfType));
}

async function downloadManagementPdf(type) {
  const qs = new URLSearchParams({
    period: state.management.filters.period,
    comparePeriod: state.management.filters.comparePeriod,
    sector: state.management.filters.sector,
    type,
  });
  const response = await fetch(`/api/management-indicators/pdf?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  if (!response.ok) {
    toast("Nao foi possivel gerar o PDF.");
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `indicadores-${type}-${state.management.filters.period}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

async function saveManagementMonthlyForm(event, renderFunction, message) {
  event.preventDefault();
  await api("/api/management-indicators/monthly", {
    method: "POST",
    body: JSON.stringify(managementFormValues(event.currentTarget)),
  });
  await loadManagementIndicators();
  renderFunction();
  toast(message);
}

async function deleteManagementMonthly(type, renderFunction, label) {
  const period = state.management.filters.entryPeriod;
  if (!confirm(`Excluir o lançamento de ${label} de ${managementMonthLabel(period)}?`)) return;
  const qs = new URLSearchParams({ period, type });
  await api(`/api/management-indicators/monthly?${qs.toString()}`, { method: "DELETE" });
  await loadManagementIndicators();
  renderFunction();
  toast(`Lançamento de ${label} excluído.`);
}

async function deleteManagementSector(type, renderFunction, label) {
  const period = state.management.filters.entryPeriod;
  const sector = document.querySelector(
    '#managementSectorForm select[name="sector"], #managementProductivityForm select[name="sector"]'
  )?.value || state.management.filters.sector;
  if (!sector) {
    toast("Selecione um setor.");
    return;
  }
  if (!confirm(`Excluir ${label} de ${sector} em ${managementMonthLabel(period)}?`)) return;
  const qs = new URLSearchParams({ period, sector, type });
  await api(`/api/management-indicators/sector?${qs.toString()}`, { method: "DELETE" });
  await loadManagementIndicators();
  renderFunction();
  toast(`${label} excluído.`);
}

function renderManagementIndicators() {
  const data = state.management.data;
  if (!data) return;
  const monthly = data.monthly || {};
  const previous = data.previousMonthly || {};
  const comparison = data.monthlyComparison || {};
  const currentLosses = (data.sectors || []).reduce((sum, row) => sum + Number(row.losses || 0), 0);
  const previousLosses = (data.sectors || []).reduce((sum, row) => sum + Number(row.previous?.losses || 0), 0);
  const lossComparison = managementDirectComparison({ losses: currentLosses }, { losses: previousLosses }, "losses");
  view.innerHTML = `
    ${managementScreenHeader("Visao Geral", "Resumo dos principais indicadores, sempre comparando a mesma atividade entre dois periodos.", "all")}
    <div class="metrics management-metrics">
      ${managementComparisonCard("Venda liquida da loja", monthly.net_sales, previous.net_sales, comparison.net_sales)}
      ${managementComparisonCard("Delivery", monthly.delivery_total, previous.delivery_total, comparison.delivery_total)}
      ${managementComparisonCard("Venda de cotacoes", monthly.quotation_sales, previous.quotation_sales, comparison.quotation_sales)}
      ${managementComparisonCard("Perdas dos setores", currentLosses, previousLosses, lossComparison, fmtMoney, true)}
    </div>
    <section class="management-module-grid">
      <button class="management-module" data-management-open="managementStore"><strong>Venda Loja</strong><span>Venda, cupons, descontos e ticket medio</span></button>
      <button class="management-module" data-management-open="managementDelivery"><strong>Delivery</strong><span>Venda, participacao, metas e cancelamentos</span></button>
      <button class="management-module" data-management-open="managementQuotations"><strong>Cotacoes</strong><span>Venda, custo, lucro e margem</span></button>
      <button class="management-module" data-management-open="managementSectors"><strong>Perdas e Consumo</strong><span>Valores e percentuais por setor</span></button>
      <button class="management-module" data-management-open="managementProductivity"><strong>Produtividade Setor</strong><span>Venda por funcionario e dimensionamento</span></button>
      <button class="management-module" data-management-open="managementOperators"><strong>Operadores</strong><span>Venda e desempenho individual</span></button>
    </section>
  `;
  bindManagementScreen(renderManagementIndicators, "all");
  document.querySelectorAll("[data-management-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.tab = button.dataset.managementOpen;
      state.openNavGroup = "admin";
      await refreshForTab();
      renderShell();
    });
  });
}

function renderManagementStore() {
  const data = state.management.data;
  if (!data) return;
  const monthly = data.monthly || {};
  const previous = data.previousMonthly || {};
  const comparison = data.monthlyComparison || {};
  const entry = managementEntryMonthlyData();
  view.innerHTML = `
    ${managementScreenHeader("Venda Loja", "Compare exclusivamente os resultados gerais da loja entre dois meses.", "store")}
    <div class="metrics management-metrics">
      ${managementComparisonCard("Venda liquida", monthly.net_sales, previous.net_sales, comparison.net_sales)}
      ${managementComparisonCard("Venda bruta", monthly.gross_sales, previous.gross_sales, comparison.gross_sales)}
      ${managementComparisonCard("Cupons", monthly.coupons, previous.coupons, comparison.coupons, (value) => Number(value || 0).toLocaleString("pt-BR"))}
      ${managementComparisonCard("Ticket medio", monthly.average_ticket, previous.average_ticket, comparison.average_ticket)}
    </div>
    ${managementComparisonTable([
      { label: "Quantidade vendida", current: monthly.sold_quantity, previous: previous.sold_quantity, comparison: comparison.sold_quantity, format: (value) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 }) },
      { label: "Venda bruta", current: monthly.gross_sales, previous: previous.gross_sales, comparison: comparison.gross_sales },
      { label: "Venda cancelada", current: monthly.cancelled_sales, previous: previous.cancelled_sales, comparison: comparison.cancelled_sales, inverted: true },
      { label: "Valor de descontos", current: monthly.discounts, previous: previous.discounts, comparison: comparison.discounts, inverted: true },
      { label: "Percentual de descontos", current: monthly.discount_rate, previous: previous.discount_rate, comparison: comparison.discount_rate, format: managementPercent, inverted: true },
      { label: "Venda liquida", current: monthly.net_sales, previous: previous.net_sales, comparison: comparison.net_sales },
      { label: "Quantidade de cupons", current: monthly.coupons, previous: previous.coupons, comparison: comparison.coupons, format: (value) => Number(value || 0).toLocaleString("pt-BR") },
      { label: "Ticket medio", current: monthly.average_ticket, previous: previous.average_ticket, comparison: comparison.average_ticket },
      { label: "Cupons cancelados", current: monthly.cancelled_coupons, previous: previous.cancelled_coupons, comparison: comparison.cancelled_coupons, format: (value) => Number(value || 0).toLocaleString("pt-BR"), inverted: true },
      { label: "Taxa de cancelamento", current: monthly.cancellation_rate, previous: previous.cancellation_rate, comparison: comparison.cancellation_rate, format: managementPercent, inverted: true },
      { label: "Cupons verdes", current: monthly.green_coupons, previous: previous.green_coupons, comparison: comparison.green_coupons, format: (value) => Number(value || 0).toLocaleString("pt-BR") },
      { label: "Cupons verdes identificados", current: monthly.identified_green_coupons, previous: previous.identified_green_coupons, comparison: comparison.identified_green_coupons, format: (value) => Number(value || 0).toLocaleString("pt-BR") },
      { label: "Cupons verdes nao identificados", current: monthly.green_unidentified_coupons, previous: previous.green_unidentified_coupons, comparison: comparison.green_unidentified_coupons, format: (value) => Number(value || 0).toLocaleString("pt-BR"), inverted: true },
      { label: "Percentual identificado", current: monthly.green_identification_rate, previous: previous.green_identification_rate, comparison: comparison.green_identification_rate, format: managementPercent },
    ])}
    <form class="panel grid management-data-form" id="managementStoreForm">
      <div><h3>Lancamento mensal da loja</h3><div class="muted">Selecione qualquer mes que deseja cadastrar ou corrigir.</div></div>
      ${managementEntryPeriodField()}
      <div class="grid three">
        ${managementNumberInput("soldQuantity", "Quantidade vendida", entry.sold_quantity, "0.001")}
        ${managementNumberInput("grossSales", "Venda bruta", entry.gross_sales)}
        ${managementNumberInput("cancelledSales", "Venda cancelada", entry.cancelled_sales)}
        ${managementNumberInput("discounts", "Descontos", entry.discounts)}
        ${managementNumberInput("netSales", "Venda liquida", entry.net_sales)}
        ${managementNumberInput("coupons", "Cupons", entry.coupons, "1")}
        ${managementNumberInput("averageTicket", "Ticket medio", entry.average_ticket)}
        ${managementNumberInput("cancelledCoupons", "Cupons cancelados", entry.cancelled_coupons, "1")}
        ${managementNumberInput("greenCoupons", "Cupons verdes", entry.green_coupons, "1")}
        ${managementNumberInput("identifiedGreenCoupons", "Cupons verdes identificados", entry.identified_green_coupons, "1")}
      </div>
      <div class="toolbar">
        <button class="btn primary" type="submit">Salvar alterações</button>
        <button class="btn danger" type="button" id="deleteManagementStore">Excluir lançamento deste mês</button>
      </div>
    </form>
  `;
  bindManagementScreen(renderManagementStore, "store");
  document.getElementById("managementStoreForm").addEventListener("submit", (event) =>
    saveManagementMonthlyForm(event, renderManagementStore, "Venda da loja salva.")
  );
  document.getElementById("deleteManagementStore").addEventListener("click", () =>
    deleteManagementMonthly("store", renderManagementStore, "Venda Loja")
  );
}

function renderManagementDelivery() {
  const data = state.management.data;
  if (!data) return;
  const current = data.monthly || {};
  const previous = data.previousMonthly || {};
  const totalComparison = managementDirectComparison(current, previous, "delivery_total");
  const participationComparison = managementDirectComparison(current, previous, "delivery_participation");
  const couponsComparison = managementDirectComparison(current, previous, "delivery_coupons");
  const ticketComparison = managementDirectComparison(current, previous, "delivery_average_ticket");
  const entry = managementEntryMonthlyData();
  view.innerHTML = `
    ${managementScreenHeader("Delivery", "Delivery de um periodo comparado diretamente com o Delivery de outro periodo.", "delivery")}
    <div class="metrics management-metrics">
      ${managementComparisonCard("Venda Delivery", current.delivery_total, previous.delivery_total, totalComparison)}
      ${managementComparisonCard("Participacao na loja", current.delivery_participation, previous.delivery_participation, participationComparison, managementPercent)}
      ${managementComparisonCard("Cupons validos Delivery", current.delivery_valid_coupons, previous.delivery_valid_coupons, managementDirectComparison(current, previous, "delivery_valid_coupons"), (value) => Number(value || 0).toLocaleString("pt-BR"))}
      ${managementComparisonCard("Ticket medio Delivery", current.delivery_average_ticket, previous.delivery_average_ticket, ticketComparison)}
      ${managementComparisonCard("Venda cancelada", current.delivery_cancelled_sales, previous.delivery_cancelled_sales, managementDirectComparison(current, previous, "delivery_cancelled_sales"), fmtMoney, true)}
    </div>
    ${managementComparisonTable([
      { label: "Venda liquida Delivery", current: current.delivery_net_sales, previous: previous.delivery_net_sales, comparison: data.monthlyComparison.delivery_net_sales },
      { label: "Venda cancelada", current: current.delivery_cancelled_sales, previous: previous.delivery_cancelled_sales, comparison: data.monthlyComparison.delivery_cancelled_sales, inverted: true },
      { label: "Ticket medio sobre cupons validos", current: current.delivery_average_ticket, previous: previous.delivery_average_ticket, comparison: data.monthlyComparison.delivery_average_ticket },
      { label: "Valor de descontos", current: current.delivery_discounts, previous: previous.delivery_discounts, comparison: data.monthlyComparison.delivery_discounts, inverted: true },
      { label: "Percentual de descontos", current: current.delivery_discount_rate, previous: previous.delivery_discount_rate, comparison: data.monthlyComparison.delivery_discount_rate, format: managementPercent, inverted: true },
      { label: "Quantidade de cupons", current: current.delivery_coupons, previous: previous.delivery_coupons, comparison: data.monthlyComparison.delivery_coupons, format: (value) => Number(value || 0).toLocaleString("pt-BR") },
      { label: "Cupons cancelados", current: current.delivery_cancelled_coupons, previous: previous.delivery_cancelled_coupons, comparison: data.monthlyComparison.delivery_cancelled_coupons, format: (value) => Number(value || 0).toLocaleString("pt-BR"), inverted: true },
      { label: "Cupons validos", current: current.delivery_valid_coupons, previous: previous.delivery_valid_coupons, comparison: data.monthlyComparison.delivery_valid_coupons, format: (value) => Number(value || 0).toLocaleString("pt-BR") },
      { label: "Taxa de cancelamento", current: current.delivery_cancellation_rate, previous: previous.delivery_cancellation_rate, comparison: data.monthlyComparison.delivery_cancellation_rate, format: managementPercent, inverted: true },
      { label: "Venda em outros checkouts sem cupons", current: current.delivery_other_checkouts, previous: previous.delivery_other_checkouts, comparison: data.monthlyComparison.delivery_other_checkouts },
      { label: "Total Delivery", current: current.delivery_total, previous: previous.delivery_total, comparison: data.monthlyComparison.delivery_total },
      { label: "Participacao na venda da loja", current: current.delivery_participation, previous: previous.delivery_participation, comparison: data.monthlyComparison.delivery_participation, format: managementPercent },
      { label: "Resultado sobre meta normal", current: current.delivery_result_normal, previous: previous.delivery_result_normal, comparison: data.monthlyComparison.delivery_result_normal },
      { label: "Resultado sobre meta plus", current: current.delivery_result_plus, previous: previous.delivery_result_plus, comparison: data.monthlyComparison.delivery_result_plus },
    ])}
    <section class="panel management-comparison-detail">
      <h3>Metas do periodo analisado</h3>
      <div class="muted">Ticket medio calculado por venda liquida Delivery dividida pelos cupons validos (cupons Delivery menos cupons cancelados). Outros checkouts entram no total, mas nao entram no ticket medio por nao terem quantidade de cupons.</div>
      <div class="grid two">
        <div><span class="muted">Resultado sobre meta normal</span><strong>${fmtMoney(current.delivery_result_normal)}</strong></div>
        <div><span class="muted">Resultado sobre meta plus</span><strong>${fmtMoney(current.delivery_result_plus)}</strong></div>
      </div>
    </section>
    <form class="panel grid management-data-form" id="managementDeliveryForm">
      <div><h3>Lancamento de Delivery</h3><div class="muted">Escolha qualquer mes que deseja cadastrar ou editar.</div></div>
      ${managementEntryPeriodField()}
      <div class="grid three">
        ${managementNumberInput("deliveryNetSales", "Venda liquida", entry.delivery_net_sales)}
        ${managementNumberInput("deliveryCancelledSales", "Venda cancelada", entry.delivery_cancelled_sales)}
        ${managementNumberInput("deliveryDiscounts", "Descontos", entry.delivery_discounts)}
        ${managementNumberInput("deliveryCoupons", "Cupons", entry.delivery_coupons, "1")}
        ${managementNumberInput("deliveryCancelledCoupons", "Cupons cancelados", entry.delivery_cancelled_coupons, "1")}
        ${managementNumberInput("deliveryOtherCheckouts", "Outros checkouts", entry.delivery_other_checkouts)}
        ${managementNumberInput("deliveryGoalNormal", "Meta normal", entry.delivery_goal_normal)}
        ${managementNumberInput("deliveryGoalPlus", "Meta plus", entry.delivery_goal_plus)}
      </div>
      <div class="toolbar">
        <button class="btn primary" type="submit">Salvar alterações</button>
        <button class="btn danger" type="button" id="deleteManagementDelivery">Excluir lançamento deste mês</button>
      </div>
    </form>
  `;
  bindManagementScreen(renderManagementDelivery, "delivery");
  document.getElementById("managementDeliveryForm").addEventListener("submit", (event) =>
    saveManagementMonthlyForm(event, renderManagementDelivery, "Delivery salvo.")
  );
  document.getElementById("deleteManagementDelivery").addEventListener("click", () =>
    deleteManagementMonthly("delivery", renderManagementDelivery, "Delivery")
  );
}

function renderManagementQuotations() {
  const data = state.management.data;
  if (!data) return;
  const current = data.monthly || {};
  const previous = data.previousMonthly || {};
  const entry = managementEntryMonthlyData();
  view.innerHTML = `
    ${managementScreenHeader("Cotacoes", "Venda de cotacoes comparada com o mesmo indicador de outro mes.", "quotations")}
    <div class="metrics management-metrics">
      ${managementComparisonCard("Venda de cotacoes", current.quotation_sales, previous.quotation_sales, managementDirectComparison(current, previous, "quotation_sales"))}
      ${managementComparisonCard("Custo", current.quotation_cost, previous.quotation_cost, managementDirectComparison(current, previous, "quotation_cost"), fmtMoney, true)}
      ${managementComparisonCard("Lucro", current.quotation_profit, previous.quotation_profit, managementDirectComparison(current, previous, "quotation_profit"))}
      ${managementComparisonCard("Margem sobre venda", current.quotation_margin_sales, previous.quotation_margin_sales, managementDirectComparison(current, previous, "quotation_margin_sales"), managementPercent)}
    </div>
    ${managementComparisonTable([
      { label: "Custo das cotacoes", current: current.quotation_cost, previous: previous.quotation_cost, comparison: data.monthlyComparison.quotation_cost, inverted: true },
      { label: "Venda das cotacoes", current: current.quotation_sales, previous: previous.quotation_sales, comparison: data.monthlyComparison.quotation_sales },
      { label: "Lucro", current: current.quotation_profit, previous: previous.quotation_profit, comparison: data.monthlyComparison.quotation_profit },
      { label: "Participacao na venda da loja", current: current.quotation_participation, previous: previous.quotation_participation, comparison: data.monthlyComparison.quotation_participation, format: managementPercent },
      { label: "Margem sobre custo", current: current.quotation_margin_cost, previous: previous.quotation_margin_cost, comparison: data.monthlyComparison.quotation_margin_cost, format: managementPercent },
      { label: "Margem sobre venda", current: current.quotation_margin_sales, previous: previous.quotation_margin_sales, comparison: data.monthlyComparison.quotation_margin_sales, format: managementPercent },
    ])}
    <form class="panel grid management-data-form" id="managementQuotationForm">
      <div><h3>Lancamento de cotacoes</h3><div class="muted">Cadastre os dados de cada mes separadamente para formar o comparativo.</div></div>
      ${managementEntryPeriodField()}
      <div class="grid two">
        ${managementNumberInput("quotationCost", "Custo das cotacoes", entry.quotation_cost)}
        ${managementNumberInput("quotationSales", "Venda das cotacoes", entry.quotation_sales)}
      </div>
      <div class="toolbar">
        <button class="btn primary" type="submit">Salvar alterações</button>
        <button class="btn danger" type="button" id="deleteManagementQuotations">Excluir lançamento deste mês</button>
      </div>
    </form>
  `;
  bindManagementScreen(renderManagementQuotations, "quotations");
  document.getElementById("managementQuotationForm").addEventListener("submit", (event) =>
    saveManagementMonthlyForm(event, renderManagementQuotations, "Cotacoes salvas.")
  );
  document.getElementById("deleteManagementQuotations").addEventListener("click", () =>
    deleteManagementMonthly("quotations", renderManagementQuotations, "Cotações")
  );
}

function renderManagementSectors() {
  const data = state.management.data;
  if (!data) return;
  const entryData = state.management.entryData || { sectors: [] };
  const allSectors = [...new Set([
    ...MANAGEMENT_SECTORS,
    ...(data.sectors || []).map((row) => row.sector),
    ...(entryData.sectors || []).map((row) => row.sector),
  ])].sort();
  const rows = state.management.filters.sector
    ? (data.sectors || []).filter((row) => row.sector === state.management.filters.sector)
    : (data.sectors || []);
  const selectedSector = state.management.filters.sector || allSectors[0] || "";
  const entry = (entryData.sectors || []).find((row) => row.sector === selectedSector) || { sector: selectedSector };
  view.innerHTML = `
    ${managementScreenHeader("Perdas e Consumo", "Compare perdas e consumo do mesmo setor entre dois meses.", "losses", true)}
    <section class="panel management-analysis">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setor</th><th>Venda atual/anterior</th><th>Perdas atual/anterior</th><th>% perda atual/anterior</th><th>Variacao perdas</th><th>Consumo atual/anterior</th><th>% consumo atual/anterior</th><th>Inventarios atual/anterior</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td data-label="Setor"><strong>${escapeHtml(row.sector)}</strong></td>
                <td data-label="Venda">${fmtMoney(row.sales)} / ${fmtMoney(row.previous?.sales)}</td>
                <td data-label="Perdas">${fmtMoney(row.losses)} / ${fmtMoney(row.previous?.losses)}</td>
                <td data-label="% perda">${managementPercent(row.loss_rate)} / ${managementPercent(row.previous?.loss_rate)}</td>
                <td data-label="Variacao perdas">${managementVariation(row.comparison?.losses, true)}</td>
                <td data-label="Consumo">${fmtMoney(row.consumption)} / ${fmtMoney(row.previous?.consumption)}</td>
                <td data-label="% consumo">${managementPercent(row.consumption_rate)} / ${managementPercent(row.previous?.consumption_rate)}</td>
                <td data-label="Inventarios">${Number(row.inventories || 0)} / ${Number(row.previous?.inventories || 0)}</td>
              </tr>
            `).join("") || `<tr><td colspan="8">Nenhum dado cadastrado para os periodos.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    <form class="panel grid management-data-form" id="managementSectorForm">
      <div><h3>Lancamento de perdas e consumo</h3><div class="muted">Escolha o mes e o setor que deseja cadastrar.</div></div>
      <div class="grid two">
        ${managementEntryPeriodField()}
        <label>Setor
          <select name="sector" id="managementEntrySector" required>
            ${allSectors.map((sector) => `<option value="${escapeHtml(sector)}" ${sector === selectedSector ? "selected" : ""}>${escapeHtml(sector)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="grid three">
        ${managementNumberInput("sales", "Venda do setor", entry.sales)}
        ${managementNumberInput("losses", "Perdas", entry.losses)}
        ${managementNumberInput("consumption", "Consumo", entry.consumption)}
      </div>
      <div class="toolbar">
        <button class="btn primary" type="submit">Salvar alterações</button>
        <button class="btn danger" type="button" id="deleteManagementLosses">Excluir lançamento selecionado</button>
      </div>
    </form>
  `;
  bindManagementScreen(renderManagementSectors, "losses", true);
  document.getElementById("managementEntrySector").addEventListener("change", (event) => {
    state.management.filters.sector = event.target.value;
    renderManagementSectors();
  });
  document.getElementById("managementSectorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/management-indicators/sector", {
      method: "POST",
      body: JSON.stringify(managementFormValues(event.currentTarget)),
    });
    await loadManagementIndicators();
    renderManagementSectors();
    toast("Perdas e consumo salvos.");
  });
  document.getElementById("deleteManagementLosses").addEventListener("click", () =>
    deleteManagementSector("losses", renderManagementSectors, "Perdas e consumo")
  );
}

function renderManagementProductivity() {
  const data = state.management.data;
  if (!data) return;
  const entryData = state.management.entryData || { sectors: [] };
  const allSectors = [...new Set([
    ...MANAGEMENT_SECTORS,
    ...(data.sectors || []).map((row) => row.sector),
    ...(entryData.sectors || []).map((row) => row.sector),
  ])].sort();
  const rows = state.management.filters.sector
    ? (data.sectors || []).filter((row) => row.sector === state.management.filters.sector)
    : (data.sectors || []);
  const selectedSector = state.management.filters.sector || allSectors[0] || "";
  const entry = (entryData.sectors || []).find((row) => row.sector === selectedSector) || { sector: selectedSector };
  view.innerHTML = `
    ${managementScreenHeader("Produtividade por Setor", "Compare vendas, equipe e produtividade do mesmo setor entre dois meses.", "productivity", true)}
    <section class="panel management-analysis">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setor</th><th>Venda atual/anterior</th><th>Variacao venda</th><th>Meta por funcionario atual/anterior</th><th>Equipe atual/anterior</th><th>Venda por funcionario atual/anterior</th><th>Equipe sugerida atual/anterior</th><th>Diferenca de equipe</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td data-label="Setor"><strong>${escapeHtml(row.sector)}</strong></td>
                <td data-label="Venda">${fmtMoney(row.sales)} / ${fmtMoney(row.previous?.sales)}</td>
                <td data-label="Variacao">${managementVariation(row.comparison?.sales)}</td>
                <td data-label="Meta">${fmtMoney(row.productivity_target)} / ${fmtMoney(row.previous?.productivity_target)}</td>
                <td data-label="Equipe">${Number(row.employee_count || 0)} / ${Number(row.previous?.employee_count || 0)}</td>
                <td data-label="Produtividade">${fmtMoney(row.sales_per_employee)} / ${fmtMoney(row.previous?.sales_per_employee)}</td>
                <td data-label="Equipe sugerida">${Number(row.suggested_employees || 0).toFixed(1)} / ${Number(row.previous?.suggested_employees || 0).toFixed(1)}</td>
                <td data-label="Diferenca">${Number(row.staffing_difference || 0).toFixed(1)} / ${Number(row.previous?.staffing_difference || 0).toFixed(1)}</td>
              </tr>
            `).join("") || `<tr><td colspan="8">Nenhum dado cadastrado para os periodos.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    <form class="panel grid management-data-form" id="managementProductivityForm">
      <div><h3>Lancamento de produtividade</h3><div class="muted">Informe venda, equipe e meta de produtividade do setor.</div></div>
      <div class="grid two">
        ${managementEntryPeriodField()}
        <label>Setor
          <select name="sector" id="managementProductivitySector" required>
            ${allSectors.map((sector) => `<option value="${escapeHtml(sector)}" ${sector === selectedSector ? "selected" : ""}>${escapeHtml(sector)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="grid two">
        ${managementNumberInput("sales", "Venda do setor", entry.sales)}
        ${managementNumberInput("employeeCount", "Quantidade de funcionarios", entry.employee_count, "1")}
        ${managementNumberInput("productivityTarget", "Meta de venda por funcionario", entry.productivity_target)}
        ${managementNumberInput("inventories", "Inventarios realizados", entry.inventories, "1")}
      </div>
      <div class="toolbar">
        <button class="btn primary" type="submit">Salvar alterações</button>
        <button class="btn danger" type="button" id="deleteManagementProductivity">Excluir lançamento selecionado</button>
      </div>
    </form>
  `;
  bindManagementScreen(renderManagementProductivity, "productivity", true);
  document.getElementById("managementProductivitySector").addEventListener("change", (event) => {
    state.management.filters.sector = event.target.value;
    renderManagementProductivity();
  });
  document.getElementById("managementProductivityForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/management-indicators/sector", {
      method: "POST",
      body: JSON.stringify(managementFormValues(event.currentTarget)),
    });
    await loadManagementIndicators();
    renderManagementProductivity();
    toast("Produtividade do setor salva.");
  });
  document.getElementById("deleteManagementProductivity").addEventListener("click", () =>
    deleteManagementSector("productivity", renderManagementProductivity, "Produtividade")
  );
}

function renderManagementOperators() {
  const data = state.management.data;
  if (!data) return;
  const entryData = state.management.entryData || { operators: [] };
  const operatorName = state.management.filters.operatorName;
  const operatorEntry = (entryData.operators || []).find((row) => row.operator_name === operatorName) || {};
  const operatorNames = [...new Set([
    ...(data.operators || []).map((row) => row.operator_name),
    ...(entryData.operators || []).map((row) => row.operator_name),
  ])].sort();
  view.innerHTML = `
    ${managementScreenHeader("Operadores", "Compare a venda do mesmo operador entre dois meses.", "operators")}
    <section class="panel management-analysis">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Operador</th><th>Venda atual/anterior</th><th>Variacao</th><th>Participacao atual/anterior</th><th>Cupons atual/anterior</th><th>Cancelados atual/anterior</th><th>Taxa cancelamento atual/anterior</th><th>VIP atual/anterior</th><th>Acoes</th></tr></thead>
          <tbody>
            ${(data.operators || []).map((row) => `
              <tr>
                <td data-label="Operador"><strong>${escapeHtml(row.operator_name)}</strong></td>
                <td data-label="Venda">${fmtMoney(row.net_sales)} / ${fmtMoney(row.previous?.net_sales)}</td>
                <td data-label="Variacao">${managementVariation(row.comparison?.net_sales)}</td>
                <td data-label="Participacao">${managementPercent(row.participation)} / ${managementPercent(row.previous?.participation)}</td>
                <td data-label="Cupons">${Number(row.coupons || 0)} / ${Number(row.previous?.coupons || 0)}</td>
                <td data-label="Cancelados">${Number(row.cancelled_coupons || 0)} / ${Number(row.previous?.cancelled_coupons || 0)}</td>
                <td data-label="Taxa cancelamento">${managementPercent(row.cancellation_rate)} / ${managementPercent(row.previous?.cancellation_rate)}</td>
                <td data-label="VIP">${Number(row.vip || 0)} / ${Number(row.previous?.vip || 0)}</td>
                <td data-label="Acoes">
                  <div class="toolbar">
                    <button class="btn" type="button" data-edit-management-operator="${escapeHtml(row.operator_name)}" data-period="${escapeHtml(state.management.filters.period)}">Editar atual</button>
                    <button class="btn" type="button" data-edit-management-operator="${escapeHtml(row.operator_name)}" data-period="${escapeHtml(state.management.filters.comparePeriod)}">Editar anterior</button>
                  </div>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="9">Nenhum operador cadastrado para os periodos.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    <form class="panel grid management-data-form" id="managementOperatorForm">
      <div><h3>Lancamento por operador</h3><div class="muted">Use exatamente o mesmo nome nos dois meses para formar o comparativo.</div></div>
      ${managementEntryPeriodField()}
      <label>Operador <input name="operatorName" value="${escapeHtml(operatorName)}" required list="managementOperatorNames"></label>
      <datalist id="managementOperatorNames">${operatorNames.map((name) => `<option value="${escapeHtml(name)}">`).join("")}</datalist>
      <div class="grid two">
        ${managementNumberInput("netSales", "Venda liquida", operatorEntry.net_sales)}
        ${managementNumberInput("coupons", "Cupons", operatorEntry.coupons, "1")}
        ${managementNumberInput("cancelledCoupons", "Cupons cancelados", operatorEntry.cancelled_coupons, "1")}
        ${managementNumberInput("vip", "Identificacoes VIP", operatorEntry.vip, "1")}
      </div>
      <div class="toolbar">
        <button class="btn primary" type="submit">Salvar alterações</button>
        <button class="btn danger" type="button" id="deleteManagementOperator" ${operatorName ? "" : "disabled"}>Excluir operador deste mês</button>
      </div>
    </form>
  `;
  bindManagementScreen(renderManagementOperators, "operators");
  document.querySelectorAll("[data-edit-management-operator]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.management.filters.operatorName = button.dataset.editManagementOperator;
      state.management.filters.entryPeriod = button.dataset.period;
      await loadManagementEntryPeriod();
      renderManagementOperators();
      document.getElementById("managementOperatorForm").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  document.getElementById("managementOperatorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/management-indicators/operator", {
      method: "POST",
      body: JSON.stringify(managementFormValues(event.currentTarget)),
    });
    await loadManagementIndicators();
    renderManagementOperators();
    toast("Venda do operador salva.");
  });
  document.getElementById("deleteManagementOperator").addEventListener("click", async () => {
    const period = state.management.filters.entryPeriod;
    const name = state.management.filters.operatorName;
    if (!name || !confirm(`Excluir ${name} de ${managementMonthLabel(period)}?`)) return;
    const qs = new URLSearchParams({ period, operatorName: name });
    await api(`/api/management-indicators/operator?${qs.toString()}`, { method: "DELETE" });
    state.management.filters.operatorName = "";
    await loadManagementIndicators();
    renderManagementOperators();
    toast("Lançamento do operador excluído.");
  });
}

function renderUsers() {
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Acessos</h2>
        <div class="muted">Defina usuÃ¡rio e senha para cada colaborador acessar diretamente o checklist</div>
      </div>
    </div>
    <form class="panel grid" id="userForm">
      <input type="hidden" name="id">
      <div class="grid three">
        <label>Nome exibido <input name="displayName" required></label>
        <label>UsuÃ¡rio <input name="username" required autocomplete="off"></label>
        <label>Senha <input name="password" required autocomplete="new-password"></label>
      </div>
      <div class="grid three">
        <label>Perfil
          <select name="role" required>
            <option value="colaborador">Colaborador</option>
            <option value="prevencao">PrevenÃ§Ã£o</option>
            <option value="encarregada">Encarregada</option>
            <option value="gerente">Gerente</option>
            <option value="reposicao">ReposiÃ§Ã£o</option>
            <option value="recebimento">Recebimento</option>
            <option value="comercial">Comercial</option>
            <option value="administrador">Administrador</option>
          </select>
        </label>
        <label>Colaborador vinculado
          <select name="collaboratorId">
            <option value="">Sem vÃ­nculo</option>
            ${collaboratorOptions(false)}
          </select>
        </label>
        <label>Status
          <select name="status"><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select>
        </label>
      </div>
      <div class="toolbar">
        <button class="btn primary" type="submit" id="userSubmit">Criar acesso</button>
        <button class="btn hidden" type="button" id="cancelUserEdit">Cancelar ediÃ§Ã£o</button>
      </div>
    </form>
    <div class="table-wrap" style="margin-top:14px">
      <table><thead><tr><th>Nome</th><th>UsuÃ¡rio</th><th>Perfil</th><th>Colaborador</th><th>Status</th><th>AÃ§Ãµes</th></tr></thead><tbody>
        ${state.users.map((row) => `
          <tr>
            <td data-label="Nome">${escapeHtml(row.display_name)}</td>
            <td data-label="UsuÃ¡rio">${escapeHtml(row.username)}</td>
            <td data-label="Perfil">${escapeHtml(roleLabel(row.role))}</td>
            <td data-label="Colaborador">${escapeHtml(row.collaborator || "-")}</td>
            <td data-label="Status"><span class="status ${row.status === "ativo" ? "ok" : ""}">${escapeHtml(row.status)}</span></td>
            <td data-label="AÃ§Ãµes">
              <div class="toolbar">
                <button class="btn" type="button" data-edit-user="${row.id}">Editar</button>
                <button class="btn danger" type="button" data-delete-user="${row.id}">Excluir</button>
              </div>
            </td>
          </tr>
        `).join("") || `<tr><td colspan="6">Nenhum acesso cadastrado.</td></tr>`}
      </tbody></table>
    </div>
  `;

  const form = document.getElementById("userForm");
  const submitButton = document.getElementById("userSubmit");
  const cancelButton = document.getElementById("cancelUserEdit");

  function clearUserEdit() {
    form.reset();
    form.id.value = "";
    form.password.required = true;
    form.password.placeholder = "";
    submitButton.textContent = "Criar acesso";
    cancelButton.classList.add("hidden");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form).entries());
    if (!body.password) delete body.password;
    const id = body.id;
    delete body.id;
    await api(id ? `/api/users/${id}` : "/api/users", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    await loadUsers();
    renderUsers();
    toast(id ? "Acesso atualizado." : "Acesso criado.");
  });

  cancelButton.addEventListener("click", clearUserEdit);

  document.querySelectorAll("[data-edit-user]").forEach((button) => {
    button.addEventListener("click", () => {
      const access = state.users.find((item) => item.id === Number(button.dataset.editUser));
      if (!access) return;
      form.id.value = access.id;
      form.displayName.value = access.display_name;
      form.username.value = access.username;
      form.password.value = "";
      form.password.required = false;
      form.password.placeholder = "Preencha apenas se quiser trocar";
      form.role.value = access.role;
      form.collaboratorId.value = access.collaborator_id || "";
      form.status.value = access.status;
      submitButton.textContent = "Salvar alterações";
      cancelButton.classList.remove("hidden");
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  document.querySelectorAll("[data-delete-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const access = state.users.find((item) => item.id === Number(button.dataset.deleteUser));
      if (!access) return;
      const confirmed = confirm(`Excluir o acesso de ${access.display_name}?`);
      if (!confirmed) return;
      const result = await api(`/api/users/${access.id}`, { method: "DELETE" });
      await loadUsers();
      renderUsers();
      toast(result.message || "Acesso excluÃ­do.");
    });
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

bootstrap();


