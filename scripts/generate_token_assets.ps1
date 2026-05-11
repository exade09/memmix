$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$tokenFile = Join-Path $projectRoot 'data\solana_memecoins.json'
$assetDir = Join-Path $projectRoot 'web\assets\tokens'

New-Item -ItemType Directory -Force -Path $assetDir | Out-Null
$tokens = (Get-Content -Raw -Path $tokenFile | ConvertFrom-Json).tokens

foreach ($token in $tokens) {
  $symbol = [string]$token.symbol
  $name = [string]$token.name
  $theme = [string]$token.theme
  $seed = 0
  foreach ($char in $symbol.ToCharArray()) {
    $seed += [int][char]$char
  }
  $hue = $seed % 360
  $hue2 = ($hue + 74) % 360
  $hue3 = ($hue + 168) % 360
  $shortSymbol = if ($symbol.Length -gt 8) { $symbol.Substring(0, 8) } else { $symbol }
  $safeName = [System.Security.SecurityElement]::Escape($name)
  $safeTheme = [System.Security.SecurityElement]::Escape($theme.ToUpperInvariant())
  $safeSymbol = [System.Security.SecurityElement]::Escape($shortSymbol)
  $emoji = switch -Regex ($theme) {
    'dog|bonk|wif|samo|myro' { 'DOG'; break }
    'cat|michi|popcat|mew' { 'CAT'; break }
    'frog|fwog' { 'FROG'; break }
    'brainrot|chant|sound|nonsense' { 'MEME'; break }
    'coffee' { 'CAFE'; break }
    'bull' { 'BULL'; break }
    'penguin' { 'PENG'; break }
    default { 'SOL' }
  }

  $svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="$safeName token art">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl($hue 78% 16%)"/>
      <stop offset="0.58" stop-color="hsl($hue2 74% 20%)"/>
      <stop offset="1" stop-color="hsl($hue3 80% 18%)"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity=".38"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="56" fill="url(#bg)"/>
  <circle cx="402" cy="96" r="92" fill="hsl($hue2 92% 58%)" opacity=".82"/>
  <circle cx="96" cy="404" r="118" fill="hsl($hue3 90% 62%)" opacity=".55"/>
  <path d="M58 165 C135 94 202 226 278 154 C344 91 405 146 454 94" fill="none" stroke="#41e28b" stroke-width="18" stroke-linecap="round" opacity=".82"/>
  <rect x="72" y="134" width="368" height="244" rx="38" fill="#0f1412" opacity=".82" filter="url(#shadow)"/>
  <text x="256" y="206" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="900" fill="#6ed7ff">$emoji</text>
  <text x="256" y="286" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="900" fill="#f6f8f7">$safeSymbol</text>
  <text x="256" y="336" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" fill="#e8c44f">$safeTheme</text>
  <text x="256" y="438" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#f6f8f7">SOLANA MEME</text>
</svg>
"@

  Set-Content -Path (Join-Path $assetDir "$symbol.svg") -Value $svg -Encoding UTF8
}

"Generated $($tokens.Count) token images in $assetDir"
