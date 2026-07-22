$ErrorActionPreference = "Stop"

$BundledNode = "C:\Users\tiozo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$BundledPython = "C:\Users\tiozo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if (Test-Path $BundledNode) {
  $env:APP_NODE = $BundledNode
} else {
  $env:APP_NODE = "node"
}

if (Test-Path $BundledPython) {
  $env:PYTHON_EXE = $BundledPython
} elseif (-not $env:PYTHON_EXE) {
  $env:PYTHON_EXE = "python"
}

& $env:APP_NODE server.js
