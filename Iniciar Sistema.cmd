@echo off
setlocal
cd /d "%~dp0"

set "NODE_CMD=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Users\tiozo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "NODE_CMD=C:\Users\tiozo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  )
)

echo Iniciando o Sistema de Prevencao de Perdas...
echo.
echo Uma janela minimizada do servidor sera aberta.
echo Para parar o sistema, use o arquivo "Parar Sistema.cmd".
echo.

start "Servidor Prevencao de Perdas" /min "%NODE_CMD%" server.js
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"

echo Sistema iniciado. Se o navegador nao abrir, acesse:
echo http://localhost:3000
echo.
pause
