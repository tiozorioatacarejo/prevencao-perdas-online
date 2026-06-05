const state = {
  token: localStorage.getItem("token") || "",
  user: JSON.parse(localStorage.getItem("user") || "null"),
  tab: "dashboard",
  dashboardFilters: {
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
  },
  collaborators: [],
  activities: [],
  checklists: [],
  pendencies: [],
  users: [],
  dashboard: null,
};

const app = document.getElementById("app");

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
    state.tab = defaultTab();
    await Promise.all([loadCollaborators(), loadDashboard()]);
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
    pendencies: renderPendencies,
    collaborators: renderCollaborators,
    users: renderUsers,
  };
  map[state.tab]();
}

function allowedTabs() {
  if (state.user?.role !== "administrador") {
    const tabs = [
      ["dashboard", "Painel"],
      ["checklist", "Checklist"],
      ["pendencies", "Pendências"],
    ];
    if (canAccessSummary()) tabs.splice(2, 0, ["summary", "Resumo"]);
    return tabs;
  }
  const tabs = [
    ["dashboard", "Painel"],
    ["checklist", "Checklist"],
    ["summary", "Resumo"],
    ["reports", "Relatórios"],
    ["pendencies", "Pendências"],
    ["collaborators", "Colaboradores"],
  ];
  tabs.push(["users", "Acessos"]);
  return tabs;
}

function defaultTab() {
  return "dashboard";
}

async function loadCollaborators() {
  const data = await api("/api/collaborators");
  state.collaborators = data.rows;
}

async function loadDashboard() {
  const qs = new URLSearchParams(state.dashboardFilters);
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
      <div class="grid two">
        <label>Data inicial <input name="startDate" type="date" value="${escapeHtml(state.dashboardFilters.startDate)}"></label>
        <label>Data final <input name="endDate" type="date" value="${escapeHtml(state.dashboardFilters.endDate)}"></label>
      </div>
      <button class="btn primary" type="submit">Aplicar período</button>
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
        <div class="muted" style="margin-top:4px">Participação nos preenchimentos realizados no mês</div>
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
  document.getElementById("dashboardFilterForm").addEventListener("submit", async (event) => {
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
          <select name="activity" required>${state.activities.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}</select>
        </label>
      </div>
      <div class="grid two">
        <label>Sim / Não
          <select name="answer" required><option>Sim</option><option>Não</option></select>
        </label>
        <label>Produtos com divergência de preços <textarea name="priceDivergenceProducts"></textarea></label>
      </div>
      <label>Produtos vencidos encontrados <textarea name="expiredProducts"></textarea></label>
      <label>Observação
        <textarea name="observation"></textarea>
      </label>
      <button class="btn primary" type="submit">Enviar checklist</button>
    </form>
  `;
  document.getElementById("checklistForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    await api("/api/checklists", { method: "POST", body: JSON.stringify(body) });
    form.reset();
    toast("Checklist enviado com data e hora registradas.");
  });
}

function renderSummary() {
  view.innerHTML = `
    <div class="topbar">
      <div>
        <h2>Resumo operacional diário</h2>
        <div class="muted">Consolidação do dia para acompanhamento gerencial</div>
      </div>
    </div>
    <form class="panel grid" id="summaryForm">
      <div class="grid four">
        <label>Valor das perdas lançadas <input name="lossesValue" type="number" step="0.01" min="0"></label>
        <label>Valor dos consumos lançados <input name="consumptionValue" type="number" step="0.01" min="0"></label>
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
      <button class="btn primary" type="submit">Salvar resumo</button>
    </form>
  `;
  document.getElementById("summaryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    await api("/api/summary", { method: "POST", body: JSON.stringify(body) });
    toast("Resumo operacional salvo.");
  });
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
    <table><thead><tr><th>Data</th><th>Colaborador</th><th>Atividade</th><th>Resposta</th><th>Divergências</th><th>Vencidos</th><th>Observação</th><th>Enviado em</th>${showActions ? "<th>Ações</th>" : ""}</tr></thead><tbody>
      ${state.checklists.map((row) => `
        <tr>
          <td data-label="Data">${fmtDate(row.date)}</td>
          <td data-label="Colaborador">${escapeHtml(row.collaborator)}</td>
          <td data-label="Atividade">${escapeHtml(row.activity)}</td>
          <td data-label="Resposta"><span class="status ${row.answer === "Sim" ? "ok" : "danger"}">${row.answer}</span></td>
          <td data-label="Divergências">${escapeHtml(row.price_divergence_products || "")}</td>
          <td data-label="Vencidos">${escapeHtml(row.expired_products || "")}</td>
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
  const answer = prompt("Resposta corrigida: Sim ou Não", row.answer);
  if (!answer) return;
  const observation = prompt("Observação corrigida", row.observation || "") || "";
  const priceDivergenceProducts = prompt("Produtos com divergência de preços", row.price_divergence_products || "") || "";
  const expiredProducts = prompt("Produtos vencidos encontrados", row.expired_products || "") || "";
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
