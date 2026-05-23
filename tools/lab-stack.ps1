[CmdletBinding()]
param(
    [ValidateSet("start", "stop", "restart", "status")]
    [string]$Action = "status",

    [string]$BindHost = "127.0.0.1",
    [int]$SenderPort = 8787,
    [int]$ReceiverPort = 8788,
    [int]$RelayPort = 8790,
    [int]$UnifiedPort = 8796,
    [string]$SenderTransport = "COM9",
    [string]$ReceiverTransport = "COM8",
    [int]$SyncIntervalMs = 15000,
    [string]$RelayName = "gateway-alpha",
    [string]$ShellName = "unified-client",
    [ValidateSet("windows", "background")]
    [string]$LaunchMode = "windows"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $PSScriptRoot "runtime"
$metadataPath = Join-Path $runtimeRoot "lab-stack.json"
$logDir = Join-Path $runtimeRoot "logs"
$powerShellExe = Join-Path $PSHOME "powershell.exe"
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source

function Ensure-Directory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Get-RoleDefinitions {
    $cliPath = Join-Path $projectRoot "agent\src\cli.js"
    $senderStateDir = Join-Path $projectRoot "agent\state"
    $receiverStateDir = Join-Path $projectRoot "agent\state-receiver"
    $relayStateDir = Join-Path $projectRoot "agent\state-relay"
    $relayUrl = "http://$BindHost`:$RelayPort"
    $senderUrl = "http://$BindHost`:$SenderPort"
    $receiverUrl = "http://$BindHost`:$ReceiverPort"

    @(
        [PSCustomObject]@{
            Name = "sender"
            Port = $SenderPort
            Url = $senderUrl
            HealthUrl = "$senderUrl/health"
            ProbeUrl = "$senderUrl/health"
            OutLog = Join-Path $logDir "sender.out.log"
            ErrLog = Join-Path $logDir "sender.err.log"
            Command = @(
                $nodeExe,
                $cliPath,
                "serve",
                "--port", $SenderTransport,
                "--listen", "$SenderPort",
                "--state-dir", $senderStateDir,
                "--agent-name", "sender",
                "--remote-url", $relayUrl,
                "--target-agent", "receiver",
                "--sync-interval-ms", "$SyncIntervalMs"
            )
        }
        [PSCustomObject]@{
            Name = "receiver"
            Port = $ReceiverPort
            Url = $receiverUrl
            HealthUrl = "$receiverUrl/health"
            ProbeUrl = "$receiverUrl/health"
            OutLog = Join-Path $logDir "receiver.out.log"
            ErrLog = Join-Path $logDir "receiver.err.log"
            Command = @(
                $nodeExe,
                $cliPath,
                "serve",
                "--port", $ReceiverTransport,
                "--listen", "$ReceiverPort",
                "--state-dir", $receiverStateDir,
                "--agent-name", "receiver",
                "--remote-url", $relayUrl,
                "--target-agent", "sender",
                "--sync-interval-ms", "$SyncIntervalMs"
            )
        }
        [PSCustomObject]@{
            Name = "relay"
            Port = $RelayPort
            Url = $relayUrl
            HealthUrl = "$relayUrl/health"
            ProbeUrl = "$relayUrl/health"
            OutLog = Join-Path $logDir "relay.out.log"
            ErrLog = Join-Path $logDir "relay.err.log"
            Command = @(
                $nodeExe,
                $cliPath,
                "serve-relay",
                "--listen", "$RelayPort",
                "--state-dir", $relayStateDir,
                "--relay-name", $RelayName,
                "--route", "receiver=$receiverUrl",
                "--route", "sender=$senderUrl"
            )
        }
        [PSCustomObject]@{
            Name = "unified"
            Port = $UnifiedPort
            Url = "http://$BindHost`:$UnifiedPort"
            HealthUrl = "http://$BindHost`:$UnifiedPort/health"
            ProbeUrl = "http://$BindHost`:$UnifiedPort/ready"
            OutLog = Join-Path $logDir "unified.out.log"
            ErrLog = Join-Path $logDir "unified.err.log"
            Command = @(
                $nodeExe,
                $cliPath,
                "serve-unified",
                "--listen", "$UnifiedPort",
                "--sender-url", $senderUrl,
                "--receiver-url", $receiverUrl,
                "--relay-url", $relayUrl,
                "--shell-name", $ShellName
            )
        }
    )
}

function Read-Metadata {
    if (-not (Test-Path $metadataPath)) {
        return @{}
    }

    try {
        return (Get-Content -Path $metadataPath -Raw | ConvertFrom-Json -AsHashtable)
    } catch {
        return @{}
    }
}

function Write-Metadata {
    param([Parameter(Mandatory = $true)][hashtable]$Metadata)

    Ensure-Directory -Path $runtimeRoot
    $Metadata | ConvertTo-Json -Depth 6 | Set-Content -Path $metadataPath -Encoding UTF8
}

function Test-Health {
    param([Parameter(Mandatory = $true)][string]$Url)

    try {
        $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 4
        return [PSCustomObject]@{
            Ok = [bool]$response.ok
            Payload = $response
            Error = $null
        }
    } catch {
        return [PSCustomObject]@{
            Ok = $false
            Payload = $null
            Error = $_.Exception.Message
        }
    }
}

function Get-PortListenerPid {
    param([Parameter(Mandatory = $true)][int]$Port)

    try {
        $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
            Select-Object -First 1
        if ($null -ne $listener) {
            return [int]$listener.OwningProcess
        }
    } catch {
        return $null
    }

    return $null
}

function Stop-RoleProcess {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][int]$Port,
        [hashtable]$Metadata
    )

    $pidToStop = $null
    if ($Metadata.ContainsKey($Name) -and $Metadata[$Name].ContainsKey("Pid")) {
        $pidToStop = [int]$Metadata[$Name].Pid
    }

    if (-not $pidToStop) {
        $pidToStop = Get-PortListenerPid -Port $Port
    }

    if ($pidToStop) {
        try {
            Stop-Process -Id $pidToStop -Force -ErrorAction Stop
        } catch {
        }
    }
}

