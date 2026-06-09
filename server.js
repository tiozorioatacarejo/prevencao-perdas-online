const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const BUNDLED_PYTHON = "C:\\Users\\tiozo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const PYTHON = process.env.PYTHON_EXE || (fs.existsSync(BUNDLED_PYTHON) ? BUNDLED_PYTHON : "python");
const DATA_DIR = process.env.APP_DATA_DIR || path.join(ROOT, "data");
const UPLOAD_DIR = process.env.APP_UPLOAD_DIR || path.join(ROOT, "uploads");
const DATABASE_URL = process.env.DATABASE_URL || "";
let pgPool = null;

const sessions = new Map();
const PRICE_DIVERGENCE_ACTIVITY = "Conferência de precificação";
const EXPIRED_PRODUCTS_ACTIVITY = "Verificação de validades";

const activities = [
  "Temperatura 07h",
  "Temperatura 10h",
  "Temperatura 16h",
  "Temperatura 19h",
  "Lançamento de perdas no sistema",
  "Lançamento de consumo interno",
  "Contagem e acompanhamento de vasilhames",
  "Acompanhamento de cotações",
  "Acompanhamento de recebimentos",
  "Monitoramento loja / App Veesion",
  "Conferência de precificação",
  "Verificação de validades",
  "Verificação de água do bebedouro",
  "Acompanhamento da vitrine",
  "Portas e acessos conferidos",
  "Cancelamentos e estornos verificados",
  "Passagem de itens de forma correta no caixa",
  "Devolução de produtos acompanhadas",
];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

async function postgresPool() {
  if (!DATABASE_URL) return null;
  if (!pgPool) {
    const { Pool } = require("pg");
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
    });
    await initPostgres(pgPool);
  }
  return pgPool;
}

function toPostgresSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function initPostgres(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      collaborator_id INTEGER,
      status TEXT NOT NULL DEFAULT 'ativo'
    );

    CREATE TABLE IF NOT EXISTS collaborators (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ativo',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS checklists (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      collaborator_id INTEGER NOT NULL REFERENCES collaborators(id),
      activity TEXT NOT NULL,
      answer TEXT NOT NULL,
      observation TEXT,
      price_divergence_products TEXT,
      expired_products TEXT,
      photo_path TEXT,
      sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER NOT NULL REFERENCES users(id),
      corrected_by INTEGER REFERENCES users(id),
      corrected_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS operational_summaries (
      id SERIAL PRIMARY KEY,
      date TEXT UNIQUE NOT NULL,
      losses_value REAL NOT NULL DEFAULT 0,
      consumption_value REAL NOT NULL DEFAULT 0,
      bottles_count INTEGER NOT NULL DEFAULT 0,
      bottles_details TEXT,
      receipts_count INTEGER NOT NULL DEFAULT 0,
      price_divergence_products TEXT,
      expired_products TEXT,
      occurrences TEXT,
      corrective_actions TEXT,
      pending_items TEXT,
      sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER NOT NULL REFERENCES users(id),
      corrected_by INTEGER REFERENCES users(id),
      corrected_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pendencies (
      id SERIAL PRIMARY KEY,
      description TEXT NOT NULL,
      responsible_id INTEGER NOT NULL REFERENCES collaborators(id),
      opened_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Aberto',
      attachment_path TEXT,
      solution_observation TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const existing = await pool.query("SELECT COUNT(*) AS total FROM users");
  if (Number(existing.rows[0].total) === 0) {
    await pool.query(
      "INSERT INTO users (username, password, role, display_name, status) VALUES ($1, $2, $3, $4, $5)",
      ["admin", "adm123", "administrador", "Administrador", "ativo"]
    );
  }
}

async function runDb(payload) {
  const pool = await postgresPool();
  if (pool) {
    if (payload.action === "query") {
      const result = await pool.query(toPostgresSql(payload.sql), payload.params || []);
      return { rows: result.rows };
    }
    if (payload.action === "execute") {
      const result = await pool.query(toPostgresSql(payload.sql), payload.params || []);
      return { changes: result.rowCount };
    }
    throw new Error("Ação de banco inválida");
  }
  const result = spawnSync(PYTHON, [path.join(ROOT, "scripts", "db.py")], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Falha ao acessar SQLite");
  }
  return JSON.parse(result.stdout);
}

async function query(sql, params = []) {
  return (await runDb({ action: "query", sql, params })).rows;
}

async function execute(sql, params = []) {
  return runDb({ action: "execute", sql, params });
}

function send(res, status, data, headers = {}) {
  const body = typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": Buffer.isBuffer(data) ? "application/octet-stream" : "application/json; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 12 * 1024 * 1024) reject(new Error("Arquivo muito grande"));
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
  });
}

