[CmdletBinding()]
param(
    [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Add-PathEntry {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathEntry,
        [switch]$Append
    )

    if (-not (Test-Path $PathEntry)) {
        return
    }

    $existing = @()
    if ($env:PATH) {
        $existing = $env:PATH -split ';' | Where-Object { $_ }
    }

    if ($existing -notcontains $PathEntry) {
        if ($Append) {
            $env:PATH = "$env:PATH;$PathEntry"
        }
        else {
            $env:PATH = "$PathEntry;$env:PATH"
        }
    }
}

function Get-LatestChildDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BasePath
    )

    if (-not (Test-Path $BasePath)) {
        return $null
    }

    try {
        return Get-ChildItem -Path $BasePath -Directory -ErrorAction Stop |
            Sort-Object Name -Descending |
            Select-Object -First 1
    }
    catch {
        return $null
    }
}

function Get-EspressifInstallInfo {
    $configPath = "C:\Espressif\tools\eim_idf.json"
    if (-not (Test-Path $configPath)) {
        throw "Espressif config not found at $configPath"
    }

    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    $selected = $config.idfInstalled | Where-Object { $_.id -eq $config.idfSelectedId } | Select-Object -First 1
    if (-not $selected) {
        $selected = $config.idfInstalled | Select-Object -First 1
    }
    if (-not $selected) {
        throw "No ESP-IDF installation records found in $configPath"
    }

    return [pscustomobject]@{
        ConfigPath = $configPath
        GitPath = $config.gitPath
        IDFPath = $selected.path
        IDFToolsPath = $selected.idfToolsPath
        PythonExe = $selected.python
        PythonEnvPath = Split-Path -Parent $selected.python
        ActivationScript = $selected.activationScript
    }
}

function Get-ArduinoEsp32Info {
    $root = Join-Path $env:LOCALAPPDATA "Arduino15\packages\esp32"
    if (-not (Test-Path $root)) {
        return $null
    }

    $hardwareRoot = Join-Path $root "hardware\esp32"
    $hardwareVersion = Get-LatestChildDirectory -BasePath $hardwareRoot
    $toolsRoot = Join-Path $root "tools"

    $espX32 = Get-LatestChildDirectory -BasePath (Join-Path $toolsRoot "esp-x32")
    $espRv32 = Get-LatestChildDirectory -BasePath (Join-Path $toolsRoot "esp-rv32")
    $esptool = Get-LatestChildDirectory -BasePath (Join-Path $toolsRoot "esptool_py")
    $openocd = Get-LatestChildDirectory -BasePath (Join-Path $toolsRoot "openocd-esp32")

    return [pscustomobject]@{
        Root = $root
        HardwarePath = if ($hardwareVersion) { $hardwareVersion.FullName } else { $null }
        EspX32Bin = if ($espX32) { Join-Path $espX32.FullName "bin" } else { $null }
        EspRv32Bin = if ($espRv32) { Join-Path $espRv32.FullName "bin" } else { $null }
        EsptoolPath = if ($esptool) { $esptool.FullName } else { $null }
        OpenOcdBin = if ($openocd) { Join-Path $openocd.FullName "bin" } else { $null }
    }
}

function Apply-LocalOverrides {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Values
    )

    $overridePath = Join-Path $PSScriptRoot "esp-env.local.ps1"
    if (-not (Test-Path $overridePath)) {
        return
    }

    . $overridePath
    if (Get-Variable -Name EspEnvOverrides -Scope Script -ErrorAction SilentlyContinue) {
        foreach ($entry in $script:EspEnvOverrides.GetEnumerator()) {
            $Values[$entry.Key] = $entry.Value
        }
    }
}

function Set-EnvironmentFromEspressifInfo {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Info,
        [switch]$QuietActivation
    )

    if (Test-Path $Info.ActivationScript) {
        if ($QuietActivation) {
            . $Info.ActivationScript *> $null
        }
        else {
            . $Info.ActivationScript
        }
    }
    else {
        $env:IDF_TOOLS_PATH = $Info.IDFToolsPath
        $env:IDF_PATH = $Info.IDFPath
        $env:IDF_PYTHON_ENV_PATH = Split-Path -Parent $Info.PythonExe
        Add-PathEntry -PathEntry (Join-Path $Info.IDFToolsPath "idf-exe\1.0.3")
        Add-PathEntry -PathEntry (Join-Path $Info.IDFToolsPath "ninja\1.12.1")
        Add-PathEntry -PathEntry (Join-Path $Info.IDFToolsPath "cmake\3.30.2\cmake-3.30.2-windows-x86_64\bin")
        Add-PathEntry -PathEntry (Join-Path $Info.IDFToolsPath "xtensa-esp-elf\esp-14.2.0_20251107\xtensa-esp-elf\bin")
        Add-PathEntry -PathEntry (Join-Path $Info.IDFToolsPath "riscv32-esp-elf\esp-14.2.0_20251107\riscv32-esp-elf\bin")
        Add-PathEntry -PathEntry (Join-Path (Split-Path -Parent $Info.PythonExe) "Scripts")
    }
}