function Start-RoleProcess {
    param(
        [Parameter(Mandatory = $true)]$Definition,
        [Parameter(Mandatory = $true)][hashtable]$Metadata
    )

    $probeUrl = if ($Definition.PSObject.Properties.Name -contains "ProbeUrl" -and $Definition.ProbeUrl) {
        $Definition.ProbeUrl
    } else {
        $Definition.HealthUrl
    }

    $currentHealth = Test-Health -Url $probeUrl
    if ($currentHealth.Ok) {
        $Metadata[$Definition.Name] = @{
            Name = $Definition.Name
            Pid = Get-PortListenerPid -Port $Definition.Port
            Port = $Definition.Port
            Url = $Definition.Url
            HealthUrl = $Definition.HealthUrl
            OutLog = $Definition.OutLog
            ErrLog = $Definition.ErrLog
            Status = "already-running"
            UpdatedAt = (Get-Date).ToString("o")
        }
        return
    }

    Stop-RoleProcess -Name $Definition.Name -Port $Definition.Port -Metadata $Metadata

    if (Test-Path $Definition.OutLog) {
        Remove-Item -LiteralPath $Definition.OutLog -Force
    }
    if (Test-Path $Definition.ErrLog) {
        Remove-Item -LiteralPath $Definition.ErrLog -Force
    }

    $process = $null
    $launchScriptPath = Join-Path $runtimeRoot ("launch-" + $Definition.Name + ".ps1")
    $commandParts = $Definition.Command | ForEach-Object {
        "'" + ($_ -replace "'", "''") + "'"
    }
    $useDetachedWrapper = ($LaunchMode -eq "background")
    $launchCommand = if ($useDetachedWrapper) {
        "& " + ($commandParts -join " ") + " 1>> '$($Definition.OutLog -replace "'", "''")' 2>> '$($Definition.ErrLog -replace "'", "''")'"
    } else {
        "& " + ($commandParts -join " ")
    }
    $launchScript = @(
        "Set-Location '$($projectRoot -replace "'", "''")'"
        $launchCommand
    ) -join [Environment]::NewLine
    Set-Content -Path $launchScriptPath -Value $launchScript -Encoding UTF8

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $powerShellExe
    $psi.Arguments = if ($useDetachedWrapper) {
        "-NoProfile -ExecutionPolicy Bypass -File `"$launchScriptPath`""
    } else {
        "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$launchScriptPath`""
    }
    $psi.WorkingDirectory = $projectRoot
    $psi.UseShellExecute = $true
    $psi.WindowStyle = if ($useDetachedWrapper) { "Hidden" } else { "Normal" }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    [void]$process.Start()

    $deadline = if ($Definition.Name -eq "unified") {
        (Get-Date).AddSeconds(30)
    } else {
        (Get-Date).AddSeconds(20)
    }
    $healthy = $false
    do {
        Start-Sleep -Milliseconds 500
        $health = Test-Health -Url $probeUrl
        if ($health.Ok) {
            $healthy = $true
            break
        }
    } while ((Get-Date) -lt $deadline)

    $Metadata[$Definition.Name] = @{
        Name = $Definition.Name
        Pid = $process.Id
        Port = $Definition.Port
        Url = $Definition.Url
        HealthUrl = $Definition.HealthUrl
        OutLog = $Definition.OutLog
        ErrLog = $Definition.ErrLog
        Status = if ($healthy) { "running" } else { "starting-timeout" }
        UpdatedAt = (Get-Date).ToString("o")
    }

    if (-not $healthy) {
        if ($LaunchMode -eq "background") {
            throw "Role '$($Definition.Name)' did not become healthy in time. Check $($Definition.OutLog) and $($Definition.ErrLog)."
        }
        throw "Role '$($Definition.Name)' did not become healthy in time. Inspect its PowerShell window."
    }
}

