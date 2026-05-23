import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { encodeLineDelimitedJson, decodeJsonLines } from "../protocol/framing.js";

const execFileAsync = promisify(execFile);

function escapeSingleQuotes(value) {
  return value.replace(/'/g, "''");
}

export function createWindowsSerialJsonTransport({ port, baudRate }) {
  return {
    async send(request) {
      const encoded = encodeLineDelimitedJson(request);
      const script = `
$port = New-Object System.IO.Ports.SerialPort '${escapeSingleQuotes(port)}',${baudRate},'None',8,'one'
$port.NewLine = "\`n"
$port.ReadTimeout = 5000
$port.WriteTimeout = 1500
$port.Open()
try {
  Start-Sleep -Milliseconds 200
  $port.DiscardInBuffer()
  $port.DiscardOutBuffer()
  $port.Write('${escapeSingleQuotes(encoded)}')
  $deadline = [DateTime]::UtcNow.AddMilliseconds(5000)
  $lines = @()
      while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $line = $port.ReadLine()
      if ($line) {
        $lines += $line
        if ($line.Contains('{') -or $line.Contains('[')) {
          break
        }
      }
    } catch [System.TimeoutException] {
    }
  }
  $lines -join "\`n"
} finally {
  if ($port.IsOpen) { $port.Close() }
}
`;

      const { stdout } = await execFileAsync("powershell.exe", ["-Command", script], {
        windowsHide: true
      });

      const messages = decodeJsonLines(stdout);
      if (!messages.length) {
        throw new Error(`No JSON response received from ${port}.`);
      }
      return messages[messages.length - 1];
    }
  };
}
