[CmdletBinding()]
param(
    [string]$Port = "COM9",
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "setup-env.ps1") -Quiet

idf.py.exe -C (Join-Path $env:ESP_MESSENGER_PROJECT_ROOT "firmware\dongle") -p $Port flash @Arguments
