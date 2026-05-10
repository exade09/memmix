param(
    [int]$Port = 8080,
    [int]$Limit = 100
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

python main.py web --port $Port --limit $Limit
