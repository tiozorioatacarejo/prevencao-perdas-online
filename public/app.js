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
    filters: {
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
    },
  },
};

const app = document.getElementById("app");
const PRICE_DIVERGENCE_ACTIVITY = "Confer\u00eancia de precifica\u00e7\u00e3o";
const EXPIRED_PRODUCTS_ACTIVITY = "Verifica\u00e7\u00e3o de validades";
const SECTOR_REQUIRED_ACTIVITY_TERMS = ["validade", "ruptura", "precificacao", "preco"];
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
const ENCARREGADA_ONLY_ACTIVITIES = [
  "Lan\u00e7amento de perdas no sistema",
  "Lan\u00e7amento de consumo interno",
  "Contagem e acompanhamento de vasilhames",
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
    if (!response.ok) throw new Error(data.error || "Falha ao processar solicitaÃ§Ã£o.");
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
  return ["administrador", "reposicao", "comercial"].includes(state.user?.role);
}

function canFillEncarregadaOnly() {
  return state.user?.role === "encarregada";
}

function checklistActivitiesForUser() {
  return state.activities.filter((activity) => (
    canFillEncarregadaOnly() || !ENCARREGADA_ONLY_ACTIVITIES.includes(activity)
  ));
}

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = normalizeText(message);
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
    node.nodeValue = normalizeText(node.nodeValue);
  });
  root.querySelectorAll("input[placeholder], textarea[placeholder], [title], [aria-label]").forEach((field) => {
    if (field.hasAttribute("placeholder")) field.placeholder = normalizeText(field.placeholder);
    if (field.title) field.title = normalizeText(field.title);
    if (field.getAttribute("aria-label")) field.setAttribute("aria-label", normalizeText(field.getAttribute("aria-label")));
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
    gerente: ["encarregada"],
    reposicao: ["reposicao"],
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
  } catch {
    logout();
  }
}

function logout() {
  state.token = "";
  state.user = null;
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  renderLogin();
}

function tabIcon(id) {
  const icons = {
    dashboard: "&#128200;",
    repoDashboard: "&#9673;",
    commercialDashboard: "&#128188;",
    checklist: "&#9745;",
    summary: "&#128221;",
    reports: "&#128202;",
    reposition: "&#128230;",
    commercial: "&#128179;",
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
    encarregada: "Gerente",
    reposicao: "Reposição",
    comercial: "Comercial",
  };
  return labels[role] || role || "";
}

function userInitial(name) {
  return normalizeText(name || "A").trim().charAt(0).toUpperCase() || "A";
}