function makeToken(user) {
  const raw = `${user.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  return Buffer.from(raw).toString("base64url");
}

function currentUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return sessions.get(token);
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) {
    send(res, 401, { error: "Sessão expirada. Faça login novamente." });
    return null;
  }
  return user;
}

function canCorrect(user) {
  return user.role === "administrador" || user.role === "encarregada";
}

function canDeleteRecords(user) {
  return user.role === "administrador";
}

function isAdmin(user) {
  return user.role === "administrador";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthBounds(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const iso = (value) => value.toISOString().slice(0, 10);
  return {
    start: iso(start),
    end: iso(end),
    days: end.getDate(),
    label: start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
  };
}

function periodInfo(start, end) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const days = Math.max(1, Math.round((endDate - startDate) / 86400000) + 1);
  return {
    start,
    end,
    days,
    label: start === end ? startDate.toLocaleDateString("pt-BR") : `${startDate.toLocaleDateString("pt-BR")} a ${endDate.toLocaleDateString("pt-BR")}`,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function saveDataUrl(dataUrl, originalName = "anexo") {
  if (!dataUrl) return null;
  const match = /^data:(.+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const extMap = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
  };
  const ext = extMap[match[1]] || path.extname(originalName).slice(0, 8) || ".bin";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(match[2], "base64"));
  return `/uploads/${filename}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function rowsForReports(filters) {
  const where = [];
  const params = [];
  if (filters.date) {
    where.push("c.date = ?");
    params.push(filters.date);
  }
  if (filters.startDate) {
    where.push("c.date >= ?");
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    where.push("c.date <= ?");
    params.push(filters.endDate);
  }
  if (filters.collaboratorId) {
    where.push("c.collaborator_id = ?");
    params.push(filters.collaboratorId);
  }
  if (filters.activity) {
    where.push("c.activity = ?");
    params.push(filters.activity);
  }
  return query(
    `
    SELECT c.id, c.date, c.sent_at, c.collaborator_id, c.created_by, c.photo_path,
           c.price_divergence_products, c.expired_products,
           col.name AS collaborator, c.activity, c.answer, c.observation,
           u.display_name AS sent_by
    FROM checklists c
    JOIN collaborators col ON col.id = c.collaborator_id
    JOIN users u ON u.id = c.created_by
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY c.date DESC, c.sent_at DESC
    `,
    params
  );
}

function makeExcel(rows) {
  const header = ["Data", "Hora de envio", "Colaborador", "Atividade", "Sim/Nao", "Observacao", "Enviado por"];
  const xmlRows = [header, ...rows.map((row) => [
    row.date,
    row.sent_at,
    row.collaborator,
    row.activity,
    row.answer,
    row.observation || "",
    row.sent_by,
  ])]
    .map((cols) => `<tr>${cols.map((col) => `<td>${escapeHtml(col)}</td>`).join("")}</tr>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><table>${xmlRows}</table></body></html>`;
}

function makePdf(rows) {
  const lines = [
    "Relatório Diário de Atividades - Prevenção de Perdas",
    "Atacarejo Antônio de Ozório",
    `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
    "",
    ...rows.flatMap((row) => [
      `${row.date} | ${row.collaborator} | ${row.activity}`,
      `Resposta: ${row.answer}`,
      `Observacao: ${row.observation || "-"}`,
      "",
    ]),
  ];
  const text = lines
    .slice(0, 120)
    .map((line, index) => `BT /F1 10 Tf 40 ${780 - index * 14} Td (${pdfEscape(line.slice(0, 105))}) Tj ET`)
    .join("\n");
  const stream = Buffer.from(text, "latin1");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${stream.length} >> stream\n${stream.toString("latin1")}\nendstream endobj`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${obj}\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

function checklistSpecificFields(activity, body) {
  return {
    priceDivergenceProducts: activity === PRICE_DIVERGENCE_ACTIVITY ? body.priceDivergenceProducts || "" : "",
    expiredProducts: activity === EXPIRED_PRODUCTS_ACTIVITY ? body.expiredProducts || "" : "",
  };
}

function pdfEscape(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[()\\]/g, " ");
}

async function api(req, res, url) {
  const method = req.method;

  if (method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
  const users = await query(
      "SELECT id, username, role, display_name, collaborator_id, status FROM users WHERE username = ? AND password = ? AND status = 'ativo'",
      [
      body.username,
      body.password,
      ]
    );
    if (!users[0]) return send(res, 401, { error: "Usuário ou senha inválidos." });
    const token = makeToken(users[0]);
    sessions.set(token, users[0]);
    return send(res, 200, { token, user: users[0] });
  }

  const user = requireUser(req, res);
  if (!user) return;

  if (method === "GET" && url.pathname === "/api/me") {
    return send(res, 200, { user, activities });
  }

  if (method === "GET" && url.pathname === "/api/users") {
    if (!isAdmin(user)) return send(res, 403, { error: "Apenas administrador pode gerenciar acessos." });
    return send(res, 200, {
      rows: await query(
        `
        SELECT u.id, u.username, u.password, u.role, u.display_name, u.collaborator_id, u.status,
               c.name AS collaborator
        FROM users u
        LEFT JOIN collaborators c ON c.id = u.collaborator_id
        ORDER BY u.role, u.display_name
        `
      ),
    });
  }

  if (method === "POST" && url.pathname === "/api/users") {
    if (!isAdmin(user)) return send(res, 403, { error: "Apenas administrador pode gerenciar acessos." });
    const body = await readBody(req);
    await execute(
      "INSERT INTO users (username, password, role, display_name, collaborator_id, status) VALUES (?, ?, ?, ?, ?, ?)",
      [
        body.username,
        body.password,
        body.role || "colaborador",
        body.displayName,
        body.collaboratorId || null,
        body.status || "ativo",
      ]
    );
    return send(res, 201, { ok: true });
  }

  if (method === "PUT" && url.pathname.startsWith("/api/users/")) {
    if (!isAdmin(user)) return send(res, 403, { error: "Apenas administrador pode gerenciar acessos." });
    const id = Number(url.pathname.split("/").pop());
    const body = await readBody(req);
    await execute(
      "UPDATE users SET username = ?, password = ?, role = ?, display_name = ?, collaborator_id = ?, status = ? WHERE id = ?",
      [
        body.username,
        body.password,
        body.role,
        body.displayName,
        body.collaboratorId || null,
        body.status,
        id,
      ]
    );
    return send(res, 200, { ok: true });
  }

  if (method === "DELETE" && url.pathname.startsWith("/api/users/")) {
    if (!isAdmin(user)) return send(res, 403, { error: "Apenas administrador pode gerenciar acessos." });
    const id = Number(url.pathname.split("/").pop());
    if (id === user.id) return send(res, 400, { error: "Você não pode excluir o próprio acesso enquanto está logado." });
    await execute("DELETE FROM users WHERE id = ?", [id]);
    return send(res, 200, { ok: true, message: "Acesso excluído." });
  }

  if (method === "GET" && url.pathname === "/api/collaborators") {
    const status = url.searchParams.get("status");
    const sql = status
      ? "SELECT * FROM collaborators WHERE status = ? ORDER BY name"
      : "SELECT * FROM collaborators ORDER BY status, name";
    return send(res, 200, { rows: await query(sql, status ? [status] : []) });
  }

  if (method === "POST" && url.pathname === "/api/collaborators") {
    const body = await readBody(req);
    await execute("INSERT INTO collaborators (name, role, status) VALUES (?, ?, ?)", [
      body.name,
      body.role,
      body.status || "ativo",
    ]);
    return send(res, 201, { ok: true });
  }

  if (method === "PUT" && url.pathname.startsWith("/api/collaborators/")) {
    const id = Number(url.pathname.split("/").pop());
    const body = await readBody(req);
    await execute("UPDATE collaborators SET name = ?, role = ?, status = ? WHERE id = ?", [
      body.name,
      body.role,
      body.status,
      id,
    ]);
    return send(res, 200, { ok: true });
  }

  if (method === "DELETE" && url.pathname.startsWith("/api/collaborators/")) {
    const id = Number(url.pathname.split("/").pop());
    const checklistCount = (await query("SELECT COUNT(*) AS total FROM checklists WHERE collaborator_id = ?", [id]))[0].total;
    const pendencyCount = (await query("SELECT COUNT(*) AS total FROM pendencies WHERE responsible_id = ?", [id]))[0].total;
    await execute("UPDATE users SET collaborator_id = NULL, status = 'inativo' WHERE collaborator_id = ?", [id]);
    if (checklistCount > 0 || pendencyCount > 0) {
      await execute("UPDATE collaborators SET status = 'inativo' WHERE id = ?", [id]);
      return send(res, 200, {
        ok: true,
        mode: "inactivated",
        message: "Colaborador possui registros vinculados e foi inativado para preservar o histórico.",
      });
    }
    await execute("DELETE FROM collaborators WHERE id = ?", [id]);
    return send(res, 200, { ok: true, mode: "deleted", message: "Colaborador excluído." });
  }

  if (method === "GET" && url.pathname === "/api/checklists") {
    return send(res, 200, { rows: await rowsForReports(Object.fromEntries(url.searchParams.entries())) });
  }

  if (method === "POST" && url.pathname === "/api/checklists") {
    const body = await readBody(req);
    const date = today();
    const collaboratorId = user.collaborator_id || body.collaboratorId;
    if (!collaboratorId) return send(res, 400, { error: "Selecione um colaborador." });
    const specificFields = checklistSpecificFields(body.activity, body);
    await execute(
      "INSERT INTO checklists (date, collaborator_id, activity, answer, observation, price_divergence_products, expired_products, sent_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        date,
        collaboratorId,
        body.activity,
        body.answer,
        body.observation || "",
        specificFields.priceDivergenceProducts,
        specificFields.expiredProducts,
        nowIso(),
        user.id,
      ]
    );
    return send(res, 201, { ok: true });
  }

  if (method === "PUT" && url.pathname.startsWith("/api/checklists/")) {
    const id = Number(url.pathname.split("/").pop());
    const record = (await query("SELECT created_by FROM checklists WHERE id = ?", [id]))[0];
    if (!record) return send(res, 404, { error: "Preenchimento não encontrado." });
    if (!canCorrect(user) && record.created_by !== user.id) {
      return send(res, 403, { error: "Você só pode corrigir preenchimentos enviados por você." });
    }
    const body = await readBody(req);
    const collaboratorId = canCorrect(user) ? body.collaboratorId : user.collaborator_id || body.collaboratorId;
    const specificFields = checklistSpecificFields(body.activity, body);
    await execute(
      "UPDATE checklists SET collaborator_id = ?, activity = ?, answer = ?, observation = ?, price_divergence_products = ?, expired_products = ?, corrected_by = ?, corrected_at = ? WHERE id = ?",
      [
        collaboratorId,
        body.activity,
        body.answer,
        body.observation || "",
        specificFields.priceDivergenceProducts,
        specificFields.expiredProducts,
        user.id,
        nowIso(),
        id,
      ]
    );
    return send(res, 200, { ok: true });
  }

  if (method === "DELETE" && url.pathname.startsWith("/api/checklists/")) {
    if (!canDeleteRecords(user)) return send(res, 403, { error: "Apenas administrador pode excluir preenchimentos." });
    const id = Number(url.pathname.split("/").pop());
    await execute("DELETE FROM checklists WHERE id = ?", [id]);
    return send(res, 200, { ok: true, message: "Preenchimento excluído." });
  }

  if (method === "GET" && url.pathname === "/api/summary") {
    const date = url.searchParams.get("date") || today();
    const rows = await query("SELECT * FROM operational_summaries WHERE date = ?", [date]);
    return send(res, 200, { row: rows[0] || null });
  }

  if (method === "POST" && url.pathname === "/api/summary") {
    if (!canCorrect(user)) {
      return send(res, 403, { error: "Apenas administrador ou encarregada podem salvar o resumo." });
    }
    const body = await readBody(req);
    const existing = (await query("SELECT id FROM operational_summaries WHERE date = ?", [body.date || today()]))[0];
    if (existing && !canCorrect(user)) {
      return send(res, 403, { error: "Apenas administrador ou encarregada podem corrigir resumo já enviado." });
    }
    const params = [
      body.date || today(),
      Number(body.lossesValue || 0),
      Number(body.consumptionValue || 0),
      Number(body.bottlesCount || 0),
      body.bottlesDetails || "",
      Number(body.receiptsCount || 0),
      "",
      "",
      body.occurrences || "",
      body.correctiveActions || "",
      "",
      user.id,
      existing ? user.id : null,
      existing ? nowIso() : null,
    ];
    await execute(
      `
      INSERT INTO operational_summaries (
        date, losses_value, consumption_value, bottles_count, bottles_details, receipts_count,
        price_divergence_products, expired_products, occurrences, corrective_actions,
        pending_items, created_by, corrected_by, corrected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        losses_value=excluded.losses_value,
        consumption_value=excluded.consumption_value,
        bottles_count=excluded.bottles_count,
        bottles_details=excluded.bottles_details,
        receipts_count=excluded.receipts_count,
        price_divergence_products=excluded.price_divergence_products,
        expired_products=excluded.expired_products,
        occurrences=excluded.occurrences,
        corrective_actions=excluded.corrective_actions,
        pending_items=excluded.pending_items,
        corrected_by=excluded.corrected_by,
        corrected_at=excluded.corrected_at
      `,
      params
    );
    return send(res, 200, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/dashboard") {
    const fallback = today();
    const start = url.searchParams.get("startDate") || fallback;
    const end = url.searchParams.get("endDate") || start;
    const currentMonth = periodInfo(start, end);
    const totalsByDay = await query(
      "SELECT date, COUNT(*) AS total FROM checklists WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date",
      [start, end]
    );
    const summary = (await query(
      `
      SELECT
        COALESCE(SUM(losses_value),0) AS losses,
        COALESCE(SUM(consumption_value),0) AS consumptions,
        COALESCE(SUM(bottles_count),0) AS bottles,
        COALESCE(SUM(receipts_count),0) AS receipts,
        (SELECT COUNT(*) FROM checklists WHERE date BETWEEN ? AND ? AND activity = ? AND expired_products <> '') AS expired,
        (SELECT COUNT(*) FROM checklists WHERE date BETWEEN ? AND ? AND activity = ? AND price_divergence_products <> '') AS divergences
      FROM operational_summaries WHERE date BETWEEN ? AND ?
      `,
      [start, end, EXPIRED_PRODUCTS_ACTIVITY, start, end, PRICE_DIVERGENCE_ACTIVITY, start, end]
    ))[0];
    const doneToday = (await query("SELECT COUNT(*) AS total FROM checklists WHERE date = ?", [today()]))[0].total;
    const pendingToday = Math.max(activities.length - doneToday, 0);
    const byCollaborator = await query(
      `
      SELECT col.name, COUNT(*) AS total
      FROM checklists c JOIN collaborators col ON col.id = c.collaborator_id
      WHERE c.answer = 'Nao' AND c.date BETWEEN ? AND ?
      GROUP BY col.name ORDER BY total DESC
      `,
      [start, end]
    );
    const activeCollaborators = await query("SELECT id, name FROM collaborators WHERE status = 'ativo' ORDER BY name");
    const collaboratorCounts = await query(
      `
      SELECT col.id, col.name, COUNT(c.id) AS total
      FROM collaborators col
      LEFT JOIN checklists c ON c.collaborator_id = col.id AND c.date BETWEEN ? AND ?
      WHERE col.status = 'ativo'
      GROUP BY col.id, col.name
      ORDER BY col.name
      `,
      [currentMonth.start, currentMonth.end]
    );
    const totalMonthlyChecklists = collaboratorCounts.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const collaboratorCompletion = collaboratorCounts.map((row) => ({
      id: row.id,
      name: row.name,
      total: row.total,
      expected: totalMonthlyChecklists,
      percent: totalMonthlyChecklists ? Math.round((row.total / totalMonthlyChecklists) * 100) : 0,
    }));
    const activityCounts = await query(
      `
      SELECT activity, COUNT(DISTINCT date) AS total
      FROM checklists
      WHERE date BETWEEN ? AND ?
      GROUP BY activity
      `,
      [currentMonth.start, currentMonth.end]
    );
    const activityMap = new Map(activityCounts.map((row) => [row.activity, row.total]));
    const expectedPerActivity = currentMonth.days;
    const activityCompletion = activities.map((activity) => {
      const total = activityMap.get(activity) || 0;
      return {
        activity,
        total,
        expected: expectedPerActivity,
        percent: expectedPerActivity ? Math.min(100, Math.round((total / expectedPerActivity) * 100)) : 0,
      };
    });
    return send(res, 200, {
      totalsByDay,
      pendingToday,
      summary,
      byCollaborator,
      month: currentMonth,
      collaboratorCompletion,
      activityCompletion,
    });
  }

  if (method === "GET" && url.pathname === "/api/pendencies") {
    return send(res, 200, {
      rows: await query(
        `
        SELECT p.*, c.name AS responsible
        FROM pendencies p JOIN collaborators c ON c.id = p.responsible_id
        ORDER BY CASE p.status WHEN 'Aberto' THEN 1 WHEN 'Em andamento' THEN 2 ELSE 3 END, p.opened_at DESC
        `
      ),
    });
  }

  if (method === "POST" && url.pathname === "/api/pendencies") {
    const body = await readBody(req);
    const attachmentPath = saveDataUrl(body.attachmentData, body.attachmentName);
    await execute(
      "INSERT INTO pendencies (description, responsible_id, opened_at, status, attachment_path, solution_observation, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [body.description, body.responsibleId, body.openedAt || today(), body.status || "Aberto", attachmentPath, body.solutionObservation || "", user.id]
    );
    return send(res, 201, { ok: true });
  }

  if (method === "PUT" && url.pathname.startsWith("/api/pendencies/")) {
    const id = Number(url.pathname.split("/").pop());
    const body = await readBody(req);
    const attachmentPath = body.attachmentData ? saveDataUrl(body.attachmentData, body.attachmentName) : body.attachmentPath || null;
    await execute(
      "UPDATE pendencies SET description=?, responsible_id=?, opened_at=?, status=?, attachment_path=?, solution_observation=?, updated_at=? WHERE id=?",
      [body.description, body.responsibleId, body.openedAt, body.status, attachmentPath, body.solutionObservation || "", nowIso(), id]
    );
    return send(res, 200, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/reports/export") {
    const format = url.searchParams.get("format") || "excel";
    const rows = await rowsForReports(Object.fromEntries(url.searchParams.entries()));
    if (format === "pdf") {
      return send(res, 200, makePdf(rows), {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=relatorio-prevencao-perdas.pdf",
      });
    }
    return send(res, 200, makeExcel(rows), {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": "attachment; filename=relatorio-prevencao-perdas.xls",
    });
  }

  return send(res, 404, { error: "Rota não encontrada." });
}

function serveStatic(req, res, url) {
  let filePath = url.pathname === "/" ? path.join(ROOT, "public", "index.html") : path.join(ROOT, url.pathname);
  if (url.pathname.startsWith("/uploads/")) filePath = path.join(ROOT, url.pathname);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return send(res, 404, "Arquivo não encontrado", { "Content-Type": "text/plain; charset=utf-8" });
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
  };
  send(res, 200, fs.readFileSync(filePath), { "Content-Type": types[ext] || "application/octet-stream" });
}

function localNetworkUrls() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${PORT}`);
}

async function start() {
  await runDb({ action: "query", sql: "SELECT 1 AS ok" });
  http
    .createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        api(req, res, url).catch((error) => send(res, 500, { error: error.message }));
      } else {
        serveStatic(req, res, url);
      }
    })
    .listen(PORT, HOST, () => {
      console.log(`Sistema rodando em http://localhost:${PORT}`);
      const urls = localNetworkUrls();
      if (urls.length) {
        console.log("Acesse pelo celular na mesma rede:");
        urls.forEach((url) => console.log(`- ${url}`));
      }
    });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
