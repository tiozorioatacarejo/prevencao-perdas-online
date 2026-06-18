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
  users: [],
  dashboard: null,
  repo: {
    sectors: [],
    activities: [],
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
const PRICE_DIVERGENCE_ACTIVITY = "Conferência de precificação";
const EXPIRED_PRODUCTS_ACTIVITY = "Verificação de validades";
const ENCARREGADA_ONLY_ACTIVITIES = [
  "Lançamento de perdas no sistema",
  "Lançamento de consumo interno",
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
    if (!response.ok) throw new Error(data.error || "Falha ao processar solicitação.");
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
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderLogin(error = "") {
  app.innerHTML = `
    <section class="login-screen">
      <form class="login-panel" id="loginForm">
        <div class="brand">
          <div class="brand-mark">PP</div>
          <div>
            <h1>Prevenção de Perdas</h1>
            <div class="muted">Atacarejo Antônio de Ozório</div>
          </div>
        </div>
        <div class="grid">
          <label>Usuário
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
  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const data = await api("/api/login", { method: "POST", body: JSON.stringify(body) });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      await bootstrap();
    } catch (err) {
      renderLogin(err.message);
    }
  });
}

async function bootstrap() {
  if (!state.token) return renderLogin();
  try {
    const me = await api("/api/me");
    state.user = me.user;
    state.activities = me.activities;
    if (canAccessReposition()) {
      const repoOptions = await api("/api/reposition/options");
      state.repo.sectors = repoOptions.sectors;
      state.repo.activities = repoOptions.activities;
    }
    state.tab = defaultTab();
    await loadCollaborators();
    if (state.tab === "dashboard") await loadDashboard();
    if (state.tab === "reposition") await loadReposition();
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

function renderShell() {
  const tabs = allowedTabs();
  if (!tabs.some(([id]) => id === state.tab)) state.tab = tabs[0][0];
  app.innerHTML = `
    <section class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">PP</div>
          <div>
            <h3>Atacarejo Antônio de Ozório</h3>
            <div class="muted">${escapeHtml(state.user.display_name)} · ${escapeHtml(state.user.role)}</div>
          </div>
        </div>
        <nav class="nav">
          ${tabs.map(([id, label]) => `<button class="${state.tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`).join("")}
        </nav>
        <button class="btn danger" id="logoutBtn">Sair</button>
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
  if (state.tab === "collaborators" || state.tab === "checklist" || state.tab === "pendencies") await loadCollaborators();
  if (state.tab === "reposition") await Promise.all([loadCollaborators(), loadReposition()]);
  if (state.tab === "reports") await loadChecklists();
  if (state.tab === "pendencies") await loadPendencies();
  if (state.tab === "users") await Promise.all([loadUsers(), loadCollaborators()]);
}

function renderView() {
  const map = {
    dashboard: renderDashboard,
    checklist: renderChecklist,
    summary: renderSummary,
    reports: renderReports,
    reposition: renderReposition,
    pendencies: renderPendencies,
    collaborators: renderCollaborators,
    users: renderUsers,
  };
  map[state.tab]();
}

function allowedTabs() {
  if (state.user?.role === "reposicao") return [["reposition", "Reposicao"]];
  if (state.user?.role === "comercial") return [["reposition", "Reposicao"]];
  if (state.user?.role !== "administrador") {
    const tabs = [
      ["dashboard", "Painel"],
      ["checklist", "Checklist"],
      ["reposition", "Reposicao"],
      ["pendencies", "Pendências"],
    ];
    if (canAccessSummary()) tabs.splice(2, 0, ["summary", "Resumo"]);
    return tabs.filter(([id]) => id !== "reposition");
  }
  const tabs = [
    ["dashboard", "Painel"],
    ["checklist", "Checklist"],
    ["reposition", "Reposicao"],
    ["summary", "Resumo"],
    ["reports", "Relatórios"],
    ["pendencies", "Pendências"],
    ["collaborators", "Colaboradores"],
  ];
  tabs.push(["users", "Acessos"]);
  return tabs;
}

function defaultTab() {
  if (["reposicao", "comercial"].includes(state.user?.role)) return "reposition";
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
    api("/api/reposition/ruptures"),
    api("/api/reposition/expirations"),
    api("/api/reposition/damages"),
  ]);
  state.repo.dashboard = dashboard;
  state.repo.tasks = tasks.rows;
  state.repo.ruptures = ruptures.rows;
  state.repo.expirations = expirations.rows;
  state.repo.damages = damages.rows;
}