function renderShell() {
  const tabs = allowedTabs();
  if (!tabs.some(([id]) => id === state.tab)) state.tab = tabs[0][0];
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
          ${tabs.map(([id, label]) => `
            <button class="${state.tab === id ? "active" : ""}" data-tab="${id}">
              <span class="nav-icon" aria-hidden="true">${tabIcon(id)}</span>
              <span class="nav-label">${label}</span>
            </button>
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
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.tab = button.dataset.tab;
      await refreshForTab();
      renderShell();
    });
  });
  document.getElementById("logoutBtn").addEventListener("click", logout);
  renderView();
}

async function refreshForTab() {
  if (state.tab === "dashboard") await loadDashboard();
  if (state.tab === "repoDashboard" || state.tab === "commercialDashboard") await Promise.all([loadCollaborators(), loadReposition()]);
  if (state.tab === "sectorAudit") await Promise.all([loadCollaborators(), loadSectorAudits()]);
  if (state.tab === "collaborators" || state.tab === "checklist" || state.tab === "pendencies") await loadCollaborators();
  if (state.tab === "reposition" || state.tab === "commercial") await Promise.all([loadCollaborators(), loadReposition()]);
  if (state.tab === "reports") await loadChecklists();
  if (state.tab === "pendencies") await loadPendencies();
  if (state.tab === "users") await Promise.all([loadUsers(), loadCollaborators()]);
}

function renderView() {
  const map = {
    dashboard: renderDashboard,
    repoDashboard: renderRepoDashboard,
    commercialDashboard: renderCommercialDashboard,
    checklist: renderChecklist,
    summary: renderSummary,
    reports: renderReports,
    reposition: renderReposition,
    commercial: renderCommercial,
    sectorAudit: renderSectorAudit,
    pendencies: renderPendencies,
    collaborators: renderCollaborators,
    users: renderUsers,
  };
  map[state.tab]();
  fixVisibleText(app);
}

function allowedTabs() {
  if (state.user?.role === "reposicao") return [["repoDashboard", "Painel Reposi\u00e7\u00e3o"], ["reposition", "Reposi\u00e7\u00e3o"]];
  if (state.user?.role === "comercial") return [["commercialDashboard", "Painel Comercial"], ["commercial", "Comercial"]];
  if (state.user?.role === "encarregada") {
    return [
      ["sectorAudit", "Conferência Gerencial"],
      ["reports", "Relatórios"],
      ["pendencies", "Pendências"],
    ];
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
    ["commercialDashboard", "Painel Comercial"],
    ["sectorAudit", "Confer\u00eancia Gerencial"],
    ["checklist", "Checklist"],
    ["reposition", "ReposiÃ§Ã£o"],
    ["commercial", "Comercial"],
    ["summary", "Resumo"],
    ["reports", "RelatÃ³rios"],
    ["pendencies", "PendÃªncias"],
    ["collaborators", "Colaboradores"],
  ];
  tabs.push(["users", "Acessos"]);
  return tabs;
}

function defaultTab() {
  if (state.user?.role === "reposicao") return "repoDashboard";
  if (state.user?.role === "comercial") return "commercialDashboard";
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

async function loadReposition() {
  const qs = new URLSearchParams(state.repo.filters);
  const [dashboard, tasks, ruptures, expirations, damages] = await Promise.all([
    api(`/api/reposition/dashboard?${qs.toString()}`),
    api(`/api/reposition/tasks?${qs.toString()}`),
    api(`/api/reposition/ruptures?${qs.toString()}`),
    api(`/api/reposition/expirations?${qs.toString()}`),
    api(`/api/reposition/damages?${qs.toString()}`),
  ]);
  state.repo.dashboard = dashboard;
  state.repo.tasks = tasks.rows;
  state.repo.ruptures = ruptures.rows;
  state.repo.expirations = expirations.rows;
  state.repo.damages = damages.rows;
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
    <div class="grid two" style="margin-top:14px">
      <section class="panel">
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
      <section class="panel">
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
    </div>
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
    ["Setor", "Itens identificados", "Rupturas", "Validades", "Avarias"],
    ...(data.bySector || []).map((row) => [
      row.sector,
      Number(row.ruptures || 0) + Number(row.expirations || 0) + Number(row.damages || 0),
      row.ruptures || 0,
      row.expirations || 0,
      row.damages || 0,
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
      <label>ObservaÃ§Ã£o
        <textarea name="observation"></textarea>
      </label>
      <button class="btn primary" type="submit">Enviar checklist</button>
    </form>
  `;
  const checklistForm = document.getElementById("checklistForm");
  const activitySelect = checklistForm.elements.activity;
  const priceField = checklistForm.querySelector("[data-price-divergence-field]");
  const expiredField = checklistForm.querySelector("[data-expired-products-field]");
  const sectorField = checklistForm.querySelector("[data-product-sector-field]");
  const syncChecklistSpecificFields = () => {
    const activity = activitySelect.value;
    const showPrice = activity === PRICE_DIVERGENCE_ACTIVITY;
    const showExpired = activity === EXPIRED_PRODUCTS_ACTIVITY;
    const showSector = activityNeedsProductSector(activity);
    priceField.hidden = !showPrice;
    expiredField.hidden = !showExpired;
    sectorField.hidden = !showSector;
    priceField.classList.toggle("hidden", !showPrice);
    expiredField.classList.toggle("hidden", !showExpired);
    sectorField.classList.toggle("hidden", !showSector);
    checklistForm.elements.sector.required = showSector;
    if (!showPrice) checklistForm.elements.priceDivergenceProducts.value = "";
    if (!showExpired) checklistForm.elements.expiredProducts.value = "";
    if (!showSector) checklistForm.elements.sector.value = "";
  };
  activitySelect.addEventListener("change", syncChecklistSpecificFields);
  syncChecklistSpecificFields();
  checklistForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    await api("/api/checklists", { method: "POST", body: JSON.stringify(body) });
    form.reset();
    syncChecklistSpecificFields();
    toast("Checklist enviado com data e hora registradas.");
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
        <h2>RelatÃ³rios</h2>
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
    <table><thead><tr><th>Data</th><th>Colaborador</th><th>Atividade</th><th>Setor</th><th>Produtos identificados</th><th>Resposta</th><th>ObservaÃ§Ã£o</th><th>Enviado em</th>${showActions ? "<th>AÃ§Ãµes</th>" : ""}</tr></thead><tbody>
      ${state.checklists.map((row) => `
        <tr>
          <td data-label="Data">${fmtDate(row.date)}</td>
          <td data-label="Colaborador">${escapeHtml(row.collaborator)}</td>
          <td data-label="Atividade">${escapeHtml(row.activity)}</td>
          <td data-label="Setor">${escapeHtml(row.sector || "-")}</td>
          <td data-label="Produtos identificados">${escapeHtml(checklistProductDetails(row) || "-")}</td>
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
      `).join("") || `<tr><td colspan="${showActions ? 9 : 8}">Nenhum registro encontrado.</td></tr>`}
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
  return items.map((item) => `<option ${item === selected ? "selected" : ""}>${escapeHtml(item)}</option>`).join("");
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
        <div class="muted" style="margin-top:4px">Soma de rupturas, validades e avarias registradas no período</div>
        <div class="table-wrap" style="margin-top:12px">${repoSectorTable(data.bySector || [])}</div>
      </section>
      <section class="panel">
        <h3>Engajamento da reposição</h3>
        <div class="muted" style="margin-top:4px">Participação dos usuários de reposição nos checklists do período</div>
        <div class="table-wrap" style="margin-top:12px">${repoUserEngagementTable(data.repoUserEngagement || [])}</div>
      </section>
    </div>
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
        <div class="muted">Atividades, rupturas, validades, avarias e retorno comercial</div>
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
    <div class="grid two" style="margin-top:14px">
      <section class="panel">${repoTaskForm()}</section>
      <section class="panel">${repoIssueForm("ruptures", "Rupturas", "Produto em falta", [["type", "Tipo", ["Ruptura total", "Proximo de ruptura"]], ["quantity", "Quantidade"]])}</section>
    </div>
    <div class="grid two" style="margin-top:14px">
      <section class="panel">${repoIssueForm("expirations", "Validades", "Produto com validade curta", [["expirationDate", "Data de validade", "date"], ["quantity", "Quantidade"]])}</section>
      <section class="panel">${repoDamageForm()}</section>
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

function repoDamageForm() {
  return `
    <h3>Avarias</h3>
    <form class="grid" id="repo-damages-form" data-repo-kind="damages" style="margin-top:12px">
      <div class="grid two">
        <label>Data <input name="date" type="date" value="${todayInputValue()}"></label>
        <label>Setor <select name="sector">${repoSectorOptionsForCurrentUser()}</select></label>
      </div>
      <label>Produto <input name="product" required></label>
      <div class="grid two">
        <label>Quantidade <input name="quantity"></label>
        <label>Motivo <input name="reason"></label>
      </div>
      <label>AÃ§Ã£o tomada <input name="action"></label>
      <button class="btn primary" type="submit">Salvar avaria</button>
    </form>
  `;
}

function bindRepoForms() {
  const taskForm = document.getElementById("repoTaskForm");
  const syncRepoTaskSector = () => {
    const collaboratorId = taskForm.elements.collaboratorId?.value;
    const sectorField = taskForm.elements.sector;
    const collaborator = state.collaborators.find((item) => Number(item.id) === Number(collaboratorId));
    const assigned = collaboratorSectors(collaborator);
    if (!sectorField || sectorField.tagName !== "SELECT") return;
    sectorField.innerHTML = repoOptions(assigned.length ? assigned : state.repo.sectors);
  };
  taskForm.elements.collaboratorId?.addEventListener("change", syncRepoTaskSector);
  syncRepoTaskSector();

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
    <table><thead><tr><th>Setor</th><th>Itens identificados</th><th>Rupturas</th><th>Validades</th><th>Avarias</th></tr></thead><tbody>
      ${rows.map((row) => {
        const identified = Number(row.ruptures || 0) + Number(row.expirations || 0) + Number(row.damages || 0);
        return `<tr><td data-label="Setor">${escapeHtml(row.sector)}</td><td data-label="Itens identificados">${identified}</td><td data-label="Rupturas">${row.ruptures || 0}</td><td data-label="Validades">${row.expirations || 0}</td><td data-label="Avarias">${row.damages || 0}</td></tr>`;
      }).join("") || `<tr><td colspan="5">Sem registros.</td></tr>`}
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
  const managerMetricLabel = state.user?.role === "encarregada" ? "Avaliações feitas por você" : "Avaliações registradas";
  const managerMetricValue = state.user?.role === "encarregada" ? auditSummary.evaluatedByUser : auditSummary.evaluatedTotal;
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Conferência Gerencial</h2>
        <div class="muted">Confronto entre o que a reposição informou e a validação da gerente</div>
      </div>
      <button class="btn" id="refreshSectorAudit">Atualizar</button>
    </div>
    <form class="panel grid" id="sectorAuditFilterForm" style="margin-bottom:14px">
      <div class="grid three">
        <label>Início <input name="startDate" type="date" value="${escapeHtml(state.auditFilters.startDate)}"></label>
        <label>Fim <input name="endDate" type="date" value="${escapeHtml(state.auditFilters.endDate)}"></label>
        <label>O que deseja conferir?
          <select name="focus">
            ${AUDIT_FOCUS_OPTIONS.map(([value, label]) => `<option value="${value}" ${state.auditFilters.focus === value ? "selected" : ""}>${label}</option>`).join("")}
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
  const rows = state.sectorAudits || [];
  return `
    <table>
      <thead>
        <tr>
          <th>Setor</th>
          <th>Conferência</th>
          <th>Status automático</th>
          <th>Motivos</th>
          <th>Responsáveis</th>
          <th>Validação gerente</th>
          <th>Ação</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td data-label="Setor">
              <strong>${escapeHtml(row.sector)}</strong>
              <div class="muted">Última atualização: ${row.lastUpdate ? new Date(row.lastUpdate).toLocaleString("pt-BR") : "-"}</div>
            </td>
            <td data-label="Conferência">${escapeHtml(row.focusLabel || "")}</td>
            <td data-label="Status automático">
              <span class="status ${auditStatusClass(row.automaticStatus)}">${escapeHtml(row.automaticStatus)}</span>
              <div class="muted" style="margin-top:6px">${row.expectedTasks ? `${row.completedTasks || 0}/${row.expectedTasks || 0} registros esperados` : "Conferência por ocorrência"}</div>
            </td>
            <td data-label="Motivos">
              ${(row.motives || []).map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
              ${(row.notes || []).length ? `<div class="muted" style="margin-top:6px">${row.notes.map(escapeHtml).join("<br>")}</div>` : ""}
            </td>
            <td data-label="Responsáveis">${escapeHtml(row.responsible || "-")}</td>
            <td data-label="Validação gerente">
              <div class="grid" style="gap:8px">
                <select data-audit-status="${escapeHtml(row.sector)}">
                  ${["Pendente", "Confere", "N\u00e3o confere", "Corrigir"].map((status) => `<option ${status === row.managerStatus ? "selected" : ""}>${status}</option>`).join("")}
                </select>
                <textarea data-audit-observation="${escapeHtml(row.sector)}" placeholder="Observação da gerente">${escapeHtml(row.managerObservation || "")}</textarea>
                <input data-audit-action="${escapeHtml(row.sector)}" value="${escapeHtml(row.actionRequired || "")}" placeholder="Ação cobrada">
                <div class="grid two">
                  <input data-audit-responsible="${escapeHtml(row.sector)}" value="${escapeHtml(row.auditResponsible || "")}" placeholder="Responsável acionado">
                  <input data-audit-due="${escapeHtml(row.sector)}" type="date" value="${escapeHtml(row.dueDate || "")}">
                </div>
                <div class="muted">${row.auditedAt ? `Última validação: ${new Date(row.auditedAt).toLocaleString("pt-BR")} por ${escapeHtml(row.auditedBy || "-")}` : "Ainda não validado pela gerente."}</div>
              </div>
            </td>
            <td data-label="Ação"><button class="btn primary" type="button" data-save-sector-audit="${escapeHtml(row.sector)}">Salvar</button></td>
          </tr>
        `).join("") || `<tr><td colspan="7">Sem setores para conferência.</td></tr>`}
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
        actionRequired: document.querySelector(`[data-audit-action="${CSS.escape(sector)}"]`).value,
        responsible: document.querySelector(`[data-audit-responsible="${CSS.escape(sector)}"]`).value,
        dueDate: document.querySelector(`[data-audit-due="${CSS.escape(sector)}"]`).value,
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
            <option value="encarregada">Gerente</option>
            <option value="reposicao">ReposiÃ§Ã£o</option>
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


