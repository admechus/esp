import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DISCOVERY_SCRIPT = `
$roots = @(
  'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_303A*',
  'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_10C4*',
  'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_1A86*'
)

$items = foreach ($root in $roots) {
  Get-ChildItem -Path $root -Recurse -ErrorAction SilentlyContinue |
    ForEach-Object {
      try {
        Get-ItemProperty $_.PSPath -ErrorAction Stop
      } catch {
      }
    }
}

$devices = $items | Where-Object {
  $_.FriendlyName -or $_.DeviceDesc
} | ForEach-Object {
  $friendlyName = $_.FriendlyName
  if (-not $friendlyName -and $_.DeviceDesc) {
    $friendlyName = $_.DeviceDesc
  }

  $portName = $null
  if ($friendlyName -match '\\((COM\\d+)\\)') {
    $portName = $matches[1]
  }

  $instanceId = $_.PSChildName
  $kind = 'unknown'
  if ($_.PSPath -match 'VID_303A') { $kind = 'espressif-usb' }
  elseif ($_.PSPath -match 'VID_10C4') { $kind = 'cp210x-uart' }
  elseif ($_.PSPath -match 'VID_1A86') { $kind = 'ch340-uart' }

  [PSCustomObject]@{
    port = $portName
    kind = $kind
    friendlyName = $friendlyName
    instanceId = $instanceId
  }
}

$devices |
  Where-Object { $_.port } |
  Group-Object port, friendlyName, instanceId |
  ForEach-Object { $_.Group[0] } |
  Sort-Object friendlyName |
  ConvertTo-Json -Depth 3
`;

export async function discoverWindowsEspPorts() {
  const { stdout } = await execFileAsync("powershell.exe", ["-Command", DISCOVERY_SCRIPT], {
    windowsHide: true
  });

  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}
