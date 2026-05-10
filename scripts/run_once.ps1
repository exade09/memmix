param(
    [int]$Limit = 15,
    [string]$Config = ""
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

if ($Config -ne "") {
    python main.py --config $Config scan --limit $Limit
} else {
    python main.py scan --limit $Limit
}