function Show-EspEnvironment {
    if (-not $env:IDF_PATH) {
        Write-Host "ESP environment is not configured."
        return
    }

    Write-Host "ESP environment ready"
    Write-Host "  IDF_PATH: $env:IDF_PATH"
    Write-Host "  IDF_TOOLS_PATH: $env:IDF_TOOLS_PATH"
    Write-Host "  IDF_PYTHON_ENV_PATH: $env:IDF_PYTHON_ENV_PATH"
    if ($env:ARDUINO_ESP32_ROOT) {
        Write-Host "  ARDUINO_ESP32_ROOT: $env:ARDUINO_ESP32_ROOT"
    }
}

$espInfo = Get-EspressifInstallInfo
$arduinoInfo = Get-ArduinoEsp32Info

$overrideValues = @{
    IDF_PATH = $espInfo.IDFPath
    IDF_TOOLS_PATH = $espInfo.IDFToolsPath
    ESP_PYTHON_EXE = $espInfo.PythonExe
    ARDUINO_ESP32_ROOT = if ($arduinoInfo) { $arduinoInfo.HardwarePath } else { $null }
    ARDUINO_ESP32_XTENSA_BIN = if ($arduinoInfo) { $arduinoInfo.EspX32Bin } else { $null }
    ARDUINO_ESP32_RISCV_BIN = if ($arduinoInfo) { $arduinoInfo.EspRv32Bin } else { $null }
    ARDUINO_ESP32_ESPTOOL_DIR = if ($arduinoInfo) { $arduinoInfo.EsptoolPath } else { $null }
    ARDUINO_ESP32_OPENOCD_BIN = if ($arduinoInfo) { $arduinoInfo.OpenOcdBin } else { $null }
}
Apply-LocalOverrides -Values $overrideValues

$espInfo = [pscustomobject]@{
    ConfigPath = $espInfo.ConfigPath
    GitPath = $espInfo.GitPath
    IDFPath = $overrideValues.IDF_PATH
    IDFToolsPath = $overrideValues.IDF_TOOLS_PATH
    PythonExe = $overrideValues.ESP_PYTHON_EXE
    PythonEnvPath = Split-Path -Parent $overrideValues.ESP_PYTHON_EXE
    ActivationScript = $espInfo.ActivationScript
}

Set-EnvironmentFromEspressifInfo -Info $espInfo -QuietActivation:$Quiet

$env:IDF_PATH = $overrideValues.IDF_PATH
$env:IDF_TOOLS_PATH = $overrideValues.IDF_TOOLS_PATH
$env:ESP_PYTHON_EXE = $overrideValues.ESP_PYTHON_EXE
$env:ESP_MESSENGER_PROJECT_ROOT = Split-Path -Parent $PSScriptRoot

if ($overrideValues.ARDUINO_ESP32_ROOT) {
    $env:ARDUINO_ESP32_ROOT = $overrideValues.ARDUINO_ESP32_ROOT
}

if ($overrideValues.ARDUINO_ESP32_XTENSA_BIN) {
    Add-PathEntry -PathEntry $overrideValues.ARDUINO_ESP32_XTENSA_BIN -Append
}
if ($overrideValues.ARDUINO_ESP32_RISCV_BIN) {
    Add-PathEntry -PathEntry $overrideValues.ARDUINO_ESP32_RISCV_BIN -Append
}
if ($overrideValues.ARDUINO_ESP32_ESPTOOL_DIR) {
    Add-PathEntry -PathEntry $overrideValues.ARDUINO_ESP32_ESPTOOL_DIR -Append
}
if ($overrideValues.ARDUINO_ESP32_OPENOCD_BIN) {
    Add-PathEntry -PathEntry $overrideValues.ARDUINO_ESP32_OPENOCD_BIN -Append
}

if (-not $Quiet) {
    Show-EspEnvironment
}
