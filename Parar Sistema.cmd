@echo off
setlocal
echo Parando servidor na porta 3000...

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /PID %%p /F
)

echo.
echo Servidor parado, se havia algum processo ativo.
pause
