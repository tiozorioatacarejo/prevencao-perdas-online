const { spawnSync } = require("child_process");
const path = require("path");

async function initPostgres() {
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  });
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
  `);
  await pool.query("ALTER TABLE collaborators ADD COLUMN IF NOT EXISTS sector TEXT");
  await pool.query("ALTER TABLE checklists ADD COLUMN IF NOT EXISTS sector TEXT");
  const existing = await pool.query("SELECT COUNT(*) AS total FROM users");
  if (Number(existing.rows[0].total) === 0) {
    await pool.query(
      "INSERT INTO users (username, password, role, display_name, status) VALUES ($1, $2, $3, $4, $5)",
      ["admin", "adm123", "administrador", "Administrador", "ativo"]
    );
  }
  await pool.end();
  console.log("Banco PostgreSQL inicializado.");
}

function initSqlite() {
  const bundledPython = "C:\\Users\\tiozo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
  const candidates = [process.env.PYTHON_EXE, "python3", "python", bundledPython].filter(Boolean);

  for (const candidate of candidates) {
    const check = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (check.status !== 0) continue;

    const result = spawnSync(candidate, [path.join(__dirname, "db.py"), "init"], {
      stdio: "inherit",
      env: process.env,
    });
    process.exit(result.status || 0);
  }

  console.error("Nao foi possivel encontrar Python para inicializar o banco SQLite.");
  process.exit(1);
}

if (process.env.DATABASE_URL) {
  initPostgres().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  initSqlite();
}