function Get-StackStatus {
    param(
        [Parameter(Mandatory = $true)]$Definitions,
        [Parameter(Mandatory = $true)][hashtable]$Metadata
    )

    $rows = foreach ($definition in $Definitions) {
        $probeUrl = if ($definition.PSObject.Properties.Name -contains "ProbeUrl" -and $definition.ProbeUrl) {
            $definition.ProbeUrl
        } else {
            $definition.HealthUrl
        }
        $health = Test-Health -Url $probeUrl
        $portPid = Get-PortListenerPid -Port $definition.Port
        $meta = if ($Metadata.ContainsKey($definition.Name)) { $Metadata[$definition.Name] } else { $null }
        [PSCustomObject]@{
            Role = $definition.Name
            Port = $definition.Port
            PID = if ($portPid) { $portPid } elseif ($meta) { $meta.Pid } else { $null }
            Health = if ($health.Ok) { "ok" } else { "down" }
            Url = $definition.Url
            OutLog = $definition.OutLog
        }
    }

    $rows | Format-Table -AutoSize
}

Ensure-Directory -Path $runtimeRoot
Ensure-Directory -Path $logDir

$definitions = Get-RoleDefinitions
$metadata = Read-Metadata

switch ($Action) {
    "start" {
        foreach ($definition in $definitions) {
            Start-RoleProcess -Definition $definition -Metadata $metadata
        }
        Write-Metadata -Metadata $metadata
        Get-StackStatus -Definitions $definitions -Metadata $metadata
    }
    "stop" {
        foreach ($definition in ($definitions | Sort-Object Port -Descending)) {
            Stop-RoleProcess -Name $definition.Name -Port $definition.Port -Metadata $metadata
        }
        $metadata = @{}
        Write-Metadata -Metadata $metadata
        Get-StackStatus -Definitions $definitions -Metadata $metadata
    }
    "restart" {
        foreach ($definition in ($definitions | Sort-Object Port -Descending)) {
            Stop-RoleProcess -Name $definition.Name -Port $definition.Port -Metadata $metadata
        }
        Start-Sleep -Seconds 1
        $metadata = @{}
        foreach ($definition in $definitions) {
            Start-RoleProcess -Definition $definition -Metadata $metadata
        }
        Write-Metadata -Metadata $metadata
        Get-StackStatus -Definitions $definitions -Metadata $metadata
    }
    "status" {
        Get-StackStatus -Definitions $definitions -Metadata $metadata
    }
}
