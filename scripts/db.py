import json
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("APP_DATA_DIR") or os.path.join(ROOT, "data")
DB_PATH = os.path.join(DATA_DIR, "app.sqlite")

ACTIVITIES = [
    "Temperatura 07h",
    "Temperatura 10h",
    "Temperatura 16h",
    "Temperatura 19h",
    "Lancamento de perdas no sistema",
    "Lancamento de consumo interno",
    "Contagem e acompanhamento de vasilhames",
    "Acompanhamento de cotacoes",
    "Acompanhamento de recebimentos",
    "Monitoramento loja / App Veesion",
    "Conferencia de precificacao",
    "Verificacao de validades",
    "Verificacao de agua do bebedouro",
    "Acompanhamento da vitrine",
]

SEED_EXAMPLE_DATA = False


def connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    db_exists = os.path.exists(DB_PATH)
    conn = connect()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            display_name TEXT NOT NULL,
            collaborator_id INTEGER,
            status TEXT NOT NULL DEFAULT 'ativo',
            FOREIGN KEY (collaborator_id) REFERENCES collaborators(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS collaborators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ativo',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS checklists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            collaborator_id INTEGER NOT NULL,
            activity TEXT NOT NULL,
            answer TEXT NOT NULL,
            observation TEXT,
            photo_path TEXT,
            sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER NOT NULL,
            corrected_by INTEGER,
            corrected_at TEXT,
            FOREIGN KEY (collaborator_id) REFERENCES collaborators(id),
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (corrected_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS operational_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER NOT NULL,
            corrected_by INTEGER,
            corrected_at TEXT,
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (corrected_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS pendencies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            responsible_id INTEGER NOT NULL,
            opened_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Aberto',
            attachment_path TEXT,
            solution_observation TEXT,
            created_by INTEGER NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (responsible_id) REFERENCES collaborators(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        );
        """
    )

    user_columns = [row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "collaborator_id" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN collaborator_id INTEGER")
    if "status" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'ativo'")

    summary_columns = [row["name"] for row in conn.execute("PRAGMA table_info(operational_summaries)").fetchall()]
    if "bottles_details" not in summary_columns:
        conn.execute("ALTER TABLE operational_summaries ADD COLUMN bottles_details TEXT")

    if not db_exists and conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)",
            [
                ("admin", "adm123", "administrador", "Administrador"),
            ],
        )

    if SEED_EXAMPLE_DATA and not db_exists and conn.execute("SELECT COUNT(*) FROM collaborators").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO collaborators (name, role, status) VALUES (?, ?, ?)",
            [
                ("Ana Paula Santos", "Prevencao de Perdas", "ativo"),
                ("Carlos Henrique Lima", "Fiscal de Loja", "ativo"),
                ("Maria Eduarda Rocha", "Encarregada", "ativo"),
                ("Joao Batista Silva", "Conferente", "inativo"),
            ],
        )

    if SEED_EXAMPLE_DATA and not db_exists and conn.execute("SELECT COUNT(*) FROM checklists").fetchone()[0] == 0:
        collabs = conn.execute("SELECT id FROM collaborators WHERE status='ativo' ORDER BY id").fetchall()
        user_id = conn.execute("SELECT id FROM users WHERE username='prevencao'").fetchone()[0]
        sample = []
        for index, activity in enumerate(ACTIVITIES[:10]):
            sample.append(
                (
                    "2026-06-03",
                    collabs[index % len(collabs)]["id"],
                    activity,
                    "Sim" if index not in (5, 8) else "Nao",
                    "Registro de exemplo" if index not in (5, 8) else "Necessita acompanhamento",
                    None,
                    user_id,
                )
            )
        conn.executemany(
            """
            INSERT INTO checklists (date, collaborator_id, activity, answer, observation, photo_path, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            sample,
        )

    if SEED_EXAMPLE_DATA and not db_exists and conn.execute("SELECT COUNT(*) FROM operational_summaries").fetchone()[0] == 0:
        user_id = conn.execute("SELECT id FROM users WHERE username='encarregada'").fetchone()[0]
        conn.execute(
            """
            INSERT INTO operational_summaries (
                date, losses_value, consumption_value, bottles_count, bottles_details, receipts_count,
                price_divergence_products, expired_products, occurrences, corrective_actions,
                pending_items, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "2026-06-03",
                418.75,
                129.9,
                84,
                "Garrafas retornáveis 1L e 2L",
                6,
                "Arroz tipo 1 5kg; Cafe 250g",
                "Iogurte natural lote 225; Biscoito wafer",
                "Divergencia identificada no corredor de mercearia",
                "Etiqueta corrigida e produto vencido recolhido",
                "Validar nova cotacao de frios",
                user_id,
            ),
        )

    if SEED_EXAMPLE_DATA and not db_exists and conn.execute("SELECT COUNT(*) FROM pendencies").fetchone()[0] == 0:
        collab_id = conn.execute("SELECT id FROM collaborators WHERE status='ativo' ORDER BY id LIMIT 1").fetchone()[0]
        user_id = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()[0]
        conn.execute(
            """
            INSERT INTO pendencies (description, responsible_id, opened_at, status, solution_observation, created_by)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "Revisar divergencia de preco no setor de mercearia",
                collab_id,
                "2026-06-03",
                "Em andamento",
                "Aguardando confirmacao do cadastro central",
                user_id,
            ),
        )

    conn.commit()
    conn.close()


def rows_to_dict(rows):
    return [dict(row) for row in rows]


def handle(payload):
    init_db()
    conn = connect()
    action = payload.get("action")
    sql = payload.get("sql")
    params = payload.get("params") or []
    many = payload.get("many") or False
    try:
        if action == "query":
            rows = conn.execute(sql, params).fetchall()
            return {"rows": rows_to_dict(rows)}
        if action == "execute":
            cursor = conn.executemany(sql, params) if many else conn.execute(sql, params)
            conn.commit()
            return {"lastrowid": cursor.lastrowid, "changes": conn.total_changes}
        if action == "script":
            conn.executescript(sql)
            conn.commit()
            return {"ok": True}
        raise ValueError("Acao invalida")
    finally:
        conn.close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "init":
        init_db()
        print(json.dumps({"ok": True, "db": DB_PATH}))
    else:
        payload = json.loads(sys.stdin.read())
        print(json.dumps(handle(payload), ensure_ascii=False))