function renderDashboard() {
  const data = state.dashboard || {
    summary: {},
    totalsByDay: [],
    byCollaborator: [],
    collaboratorCompletion: [],
    activityCompletion: [],
    pendingToday: 0,
  };
  const summary = data.summary || {};
  const monthLabel = data.month?.label || "mês atual";
  const metrics = [
    ["Checklists pendentes", data.pendingToday || 0],
    ["Perdas lançadas", fmtMoney(summary.losses)],
    ["Consumos internos", fmtMoney(summary.consumptions)],
    ["Contagem de vasilhames", summary.bottles || 0],
    ["Recebimentos", summary.receipts || 0],
    ["Produtos vencidos", summary.expired || 0],
    ["Divergências de preço", summary.divergences || 0],
    ["Dias com checklist", data.totalsByDay.length],
  ];
  const max = Math.max(...data.totalsByDay.map((row) => row.total), 1);
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Dashboard gerencial</h2>
        <div class="muted">Indicadores operacionais do período registrado e percentuais de ${escapeHtml(monthLabel)}</div>
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
            <option value="period" ${state.dashboardFilters.mode === "period" ? "selected" : ""}>Período</option>
            <option value="month" ${state.dashboardFilters.mode === "month" ? "selected" : ""}>Mês</option>
          </select>
        </label>
        <label data-dashboard-day>Data <input name="date" type="date" value="${escapeHtml(state.dashboardFilters.date)}"></label>
        <label data-dashboard-period>Início <input name="startDate" type="date" value="${escapeHtml(state.dashboardFilters.startDate)}"></label>
        <label data-dashboard-period>Fim <input name="endDate" type="date" value="${escapeHtml(state.dashboardFilters.endDate)}"></label>
        <label data-dashboard-month>Mês <input name="month" type="month" value="${escapeHtml(state.dashboardFilters.month)}"></label>
      </div>
      <button class="btn primary" type="submit">Aplicar filtro</button>
    </form>
    <div class="metrics">${metrics.map(([label, value]) => `<div class="metric"><span class="muted">${label}</span><strong>${value}</strong></div>`).join("")}</div>
    <div class="grid two" style="margin-top:14px">
      <section class="panel">
        <h3>Total de checklists por dia</h3>
        <div class="mini-bars" style="margin-top:12px">
          ${data.totalsByDay.map((row) => `
            <div class="bar-row"><span>${fmtDate(row.date)}</span><div class="bar"><span style="width:${(row.total / max) * 100}%"></span></div><strong>${row.total}</strong></div>
          `).join("") || `<div class="muted">Sem registros.</div>`}
        </div>
      </section>
      <section class="panel">
        <h3>Ocorrências por colaborador</h3>
        <div class="table-wrap" style="margin-top:12px">
          <table><thead><tr><th>Colaborador</th><th>Ocorrências</th></tr></thead><tbody>
            ${data.byCollaborator.map((row) => `<tr><td data-label="Colaborador">${escapeHtml(row.name)}</td><td data-label="Ocorrências">${row.total}</td></tr>`).join("") || `<tr><td colspan="2">Sem ocorrências.</td></tr>`}
          </tbody></table>
        </div>
      </section>
    </div>
    <div class="grid two" style="margin-top:14px">
      <section class="panel">
        <h3>Engajamento por colaborador</h3>
        <div class="muted" style="margin-top:4px">Participação nos preenchimentos do mês, sem considerar perdas, consumos e vasilhames</div>
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
        <h3>Percentual de realização das atividades</h3>
        <div class="muted" style="margin-top:4px">Meta: dias do mês; conta o dia quando a atividade foi registrada ao menos uma vez</div>
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
    ["Relatório do painel", data.month?.label || ""],
    [],
    ["Indicador", "Valor"],
    ["Checklists pendentes", data.pendingToday || 0],
    ["Perdas lançadas", data.summary?.losses || 0],
    ["Consumos internos", data.summary?.consumptions || 0],
    ["Contagem de vasilhames", data.summary?.bottles || 0],
    ["Recebimentos", data.summary?.receipts || 0],
    [],
    ["Engajamento por colaborador"],
    ["Colaborador", "Preenchimentos", "Percentual"],
    ...(data.collaboratorCompletion || []).map((row) => [row.name, row.total, `${row.percent}%`]),
    [],
    ["Realização das atividades"],
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

function collaboratorOptions(activeOnly = true) {
  return state.collaborators
    .filter((item) => !activeOnly || item.status === "ativo")
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)} - ${escapeHtml(item.role)}</option>`)
    .join("");
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
        <select name="collaboratorId" required>${collaboratorOptions()}</select>
      </label>
    `;
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Checklist diário</h2>
        <div class="muted">${linkedCollaborator ? "Acesso vinculado ao seu cadastro" : "Data e horário são registrados automaticamente no envio"}</div>
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
        <label>Sim / Não
          <select name="answer" required><option>Sim</option><option>Não</option></select>
        </label>
        <label data-price-divergence-field>Produtos com divergência de preços <textarea name="priceDivergenceProducts"></textarea></label>
      </div>
      <label data-expired-products-field>Produtos vencidos encontrados <textarea name="expiredProducts"></textarea></label>
      <label>Observação
        <textarea name="observation"></textarea>
      </label>
      <button class="btn primary" type="submit">Enviar checklist</button>
    </form>
  `;
  const checklistForm = document.getElementById("checklistForm");
  const activitySelect = checklistForm.elements.activity;
  const priceField = checklistForm.querySelector("[data-price-divergence-field]");
  const expiredField = checklistForm.querySelector("[data-expired-products-field]");
  const syncChecklistSpecificFields = () => {
    const activity = activitySelect.value;
    const showPrice = activity === PRICE_DIVERGENCE_ACTIVITY;
    const showExpired = activity === EXPIRED_PRODUCTS_ACTIVITY;
    priceField.hidden = !showPrice;
    expiredField.hidden = !showExpired;
    priceField.classList.toggle("hidden", !showPrice);
    expiredField.classList.toggle("hidden", !showExpired);
    if (!showPrice) checklistForm.elements.priceDivergenceProducts.value = "";
    if (!showExpired) checklistForm.elements.expiredProducts.value = "";
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
        <h2>Resumo operacional diário</h2>
        <div class="muted">Consolidação do dia para acompanhamento gerencial</div>
      </div>
    </div>
    ${summaryLocked ? `<div class="panel muted" style="margin-bottom:14px">Somente a encarregada pode preencher, alterar ou excluir perdas, consumos e vasilhames.</div>` : ""}
    <form class="panel grid" id="summaryForm">
      <div class="grid three">
        <label>Data do resumo <input name="date" type="date" required value="${todayInputValue()}"></label>
        <label>Valor das perdas lançadas <input name="lossesValue" type="number" step="0.01" min="0"></label>
        <label>Valor dos consumos lançados <input name="consumptionValue" type="number" step="0.01" min="0"></label>
      </div>
      <div class="grid four">
        <label>Contagem de vasilhames do dia <input name="bottlesCount" type="number" min="0"></label>
        <label>Recebimentos acompanhados <input name="receiptsCount" type="number" min="0"></label>
      </div>
      <label>Qual vasilhame
        <textarea name="bottlesDetails" placeholder="Ex.: garrafa 1L, garrafa 2L, caixas, engradados"></textarea>
      </label>
      <div class="grid two">
        <label>Ocorrências identificadas <textarea name="occurrences"></textarea></label>
        <label>Ações corretivas realizadas <textarea name="correctiveActions"></textarea></label>
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
    ["lossesValue", "consumptionValue", "bottlesCount", "receiptsCount", "bottlesDetails", "occurrences", "correctiveActions"].forEach((name) => {
      form.elements[name].disabled = true;
    });
  }
  const clearSummaryFields = () => {
    form.lossesValue.value = "";
    form.consumptionValue.value = "";
    form.bottlesCount.value = "";
    form.receiptsCount.value = "";
    form.bottlesDetails.value = "";
    form.occurrences.value = "";
    form.correctiveActions.value = "";
  };
  const fillSummaryForm = (row) => {
    clearSummaryFields();
    if (!row) return;
    form.date.value = row.date || form.date.value;
    form.lossesValue.value = row.losses_value ?? "";
    form.consumptionValue.value = row.consumption_value ?? "";
    form.bottlesCount.value = row.bottles_count ?? "";
    form.receiptsCount.value = row.receipts_count ?? "";
    form.bottlesDetails.value = row.bottles_details || "";
    form.occurrences.value = row.occurrences || "";
    form.correctiveActions.value = row.corrective_actions || "";
  };
  const loadSummaryForDate = async () => {
    const data = await api(`/api/summary?date=${encodeURIComponent(form.date.value)}`);
    fillSummaryForm(data.row);
    toast(data.row ? "Resumo carregado para edição." : "Nenhum resumo encontrado para essa data.");
  };
  const refreshSummaryTable = async () => {
    const data = await api("/api/summaries");
    document.getElementById("summaryTable").innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Perdas</th>
            <th>Consumos</th>
            <th>Vasilhames</th>
            <th>Qual vasilhame</th>
            <th>Recebimentos</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${data.rows.map((row) => `
            <tr>
              <td data-label="Data">${fmtDate(row.date)}</td>
              <td data-label="Perdas">${fmtMoney(row.losses_value)}</td>
              <td data-label="Consumos">${fmtMoney(row.consumption_value)}</td>
              <td data-label="Vasilhames">${row.bottles_count || 0}</td>
              <td data-label="Qual vasilhame">${escapeHtml(row.bottles_details || "")}</td>
              <td data-label="Recebimentos">${row.receipts_count || 0}</td>
              <td data-label="Ações">
                <div class="toolbar">
                  <button class="btn" type="button" data-edit-summary="${row.date}">Editar</button>
                  ${canFillEncarregadaOnly() ? `<button class="btn danger" type="button" data-delete-summary="${row.date}">Excluir</button>` : ""}
                </div>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="7">Nenhum resumo lançado.</td></tr>`}
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
        toast(result.message || "Resumo excluído.");
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
    toast(result.message || "Resumo excluído.");
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
      <label>Início <input name="startDate" type="date"></label>
      <label>Fim <input name="endDate" type="date"></label>
      <label>Colaborador <select name="collaboratorId"><option value="">Todos</option>${collaboratorOptions(false)}</select></label>
    </div>
    <label>Atividade <select name="activity"><option value="">Todas</option>${state.activities.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}</select></label>
  `;
}

