[CmdletBinding()]
param(
    [ValidateSet("tdongle-s3", "host-identity-esp32")]
    [string]$Board = "tdongle-s3",
    [string]$Port,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "setup-env.ps1") -Quiet

$projectRoot = $env:ESP_MESSENGER_PROJECT_ROOT
$projectDir = Join-Path $projectRoot "firmware\unified-node"
$localGitConfig = Join-Path $projectRoot ".gitconfig-idf"

if (Test-Path $localGitConfig) {
    $env:GIT_CONFIG_GLOBAL = $localGitConfig
}

$env:IDF_SKIP_CHECK_SUBMODULES = "1"
$env:ESP_MESSENGER_BOARD_PROFILE = $Board

$chip = if ($Board -eq "tdongle-s3") { "esp32s3" } else { "esp32" }
if (-not $Port) {
    $Port = if ($Board -eq "tdongle-s3") { "COM9" } else { "COM8" }
}

$buildDir = Join-Path $projectDir ("build-" + $Board)
if (-not (Test-Path $buildDir)) {
    & (Join-Path $PSScriptRoot "build-unified-node.ps1") -Board $Board
}

$flashArgsPath = Join-Path $buildDir "flash_args"
if (-not (Test-Path $flashArgsPath)) {
    throw "flash_args not found at $flashArgsPath"
}

$flashArgs = New-Object System.Collections.Generic.List[string]
foreach ($line in (Get-Content $flashArgsPath)) {
    $trimmed = $line.Trim()
    if (-not $trimmed) {
        continue
    }

    foreach ($token in ($trimmed -split '\s+')) {
        if ($token) {
            $flashArgs.Add($token)
        }
    }
}

Push-Location $buildDir
try {
    & $env:ESP_PYTHON_EXE -m esptool `
        --chip $chip `
        -p $Port `
        -b 460800 `
        --before default_reset `
        --after hard_reset `
        write_flash `
        @flashArgs `
        @Arguments
}
finally {
    Pop-Location
}
