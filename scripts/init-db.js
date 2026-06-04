const { spawnSync } = require("child_process");
const path = require("path");

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