function renderReports() {
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Relatórios</h2>
        <div class="muted">Filtros por data, colaborador, período e atividade</div>
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

function drawReportTable() {
  const showActions = state.checklists.some((row) => canEditChecklist(row) || canDeleteChecklist());
  document.getElementById("reportTable").innerHTML = `
    <table><thead><tr><th>Data</th><th>Colaborador</th><th>Atividade</th><th>Resposta</th><th>Observação</th><th>Enviado em</th>${showActions ? "<th>Ações</th>" : ""}</tr></thead><tbody>
      ${state.checklists.map((row) => `
        <tr>
          <td data-label="Data">${fmtDate(row.date)}</td>
          <td data-label="Colaborador">${escapeHtml(row.collaborator)}</td>
          <td data-label="Atividade">${escapeHtml(row.activity)}</td>
          <td data-label="Resposta"><span class="status ${row.answer === "Sim" ? "ok" : "danger"}">${row.answer}</span></td>
          <td data-label="Observação">${escapeHtml(row.observation || "")}</td>
          <td data-label="Enviado em">${new Date(row.sent_at).toLocaleString("pt-BR")}</td>
          ${showActions ? `
            <td data-label="Ações">
              <div class="toolbar">
                ${canEditChecklist(row) ? `<button class="btn" type="button" data-edit-checklist="${row.id}">Editar</button>` : ""}
                ${canDeleteChecklist() ? `<button class="btn danger" type="button" data-delete-checklist="${row.id}">Excluir</button>` : ""}
              </div>
            </td>
          ` : ""}
        </tr>
      `).join("") || `<tr><td colspan="${showActions ? 7 : 6}">Nenhum registro encontrado.</td></tr>`}
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
  const answer = prompt("Resposta corrigida: Sim ou Não", row.answer);
  if (!answer) return;
  const observation = prompt("Observação corrigida", row.observation || "") || "";
  const priceDivergenceProducts = row.activity === PRICE_DIVERGENCE_ACTIVITY
    ? prompt("Produtos com divergência de preços", row.price_divergence_products || "") || ""
    : "";
  const expiredProducts = row.activity === EXPIRED_PRODUCTS_ACTIVITY
    ? prompt("Produtos vencidos encontrados", row.expired_products || "") || ""
    : "";
  api(`/api/checklists/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      collaboratorId: row.collaborator_id,
      activity: row.activity,
      answer,
      observation,
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
  toast(result.message || "Preenchimento excluído.");
}

function repoOptions(items, selected = "") {
  return items.map((item) => `<option ${item === selected ? "selected" : ""}>${escapeHtml(item)}</option>`).join("");
}

function renderReposition() {
  const data = state.repo.dashboard || { summary: {}, bySector: [] };
  const summary = data.summary || {};
  const metrics = [
    ["Atividades", summary.taskTotal || 0],
    ["Realizadas", summary.completed || 0],
    ["Pendentes", summary.pending || 0],
    ["Rupturas", summary.ruptures || 0],
    ["Pedidos confirmados", summary.rupturesPurchased || 0],
    ["Validades", summary.expirations || 0],
    ["Validades com acao", summary.expirationsActioned || 0],
    ["Avarias", summary.damages || 0],
  ];
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Reposicao da loja</h2>
        <div class="muted">Atividades, rupturas, validades, avarias e retorno comercial</div>
      </div>
      <button class="btn" id="refreshReposition">Atualizar</button>
    </div>
    <form class="panel grid" id="repoFilterForm" style="margin-bottom:14px">
      <div class="grid two">
        <label>Inicio <input name="startDate" type="date" value="${escapeHtml(state.repo.filters.startDate)}"></label>
        <label>Fim <input name="endDate" type="date" value="${escapeHtml(state.repo.filters.endDate)}"></label>
      </div>
      <button class="btn primary" type="submit">Aplicar periodo</button>
    </form>
    <div class="metrics">${metrics.map(([label, value]) => `<div class="metric"><span class="muted">${label}</span><strong>${value}</strong></div>`).join("")}</div>
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
}

function repoTaskForm() {
  const linked = state.user?.collaborator_id ? state.collaborators.find((item) => Number(item.id) === Number(state.user.collaborator_id)) : null;
  return `
    <h3>Registrar atividade</h3>
    <form class="grid" id="repoTaskForm" style="margin-top:12px">
      <div class="grid two">
        <label>Data <input name="date" type="date" value="${todayInputValue()}"></label>
        <label>Colaborador ${linked ? `<input value="${escapeHtml(linked.name)}" disabled><input type="hidden" name="collaboratorId" value="${linked.id}">` : `<select name="collaboratorId" required>${collaboratorOptions()}</select>`}</label>
      </div>
      <div class="grid two">
        <label>Setor <select name="sector">${repoOptions(state.repo.sectors)}</select></label>
        <label>Status <select name="status"><option>Realizado</option><option>Pendente</option><option>Parcial</option></select></label>
      </div>
      <label>Atividade <select name="activity">${repoOptions(state.repo.activities)}</select></label>
      <label>Observacao <textarea name="observation"></textarea></label>
      <button class="btn primary" type="submit">Salvar atividade</button>
    </form>
  `;
}

function repoIssueForm(kind, title, productLabel, fields) {
  return `
    <h3>${title}</h3>
    <form class="grid" id="repo-${kind}-form" data-repo-kind="${kind}" style="margin-top:12px">
      <div class="grid two">
        <label>Data <input name="date" type="date" value="${todayInputValue()}"></label>
        <label>Setor <select name="sector">${repoOptions(state.repo.sectors)}</select></label>
      </div>
      <label>${productLabel} <input name="product" required></label>
      <div class="grid two">
        ${fields.map(([name, label, typeOrOptions]) => Array.isArray(typeOrOptions)
          ? `<label>${label} <select name="${name}">${repoOptions(typeOrOptions)}</select></label>`
          : `<label>${label} <input name="${name}" type="${typeOrOptions || "text"}"></label>`).join("")}
      </div>
      <label>Observacao <textarea name="observation"></textarea></label>
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
        <label>Setor <select name="sector">${repoOptions(state.repo.sectors)}</select></label>
      </div>
      <label>Produto <input name="product" required></label>
      <div class="grid two">
        <label>Quantidade <input name="quantity"></label>
        <label>Motivo <input name="reason"></label>
      </div>
      <label>Acao tomada <input name="action"></label>
      <button class="btn primary" type="submit">Salvar avaria</button>
    </form>
  `;
}

function bindRepoForms() {
  document.getElementById("repoTaskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/reposition/tasks", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
    await loadReposition();
    renderReposition();
    toast("Atividade de reposicao salva.");
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
  document.querySelectorAll("[data-repo-commercial]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [kind, id] = button.dataset.repoCommercial.split(":");
      const commercialStatus = kind === "ruptures"
        ? (confirm("O pedido foi realizado?") ? "Pedido realizado" : "Pedido nao realizado")
        : (confirm("Foi feita acao ou rebaixa?") ? "Acao ou rebaixa realizada" : "Acao nao realizada");
      const commercialObservation = prompt("Observacao do comercial") || "";
      await api(`/api/reposition/${kind}/${id}`, { method: "PUT", body: JSON.stringify({ commercialStatus, commercialObservation }) });
      await loadReposition();
      renderReposition();
      toast("Retorno comercial atualizado.");
    });
  });
}

