[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "setup-env.ps1") -Quiet

$projectRoot = $env:ESP_MESSENGER_PROJECT_ROOT
if ($projectRoot) {
    $localGitConfig = Join-Path $projectRoot ".gitconfig-idf"
    if ((-not $env:GIT_CONFIG_GLOBAL) -and (Test-Path $localGitConfig)) {
        $env:GIT_CONFIG_GLOBAL = $localGitConfig
    }
}

if (-not $env:IDF_SKIP_CHECK_SUBMODULES) {
    $env:IDF_SKIP_CHECK_SUBMODULES = "1"
}

idf.py.exe @Arguments
