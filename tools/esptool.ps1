[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "setup-env.ps1") -Quiet

$idfEsptool = Join-Path $env:IDF_PATH "components\esptool_py\esptool\esptool.py"
& $env:ESP_PYTHON_EXE $idfEsptool @Arguments