function repoSectorTable(rows) {
  return `
    <table><thead><tr><th>Setor</th><th>Atividades</th><th>Rupturas</th><th>Validades</th><th>Avarias</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td data-label="Setor">${escapeHtml(row.sector)}</td><td data-label="Atividades">${row.tasks || 0}</td><td data-label="Rupturas">${row.ruptures || 0}</td><td data-label="Validades">${row.expirations || 0}</td><td data-label="Avarias">${row.damages || 0}</td></tr>`).join("") || `<tr><td colspan="5">Sem registros.</td></tr>`}
    </tbody></table>
  `;
}

function repoCommercialTable() {
  const rows = [
    ...state.repo.ruptures.map((row) => ({ ...row, kind: "ruptures", origin: "Ruptura", detail: row.type || "" })),
    ...state.repo.expirations.map((row) => ({ ...row, kind: "expirations", origin: "Validade", detail: row.expiration_date ? fmtDate(row.expiration_date) : "" })),
  ].slice(0, 30);
  return `
    <table><thead><tr><th>Origem</th><th>Produto</th><th>Setor</th><th>Detalhe</th><th>Status</th><th>Retorno</th><th>Acao</th></tr></thead><tbody>
      ${rows.map((row) => `<tr>
        <td data-label="Origem">${row.origin}</td>
        <td data-label="Produto">${escapeHtml(row.product)}</td>
        <td data-label="Setor">${escapeHtml(row.sector)}</td>
        <td data-label="Detalhe">${escapeHtml(row.detail)}</td>
        <td data-label="Status"><span class="status ${row.status === "Resolvido" ? "ok" : "warn"}">${escapeHtml(row.status)}</span></td>
        <td data-label="Retorno">${escapeHtml(row.commercial_status || "")}</td>
        <td data-label="Acao"><button class="btn" type="button" data-repo-commercial="${row.kind}:${row.id}">Atualizar</button></td>
      </tr>`).join("") || `<tr><td colspan="7">Sem registros comerciais.</td></tr>`}
    </tbody></table>
  `;
}

function repoTasksTable() {
  return `
    <table><thead><tr><th>Data</th><th>Colaborador</th><th>Setor</th><th>Atividade</th><th>Status</th><th>Obs.</th></tr></thead><tbody>
      ${state.repo.tasks.map((row) => `<tr>
        <td data-label="Data">${fmtDate(row.date)}</td>
        <td data-label="Colaborador">${escapeHtml(row.collaborator)}</td>
        <td data-label="Setor">${escapeHtml(row.sector)}</td>
        <td data-label="Atividade">${escapeHtml(row.activity)}</td>
        <td data-label="Status"><span class="status ${row.status === "Realizado" ? "ok" : row.status === "Parcial" ? "warn" : "danger"}">${escapeHtml(row.status)}</span></td>
        <td data-label="Obs.">${escapeHtml(row.observation || "")}</td>
      </tr>`).join("") || `<tr><td colspan="6">Sem atividades registradas.</td></tr>`}
    </tbody></table>
  `;
}

function renderPendencies() {
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Pendências</h2>
        <div class="muted">Controle de abertura, andamento e solução</div>
      </div>
    </div>
    <form class="panel grid" id="pendencyForm">
      <div class="grid three">
        <label>Responsável <select name="responsibleId" required>${collaboratorOptions()}</select></label>
        <label>Data de abertura <input name="openedAt" type="date" required value="${new Date().toISOString().slice(0, 10)}"></label>
        <label>Status <select name="status"><option>Aberto</option><option>Em andamento</option><option>Resolvido</option></select></label>
      </div>
      <label>Descrição <textarea name="description" required></textarea></label>
      <label>Observação da solução <textarea name="solutionObservation"></textarea></label>
      <button class="btn primary" type="submit">Salvar pendência</button>
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
    toast("Pendência salva.");
  });
}

function drawPendenciesTable() {
  document.getElementById("pendenciesTable").innerHTML = `
    <table><thead><tr><th>Descrição</th><th>Responsável</th><th>Abertura</th><th>Status</th><th>Solução</th></tr></thead><tbody>
      ${state.pendencies.map((row) => `
        <tr>
          <td data-label="Descrição">${escapeHtml(row.description)}</td>
          <td data-label="Responsável">${escapeHtml(row.responsible)}</td>
          <td data-label="Abertura">${fmtDate(row.opened_at)}</td>
          <td data-label="Status"><span class="status ${row.status === "Resolvido" ? "ok" : row.status === "Em andamento" ? "warn" : "danger"}">${escapeHtml(row.status)}</span></td>
          <td data-label="Solução">${escapeHtml(row.solution_observation || "")}</td>
        </tr>
      `).join("") || `<tr><td colspan="5">Nenhuma pendência cadastrada.</td></tr>`}
    </tbody></table>
  `;
}

function renderCollaborators() {
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Colaboradores</h2>
        <div class="muted">Cadastro de pessoas habilitadas no relatório</div>
      </div>
    </div>
    <form class="panel grid" id="collaboratorForm">
      <input type="hidden" name="id">
      <div class="grid three">
        <label>Nome <input name="name" required></label>
        <label>Cargo <input name="role" required></label>
        <label>Status <select name="status"><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
      </div>
      <div class="toolbar">
        <button class="btn primary" type="submit" id="collaboratorSubmit">Cadastrar colaborador</button>
        <button class="btn hidden" type="button" id="cancelCollaboratorEdit">Cancelar edição</button>
      </div>
    </form>
    <div class="table-wrap" style="margin-top:14px">
      <table><thead><tr><th>Nome</th><th>Cargo</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        ${state.collaborators.map((row) => `
          <tr>
            <td data-label="Nome">${escapeHtml(row.name)}</td>
            <td data-label="Cargo">${escapeHtml(row.role)}</td>
            <td data-label="Status"><span class="status ${row.status === "ativo" ? "ok" : ""}">${row.status}</span></td>
            <td data-label="Ações">
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
      toast(result.message || "Colaborador excluído.");
    });
  });
}

