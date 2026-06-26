const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
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
const loginAttempts = new Map();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_LOCK_MS = 10 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const PRICE_DIVERGENCE_ACTIVITY = "Confer\u00eancia de precifica\u00e7\u00e3o";
const EXPIRED_PRODUCTS_ACTIVITY = "Verifica\u00e7\u00e3o de validades";
const RECEIPTS_ACTIVITY = "Acompanhamento de recebimentos";
const SECTOR_REQUIRED_ACTIVITY_TERMS = ["validade", "ruptura", "precificacao", "preco"];
const PHOTO_REQUIRED_ACTIVITY_TERMS = ["cotacao", "precificacao", "preco"];
const ENGAGEMENT_EXCLUDED_ACTIVITIES = [
  "Lan\u00e7amento de perdas no sistema",
  "Lan\u00e7amento de consumo interno",
  "Contagem e acompanhamento de vasilhames",
  "Observa\u00e7\u00e3o geral da loja",
];

const repoSectors = [
  "A\u00e7ougue",
  "Bazar",
  "Bebidas",
  "FLV e Granjeiro",
  "Limpeza",
  "Mercearia doce",
  "Mercearia salgada",
  "Mercearia seca",
  "Padaria",
  "Perec\u00edveis",
  "Perfumaria",
];

const repoActivities = [
  "Limpeza do setor",
  "Organiza\u00e7\u00e3o de g\u00f4ndolas",
  "Abastecimento de produtos",
  "Precifica\u00e7\u00e3o - placas de ofertas",
  "Precifica\u00e7\u00e3o - etiqueta de pre\u00e7o normal",
  "Verifica\u00e7\u00e3o de validades",
  "Ruptura",
  "Ponta de g\u00f4ndola e ilhas organizadas",
  "Confer\u00eancia de estoque no dep\u00f3sito",
  "Devolu\u00e7\u00e3o de produtos ao setor correto",
];

