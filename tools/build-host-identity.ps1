[CmdletBinding()]
param(
    [switch]$Clean
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "setup-env.ps1") -Quiet

$projectRoot = $env:ESP_MESSENGER_PROJECT_ROOT
$projectDir = Join-Path $projectRoot "firmware\host-identity"
$buildDir = Join-Path $projectDir "build"
$localGitConfig = Join-Path $projectRoot ".gitconfig-idf"
$ninjaExe = (Get-Command ninja.exe -ErrorAction Stop).Source
$pythonExe = $env:ESP_PYTHON_EXE

if ((-not $pythonExe) -or (-not (Test-Path $pythonExe))) {
    throw "ESP Python executable was not found in ESP_PYTHON_EXE."
}

if (Test-Path $localGitConfig) {
    $env:GIT_CONFIG_GLOBAL = $localGitConfig
}

$env:IDF_SKIP_CHECK_SUBMODULES = "1"

if ($Clean -and (Test-Path $buildDir)) {
    Remove-Item -LiteralPath $buildDir -Recurse -Force
}

cmake -S $projectDir `
    -B $buildDir `
    -G Ninja `
    "-DCMAKE_MAKE_PROGRAM=$ninjaExe" `
    -DPYTHON_DEPS_CHECKED=1 `
    "-DPYTHON=$pythonExe" `
    -DESP_PLATFORM=1 `
    -DIDF_TARGET=esp32 `
    -DCCACHE_ENABLE=0

cmake --build $buildDir