function renderUsers() {
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Acessos</h2>
        <div class="muted">Defina usuário e senha para cada colaborador acessar diretamente o checklist</div>
      </div>
    </div>
    <form class="panel grid" id="userForm">
      <input type="hidden" name="id">
      <div class="grid three">
        <label>Nome exibido <input name="displayName" required></label>
        <label>Usuário <input name="username" required autocomplete="off"></label>
        <label>Senha <input name="password" required autocomplete="new-password"></label>
      </div>
      <div class="grid three">
        <label>Perfil
          <select name="role" required>
            <option value="colaborador">Colaborador</option>
            <option value="prevencao">Prevenção</option>
            <option value="encarregada">Encarregada</option>
            <option value="reposicao">Reposicao</option>
            <option value="comercial">Comercial</option>
            <option value="administrador">Administrador</option>
          </select>
        </label>
        <label>Colaborador vinculado
          <select name="collaboratorId">
            <option value="">Sem vínculo</option>
            ${collaboratorOptions(false)}
          </select>
        </label>
        <label>Status
          <select name="status"><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select>
        </label>
      </div>
      <div class="toolbar">
        <button class="btn primary" type="submit" id="userSubmit">Criar acesso</button>
        <button class="btn hidden" type="button" id="cancelUserEdit">Cancelar edição</button>
      </div>
    </form>
    <div class="table-wrap" style="margin-top:14px">
      <table><thead><tr><th>Nome</th><th>Usuário</th><th>Senha</th><th>Perfil</th><th>Colaborador</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        ${state.users.map((row) => `
          <tr>
            <td data-label="Nome">${escapeHtml(row.display_name)}</td>
            <td data-label="Usuário">${escapeHtml(row.username)}</td>
            <td data-label="Senha">${escapeHtml(row.password)}</td>
            <td data-label="Perfil">${escapeHtml(row.role)}</td>
            <td data-label="Colaborador">${escapeHtml(row.collaborator || "-")}</td>
            <td data-label="Status"><span class="status ${row.status === "ativo" ? "ok" : ""}">${escapeHtml(row.status)}</span></td>
            <td data-label="Ações">
              <div class="toolbar">
                <button class="btn" type="button" data-edit-user="${row.id}">Editar</button>
                <button class="btn danger" type="button" data-delete-user="${row.id}">Excluir</button>
              </div>
            </td>
          </tr>
        `).join("") || `<tr><td colspan="7">Nenhum acesso cadastrado.</td></tr>`}
      </tbody></table>
    </div>
  `;

  const form = document.getElementById("userForm");
  const submitButton = document.getElementById("userSubmit");
  const cancelButton = document.getElementById("cancelUserEdit");

  function clearUserEdit() {
    form.reset();
    form.id.value = "";
    submitButton.textContent = "Criar acesso";
    cancelButton.classList.add("hidden");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form).entries());
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
      form.password.value = access.password;
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
      toast(result.message || "Acesso excluído.");
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