const activities = [
  "Temperatura 07h",
  "Temperatura 10h",
  "Temperatura 16h",
  "Temperatura 19h",
  "Lan\u00e7amento de perdas no sistema",
  "Lan\u00e7amento de consumo interno",
  "Contagem e acompanhamento de vasilhames",
  "Acompanhamento de cota\u00e7\u00f5es",
  "Acompanhamento de recebimentos",
  "Monitoramento loja / App Veesion",
  "Confer\u00eancia de precifica\u00e7\u00e3o",
  "Verifica\u00e7\u00e3o de validades",
  "Verifica\u00e7\u00e3o de \u00e1gua do bebedouro",
  "Acompanhamento da vitrine",
  "Portas e acessos conferidos",
  "Cancelamentos e estornos verificados",
  "Passagem de itens de forma correta no caixa",
  "Devolu\u00e7\u00e3o de produtos acompanhadas",
];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const SESSION_SECRET_FILE = path.join(DATA_DIR, ".session-secret");
const SESSION_SECRET = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (DATABASE_URL) return crypto.createHash("sha256").update(DATABASE_URL).digest("hex");
  if (fs.existsSync(SESSION_SECRET_FILE)) return fs.readFileSync(SESSION_SECRET_FILE, "utf8").trim();
  const secret = crypto.randomBytes(48).toString("base64url");
  fs.writeFileSync(SESSION_SECRET_FILE, secret, { encoding: "utf8", mode: 0o600 });
  return secret;
})();

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
      sector TEXT,
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
      sector TEXT,
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

    CREATE TABLE IF NOT EXISTS repo_tasks (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      collaborator_id INTEGER NOT NULL REFERENCES collaborators(id),
      sector TEXT NOT NULL,
      activity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Realizado',
      observation TEXT,
      sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS repo_ruptures (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      product TEXT NOT NULL,
      sector TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity TEXT,
      observation TEXT,
      status TEXT NOT NULL DEFAULT 'Aberto',
      commercial_status TEXT NOT NULL DEFAULT 'Pendente',
      commercial_observation TEXT,
      commercial_updated_by INTEGER REFERENCES users(id),
      sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP,
      created_by INTEGER NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS repo_expirations (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      product TEXT NOT NULL,
      sector TEXT NOT NULL,
      expiration_date TEXT NOT NULL,
      quantity TEXT,
      observation TEXT,
      status TEXT NOT NULL DEFAULT 'Aberto',
      commercial_status TEXT NOT NULL DEFAULT 'Pendente',
      commercial_observation TEXT,
      commercial_updated_by INTEGER REFERENCES users(id),
      sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP,
      created_by INTEGER NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS repo_damages (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      product TEXT NOT NULL,
      sector TEXT NOT NULL,
      quantity TEXT,
      reason TEXT,
      action TEXT,
      sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS repo_goals (
      id SERIAL PRIMARY KEY,
      sector TEXT NOT NULL,
      goal_type TEXT NOT NULL DEFAULT 'checklist',
      target_daily INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ativo',
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sector, goal_type)
    );

    CREATE TABLE IF NOT EXISTS agenda_slots (
      id SERIAL PRIMARY KEY,
      agenda_type TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Disponivel',
      booked_name TEXT,
      booked_company TEXT,
      booked_phone TEXT,
      booked_document TEXT,
      booked_observation TEXT,
      created_by INTEGER REFERENCES users(id),
      booked_at TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agenda_type, date, start_time)
    );

    CREATE TABLE IF NOT EXISTS sector_audits (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      sector TEXT NOT NULL,
      manager_status TEXT NOT NULL DEFAULT 'Pendente',
      observation TEXT,
      action_required TEXT,
      responsible TEXT,
      due_date TEXT,
      audited_by INTEGER REFERENCES users(id),
      audited_at TIMESTAMP,
      UNIQUE(date, sector)
    );

    CREATE TABLE IF NOT EXISTS sector_audit_reviews (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      sector TEXT NOT NULL,
      focus TEXT NOT NULL,
      manager_status TEXT NOT NULL DEFAULT 'Pendente',
      observation TEXT,
      action_required TEXT,
      responsible TEXT,
      due_date TEXT,
      audited_by INTEGER REFERENCES users(id),
      audited_at TIMESTAMP,
      UNIQUE(date, sector, focus)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS management_monthly (
      id SERIAL PRIMARY KEY,
      period TEXT UNIQUE NOT NULL,
      sold_quantity REAL NOT NULL DEFAULT 0,
      gross_sales REAL NOT NULL DEFAULT 0,
      cancelled_sales REAL NOT NULL DEFAULT 0,
      discounts REAL NOT NULL DEFAULT 0,
      net_sales REAL NOT NULL DEFAULT 0,
      coupons INTEGER NOT NULL DEFAULT 0,
      average_ticket REAL NOT NULL DEFAULT 0,
      cancelled_coupons INTEGER NOT NULL DEFAULT 0,
      green_coupons INTEGER NOT NULL DEFAULT 0,
      identified_green_coupons INTEGER NOT NULL DEFAULT 0,
      delivery_net_sales REAL NOT NULL DEFAULT 0,
      delivery_cancelled_sales REAL NOT NULL DEFAULT 0,
      delivery_discounts REAL NOT NULL DEFAULT 0,
      delivery_coupons INTEGER NOT NULL DEFAULT 0,
      delivery_cancelled_coupons INTEGER NOT NULL DEFAULT 0,
      delivery_other_checkouts REAL NOT NULL DEFAULT 0,
      delivery_goal_normal REAL NOT NULL DEFAULT 0,
      delivery_goal_plus REAL NOT NULL DEFAULT 0,
      quotation_cost REAL NOT NULL DEFAULT 0,
      quotation_sales REAL NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS management_sectors (
      id SERIAL PRIMARY KEY,
      period TEXT NOT NULL,
      sector TEXT NOT NULL,
      sales REAL NOT NULL DEFAULT 0,
      losses REAL NOT NULL DEFAULT 0,
      consumption REAL NOT NULL DEFAULT 0,
      employee_count INTEGER NOT NULL DEFAULT 0,
      productivity_target REAL NOT NULL DEFAULT 0,
      inventories INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(period, sector)
    );

    CREATE TABLE IF NOT EXISTS management_operators (
      id SERIAL PRIMARY KEY,
      period TEXT NOT NULL,
      operator_name TEXT NOT NULL,
      net_sales REAL NOT NULL DEFAULT 0,
      coupons INTEGER NOT NULL DEFAULT 0,
      cancelled_coupons INTEGER NOT NULL DEFAULT 0,
      vip INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(period, operator_name)
    );
  `);
  await pool.query("ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS sector TEXT");
  await pool.query("ALTER TABLE checklists ADD COLUMN IF NOT EXISTS sector TEXT");
  await pool.query("ALTER TABLE checklists ADD COLUMN IF NOT EXISTS photo_path TEXT");
  await pool.query("ALTER TABLE repo_ruptures ADD COLUMN IF NOT EXISTS commercial_updated_by INTEGER REFERENCES users(id)");
  await pool.query("ALTER TABLE repo_expirations ADD COLUMN IF NOT EXISTS commercial_updated_by INTEGER REFERENCES users(id)");
  await pool.query("ALTER TABLE management_monthly ADD COLUMN IF NOT EXISTS sold_quantity REAL NOT NULL DEFAULT 0");
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
    throw new Error("AÃ§Ã£o de banco invÃ¡lida");
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
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
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
        reject(new Error("JSON invÃ¡lido"));
      }
    });
  });
}

function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({
    user: publicUser(user),
    expiresAt: Date.now() + SESSION_TTL_MS,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function signedSession(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.user || Number(session.expiresAt || 0) <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function isPasswordHash(value) {
  return String(value || "").startsWith("scrypt$");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(String(password || ""), salt, 64).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!isPasswordHash(stored)) return String(password || "") === String(stored || "");
  const [, salt, expected] = String(stored).split("$");
  if (!salt || !expected) return false;
  const hash = crypto.scryptSync(String(password || ""), salt, 64);
  const expectedBuffer = Buffer.from(expected, "base64url");
  return expectedBuffer.length === hash.length && crypto.timingSafeEqual(hash, expectedBuffer);
}

function publicUser(user) {
  if (!user) return user;
  const { password, ...safe } = user;
  return safe;
}

function currentUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const session = sessions.get(token);
  if (session) {
    if (session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    return session.user;
  }
  return signedSession(token)?.user || null;
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) {
    send(res, 401, { error: "SessÃ£o expirada. FaÃ§a login novamente." });
    return null;
  }
  return user;
}

function loginAttemptKey(req, username) {
  return `${req.socket.remoteAddress || "local"}:${String(username || "").toLowerCase()}`;
}

function isLoginLocked(key) {
  const attempt = loginAttempts.get(key);
  return attempt && attempt.lockedUntil && attempt.lockedUntil > Date.now();
}

function recordLoginFailure(key) {
  const attempt = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  attempt.count += 1;
  if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
    attempt.lockedUntil = Date.now() + LOGIN_LOCK_MS;
    attempt.count = 0;
  }
  loginAttempts.set(key, attempt);
}

function clearLoginFailures(key) {
  loginAttempts.delete(key);
}

async function logAudit(user, action, entity, entityId, details = {}) {
  try {
    await execute(
      "INSERT INTO audit_logs (user_id, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [user?.id || null, action, entity, entityId == null ? null : String(entityId), JSON.stringify(details), nowIso()]
    );
  } catch (error) {
    console.error("Falha ao registrar auditoria:", error.message);
  }
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

function canAccessPrevention(user) {
  return ["administrador", "prevencao", "colaborador", "encarregada"].includes(user.role);
}

function canAccessReposition(user) {
  return ["administrador", "encarregada", "gerente", "reposicao", "comercial"].includes(user.role);
}

function canManageRepoGoals(user) {
  return ["administrador", "encarregada"].includes(user.role);
}

function canViewRepoGoals(user) {
  return ["administrador", "encarregada", "reposicao"].includes(user.role);
}

function canAccessSectorAudit(user) {
  return ["administrador", "gerente", "encarregada"].includes(user.role);
}

function canAccessManagementIndicators(user) {
  return user.role === "administrador";
}

function normalizeAgendaType(value) {
  return value === "recebimento" ? "recebimento" : "comercial";
}

function canAccessAgenda(user, type) {
  if (["administrador", "encarregada"].includes(user.role)) return true;
  if (type === "comercial") return user.role === "comercial";
  if (type === "recebimento") return user.role === "recebimento";
  return false;
}

function canUpdateRepoCommercial(user) {
  return ["administrador", "comercial"].includes(user.role);
}

function parseCollaboratorSectors(value) {
  if (!value) return [];
  const clean = (item) => String(item ?? "").trim();
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(clean).filter(Boolean);
  } catch (error) {
    // Compatibilidade com cadastros antigos que guardavam um setor em texto.
  }
  return String(value).split("||").map(clean).filter(Boolean);
}

async function validateRepoSectorForUser(user, sector) {
  if (user.role !== "reposicao" || !user.collaborator_id) return null;
  const rows = await query("SELECT sector FROM collaborators WHERE id = ?", [user.collaborator_id]);
  const assigned = parseCollaboratorSectors(rows[0]?.sector);
  if (!assigned.length) return "Nenhum setor est\u00e1 direcionado para o seu acesso.";
  if (assigned.includes(sector)) return null;
  return "Este setor n\u00e3o est\u00e1 direcionado para o seu acesso.";
}

async function sectorsForUser(user) {
  if (!user.collaborator_id) return [];
  const rows = await query("SELECT sector FROM collaborators WHERE id = ?", [user.collaborator_id]);
  return parseCollaboratorSectors(rows[0]?.sector);
}

async function commercialSectorFilter(user, column = "sector") {
  if (user.role !== "comercial") return { clause: "", params: [] };
  const sectors = await sectorsForUser(user);
  if (!sectors.length) return { clause: " AND 1 = 0", params: [] };
  return {
    clause: ` AND ${column} IN (${sectors.map(() => "?").join(", ")})`,
    params: sectors,
  };
}

async function repositionSectorFilter(user, column = "sector") {
  if (user.role !== "reposicao") return { clause: "", params: [] };
  const sectors = await sectorsForUser(user);
  if (!sectors.length) return { clause: " AND 1 = 0", params: [] };
  return {
    clause: ` AND ${column} IN (${sectors.map(() => "?").join(", ")})`,
    params: sectors,
  };
}

async function validateCommercialRecordSector(user, table, id) {
  if (user.role !== "comercial") return null;
  const sectors = await sectorsForUser(user);
  if (!sectors.length) return "Nenhum setor est\u00e1 direcionado para o seu acesso comercial.";
  const rows = await query(`SELECT sector FROM ${table} WHERE id = ?`, [id]);
  if (!rows[0]) return "Registro n\u00e3o encontrado.";
  if (sectors.includes(rows[0].sector)) return null;
  return "Este registro pertence a um setor que n\u00e3o est\u00e1 direcionado para o seu acesso comercial.";
}

function auditFocusConfig(focus) {
  const configs = {
    limpeza: { label: "Limpeza", terms: ["limpeza"], issueTypes: [] },
    organizacao: { label: "Organização", terms: ["organizacao", "gondola", "ilha"], issueTypes: [] },
    abastecimento: { label: "Abastecimento", terms: ["abastecimento"], issueTypes: ["ruptures"] },
    precificacao: { label: "Precificação", terms: ["precificacao", "preco"], issueTypes: [] },
    validade: { label: "Validade", terms: ["validade"], issueTypes: ["expirations"] },
    ruptura: { label: "Ruptura", terms: ["ruptura"], issueTypes: ["ruptures"] },
    avaria: { label: "Avaria", terms: ["avaria"], issueTypes: ["damages"] },
    tudo: { label: "Tudo", terms: [], issueTypes: ["ruptures", "expirations", "damages"] },
  };
  return configs[focus] || configs.abastecimento;
}

function focusActivities(focus) {
  const config = auditFocusConfig(focus);
  if (focus === "tudo") return repoActivities;
  return repoActivities.filter((activity) => {
    const normalized = normalizeText(activity);
    return config.terms.some((term) => normalized.includes(term));
  });
}

function sectorAuditAutomaticStatus(row, focus) {
  const motives = [];
  const config = auditFocusConfig(focus);
  const needsTask = row.expectedTasks > 0;
  if (needsTask && !row.tasks) motives.push(`Sem registro de ${config.label.toLowerCase()} no per\u00edodo`);
  if (row.negativeTasks) motives.push(`${row.negativeTasks} atividade(s) marcada(s) como N\u00e3o`);
  if (row.pendingTasks) motives.push(`${row.pendingTasks} atividade(s) pendente(s)`);
  if (row.ruptures) motives.push(`${row.ruptures} ruptura(s) apontada(s)`);
  if (row.expirations) motives.push(`${row.expirations} validade(s) apontada(s)`);
  if (row.damages) motives.push(`${row.damages} avaria(s) apontada(s)`);
  if (row.commercialPending) motives.push(`${row.commercialPending} retorno(s) comercial(is) pendente(s)`);

  const status = (needsTask && !row.tasks) || row.commercialPending || row.negativeTasks >= 2 || row.ruptures + row.expirations + row.damages >= 3
    ? "Cr\u00edtico"
    : (row.negativeTasks || row.pendingTasks || row.ruptures || row.expirations || row.damages ? "Aten\u00e7\u00e3o" : "Em conformidade");

  return {
    status,
    motives: motives.length ? motives : ["Sem diverg\u00eancias apontadas"],
  };
}

async function sectorAuditDashboard(start, end, focus = "abastecimento", sectorFilter = "") {
  const period = periodInfo(start, end);
  const selectedActivities = focusActivities(focus);
  const expectedTasks = selectedActivities.length * period.days;
  const selectedActivitySet = new Set(selectedActivities);
  const config = auditFocusConfig(focus);
  const sectors = new Map(repoSectors.map((sector) => [sector, {
    sector,
    focus,
    focusLabel: config.label,
    tasks: 0,
    completedTasks: 0,
    negativeTasks: 0,
    expectedTasks,
    pendingTasks: expectedTasks,
    ruptures: 0,
    expirations: 0,
    damages: 0,
    commercialPending: 0,
    lastUpdate: "",
    collaborators: new Set(),
    notes: [],
    taskObservations: [],
  }]));
  const ensure = (sector) => {
    const key = sector || "Sem setor";
    if (!sectors.has(key)) {
      sectors.set(key, {
        sector: key,
        focus,
        focusLabel: config.label,
        tasks: 0,
        completedTasks: 0,
        negativeTasks: 0,
        expectedTasks,
        pendingTasks: expectedTasks,
        ruptures: 0,
        expirations: 0,
        damages: 0,
        commercialPending: 0,
        lastUpdate: "",
        collaborators: new Set(),
        notes: [],
        taskObservations: [],
      });
    }
    return sectors.get(key);
  };
  const touch = (row, sentAt) => {
    if (sentAt && (!row.lastUpdate || String(sentAt) > String(row.lastUpdate))) row.lastUpdate = sentAt;
  };

  const responsibleRows = await query("SELECT name, sector FROM collaborators WHERE status = 'ativo'");
  responsibleRows.forEach((collaborator) => {
    parseCollaboratorSectors(collaborator.sector).forEach((sector) => ensure(sector).collaborators.add(collaborator.name));
  });

  const taskRows = await query(
    `SELECT t.date, t.sector, t.activity, t.status, t.observation, t.sent_at, c.name AS collaborator
     FROM repo_tasks t JOIN collaborators c ON c.id = t.collaborator_id
     WHERE t.date BETWEEN ? AND ?`,
    [start, end]
  );
  const completedKeys = new Set();
  taskRows.forEach((task) => {
    if (focus !== "tudo" && !selectedActivitySet.has(task.activity)) return;
    const row = ensure(task.sector);
    row.tasks += 1;
    if (task.status === "Realizado") {
      completedKeys.add(`${task.sector}|${task.date}|${task.activity}`);
      row.completedTasks += 1;
    } else {
      row.negativeTasks += 1;
      row.notes.push(`${task.activity}: marcada como N\u00e3o`);
    }
    if (String(task.observation || "").trim()) {
      row.taskObservations.push({
        collaborator: task.collaborator || "Repositor",
        date: task.date,
        activity: task.activity,
        observation: String(task.observation).trim(),
      });
    }
    if (task.collaborator) row.collaborators.add(task.collaborator);
    touch(row, task.sent_at);
  });
  sectors.forEach((row) => {
    const sectorCompleted = Array.from(completedKeys).filter((key) => key.startsWith(`${row.sector}|`)).length;
    row.pendingTasks = Math.max(expectedTasks - sectorCompleted, 0);
  });

  if (config.issueTypes.includes("ruptures")) {
    const ruptureRows = await query("SELECT sector, product, commercial_status, sent_at FROM repo_ruptures WHERE date BETWEEN ? AND ?", [start, end]);
    ruptureRows.forEach((item) => {
      const row = ensure(item.sector);
      row.ruptures += 1;
      if (item.commercial_status === "Pendente") row.commercialPending += 1;
      row.notes.push(`Ruptura: ${item.product}`);
      touch(row, item.sent_at);
    });
  }

  if (config.issueTypes.includes("expirations")) {
    const expirationRows = await query("SELECT sector, product, commercial_status, sent_at FROM repo_expirations WHERE date BETWEEN ? AND ?", [start, end]);
    expirationRows.forEach((item) => {
      const row = ensure(item.sector);
      row.expirations += 1;
      if (item.commercial_status === "Pendente") row.commercialPending += 1;
      row.notes.push(`Validade: ${item.product}`);
      touch(row, item.sent_at);
    });
  }

  if (config.issueTypes.includes("damages")) {
    const damageRows = await query("SELECT sector, product, sent_at FROM repo_damages WHERE date BETWEEN ? AND ?", [start, end]);
    damageRows.forEach((item) => {
      const row = ensure(item.sector);
      row.damages += 1;
      row.notes.push(`Avaria: ${item.product}`);
      touch(row, item.sent_at);
    });
  }

  const auditRows = await query(
    `SELECT a.*, u.display_name AS audited_by_name
     FROM sector_audit_reviews a
     LEFT JOIN users u ON u.id = a.audited_by
     WHERE a.date BETWEEN ? AND ? AND a.focus = ?
     ORDER BY a.audited_at DESC`,
    [start, end, focus]
  );
  const audits = new Map();
  auditRows.forEach((audit) => {
    if (!audits.has(audit.sector)) audits.set(audit.sector, audit);
  });

  return Array.from(sectors.values()).filter((row) => !sectorFilter || row.sector === sectorFilter).map((row) => {
    const automatic = sectorAuditAutomaticStatus(row, focus);
    const audit = audits.get(row.sector) || null;
    return {
      sector: row.sector,
      focus: row.focus,
      focusLabel: row.focusLabel,
      automaticStatus: automatic.status,
      motives: automatic.motives,
      responsible: Array.from(row.collaborators).join(", ") || "-",
      tasks: row.tasks,
      expectedTasks: row.expectedTasks,
      completedTasks: row.completedTasks,
      negativeTasks: row.negativeTasks,
      pendingTasks: row.pendingTasks,
      ruptures: row.ruptures,
      expirations: row.expirations,
      damages: row.damages,
      commercialPending: row.commercialPending,
      lastUpdate: row.lastUpdate,
      notes: row.notes.slice(0, 6),
      taskObservations: row.taskObservations.slice(0, 10),
      managerStatus: audit?.manager_status || "Pendente",
      managerObservation: audit?.observation || "",
      actionRequired: audit?.action_required || "",
      auditResponsible: audit?.responsible || "",
      dueDate: audit?.due_date || "",
      auditedBy: audit?.audited_by_name || "",
      auditedAt: audit?.audited_at || "",
    };
  }).sort((a, b) => a.sector.localeCompare(b.sector));
}

function canFillEncarregadaOnly(user) {
  return user.role === "encarregada";
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

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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
  if (filters.sector) {
    where.push("c.sector = ?");
    params.push(filters.sector);
  }
  return query(
    `
    SELECT c.id, c.date, c.sent_at, c.collaborator_id, c.created_by, c.photo_path,
           c.sector, c.price_divergence_products, c.expired_products,
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

function checklistProductDetails(row) {
  if (row.activity === PRICE_DIVERGENCE_ACTIVITY) return row.price_divergence_products || "";
  if (row.activity === EXPIRED_PRODUCTS_ACTIVITY) return row.expired_products || "";
  return "";
}

function makeExcel(rows) {
  const header = ["Data", "Hora de envio", "Colaborador", "Atividade", "Setor", "Produtos identificados", "Foto", "Sim/NÃ£o", "ObservaÃ§Ã£o", "Enviado por"];
  const xmlRows = [header, ...rows.map((row) => [
    row.date,
    row.sent_at,
    row.collaborator,
    row.activity,
    row.sector || "",
    checklistProductDetails(row),
    row.photo_path || "",
    row.answer,
    row.observation || "",
    row.sent_by,
  ])]
    .map((cols) => `<tr>${cols.map((col) => `<td>${escapeHtml(col)}</td>`).join("")}</tr>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><table>${xmlRows}</table></body></html>`;
}

function pdfColor(hex) {
  const value = String(hex).replace("#", "");
  const parts = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  return parts.map((part) => Number(part.toFixed(3))).join(" ");
}

function pdfText(value, limit = 220) {
  return pdfEscape(String(value ?? "").slice(0, limit));
}

function wrapPdfText(value, maxChars, maxLines = 4) {
  const words = pdfText(value, 800).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const sliced = lines.slice(0, maxLines);
    sliced[maxLines - 1] = `${sliced[maxLines - 1].slice(0, Math.max(0, maxChars - 3))}...`;
    return sliced;
  }
  return lines.length ? lines : [""];
}

function structuredPdf({ title, subtitle, meta = [], sections = [], landscape = false, compact = false }) {
  const width = landscape ? 842 : 595;
  const height = landscape ? 595 : 842;
  const margin = compact ? 24 : 36;
  const inner = width - margin * 2;
  const colors = {
    dark: "#0f1512",
    green: "#20804f",
    pale: "#edf4ef",
    line: "#d4ddd8",
    muted: "#52625a",
    text: "#101815",
    white: "#ffffff",
  };
  const pages = [];
  let ops = [];
  let y = 0;
  const cmd = (value) => ops.push(value);
  const fill = (hex) => `${pdfColor(hex)} rg`;
  const stroke = (hex) => `${pdfColor(hex)} RG`;
  const rect = (x, rectY, w, h, color) => cmd(`${fill(color)} ${x} ${rectY} ${w} ${h} re f`);
  const line = (x1, y1, x2, y2, color = colors.line, size = 0.6) => cmd(`${stroke(color)} ${size} w ${x1} ${y1} m ${x2} ${y2} l S`);
  const text = (value, x, textY, size = 9, color = colors.text, font = "F1") => {
    cmd(`BT /${font} ${size} Tf ${fill(color)} ${x} ${textY} Td (${pdfText(value)}) Tj ET`);
  };
  const addHeader = () => {
    const headerH = compact ? 58 : 92;
    rect(0, height - headerH, width, headerH, colors.dark);
    rect(margin, height - (compact ? 40 : 48), compact ? 22 : 26, compact ? 22 : 26, colors.green);
    text("CA", margin + (compact ? 6 : 7), height - (compact ? 32 : 39), compact ? 8 : 9.5, colors.white, "F2");
    text(title, margin + (compact ? 32 : 38), height - (compact ? 27 : 33), compact ? 13 : 17, colors.white, "F2");
    text(subtitle, margin + (compact ? 32 : 38), height - (compact ? 43 : 50), compact ? 7.3 : 8.2, "#b9c7c0", "F1");
    meta.slice(0, 3).forEach((item, index) => text(item, width - margin - 205, height - (compact ? 24 : 30) - index * (compact ? 10 : 12), compact ? 6.6 : 7.5, "#d7e1dc"));
    y = height - headerH - (compact ? 12 : 24);
  };
  const newPage = () => {
    if (ops.length) pages.push(ops);
    ops = [];
    addHeader();
  };
  const ensure = (space) => {
    if (y - space < (compact ? 42 : 58)) newPage();
  };
  newPage();
  const sectionTitle = (label) => {
    ensure(compact ? 24 : 34);
    text(label, margin, y, compact ? 11 : 13, colors.text, "F2");
    line(margin, y - 7, width - margin, y - 7, colors.line, 0.7);
    y -= compact ? 19 : 28;
  };
  const cards = (items) => {
    const columns = compact && items.length <= 6 ? 6 : 3;
    const gap = compact ? 6 : 10;
    const cardW = (inner - gap * (columns - 1)) / columns;
    const cardH = compact ? 42 : 72;
    for (let index = 0; index < items.length; index += columns) {
      ensure(cardH + (compact ? 8 : 14));
      items.slice(index, index + columns).forEach((item, col) => {
        const x = margin + col * (cardW + gap);
        rect(x, y - cardH + 8, cardW, cardH, "#f7faf8");
        cmd(`${stroke(colors.line)} 0.7 w ${x} ${y - cardH + 8} ${cardW} ${cardH} re S`);
        text(item.label, x + 8, y - 10, compact ? 6.5 : 8.5, colors.muted, "F2");
        text(item.value, x + 8, y - (compact ? 25 : 39), compact ? 8.5 : 15, colors.text, "F2");
        if (item.note) text(item.note, x + 8, y - (compact ? 36 : 58), compact ? 5.8 : 8, colors.muted);
      });
      y -= cardH + (compact ? 6 : 12);
    }
  };
  const table = (headers, rows, widths) => {
    if (!rows.length) rows = [["Sem dados para o filtro selecionado."]];
    const normalizedWidths = widths || headers.map(() => inner / headers.length);
    const headerH = compact ? 16 : 24;
    ensure(headerH + 10);
    rect(margin, y - headerH, inner, headerH, colors.pale);
    let x = margin;
    headers.forEach((header, index) => {
      text(header, x + 5, y - (compact ? 11 : 16), compact ? 6.2 : 7.6, colors.muted, "F2");
      x += normalizedWidths[index] || 80;
    });
    y -= headerH;
    rows.forEach((row, rowIndex) => {
      const cells = headers.map((_, index) => row[index] ?? "");
      const wrapped = cells.map((cell, index) => wrapPdfText(cell, Math.max(8, Math.floor((normalizedWidths[index] || 80) / (compact ? 4 : 4.6))), compact ? 2 : 4));
      const rowH = Math.max(compact ? 16 : 28, Math.max(...wrapped.map((lines) => lines.length)) * (compact ? 7 : 11) + (compact ? 7 : 14));
      ensure(rowH);
      if (rowIndex % 2 === 1) rect(margin, y - rowH, inner, rowH, "#fbfcfb");
      line(margin, y - rowH, width - margin, y - rowH, colors.line, 0.4);
      x = margin;
      wrapped.forEach((lines, cellIndex) => {
        lines.forEach((cellLine, lineIndex) => text(cellLine, x + 5, y - (compact ? 10 : 13) - lineIndex * (compact ? 7 : 11), compact ? 6.3 : 7.6, colors.text));
        x += normalizedWidths[cellIndex] || 80;
      });
      y -= rowH;
    });
    y -= compact ? 6 : 12;
  };
  sections.forEach((section) => {
    sectionTitle(section.title);
    if (section.cards) cards(section.cards);
    if (section.table) table(section.table.headers, section.table.rows, section.table.widths);
  });
  if (ops.length) pages.push(ops);
  const objects = [];
  const pageIds = [];
  const fontId = 3 + pages.length * 2;
  const boldFontId = fontId + 1;
  pages.forEach((pageOps, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    pageIds.push(`${pageId} 0 R`);
    const footer = [
      `${stroke(colors.line)} 0.5 w ${margin} 36 m ${width - margin} 36 l S`,
      `BT /F1 7.5 Tf ${fill(colors.muted)} ${margin} 24 Td (Controle Atacarejo) Tj ET`,
      `BT /F1 7.5 Tf ${fill(colors.muted)} ${width - margin - 54} 24 Td (Pagina ${index + 1}/${pages.length}) Tj ET`,
    ];
    const stream = Buffer.from([...pageOps, ...footer].join("\n"), "latin1");
    objects[pageId] = `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >> endobj`;
    objects[contentId] = `${contentId} 0 obj << /Length ${stream.length} >> stream\n${stream.toString("latin1")}\nendstream endobj`;
  });
  objects[1] = "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj";
  objects[2] = `2 0 obj << /Type /Pages /Kids [${pageIds.join(" ")}] /Count ${pages.length} >> endobj`;
  objects[fontId] = `${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`;
  objects[boldFontId] = `${boldFontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id <= boldFontId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${objects[id]}\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${boldFontId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= boldFontId; id += 1) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${boldFontId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

function makePdf(rows) {
  const yes = rows.filter((row) => row.answer === "Sim").length;
  return structuredPdf({
    title: "Relatorio Prevencao",
    subtitle: "Checklists e ocorrencias registradas",
    meta: [`Gerado em ${new Date().toLocaleString("pt-BR")}`, `${rows.length} registro(s)`, `${yes} resposta(s) Sim`],
    sections: [
      {
        title: "Resumo do relatorio",
        cards: [
          { label: "Registros", value: rows.length, note: "Itens encontrados no filtro" },
          { label: "Realizados", value: yes, note: "Respostas Sim" },
          { label: "Pendentes / Nao", value: rows.length - yes, note: "Respostas diferentes de Sim" },
        ],
      },
      {
        title: "Lancamentos",
        table: {
          headers: ["Data", "Colaborador", "Atividade", "Setor", "Resp.", "Detalhes"],
          widths: [54, 86, 128, 70, 42, 143],
          rows: rows.map((row) => [
            row.date,
            row.collaborator,
            row.activity,
            row.sector || "-",
            row.answer,
            [
              checklistProductDetails(row),
              row.observation,
              row.photo_path ? `Foto: ${row.photo_path}` : "",
            ].filter(Boolean).join(" | ") || "-",
          ]),
        },
      },
    ],
  });
}

function checklistSpecificFields(activity, body) {
  return {
    priceDivergenceProducts: activity === PRICE_DIVERGENCE_ACTIVITY ? body.priceDivergenceProducts || "" : "",
    expiredProducts: activity === EXPIRED_PRODUCTS_ACTIVITY ? body.expiredProducts || "" : "",
    sector: activityNeedsProductSector(activity) ? body.sector || "" : "",
  };
}

function checklistNeedsPhoto(activity) {
  const normalized = normalizeText(activity);
  return PHOTO_REQUIRED_ACTIVITY_TERMS.some((term) => normalized.includes(term));
}

function saveChecklistPhoto(activity, body) {
  if (!checklistNeedsPhoto(activity) || !body.photoDataUrl) return null;
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(body.photoDataUrl)) return null;
  return saveDataUrl(body.photoDataUrl, body.photoName || "checklist-foto");
}

function activityNeedsProductSector(activity) {
  const normalized = normalizeText(activity);
  return SECTOR_REQUIRED_ACTIVITY_TERMS.some((term) => normalized.includes(term));
}

function pdfEscape(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[()\\]/g, " ");
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function intValue(value) {
  return Math.max(0, Math.round(numberValue(value)));
}

function previousPeriod(period) {
  const [year, month] = String(period || today().slice(0, 7)).split("-").map(Number);
  const date = new Date(year, (month || 1) - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function managementMonthlyCalculated(row = {}) {
  const netSales = numberValue(row.net_sales);
  const coupons = intValue(row.coupons);
  const deliveryNet = numberValue(row.delivery_net_sales);
  const deliveryOther = numberValue(row.delivery_other_checkouts);
  const deliveryTotal = deliveryNet + deliveryOther;
  const deliveryCoupons = intValue(row.delivery_coupons);
  const deliveryCancelledCoupons = intValue(row.delivery_cancelled_coupons);
  const deliveryValidCoupons = Math.max(0, deliveryCoupons - deliveryCancelledCoupons);
  const quotationCost = numberValue(row.quotation_cost);
  const quotationSales = numberValue(row.quotation_sales);
  const quotationProfit = quotationSales - quotationCost;
  return {
    ...row,
    average_ticket: numberValue(row.average_ticket) || (coupons ? netSales / coupons : 0),
    cancellation_rate: coupons ? intValue(row.cancelled_coupons) / coupons : 0,
    discount_rate: numberValue(row.gross_sales) ? numberValue(row.discounts) / numberValue(row.gross_sales) : 0,
    green_unidentified_coupons: Math.max(0, intValue(row.green_coupons) - intValue(row.identified_green_coupons)),
    green_identification_rate: intValue(row.green_coupons) ? intValue(row.identified_green_coupons) / intValue(row.green_coupons) : 0,
    delivery_total: deliveryTotal,
    delivery_participation: netSales ? deliveryTotal / netSales : 0,
    delivery_valid_coupons: deliveryValidCoupons,
    delivery_average_ticket: deliveryValidCoupons ? deliveryNet / deliveryValidCoupons : 0,
    delivery_cancellation_rate: deliveryCoupons ? deliveryCancelledCoupons / deliveryCoupons : 0,
    delivery_discount_rate: deliveryNet ? numberValue(row.delivery_discounts) / deliveryNet : 0,
    delivery_result_normal: deliveryTotal - numberValue(row.delivery_goal_normal),
    delivery_result_plus: deliveryTotal - numberValue(row.delivery_goal_plus),
    quotation_profit: quotationProfit,
    quotation_margin_sales: quotationSales ? quotationProfit / quotationSales : 0,
    quotation_margin_cost: quotationCost ? quotationProfit / quotationCost : 0,
    quotation_participation: netSales ? quotationSales / netSales : 0,
  };
}

function managementSectorCalculated(row = {}) {
  const sales = numberValue(row.sales);
  const losses = numberValue(row.losses);
  const consumption = numberValue(row.consumption);
  const employeeCount = intValue(row.employee_count);
  const productivityTarget = numberValue(row.productivity_target);
  return {
    ...row,
    loss_rate: sales ? losses / sales : 0,
    consumption_rate: sales ? consumption / sales : 0,
    sales_per_employee: employeeCount ? sales / employeeCount : 0,
    suggested_employees: productivityTarget ? sales / productivityTarget : 0,
    staffing_difference: employeeCount - (productivityTarget ? sales / productivityTarget : 0),
  };
}

function managementComparison(current, previous, fields) {
  return Object.fromEntries(fields.map((field) => [
    field,
    {
      value: numberValue(current?.[field]),
      previous: numberValue(previous?.[field]),
      difference: numberValue(current?.[field]) - numberValue(previous?.[field]),
      percent: numberValue(previous?.[field])
        ? (numberValue(current?.[field]) - numberValue(previous?.[field])) / Math.abs(numberValue(previous?.[field]))
        : 0,
    },
  ]));
}

function simplePdf(lines) {
  const pageLines = 48;
  const pages = [];
  for (let index = 0; index < lines.length; index += pageLines) pages.push(lines.slice(index, index + pageLines));
  if (!pages.length) pages.push(["Sem dados."]);
  const objects = [];
  const pageIds = [];
  const fontId = 3 + pages.length * 2;
  pages.forEach((page, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    pageIds.push(`${pageId} 0 R`);
    const text = page.map((line, lineIndex) => `BT /F1 9 Tf 36 ${806 - lineIndex * 16} Td (${pdfEscape(String(line).slice(0, 115))}) Tj ET`).join("\n");
    const stream = Buffer.from(text, "latin1");
    objects[pageId] = `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >> endobj`;
    objects[contentId] = `${contentId} 0 obj << /Length ${stream.length} >> stream\n${stream.toString("latin1")}\nendstream endobj`;
  });
  objects[1] = "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj";
  objects[2] = `2 0 obj << /Type /Pages /Kids [${pageIds.join(" ")}] /Count ${pages.length} >> endobj`;
  objects[fontId] = `${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id <= fontId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${objects[id]}\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= fontId; id += 1) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

async function managementReportData(period, comparePeriod = previousPeriod(period)) {
  const monthlyRows = await query("SELECT * FROM management_monthly WHERE period IN (?, ?)", [period, comparePeriod]);
  const currentMonthly = managementMonthlyCalculated(monthlyRows.find((row) => row.period === period) || { period });
  const previousMonthly = managementMonthlyCalculated(monthlyRows.find((row) => row.period === comparePeriod) || { period: comparePeriod });
  const sectorRows = await query(
    "SELECT * FROM management_sectors WHERE period IN (?, ?) ORDER BY sector",
    [period, comparePeriod]
  );
  const currentSectorMap = new Map(
    sectorRows.filter((row) => row.period === period).map((row) => [row.sector, managementSectorCalculated(row)])
  );
  const previousSectorMap = new Map(sectorRows.filter((row) => row.period === comparePeriod).map((row) => [row.sector, managementSectorCalculated(row)]));
  const sectorNames = [...new Set([...currentSectorMap.keys(), ...previousSectorMap.keys()])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const sectors = sectorNames.map((sector) => {
    const row = currentSectorMap.get(sector) || managementSectorCalculated({ period, sector });
    const previous = previousSectorMap.get(sector) || managementSectorCalculated({ period: comparePeriod, sector });
    return {
      ...row,
      previous: {
        ...previous,
        participation: numberValue(previousMonthly.net_sales) ? numberValue(previous.net_sales) / numberValue(previousMonthly.net_sales) : 0,
        cancellation_rate: intValue(previous.coupons) ? intValue(previous.cancelled_coupons) / intValue(previous.coupons) : 0,
      },
      comparison: managementComparison(row, previous, ["sales", "losses", "consumption", "loss_rate", "sales_per_employee"]),
    };
  });
  const operatorRows = await query(
    "SELECT * FROM management_operators WHERE period IN (?, ?) ORDER BY operator_name",
    [period, comparePeriod]
  );
  const currentOperatorMap = new Map(operatorRows.filter((row) => row.period === period).map((row) => [row.operator_name, row]));
  const previousOperatorMap = new Map(operatorRows.filter((row) => row.period === comparePeriod).map((row) => [row.operator_name, row]));
  const operatorNames = [...new Set([...currentOperatorMap.keys(), ...previousOperatorMap.keys()])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const operators = operatorNames.map((operatorName) => {
    const row = currentOperatorMap.get(operatorName) || { period, operator_name: operatorName };
    const previous = previousOperatorMap.get(operatorName) || { period: comparePeriod, operator_name: operatorName };
    return {
      ...row,
      previous,
      comparison: managementComparison(row, previous, ["net_sales", "coupons", "cancelled_coupons", "vip"]),
      participation: numberValue(currentMonthly.net_sales) ? numberValue(row.net_sales) / numberValue(currentMonthly.net_sales) : 0,
      cancellation_rate: intValue(row.coupons) ? intValue(row.cancelled_coupons) / intValue(row.coupons) : 0,
    };
  }).sort((a, b) => numberValue(b.net_sales) - numberValue(a.net_sales));
  return {
    period,
    comparePeriod,
    monthly: currentMonthly,
    previousMonthly,
    monthlyComparison: managementComparison(currentMonthly, previousMonthly, [
      "sold_quantity", "gross_sales", "cancelled_sales", "discounts", "net_sales", "coupons",
      "average_ticket", "cancelled_coupons", "cancellation_rate", "discount_rate",
      "green_coupons", "identified_green_coupons", "green_unidentified_coupons", "green_identification_rate",
      "delivery_net_sales", "delivery_cancelled_sales", "delivery_discounts", "delivery_coupons",
      "delivery_cancelled_coupons", "delivery_other_checkouts", "delivery_total",
      "delivery_participation", "delivery_valid_coupons", "delivery_average_ticket", "delivery_cancellation_rate",
      "delivery_discount_rate", "delivery_result_normal", "delivery_result_plus",
      "quotation_cost", "quotation_sales", "quotation_profit", "quotation_margin_sales",
      "quotation_margin_cost", "quotation_participation",
    ]),
    sectors,
    operators,
  };
}

function managementPdf(report, reportType = "all", sectorFilter = "") {
  const currency = (value) => `R$ ${numberValue(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const percent = (value) => `${(numberValue(value) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const variationNote = (comparison) => `Variacao ${currency(comparison?.difference)} (${percent(comparison?.percent)})`;
  const moneyRow = (label, current, previous, comparison) => [label, currency(current), currency(previous), currency(comparison?.difference), percent(comparison?.percent)];
  const percentRow = (label, current, previous, comparison) => [label, percent(current), percent(previous), percent(comparison?.difference), percent(comparison?.percent)];
  const countRow = (label, current, previous, comparison, digits = 0) => [
    label,
    numberValue(current).toLocaleString("pt-BR", { maximumFractionDigits: digits }),
    numberValue(previous).toLocaleString("pt-BR", { maximumFractionDigits: digits }),
    numberValue(comparison?.difference).toLocaleString("pt-BR", { maximumFractionDigits: digits }),
    percent(comparison?.percent),
  ];
  const comparisonHeaders = ["Indicador", "Atual", "Anterior", "Diferenca", "Variacao"];
  const comparisonWidths = [210, 140, 140, 140, 90];
  const sectors = sectorFilter ? report.sectors.filter((row) => row.sector === sectorFilter) : report.sectors;
  const store = {
    title: "Venda da loja",
    cards: [
      { label: "Venda liquida", value: currency(report.monthly.net_sales), note: variationNote(report.monthlyComparison.net_sales) },
      { label: "Cupons", value: report.monthly.coupons || 0, note: `Anterior ${report.previousMonthly.coupons || 0}` },
      { label: "Ticket medio", value: currency(report.monthly.average_ticket), note: `Anterior ${currency(report.previousMonthly.average_ticket)}` },
      { label: "Cancelada", value: currency(report.monthly.cancelled_sales), note: `${report.monthly.cancelled_coupons || 0} cupom(ns)` },
      { label: "Taxa cancelamento", value: percent(report.monthly.cancellation_rate), note: `Anterior ${percent(report.previousMonthly.cancellation_rate)}` },
      { label: "Cupons verdes", value: report.monthly.green_coupons || 0, note: `${percent(report.monthly.green_identification_rate)} identificados` },
    ],
    table: {
      headers: comparisonHeaders,
      widths: comparisonWidths,
      rows: [
        countRow("Quantidade vendida", report.monthly.sold_quantity, report.previousMonthly.sold_quantity, report.monthlyComparison.sold_quantity, 3),
        moneyRow("Venda bruta", report.monthly.gross_sales, report.previousMonthly.gross_sales, report.monthlyComparison.gross_sales),
        moneyRow("Venda cancelada", report.monthly.cancelled_sales, report.previousMonthly.cancelled_sales, report.monthlyComparison.cancelled_sales),
        moneyRow("Descontos", report.monthly.discounts, report.previousMonthly.discounts, report.monthlyComparison.discounts),
        percentRow("Percentual de descontos", report.monthly.discount_rate, report.previousMonthly.discount_rate, report.monthlyComparison.discount_rate),
        moneyRow("Venda liquida", report.monthly.net_sales, report.previousMonthly.net_sales, report.monthlyComparison.net_sales),
        countRow("Quantidade de cupons", report.monthly.coupons, report.previousMonthly.coupons, report.monthlyComparison.coupons),
        moneyRow("Ticket medio", report.monthly.average_ticket, report.previousMonthly.average_ticket, report.monthlyComparison.average_ticket),
        countRow("Cupons cancelados", report.monthly.cancelled_coupons, report.previousMonthly.cancelled_coupons, report.monthlyComparison.cancelled_coupons),
        percentRow("Taxa de cancelamento", report.monthly.cancellation_rate, report.previousMonthly.cancellation_rate, report.monthlyComparison.cancellation_rate),
        countRow("Cupons verdes", report.monthly.green_coupons, report.previousMonthly.green_coupons, report.monthlyComparison.green_coupons),
        countRow("Cupons verdes identificados", report.monthly.identified_green_coupons, report.previousMonthly.identified_green_coupons, report.monthlyComparison.identified_green_coupons),
        countRow("Cupons verdes nao identificados", report.monthly.green_unidentified_coupons, report.previousMonthly.green_unidentified_coupons, report.monthlyComparison.green_unidentified_coupons),
        percentRow("Identificacao verde", report.monthly.green_identification_rate, report.previousMonthly.green_identification_rate, report.monthlyComparison.green_identification_rate),
      ],
    },
  };
  const delivery = {
    title: "Delivery",
    cards: [
      { label: "Total delivery", value: currency(report.monthly.delivery_total), note: variationNote(report.monthlyComparison.delivery_total) },
      { label: "Participacao", value: percent(report.monthly.delivery_participation), note: `Anterior ${percent(report.previousMonthly.delivery_participation)}` },
      { label: "Ticket medio", value: currency(report.monthly.delivery_average_ticket), note: `Venda liquida / ${report.monthly.delivery_valid_coupons || 0} cupons validos` },
      { label: "Cancelada", value: currency(report.monthly.delivery_cancelled_sales), note: `${percent(report.monthly.delivery_cancellation_rate)} taxa` },
      { label: "Meta normal", value: currency(report.monthly.delivery_goal_normal), note: `Resultado ${currency(report.monthly.delivery_result_normal)}` },
      { label: "Meta plus", value: currency(report.monthly.delivery_goal_plus), note: `Resultado ${currency(report.monthly.delivery_result_plus)}` },
    ],
    table: {
      headers: comparisonHeaders,
      widths: comparisonWidths,
      rows: [
        moneyRow("Venda liquida", report.monthly.delivery_net_sales, report.previousMonthly.delivery_net_sales, report.monthlyComparison.delivery_net_sales),
        moneyRow("Venda cancelada", report.monthly.delivery_cancelled_sales, report.previousMonthly.delivery_cancelled_sales, report.monthlyComparison.delivery_cancelled_sales),
        moneyRow("Ticket medio sobre cupons validos", report.monthly.delivery_average_ticket, report.previousMonthly.delivery_average_ticket, report.monthlyComparison.delivery_average_ticket),
        moneyRow("Descontos", report.monthly.delivery_discounts, report.previousMonthly.delivery_discounts, report.monthlyComparison.delivery_discounts),
        percentRow("Percentual de descontos", report.monthly.delivery_discount_rate, report.previousMonthly.delivery_discount_rate, report.monthlyComparison.delivery_discount_rate),
        countRow("Quantidade de cupons", report.monthly.delivery_coupons, report.previousMonthly.delivery_coupons, report.monthlyComparison.delivery_coupons),
        countRow("Cupons cancelados", report.monthly.delivery_cancelled_coupons, report.previousMonthly.delivery_cancelled_coupons, report.monthlyComparison.delivery_cancelled_coupons),
        countRow("Cupons validos", report.monthly.delivery_valid_coupons, report.previousMonthly.delivery_valid_coupons, report.monthlyComparison.delivery_valid_coupons),
        percentRow("Taxa de cancelamento", report.monthly.delivery_cancellation_rate, report.previousMonthly.delivery_cancellation_rate, report.monthlyComparison.delivery_cancellation_rate),
        moneyRow("Outros checkouts sem cupons", report.monthly.delivery_other_checkouts, report.previousMonthly.delivery_other_checkouts, report.monthlyComparison.delivery_other_checkouts),
        moneyRow("Total", report.monthly.delivery_total, report.previousMonthly.delivery_total, report.monthlyComparison.delivery_total),
        percentRow("Participacao na venda da loja", report.monthly.delivery_participation, report.previousMonthly.delivery_participation, report.monthlyComparison.delivery_participation),
        moneyRow("Resultado sobre meta normal", report.monthly.delivery_result_normal, report.previousMonthly.delivery_result_normal, report.monthlyComparison.delivery_result_normal),
        moneyRow("Resultado sobre meta plus", report.monthly.delivery_result_plus, report.previousMonthly.delivery_result_plus, report.monthlyComparison.delivery_result_plus),
      ],
    },
  };
  const quotations = {
    title: "Cotacoes",
    cards: [
      { label: "Venda", value: currency(report.monthly.quotation_sales), note: variationNote(report.monthlyComparison.quotation_sales) },
      { label: "Custo", value: currency(report.monthly.quotation_cost), note: `Anterior ${currency(report.previousMonthly.quotation_cost)}` },
      { label: "Lucro", value: currency(report.monthly.quotation_profit), note: `Anterior ${currency(report.previousMonthly.quotation_profit)}` },
      { label: "Participacao", value: percent(report.monthly.quotation_participation), note: `Anterior ${percent(report.previousMonthly.quotation_participation)}` },
      { label: "Margem venda", value: percent(report.monthly.quotation_margin_sales), note: "Lucro sobre venda" },
      { label: "Margem custo", value: percent(report.monthly.quotation_margin_cost), note: "Lucro sobre custo" },
    ],
    table: {
      headers: comparisonHeaders,
      widths: comparisonWidths,
      rows: [
        moneyRow("Venda", report.monthly.quotation_sales, report.previousMonthly.quotation_sales, report.monthlyComparison.quotation_sales),
        moneyRow("Custo", report.monthly.quotation_cost, report.previousMonthly.quotation_cost, report.monthlyComparison.quotation_cost),
        moneyRow("Lucro", report.monthly.quotation_profit, report.previousMonthly.quotation_profit, report.monthlyComparison.quotation_profit),
        percentRow("Participacao", report.monthly.quotation_participation, report.previousMonthly.quotation_participation, report.monthlyComparison.quotation_participation),
        percentRow("Margem sobre custo", report.monthly.quotation_margin_cost, report.previousMonthly.quotation_margin_cost, report.monthlyComparison.quotation_margin_cost),
        percentRow("Margem sobre venda", report.monthly.quotation_margin_sales, report.previousMonthly.quotation_margin_sales, report.monthlyComparison.quotation_margin_sales),
      ],
    },
  };
  const sectorTable = {
    title: "Comparativo por setor",
    table: {
      headers: ["Setor", "Venda", "Perdas", "Consumo", "Venda/func.", "Equipe"],
      widths: [105, 92, 82, 82, 90, 72],
      rows: sectors.map((row) => [
        row.sector,
        `${currency(row.sales)} | ${percent(row.comparison.sales.percent)}`,
        `${currency(row.losses)} | ${percent(row.loss_rate)}`,
        `${currency(row.consumption)} | ${percent(row.consumption_rate)}`,
        currency(row.sales_per_employee),
        `${row.employee_count || 0} atual | ${numberValue(row.suggested_employees).toFixed(1)} sug.`,
      ]),
    },
  };
  const losses = {
    title: "Perdas e consumo por setor",
    table: {
      headers: ["Setor", "Perdas", "% perda", "Consumo", "% consumo", "Invent."],
      widths: [110, 90, 80, 90, 80, 73],
      rows: sectors.map((row) => [
        row.sector,
        `${currency(row.losses)} | ant. ${currency(row.previous.losses)}`,
        `${percent(row.loss_rate)} | ant. ${percent(row.previous.loss_rate)}`,
        `${currency(row.consumption)} | ant. ${currency(row.previous.consumption)}`,
        `${percent(row.consumption_rate)} | ant. ${percent(row.previous.consumption_rate)}`,
        `${row.inventories || 0}`,
      ]),
    },
  };
  const productivity = {
    title: "Produtividade por setor",
    table: {
      headers: ["Setor", "Venda", "Equipe", "Meta/func.", "Venda/func.", "Diferenca"],
      widths: [105, 92, 70, 90, 92, 74],
      rows: sectors.map((row) => [
        row.sector,
        currency(row.sales),
        row.employee_count || 0,
        currency(row.productivity_target),
        currency(row.sales_per_employee),
        numberValue(row.staffing_difference).toFixed(1),
      ]),
    },
  };
  const operators = {
    title: "Operadores",
    table: {
      headers: ["Operador", "Venda", "Particip.", "Cupons", "Cancel.", "VIP"],
      widths: [135, 95, 78, 70, 70, 75],
      rows: report.operators.map((row) => [
        row.operator_name,
        `${currency(row.net_sales)} | ant. ${currency(row.previous.net_sales)}`,
        percent(row.participation),
        `${row.coupons || 0} | ant. ${row.previous.coupons || 0}`,
        `${row.cancelled_coupons || 0} | ${percent(row.cancellation_rate)}`,
        row.vip || 0,
      ]),
    },
  };
  const byType = {
    store: [store],
    delivery: [delivery],
    quotations: [quotations],
    sectors: [sectorTable],
    losses: [losses],
    consumption: [losses],
    productivity: [productivity],
    operators: [operators],
    all: [store, delivery, quotations, sectorTable, operators],
  };
  return structuredPdf({
    title: "Indicadores Gerenciais",
    subtitle: `Periodo ${report.period} comparado com ${report.comparePeriod}`,
    meta: [`Gerado em ${new Date().toLocaleString("pt-BR")}`, sectorFilter ? `Setor ${sectorFilter}` : "Todos os setores", `Relatorio ${reportType}`],
    sections: byType[reportType] || byType.all,
    landscape: true,
    compact: true,
  });
}

async function api(req, res, url) {
  const method = req.method;

  if (method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    const attemptKey = loginAttemptKey(req, body.username);
    if (isLoginLocked(attemptKey)) {
      return send(res, 429, { error: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente." });
    }
    const users = await query(
      "SELECT id, username, password, role, display_name, collaborator_id, status FROM users WHERE username = ? AND status = 'ativo'",
      [body.username]
    );
    if (!users[0] || !verifyPassword(body.password, users[0].password)) {
      recordLoginFailure(attemptKey);
      return send(res, 401, { error: "Usu\u00e1rio ou senha inv\u00e1lidos." });
    }
    if (!loginAreaMatches(body.accessArea, users[0].role)) {
      recordLoginFailure(attemptKey);
      return send(res, 403, { error: "Este usuário não pertence à área de acesso selecionada." });
    }
    if (!isPasswordHash(users[0].password)) {
      await execute("UPDATE users SET password = ? WHERE id = ?", [hashPassword(body.password), users[0].id]);
    }
    clearLoginFailures(attemptKey);
    const safeUser = publicUser(users[0]);
    const token = makeToken(safeUser);
    await logAudit(safeUser, "login", "users", safeUser.id);
    return send(res, 200, { token, user: safeUser, expiresAt: Date.now() + SESSION_TTL_MS });
  }

  if (method === "GET" && url.pathname === "/api/public/agenda") {
    const type = normalizeAgendaType(url.searchParams.get("type"));
    if (type === "recebimento") return send(res, 200, { rows: [], closed: true });
    const rows = await query(
      `SELECT id, agenda_type, date, start_time, end_time
       FROM agenda_slots
       WHERE agenda_type = ? AND status = 'Disponivel' AND date >= ?
       ORDER BY date, start_time`,
      [type, today()]
    );
    return send(res, 200, { rows });
  }

  if (method === "POST" && url.pathname === "/api/public/agenda/book") {
    const body = await readBody(req);
    const id = Number(body.slotId || 0);
    const name = String(body.name || "").trim();
    const company = String(body.company || "").trim();
    const phone = String(body.phone || "").trim();
    if (!id || !name || !company || !phone) {
      return send(res, 400, { error: "Preencha nome, empresa e telefone." });
    }
    const available = await query("SELECT id FROM agenda_slots WHERE id = ? AND agenda_type = 'comercial' AND status = 'Disponivel'", [id]);
    if (!available[0]) return send(res, 409, { error: "Este horário não está mais disponível." });
    await execute(
      `UPDATE agenda_slots
       SET status = 'Agendado', booked_name = ?, booked_company = ?, booked_phone = ?, booked_document = ?,
           booked_observation = ?, booked_at = ?, updated_at = ?
       WHERE id = ? AND status = 'Disponivel'`,
      [name, company, phone, body.document || "", body.observation || "", nowIso(), nowIso(), id]
    );
    return send(res, 200, { ok: true });
  }

  const user = requireUser(req, res);
  if (!user) return;

  if (method === "POST" && url.pathname === "/api/session/refresh") {
    return send(res, 200, {
      token: makeToken(user),
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
  }

  if (method === "GET" && url.pathname === "/api/me") {
    return send(res, 200, { user, activities, sectors: repoSectors });
  }

  if (method === "GET" && url.pathname === "/api/management-indicators") {
    if (!canAccessManagementIndicators(user)) return send(res, 403, { error: "Acesso restrito aos indicadores administrativos." });
    const period = url.searchParams.get("period") || today().slice(0, 7);
    const comparePeriod = url.searchParams.get("comparePeriod") || previousPeriod(period);
    return send(res, 200, await managementReportData(period, comparePeriod));
  }

  if (method === "POST" && url.pathname === "/api/management-indicators/monthly") {
    if (!canAccessManagementIndicators(user)) return send(res, 403, { error: "Acesso restrito aos indicadores administrativos." });
    const body = await readBody(req);
    const period = String(body.period || "").trim();
    if (!/^\d{4}-\d{2}$/.test(period)) return send(res, 400, { error: "Informe um mês válido." });
    const fieldMap = [
      ["soldQuantity", "sold_quantity"], ["grossSales", "gross_sales"], ["cancelledSales", "cancelled_sales"], ["discounts", "discounts"],
      ["netSales", "net_sales"], ["coupons", "coupons"], ["averageTicket", "average_ticket"],
      ["cancelledCoupons", "cancelled_coupons"], ["greenCoupons", "green_coupons"],
      ["identifiedGreenCoupons", "identified_green_coupons"], ["deliveryNetSales", "delivery_net_sales"],
      ["deliveryCancelledSales", "delivery_cancelled_sales"], ["deliveryDiscounts", "delivery_discounts"],
      ["deliveryCoupons", "delivery_coupons"], ["deliveryCancelledCoupons", "delivery_cancelled_coupons"],
      ["deliveryOtherCheckouts", "delivery_other_checkouts"], ["deliveryGoalNormal", "delivery_goal_normal"],
      ["deliveryGoalPlus", "delivery_goal_plus"], ["quotationCost", "quotation_cost"],
      ["quotationSales", "quotation_sales"],
    ];
    const current = (await query("SELECT * FROM management_monthly WHERE period = ?", [period]))[0] || {};
    const integerFields = new Set(["coupons", "cancelledCoupons", "greenCoupons", "identifiedGreenCoupons", "deliveryCoupons", "deliveryCancelledCoupons"]);
    const values = fieldMap.map(([bodyField, databaseField]) => {
      const value = Object.prototype.hasOwnProperty.call(body, bodyField) ? body[bodyField] : current[databaseField];
      return integerFields.has(bodyField) ? intValue(value) : numberValue(value);
    });
    await execute(
      `INSERT INTO management_monthly (
        period, sold_quantity, gross_sales, cancelled_sales, discounts, net_sales, coupons, average_ticket,
        cancelled_coupons, green_coupons, identified_green_coupons, delivery_net_sales,
        delivery_cancelled_sales, delivery_discounts, delivery_coupons, delivery_cancelled_coupons,
        delivery_other_checkouts, delivery_goal_normal, delivery_goal_plus, quotation_cost,
        quotation_sales, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(period) DO UPDATE SET
        sold_quantity=excluded.sold_quantity, gross_sales=excluded.gross_sales, cancelled_sales=excluded.cancelled_sales,
        discounts=excluded.discounts, net_sales=excluded.net_sales, coupons=excluded.coupons,
        average_ticket=excluded.average_ticket, cancelled_coupons=excluded.cancelled_coupons,
        green_coupons=excluded.green_coupons, identified_green_coupons=excluded.identified_green_coupons,
        delivery_net_sales=excluded.delivery_net_sales, delivery_cancelled_sales=excluded.delivery_cancelled_sales,
        delivery_discounts=excluded.delivery_discounts, delivery_coupons=excluded.delivery_coupons,
        delivery_cancelled_coupons=excluded.delivery_cancelled_coupons,
        delivery_other_checkouts=excluded.delivery_other_checkouts,
        delivery_goal_normal=excluded.delivery_goal_normal, delivery_goal_plus=excluded.delivery_goal_plus,
        quotation_cost=excluded.quotation_cost, quotation_sales=excluded.quotation_sales,
        updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
      [period, ...values, user.id, nowIso()]
    );
    await logAudit(user, "upsert", "management_monthly", period);
    return send(res, 200, { ok: true });
  }

  if (method === "DELETE" && url.pathname === "/api/management-indicators/monthly") {
    if (!canAccessManagementIndicators(user)) return send(res, 403, { error: "Acesso restrito aos indicadores administrativos." });
    const period = String(url.searchParams.get("period") || "").trim();
    const type = String(url.searchParams.get("type") || "").trim();
    if (!/^\d{4}-\d{2}$/.test(period)) return send(res, 400, { error: "Informe um mês válido." });
    const fieldsByType = {
      store: [
        "sold_quantity", "gross_sales", "cancelled_sales", "discounts", "net_sales", "coupons",
        "average_ticket", "cancelled_coupons", "green_coupons", "identified_green_coupons",
      ],
      delivery: [
        "delivery_net_sales", "delivery_cancelled_sales", "delivery_discounts",
        "delivery_coupons", "delivery_cancelled_coupons", "delivery_other_checkouts",
        "delivery_goal_normal", "delivery_goal_plus",
      ],
      quotations: ["quotation_cost", "quotation_sales"],
    };
    const fields = fieldsByType[type];
    if (!fields) return send(res, 400, { error: "Tipo de lançamento inválido." });
    await execute(
      `UPDATE management_monthly SET ${fields.map((field) => `${field} = 0`).join(", ")}, updated_by = ?, updated_at = ? WHERE period = ?`,
      [user.id, nowIso(), period]
    );
    await logAudit(user, "delete", `management_monthly_${type}`, period);
    return send(res, 200, { ok: true });
  }

  if (method === "POST" && url.pathname === "/api/management-indicators/sector") {
    if (!canAccessManagementIndicators(user)) return send(res, 403, { error: "Acesso restrito aos indicadores administrativos." });
    const body = await readBody(req);
    const period = String(body.period || "").trim();
    const sector = String(body.sector || "").trim();
    if (!/^\d{4}-\d{2}$/.test(period) || !sector) return send(res, 400, { error: "Informe mês e setor." });
    const current = (await query("SELECT * FROM management_sectors WHERE period = ? AND sector = ?", [period, sector]))[0] || {};
    const merged = {
      sales: Object.prototype.hasOwnProperty.call(body, "sales") ? numberValue(body.sales) : numberValue(current.sales),
      losses: Object.prototype.hasOwnProperty.call(body, "losses") ? numberValue(body.losses) : numberValue(current.losses),
      consumption: Object.prototype.hasOwnProperty.call(body, "consumption") ? numberValue(body.consumption) : numberValue(current.consumption),
      employeeCount: Object.prototype.hasOwnProperty.call(body, "employeeCount") ? intValue(body.employeeCount) : intValue(current.employee_count),
      productivityTarget: Object.prototype.hasOwnProperty.call(body, "productivityTarget") ? numberValue(body.productivityTarget) : numberValue(current.productivity_target),
      inventories: Object.prototype.hasOwnProperty.call(body, "inventories") ? intValue(body.inventories) : intValue(current.inventories),
    };
    await execute(
      `INSERT INTO management_sectors (
        period, sector, sales, losses, consumption, employee_count, productivity_target, inventories, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(period, sector) DO UPDATE SET
        sales=excluded.sales, losses=excluded.losses, consumption=excluded.consumption,
        employee_count=excluded.employee_count, productivity_target=excluded.productivity_target,
        inventories=excluded.inventories, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
      [
        period, sector, merged.sales, merged.losses, merged.consumption,
        merged.employeeCount, merged.productivityTarget, merged.inventories,
        user.id, nowIso(),
      ]
    );
    await logAudit(user, "upsert", "management_sectors", `${period}|${sector}`);
    return send(res, 200, { ok: true });
  }

  if (method === "DELETE" && url.pathname === "/api/management-indicators/sector") {
    if (!canAccessManagementIndicators(user)) return send(res, 403, { error: "Acesso restrito aos indicadores administrativos." });
    const period = String(url.searchParams.get("period") || "").trim();
    const sector = String(url.searchParams.get("sector") || "").trim();
    const type = String(url.searchParams.get("type") || "").trim();
    if (!/^\d{4}-\d{2}$/.test(period) || !sector) return send(res, 400, { error: "Informe mês e setor." });
    if (type === "losses") {
      await execute(
        "UPDATE management_sectors SET losses = 0, consumption = 0, updated_by = ?, updated_at = ? WHERE period = ? AND sector = ?",
        [user.id, nowIso(), period, sector]
      );
    } else if (type === "productivity") {
      await execute(
        "UPDATE management_sectors SET sales = 0, employee_count = 0, productivity_target = 0, inventories = 0, updated_by = ?, updated_at = ? WHERE period = ? AND sector = ?",
        [user.id, nowIso(), period, sector]
      );
    } else {
      return send(res, 400, { error: "Tipo de lançamento inválido." });
    }
    await logAudit(user, "delete", `management_sector_${type}`, `${period}|${sector}`);
    return send(res, 200, { ok: true });
  }

  if (method === "POST" && url.pathname === "/api/management-indicators/operator") {
    if (!canAccessManagementIndicators(user)) return send(res, 403, { error: "Acesso restrito aos indicadores administrativos." });
    const body = await readBody(req);
    const period = String(body.period || "").trim();
    const operatorName = String(body.operatorName || "").trim();
    if (!/^\d{4}-\d{2}$/.test(period) || !operatorName) return send(res, 400, { error: "Informe mês e operador." });
    await execute(
      `INSERT INTO management_operators (
        period, operator_name, net_sales, coupons, cancelled_coupons, vip, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(period, operator_name) DO UPDATE SET
        net_sales=excluded.net_sales, coupons=excluded.coupons,
        cancelled_coupons=excluded.cancelled_coupons, vip=excluded.vip,
        updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
      [
        period, operatorName, numberValue(body.netSales), intValue(body.coupons),
        intValue(body.cancelledCoupons), intValue(body.vip), user.id, nowIso(),
      ]
    );
    await logAudit(user, "upsert", "management_operators", `${period}|${operatorName}`);
    return send(res, 200, { ok: true });
  }

  if (method === "DELETE" && url.pathname === "/api/management-indicators/operator") {
    if (!canAccessManagementIndicators(user)) return send(res, 403, { error: "Acesso restrito aos indicadores administrativos." });
    const period = String(url.searchParams.get("period") || "").trim();
    const operatorName = String(url.searchParams.get("operatorName") || "").trim();
    if (!/^\d{4}-\d{2}$/.test(period) || !operatorName) return send(res, 400, { error: "Informe mês e operador." });
    await execute("DELETE FROM management_operators WHERE period = ? AND operator_name = ?", [period, operatorName]);
    await logAudit(user, "delete", "management_operators", `${period}|${operatorName}`);
    return send(res, 200, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/management-indicators/pdf") {
    if (!canAccessManagementIndicators(user)) return send(res, 403, { error: "Acesso restrito aos indicadores administrativos." });
    const period = url.searchParams.get("period") || today().slice(0, 7);
    const comparePeriod = url.searchParams.get("comparePeriod") || previousPeriod(period);
    const sectorFilter = url.searchParams.get("sector") || "";
    const reportType = url.searchParams.get("type") || "all";
    const report = await managementReportData(period, comparePeriod);
    return send(res, 200, managementPdf(report, reportType, sectorFilter), {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename=indicadores-${reportType}-${period}.pdf`,
    });
  }

  if (method === "GET" && url.pathname === "/api/reposition/options") {
    if (!canAccessReposition(user)) return send(res, 403, { error: "Acesso restrito ao módulo de reposição." });
    const repoUsers = await query(
      "SELECT id, display_name, collaborator_id FROM users WHERE role = 'reposicao' AND status = 'ativo' ORDER BY display_name"
    );
    const commercialUsers = await query(
      "SELECT id, display_name, collaborator_id FROM users WHERE role = 'comercial' AND status = 'ativo' ORDER BY display_name"
    );
    return send(res, 200, {
      sectors: repoSectors,
      activities: repoActivities,
      repoCollaboratorIds: repoUsers.map((row) => row.collaborator_id).filter(Boolean),
      commercialCollaboratorIds: commercialUsers.map((row) => row.collaborator_id).filter(Boolean),
      repoUsers,
      commercialUsers,
    });
  }

  if (method === "GET" && url.pathname === "/api/agenda") {
    const type = normalizeAgendaType(url.searchParams.get("type"));
    if (!canAccessAgenda(user, type)) return send(res, 403, { error: "Acesso restrito à agenda." });
    const start = url.searchParams.get("startDate") || today();
    const end = url.searchParams.get("endDate") || start;
    const rows = await query(
      `SELECT *
       FROM agenda_slots
       WHERE agenda_type = ? AND date BETWEEN ? AND ?
       ORDER BY date, start_time`,
      [type, start, end]
    );
    return send(res, 200, { rows });
  }

  if (method === "POST" && url.pathname === "/api/agenda") {
    const body = await readBody(req);
    const type = normalizeAgendaType(body.type);
    if (!canAccessAgenda(user, type)) return send(res, 403, { error: "Acesso restrito à agenda." });
    const date = body.date || today();
    const startTime = String(body.startTime || "").trim();
    const endTime = String(body.endTime || body.startTime || "").trim();
    if (!date || !startTime || !endTime) return send(res, 400, { error: type === "recebimento" ? "Informe data e horário." : "Informe data, início e fim." });
    const isManualCommercial = type === "comercial" && body.bookingMode === "manual";
    const status = type === "recebimento" || isManualCommercial ? "Agendado" : "Disponivel";
    if (isManualCommercial && (!String(body.name || "").trim() || !String(body.company || "").trim() || !String(body.phone || "").trim())) {
      return send(res, 400, { error: "Informe vendedor, empresa e telefone para o agendamento manual." });
    }
    try {
      await execute(
        `INSERT INTO agenda_slots (
          agenda_type, date, start_time, end_time, status, booked_name, booked_company, booked_phone,
          booked_document, booked_observation, booked_at, created_by, updated_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          type,
          date,
          startTime,
          endTime,
          status,
          body.name || "",
          body.company || "",
          body.phone || "",
          body.document || "",
          body.observation || "",
          status === "Agendado" ? nowIso() : null,
          user.id,
          nowIso(),
        ]
      );
    } catch (error) {
      return send(res, 409, { error: "Já existe horário cadastrado para essa agenda, data e início." });
    }
    await logAudit(user, "create", "agenda_slots", `${type}|${date}|${startTime}`, { endTime });
    return send(res, 201, { ok: true });
  }

  if (method === "PUT" && url.pathname.startsWith("/api/agenda/")) {
    const id = Number(url.pathname.split("/").pop());
    const body = await readBody(req);
    const rows = await query("SELECT agenda_type FROM agenda_slots WHERE id = ?", [id]);
    if (!rows[0]) return send(res, 404, { error: "Horário não encontrado." });
    const type = normalizeAgendaType(rows[0].agenda_type);
    if (!canAccessAgenda(user, type)) return send(res, 403, { error: "Acesso restrito à agenda." });
    const allowed = ["Disponivel", "Agendado", "Recebido", "Atendido", "Cancelado", "Atrasado"];
    const status = allowed.includes(body.status) ? body.status : "Disponivel";
    await execute("UPDATE agenda_slots SET status = ?, updated_at = ? WHERE id = ?", [status, nowIso(), id]);
    await logAudit(user, "update", "agenda_slots", id, { status });
    return send(res, 200, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/reposition/dashboard") {
    if (!canAccessReposition(user)) return send(res, 403, { error: "Acesso restrito ao módulo de reposição." });
    const start = url.searchParams.get("startDate") || today();
    const end = url.searchParams.get("endDate") || start;
    const commercialFilter = await commercialSectorFilter(user);
    const period = periodInfo(start, end);
    const repoScopeSectors = user.role === "reposicao" ? await sectorsForUser(user) : repoSectors;
    const repoScopeClause = user.role === "reposicao"
      ? (repoScopeSectors.length ? ` AND sector IN (${repoScopeSectors.map(() => "?").join(", ")})` : " AND 1 = 0")
      : "";
    const repoScopeParams = user.role === "reposicao" ? repoScopeSectors : [];
    const taskRows = await query("SELECT status, COUNT(*) AS total FROM repo_tasks WHERE date BETWEEN ? AND ? GROUP BY status", [start, end]);
    const completedTaskRows = await query(
      `SELECT COUNT(DISTINCT date || '|' || activity) AS total
       FROM repo_tasks
       WHERE date BETWEEN ? AND ? AND status = 'Realizado'${repoScopeClause}`,
      [start, end, ...repoScopeParams]
    );
    const ruptureRows = await query(`SELECT status, commercial_status, COUNT(*) AS total FROM repo_ruptures WHERE date BETWEEN ? AND ?${commercialFilter.clause} GROUP BY status, commercial_status`, [start, end, ...commercialFilter.params]);
    const expirationRows = await query(`SELECT status, commercial_status, COUNT(*) AS total FROM repo_expirations WHERE date BETWEEN ? AND ?${commercialFilter.clause} GROUP BY status, commercial_status`, [start, end, ...commercialFilter.params]);
    const damageRows = await query("SELECT COUNT(*) AS total FROM repo_damages WHERE date BETWEEN ? AND ?", [start, end]);
    const bySector = await query(
      `
      SELECT sector,
        SUM(tasks) AS tasks,
        SUM(ruptures) AS ruptures,
        SUM(expirations) AS expirations,
        SUM(damages) AS damages
      FROM (
        SELECT sector, COUNT(*) AS tasks, 0 AS ruptures, 0 AS expirations, 0 AS damages FROM repo_tasks WHERE date BETWEEN ? AND ? GROUP BY sector
        UNION ALL
        SELECT sector, 0, COUNT(*), 0, 0 FROM repo_ruptures WHERE date BETWEEN ? AND ? GROUP BY sector
        UNION ALL
        SELECT sector, 0, 0, COUNT(*), 0 FROM repo_expirations WHERE date BETWEEN ? AND ? GROUP BY sector
        UNION ALL
        SELECT sector, 0, 0, 0, COUNT(*) FROM repo_damages WHERE date BETWEEN ? AND ? GROUP BY sector
      ) x
      GROUP BY sector
      ORDER BY sector
      `,
      [start, end, start, end, start, end, start, end]
    );
    const goalRows = await query(
      "SELECT sector, target_daily, status FROM repo_goals WHERE goal_type = 'checklist' AND status = 'ativo' ORDER BY sector"
    );
    const tasksBySector = new Map((bySector || []).map((row) => [row.sector, Number(row.tasks || 0)]));
    const goalProgress = goalRows.map((row) => {
      const targetDaily = Number(row.target_daily || 0);
      const target = targetDaily * period.days;
      const done = tasksBySector.get(row.sector) || 0;
      return {
        sector: row.sector,
        targetDaily,
        target,
        done,
        pending: Math.max(target - done, 0),
        percent: target ? Math.min(100, Math.round((done / target) * 100)) : 0,
        status: row.status,
      };
    });
    const submittedTaskTotal = taskRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const expectedTaskTotal = Math.max(0, repoActivities.length * period.days);
    const completed = Math.min(Number(completedTaskRows[0]?.total || 0), expectedTaskTotal || Number(completedTaskRows[0]?.total || 0));
    const ruptures = ruptureRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const expirations = expirationRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const repoUserCounts = await query(
      `
      SELECT u.id, u.display_name AS name, COUNT(t.id) AS total
      FROM users u
      LEFT JOIN repo_tasks t ON t.created_by = u.id AND t.date BETWEEN ? AND ?
      WHERE u.role = 'reposicao' AND u.status = 'ativo'
      GROUP BY u.id, u.display_name
      ORDER BY u.display_name
      `,
      [start, end]
    );
    const repoActivityCounts = await query(
      `
      SELECT activity, COUNT(DISTINCT date) AS total
      FROM repo_tasks
      WHERE date BETWEEN ? AND ? AND status = 'Realizado'${repoScopeClause}
      GROUP BY activity
      `,
      [start, end, ...repoScopeParams]
    );
    const repoActivityMap = new Map(repoActivityCounts.map((row) => [row.activity, Number(row.total || 0)]));
    const commercialUserCounts = await query(
      `
      SELECT u.id, u.display_name AS name, COUNT(x.id) AS total
      FROM users u
      LEFT JOIN (
        SELECT id, commercial_updated_by, date FROM repo_ruptures WHERE commercial_updated_by IS NOT NULL
        UNION ALL
        SELECT id, commercial_updated_by, date FROM repo_expirations WHERE commercial_updated_by IS NOT NULL
      ) x ON x.commercial_updated_by = u.id AND x.date BETWEEN ? AND ?
      WHERE u.role = 'comercial' AND u.status = 'ativo' ${user.role === "comercial" ? "AND u.id = ?" : ""}
      GROUP BY u.id, u.display_name
      ORDER BY u.display_name
      `,
      user.role === "comercial" ? [start, end, user.id] : [start, end]
    );
    const repoTotalByUsers = repoUserCounts.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const commercialTotalByUsers = commercialUserCounts.reduce((sum, row) => sum + Number(row.total || 0), 0);
    return send(res, 200, {
      summary: {
        taskTotal: expectedTaskTotal,
        submittedTasks: submittedTaskTotal,
        completed,
        pending: Math.max(expectedTaskTotal - completed, 0),
        ruptures,
        rupturesPurchased: ruptureRows.filter((row) => row.commercial_status === "Pedido realizado").reduce((sum, row) => sum + Number(row.total || 0), 0),
        expirations,
        expirationsActioned: expirationRows.filter((row) => ["AÃ§Ã£o ou rebaixa realizada", "Acao ou rebaixa realizada"].includes(row.commercial_status)).reduce((sum, row) => sum + Number(row.total || 0), 0),
        damages: Number(damageRows[0]?.total || 0),
      },
      bySector,
      repoGoalProgress: goalProgress,
      repoUserEngagement: repoUserCounts.map((row) => ({
        id: row.id,
        name: row.name,
        total: Number(row.total || 0),
        percent: repoTotalByUsers ? Math.round((Number(row.total || 0) / repoTotalByUsers) * 100) : 0,
      })),
      repoActivityCompletion: repoActivities.map((activity) => {
        const total = repoActivityMap.get(activity) || 0;
        return {
          activity,
          total,
          expected: period.days,
          percent: period.days ? Math.min(100, Math.round((total / period.days) * 100)) : 0,
        };
      }),
      commercialUserEngagement: commercialUserCounts.map((row) => ({
        id: row.id,
        name: row.name,
        total: Number(row.total || 0),
        percent: commercialTotalByUsers ? Math.round((Number(row.total || 0) / commercialTotalByUsers) * 100) : 0,
      })),
    });
  }

  if (method === "GET" && url.pathname === "/api/reposition/goals") {
    if (!canViewRepoGoals(user)) return send(res, 403, { error: "Acesso restrito às metas da reposição." });
    return send(res, 200, {
      rows: await query("SELECT * FROM repo_goals WHERE goal_type = 'checklist' ORDER BY sector"),
    });
  }

  if (method === "POST" && url.pathname === "/api/reposition/goals") {
    if (!canManageRepoGoals(user)) return send(res, 403, { error: "Apenas administrador ou encarregada pode salvar metas." });
    const body = await readBody(req);
    const sector = String(body.sector || "").trim();
    const targetDaily = Math.max(0, Number.parseInt(body.targetDaily, 10) || 0);
    const status = body.status === "inativo" ? "inativo" : "ativo";
    if (!repoSectors.includes(sector)) return send(res, 400, { error: "Selecione um setor válido." });
    await execute(
      `
      INSERT INTO repo_goals (sector, goal_type, target_daily, status, updated_by, updated_at)
      VALUES (?, 'checklist', ?, ?, ?, ?)
      ON CONFLICT(sector, goal_type) DO UPDATE SET
        target_daily=excluded.target_daily,
        status=excluded.status,
        updated_by=excluded.updated_by,
        updated_at=excluded.updated_at
      `,
      [sector, targetDaily, status, user.id, nowIso()]
    );
    await logAudit(user, "upsert", "repo_goals", sector, { targetDaily, status });
    return send(res, 200, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/sector-audits") {
    if (!canAccessSectorAudit(user)) return send(res, 403, { error: "Acesso restrito à conferência gerencial." });
    const start = url.searchParams.get("startDate") || today();
    const end = url.searchParams.get("endDate") || start;
    const focus = url.searchParams.get("focus") || "abastecimento";
    const sector = url.searchParams.get("sector") || "";
    const rows = await sectorAuditDashboard(start, end, focus, sector);
    const sectorClause = sector ? " AND sector = ?" : "";
    const sectorParams = sector ? [sector] : [];
    const totalRows = await query(
      `SELECT COUNT(*) AS total FROM sector_audit_reviews WHERE date BETWEEN ? AND ? AND focus = ?${sectorClause}`,
      [start, end, focus, ...sectorParams]
    );
    const userRows = await query(
      `SELECT COUNT(*) AS total FROM sector_audit_reviews WHERE date BETWEEN ? AND ? AND focus = ? AND audited_by = ?${sectorClause}`,
      [start, end, focus, user.id, ...sectorParams]
    );
    return send(res, 200, {
      rows,
      summary: {
        evaluatedTotal: Number(totalRows[0]?.total || 0),
        evaluatedByUser: Number(userRows[0]?.total || 0),
      },
    });
  }

  if (method === "POST" && url.pathname === "/api/sector-audits") {
    if (!canAccessSectorAudit(user)) return send(res, 403, { error: "Acesso restrito à conferência gerencial." });
    const body = await readBody(req);
    const managerStatus = ["Pendente", "Confere", "N\u00e3o confere", "Corrigir"].includes(body.managerStatus) ? body.managerStatus : "Pendente";
    const focus = body.focus || "abastecimento";
    await execute(
      `
      INSERT INTO sector_audit_reviews (
        date, sector, focus, manager_status, observation, action_required, responsible, due_date, audited_by, audited_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, sector, focus) DO UPDATE SET
        manager_status=excluded.manager_status,
        observation=excluded.observation,
        action_required=excluded.action_required,
        responsible=excluded.responsible,
        due_date=excluded.due_date,
        audited_by=excluded.audited_by,
        audited_at=excluded.audited_at
      `,
      [
        body.date || today(),
        body.sector,
        focus,
        managerStatus,
        body.observation || "",
        body.actionRequired || "",
        body.responsible || "",
        body.dueDate || "",
        user.id,
        nowIso(),
      ]
    );
    await logAudit(user, "upsert", "sector_audit_reviews", `${body.date || today()}|${body.sector}|${focus}`, { managerStatus });
    return send(res, 200, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/reposition/tasks") {
    if (!canAccessReposition(user)) return send(res, 403, { error: "Acesso restrito ao módulo de reposição." });
    const start = url.searchParams.get("startDate") || today();
    const end = url.searchParams.get("endDate") || start;
    const repoFilter = await repositionSectorFilter(user, "t.sector");
    return send(res, 200, {
      rows: await query(
        `
        SELECT t.*, c.name AS collaborator
        FROM repo_tasks t JOIN collaborators c ON c.id = t.collaborator_id
        WHERE t.date BETWEEN ? AND ?${repoFilter.clause}
        ORDER BY t.date DESC, t.id DESC
        `,
        [start, end, ...repoFilter.params]
      ),
    });
  }

  if (method === "POST" && url.pathname === "/api/reposition/tasks") {
    if (!canAccessReposition(user)) return send(res, 403, { error: "Acesso restrito ao módulo de reposição." });
    const body = await readBody(req);
    const collaboratorId = user.collaborator_id || body.collaboratorId;
    if (!collaboratorId) return send(res, 400, { error: "Selecione um colaborador." });
    const sectorError = await validateRepoSectorForUser(user, body.sector);
    if (sectorError) return send(res, 403, { error: sectorError });
    const status = body.answer === "NÃ£o" || body.answer === "Nao" ? "Pendente" : "Realizado";
    await execute(
      "INSERT INTO repo_tasks (date, collaborator_id, sector, activity, status, observation, sent_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [body.date || today(), collaboratorId, body.sector, body.activity, status, body.observation || "", nowIso(), user.id]
    );
    const activityText = normalizeText(body.activity || "");
    const taskDate = body.date || today();
    if (activityText.includes("ruptura") && body.product) {
      await execute(
        "INSERT INTO repo_ruptures (date, product, sector, type, quantity, observation, sent_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [taskDate, body.product, body.sector, body.type || "Ruptura", body.quantity || "", body.observation || "", nowIso(), user.id]
      );
    }
    if (activityText.includes("validade") && body.product) {
      await execute(
        "INSERT INTO repo_expirations (date, product, sector, expiration_date, quantity, observation, sent_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [taskDate, body.product, body.sector, body.expirationDate || taskDate, body.quantity || "", body.observation || "", nowIso(), user.id]
      );
    }
    return send(res, 201, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/reposition/ruptures") {
    if (!canAccessReposition(user)) return send(res, 403, { error: "Acesso restrito ao módulo de reposição." });
    const filter = await commercialSectorFilter(user);
    const repoFilter = await repositionSectorFilter(user);
    const start = url.searchParams.get("startDate");
    const end = url.searchParams.get("endDate") || start;
    const dateClause = start ? " AND date BETWEEN ? AND ?" : "";
    const dateParams = start ? [start, end] : [];
    return send(res, 200, { rows: await query(`SELECT * FROM repo_ruptures WHERE 1 = 1${filter.clause}${repoFilter.clause}${dateClause} ORDER BY date DESC, id DESC`, [...filter.params, ...repoFilter.params, ...dateParams]) });
  }

  if (method === "POST" && url.pathname === "/api/reposition/ruptures") {
    if (!canAccessReposition(user)) return send(res, 403, { error: "Acesso restrito ao módulo de reposição." });
    const body = await readBody(req);
    const sectorError = await validateRepoSectorForUser(user, body.sector);
    if (sectorError) return send(res, 403, { error: sectorError });
    await execute(
      "INSERT INTO repo_ruptures (date, product, sector, type, quantity, observation, sent_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [body.date || today(), body.product, body.sector, body.type || "Ruptura total", body.quantity || "", body.observation || "", nowIso(), user.id]
    );
    return send(res, 201, { ok: true });
  }

  if (method === "PUT" && url.pathname.startsWith("/api/reposition/ruptures/")) {
    if (!canAccessReposition(user)) return send(res, 403, { error: "Acesso restrito ao módulo de reposição." });
    if (!canUpdateRepoCommercial(user)) return send(res, 403, { error: "Apenas liderança ou comercial pode atualizar o retorno." });
    const id = Number(url.pathname.split("/").pop());
    const body = await readBody(req);
    const sectorError = await validateCommercialRecordSector(user, "repo_ruptures", id);
    if (sectorError) return send(res, 403, { error: sectorError });
    const commercialStatus = ["Pedido realizado", "Pedido nÃ£o realizado", "Pedido nao realizado"].includes(body.commercialStatus) ? body.commercialStatus : "Pendente";
    await execute(
      "UPDATE repo_ruptures SET commercial_status = ?, commercial_observation = ?, commercial_updated_by = ?, status = ?, updated_at = ? WHERE id = ?",
      [commercialStatus, body.commercialObservation || "", user.id, commercialStatus === "Pendente" ? "Aberto" : "Resolvido", nowIso(), id]
    );
    return send(res, 200, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/reposition/expirations") {
    if (!canAccessReposition(user)) return send(res, 403, { error: "Acesso restrito ao módulo de reposição." });
    const filter = await commercialSectorFilter(user);
    const repoFilter = await repositionSectorFilter(user);
    const start = url.searchParams.get("startDate");
    const end = url.searchParams.get("endDate") || start;
    const dateClause = start ? " AND date BETWEEN ? AND ?" : "";
    const dateParams = start ? [start, end] : [];
    return send(res, 200, { rows: await query(`SELECT * FROM repo_expirations WHERE 1 = 1${filter.clause}${repoFilter.clause}${dateClause} ORDER BY date DESC, id DESC`, [...filter.params, ...repoFilter.params, ...dateParams]) });
  }

  if (method === "POST" && url.pathname === "/api/reposition/expirations") {
    if (!canAccessReposition(user)) return send(res, 403, { error: "Acesso restrito ao módulo de reposição." });
    const body = await readBody(req);
    const sectorError = await validateRepoSectorForUser(user, body.sector);
    if (sectorError) return send(res, 403, { error: sectorError });
    await execute(
      "INSERT INTO repo_expirations (date, product, sector, expiration_date, quantity, observation, sent_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [body.date || today(), body.product, body.sector, body.expirationDate, body.quantity || "", body.observation || "", nowIso(), user.id]
    );
    return send(res, 201, { ok: true });
  }

  if (method === "PUT" && url.pathname.startsWith("/api/reposition/expirations/")) {
    if (!canAccessReposition(user)) return send(res, 403, { error: "Acesso restrito ao módulo de reposição." });
    if (!canUpdateRepoCommercial(user)) return send(res, 403, { error: "Apenas liderança ou comercial pode atualizar o retorno." });
    const id = Number(url.pathname.split("/").pop());
    const body = await readBody(req);
    const sectorError = await validateCommercialRecordSector(user, "repo_expirations", id);
    if (sectorError) return send(res, 403, { error: sectorError });
    const commercialStatus = ["AÃ§Ã£o ou rebaixa realizada", "AÃ§Ã£o nÃ£o realizada", "Acao ou rebaixa realizada", "Acao nao realizada"].includes(body.commercialStatus) ? body.commercialStatus : "Pendente";
    await execute(
      "UPDATE repo_expirations SET commercial_status = ?, commercial_observation = ?, commercial_updated_by = ?, status = ?, updated_at = ? WHERE id = ?",
      [commercialStatus, body.commercialObservation || "", user.id, commercialStatus === "Pendente" ? "Aberto" : "Resolvido", nowIso(), id]
    );
    return send(res, 200, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/reposition/damages") {
    if (!canAccessReposition(user)) return send(res, 403, { error: "Acesso restrito ao módulo de reposição." });
    const start = url.searchParams.get("startDate");
    const end = url.searchParams.get("endDate") || start;
    const dateClause = start ? "WHERE date BETWEEN ? AND ?" : "";
    const dateParams = start ? [start, end] : [];
    return send(res, 200, { rows: await query(`SELECT * FROM repo_damages ${dateClause} ORDER BY date DESC, id DESC`, dateParams) });
  }

  if (method === "POST" && url.pathname === "/api/reposition/damages") {
    if (!canAccessReposition(user)) return send(res, 403, { error: "Acesso restrito ao módulo de reposição." });
    const body = await readBody(req);
    const sectorError = await validateRepoSectorForUser(user, body.sector);
    if (sectorError) return send(res, 403, { error: sectorError });
    await execute(
      "INSERT INTO repo_damages (date, product, sector, quantity, reason, action, sent_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [body.date || today(), body.product, body.sector, body.quantity || "", body.reason || "", body.action || "", nowIso(), user.id]
    );
    return send(res, 201, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/users") {
    if (!isAdmin(user)) return send(res, 403, { error: "Apenas administrador pode gerenciar acessos." });
    return send(res, 200, {
      rows: await query(
        `
        SELECT u.id, u.username, u.role, u.display_name, u.collaborator_id, u.status,
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
    if (!body.password) return send(res, 400, { error: "Informe uma senha para criar o acesso." });
    await execute(
      "INSERT INTO users (username, password, role, display_name, collaborator_id, status) VALUES (?, ?, ?, ?, ?, ?)",
      [
        body.username,
        hashPassword(body.password),
        body.role || "colaborador",
        body.displayName,
        body.collaboratorId || null,
        body.status || "ativo",
      ]
    );
    await logAudit(user, "create", "users", body.username, { role: body.role, displayName: body.displayName });
    return send(res, 201, { ok: true });
  }

  if (method === "PUT" && url.pathname.startsWith("/api/users/")) {
    if (!isAdmin(user)) return send(res, 403, { error: "Apenas administrador pode gerenciar acessos." });
    const id = Number(url.pathname.split("/").pop());
    const body = await readBody(req);
    const passwordSql = body.password ? ", password = ?" : "";
    const params = [
      body.username,
      body.role,
      body.displayName,
      body.collaboratorId || null,
      body.status,
    ];
    if (body.password) params.push(hashPassword(body.password));
    params.push(id);
    await execute(
      `UPDATE users SET username = ?, role = ?, display_name = ?, collaborator_id = ?, status = ?${passwordSql} WHERE id = ?`,
      params
    );
    await logAudit(user, "update", "users", id, { username: body.username, role: body.role, status: body.status, passwordChanged: Boolean(body.password) });
    return send(res, 200, { ok: true });
  }

  if (method === "DELETE" && url.pathname.startsWith("/api/users/")) {
    if (!isAdmin(user)) return send(res, 403, { error: "Apenas administrador pode gerenciar acessos." });
    const id = Number(url.pathname.split("/").pop());
    if (id === user.id) return send(res, 400, { error: "VocÃª nÃ£o pode excluir o prÃ³prio acesso enquanto estÃ¡ logado." });
    await execute("DELETE FROM users WHERE id = ?", [id]);
    await logAudit(user, "delete", "users", id);
    return send(res, 200, { ok: true, message: "Acesso excluÃ­do." });
  }

  if (method === "GET" && url.pathname === "/api/collaborators") {
    const status = url.searchParams.get("status");
    const sql = status
      ? "SELECT * FROM collaborators WHERE status = ? ORDER BY name"
      : "SELECT * FROM collaborators ORDER BY status, name";
    return send(res, 200, { rows: await query(sql, status ? [status] : []) });
  }

  if (method === "POST" && url.pathname === "/api/collaborators") {
    if (!isAdmin(user)) return send(res, 403, { error: "Apenas administrador pode cadastrar colaboradores." });
    const body = await readBody(req);
    await execute("INSERT INTO collaborators (name, role, sector, status) VALUES (?, ?, ?, ?)", [
      body.name,
      body.role,
      body.sector || "",
      body.status || "ativo",
    ]);
    await logAudit(user, "create", "collaborators", body.name, { role: body.role, sector: body.sector || "", status: body.status || "ativo" });
    return send(res, 201, { ok: true });
  }

  if (method === "PUT" && url.pathname.startsWith("/api/collaborators/")) {
    if (!isAdmin(user)) return send(res, 403, { error: "Apenas administrador pode editar colaboradores." });
    const id = Number(url.pathname.split("/").pop());
    const body = await readBody(req);
    await execute("UPDATE collaborators SET name = ?, role = ?, sector = ?, status = ? WHERE id = ?", [
      body.name,
      body.role,
      body.sector || "",
      body.status,
      id,
    ]);
    await logAudit(user, "update", "collaborators", id, { name: body.name, role: body.role, sector: body.sector || "", status: body.status });
    return send(res, 200, { ok: true });
  }

  if (method === "DELETE" && url.pathname.startsWith("/api/collaborators/")) {
    if (!isAdmin(user)) return send(res, 403, { error: "Apenas administrador pode excluir colaboradores." });
    const id = Number(url.pathname.split("/").pop());
    const checklistCount = (await query("SELECT COUNT(*) AS total FROM checklists WHERE collaborator_id = ?", [id]))[0].total;
    const pendencyCount = (await query("SELECT COUNT(*) AS total FROM pendencies WHERE responsible_id = ?", [id]))[0].total;
    await execute("UPDATE users SET collaborator_id = NULL, status = 'inativo' WHERE collaborator_id = ?", [id]);
    if (checklistCount > 0 || pendencyCount > 0) {
      await execute("UPDATE collaborators SET status = 'inativo' WHERE id = ?", [id]);
      await logAudit(user, "inactivate", "collaborators", id);
      return send(res, 200, {
        ok: true,
        mode: "inactivated",
        message: "Colaborador possui registros vinculados e foi inativado para preservar o histÃ³rico.",
      });
    }
    await execute("DELETE FROM collaborators WHERE id = ?", [id]);
    await logAudit(user, "delete", "collaborators", id);
    return send(res, 200, { ok: true, mode: "deleted", message: "Colaborador excluÃ­do." });
  }

  if (method === "GET" && url.pathname === "/api/checklists") {
    if (!canAccessPrevention(user)) return send(res, 403, { error: "Acesso restrito ao módulo de prevenção." });
    return send(res, 200, { rows: await rowsForReports(Object.fromEntries(url.searchParams.entries())) });
  }

  if (method === "POST" && url.pathname === "/api/checklists") {
    if (!canAccessPrevention(user)) return send(res, 403, { error: "Acesso restrito ao módulo de prevenção." });
    const body = await readBody(req);
    const date = today();
    const collaboratorId = user.collaborator_id || body.collaboratorId;
    if (!collaboratorId) return send(res, 400, { error: "Selecione um colaborador." });
    const specificFields = checklistSpecificFields(body.activity, body);
    if (activityNeedsProductSector(body.activity) && !specificFields.sector) {
      return send(res, 400, { error: "Selecione o setor do produto." });
    }
    const photoPath = saveChecklistPhoto(body.activity, body);
    await execute(
      "INSERT INTO checklists (date, collaborator_id, activity, answer, observation, sector, price_divergence_products, expired_products, photo_path, sent_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        date,
        collaboratorId,
        body.activity,
        body.answer,
        body.observation || "",
        specificFields.sector,
        specificFields.priceDivergenceProducts,
        specificFields.expiredProducts,
        photoPath,
        nowIso(),
        user.id,
      ]
    );
    return send(res, 201, { ok: true });
  }

  if (method === "PUT" && url.pathname.startsWith("/api/checklists/")) {
    if (!canAccessPrevention(user)) return send(res, 403, { error: "Acesso restrito ao módulo de prevenção." });
    const id = Number(url.pathname.split("/").pop());
    const record = (await query("SELECT created_by FROM checklists WHERE id = ?", [id]))[0];
    if (!record) return send(res, 404, { error: "Preenchimento nÃ£o encontrado." });
    if (!canCorrect(user) && record.created_by !== user.id) {
      return send(res, 403, { error: "VocÃª sÃ³ pode corrigir preenchimentos enviados por vocÃª." });
    }
    const body = await readBody(req);
    const collaboratorId = canCorrect(user) ? body.collaboratorId : user.collaborator_id || body.collaboratorId;
    const specificFields = checklistSpecificFields(body.activity, body);
    if (activityNeedsProductSector(body.activity) && !specificFields.sector) {
      return send(res, 400, { error: "Selecione o setor do produto." });
    }
    const photoPath = saveChecklistPhoto(body.activity, body);
    await execute(
      "UPDATE checklists SET collaborator_id = ?, activity = ?, answer = ?, observation = ?, sector = ?, price_divergence_products = ?, expired_products = ?, photo_path = COALESCE(?, photo_path), corrected_by = ?, corrected_at = ? WHERE id = ?",
      [
        collaboratorId,
        body.activity,
        body.answer,
        body.observation || "",
        specificFields.sector,
        specificFields.priceDivergenceProducts,
        specificFields.expiredProducts,
        photoPath,
        user.id,
        nowIso(),
        id,
      ]
    );
    return send(res, 200, { ok: true });
  }

  if (method === "DELETE" && url.pathname.startsWith("/api/checklists/")) {
    if (!canAccessPrevention(user)) return send(res, 403, { error: "Acesso restrito ao módulo de prevenção." });
    if (!canDeleteRecords(user)) return send(res, 403, { error: "Apenas administrador pode excluir preenchimentos." });
    const id = Number(url.pathname.split("/").pop());
    await execute("DELETE FROM checklists WHERE id = ?", [id]);
    return send(res, 200, { ok: true, message: "Preenchimento excluÃ­do." });
  }

  if (method === "GET" && url.pathname === "/api/summaries") {
    if (!canAccessPrevention(user)) return send(res, 403, { error: "Acesso restrito ao módulo de prevenção." });
    if (!canCorrect(user)) {
      return send(res, 403, { error: "Apenas administrador ou encarregada podem visualizar resumos." });
    }
    const rows = await query(
      "SELECT * FROM operational_summaries ORDER BY date DESC LIMIT 60"
    );
    return send(res, 200, { rows });
  }

  if (method === "GET" && url.pathname === "/api/summary") {
    if (!canAccessPrevention(user)) return send(res, 403, { error: "Acesso restrito ao módulo de prevenção." });
    const date = url.searchParams.get("date") || today();
    const rows = await query("SELECT * FROM operational_summaries WHERE date = ?", [date]);
    return send(res, 200, { row: rows[0] || null });
  }

  if (method === "DELETE" && url.pathname === "/api/summary") {
    if (!canAccessPrevention(user)) return send(res, 403, { error: "Acesso restrito ao módulo de prevenção." });
    if (!canFillEncarregadaOnly(user)) {
      return send(res, 403, { error: "Apenas a encarregada pode excluir o resumo." });
    }
    const date = url.searchParams.get("date") || today();
    await execute("DELETE FROM operational_summaries WHERE date = ?", [date]);
    return send(res, 200, { ok: true, message: "Resumo operacional excluÃ­do." });
  }

  if (method === "POST" && url.pathname === "/api/summary") {
    if (!canAccessPrevention(user)) return send(res, 403, { error: "Acesso restrito ao módulo de prevenção." });
    if (!canFillEncarregadaOnly(user)) {
      return send(res, 403, { error: "Apenas a encarregada pode salvar o resumo." });
    }
    const body = await readBody(req);
    const existing = (await query("SELECT id FROM operational_summaries WHERE date = ?", [body.date || today()]))[0];
    if (existing && !canCorrect(user)) {
      return send(res, 403, { error: "Apenas administrador ou encarregada podem corrigir resumo jÃ¡ enviado." });
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
    if (!canAccessPrevention(user)) return send(res, 403, { error: "Acesso restrito ao módulo de prevenção." });
    const fallback = today();
    const start = url.searchParams.get("startDate") || fallback;
    const end = url.searchParams.get("endDate") || start;
    const currentMonth = periodInfo(start, end);
    const dashboardActivities = activities;
    const totalsByDay = await query(
      `SELECT date, COUNT(*) AS total
       FROM checklists
       WHERE date BETWEEN ? AND ?
       GROUP BY date ORDER BY date`,
      [start, end]
    );
    const summary = (await query(
      `
      SELECT
        COALESCE(SUM(losses_value),0) AS losses,
        COALESCE(SUM(consumption_value),0) AS consumptions,
        COALESCE(SUM(bottles_count),0) AS bottles,
        (SELECT COUNT(*) FROM checklists WHERE date BETWEEN ? AND ? AND activity = ?) AS receipts,
        (SELECT COUNT(*) FROM checklists WHERE date BETWEEN ? AND ? AND activity = ?) AS expired,
        (SELECT COUNT(*) FROM checklists WHERE date BETWEEN ? AND ? AND activity = ?) AS divergences
      FROM operational_summaries WHERE date BETWEEN ? AND ?
      `,
      [start, end, RECEIPTS_ACTIVITY, start, end, EXPIRED_PRODUCTS_ACTIVITY, start, end, PRICE_DIVERGENCE_ACTIVITY, start, end]
    ))[0];
    const completedActivityRows = await query(
      `SELECT DISTINCT date, activity
       FROM checklists
       WHERE date BETWEEN ? AND ?`,
      [start, end]
    );
    const completedActivityKeys = new Set(
      completedActivityRows
        .filter((row) => dashboardActivities.includes(row.activity))
        .map((row) => `${row.date}|${row.activity}`)
    );
    const expectedChecklistTotal = dashboardActivities.length * currentMonth.days;
    const completedChecklistTotal = completedActivityKeys.size;
    const pendingToday = Math.max(expectedChecklistTotal - completedChecklistTotal, 0);
    const byCollaborator = await query(
      `
      SELECT col.name, COUNT(*) AS total
      FROM checklists c JOIN collaborators col ON col.id = c.collaborator_id
      WHERE c.answer = 'Nao' AND c.date BETWEEN ? AND ?
      GROUP BY col.name ORDER BY total DESC
      `,
      [start, end]
    );
    const collaboratorCounts = await query(
      `
      SELECT col.id, col.name, COUNT(c.id) AS total
      FROM users u
      JOIN collaborators col ON col.id = u.collaborator_id
      LEFT JOIN checklists c ON c.collaborator_id = col.id
        AND c.date BETWEEN ? AND ?
        AND c.activity NOT IN (${ENGAGEMENT_EXCLUDED_ACTIVITIES.map(() => "?").join(", ")})
      WHERE col.status = 'ativo'
        AND u.status = 'ativo'
        AND u.role IN ('prevencao', 'colaborador')
      GROUP BY col.id, col.name
      ORDER BY col.name
      `,
      [currentMonth.start, currentMonth.end, ...ENGAGEMENT_EXCLUDED_ACTIVITIES]
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
    const activityCompletion = dashboardActivities.map((activity) => {
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
      expectedChecklistTotal,
      completedChecklistTotal,
      summary,
      byCollaborator,
      month: currentMonth,
      collaboratorCompletion,
      activityCompletion,
    });
  }

  if (method === "GET" && url.pathname === "/api/pendencies") {
    if (!canAccessPrevention(user)) return send(res, 403, { error: "Acesso restrito ao módulo de prevenção." });
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
    if (!canAccessPrevention(user)) return send(res, 403, { error: "Acesso restrito ao módulo de prevenção." });
    const body = await readBody(req);
    const attachmentPath = saveDataUrl(body.attachmentData, body.attachmentName);
    await execute(
      "INSERT INTO pendencies (description, responsible_id, opened_at, status, attachment_path, solution_observation, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [body.description, body.responsibleId, body.openedAt || today(), body.status || "Aberto", attachmentPath, body.solutionObservation || "", user.id]
    );
    return send(res, 201, { ok: true });
  }

  if (method === "PUT" && url.pathname.startsWith("/api/pendencies/")) {
    if (!canAccessPrevention(user)) return send(res, 403, { error: "Acesso restrito ao módulo de prevenção." });
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
    if (!canAccessPrevention(user)) return send(res, 403, { error: "Acesso restrito ao módulo de prevenção." });
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

  return send(res, 404, { error: "Rota nÃ£o encontrada." });
}

function serveStatic(req, res, url) {
  let filePath = (url.pathname === "/" || url.pathname.startsWith("/agendar/")) ? path.join(ROOT, "public", "index.html") : path.join(ROOT, url.pathname);
  if (url.pathname.startsWith("/uploads/")) filePath = path.join(ROOT, url.pathname);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return send(res, 404, "Arquivo nÃ£o encontrado", { "Content-Type": "text/plain; charset=utf-8" });
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
  };
  send(res, 200, fs.readFileSync(filePath), {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
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


