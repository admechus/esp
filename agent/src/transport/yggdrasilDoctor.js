import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { describeYggdrasilEnvironment } from "./yggdrasilEnvironment.js";
import { probeYggdrasilHealth } from "./yggdrasilHealthProbe.js";
import { describeYggdrasilLocalNode } from "./yggdrasilNodeIntrospection.js";

const DEFAULT_WINDOWS_CONFIG_PATH = "C:\\ProgramData\\Yggdrasil\\yggdrasil.conf";
const EXPECTED_STATIC_LISTENER = "tls://0.0.0.0:12345";
const EXPECTED_STATIC_PORT = 12345;

function createUnavailableSection(error, extra = {}) {
  return {
    available: false,
    error,
    ...extra
  };
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [value];
}

function toBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  return String(value).trim().toLowerCase() === "true";
}

function trimCell(value) {
  return value.replace(/\s+/g, " ").trim();
}

const TABLE_SEPARATORS = ["\u2502", "\u0432\u201d\u201a", "\u0420\u0406\u0432\u20ac\u045c\u0432\u20ac\u045a"];

function normalizeTableLine(line) {
  let normalized = String(line ?? "");
  for (const separator of TABLE_SEPARATORS) {
    normalized = normalized.split(separator).join("|");
  }
  return normalized;
}

function splitTableRow(line) {
  return normalizeTableLine(line)
    .split("|")
    .slice(1, -1)
    .map((cell) => trimCell(cell));
}

function extractTableRows(output) {
  return String(output ?? "")
    .split(/\r?\n/)
    .map((line) => normalizeTableLine(line).trimEnd())
    .filter((line) => line.trim().startsWith("|") && line.includes("|"))
    .map(splitTableRow);
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number.parseInt(String(value).replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeConfigValue(value) {
  return String(value ?? "")
    .replace(/\s+#.*$/, "")
    .replace(/,$/, "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractInlineArrayValues(text, key) {
  const pattern = new RegExp(String.raw`["']?${escapeRegExp(key)}["']?\s*:\s*\[(.*?)\]`, "gis");
  const values = [];

  for (const match of text.matchAll(pattern)) {
    const body = match[1] ?? "";
    const entryPattern = /"([^"]+)"|'([^']+)'|([^,\r\n]+)/g;
    for (const entry of body.matchAll(entryPattern)) {
      const normalized = normalizeConfigValue(entry[1] ?? entry[2] ?? entry[3] ?? "");
      if (normalized) {
        values.push(normalized);
      }
    }
  }

  return values;
}

function extractSectionListValues(text, key) {
  const values = [];
  const sectionPattern = new RegExp(`^[\\s]*["']?${escapeRegExp(key)}["']?\\s*:\\s*$`, "i");
  const nextKeyPattern = /^[\s]*["']?[A-Za-z0-9_-]+["']?\s*:/;
  let insideSection = false;

  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!insideSection) {
      if (sectionPattern.test(trimmed)) {
        insideSection = true;
      }
      continue;
    }

    if (!trimmed || trimmed === "[" || trimmed === "]" || trimmed === "{" || trimmed === "}") {
      continue;
    }

    if (nextKeyPattern.test(trimmed) && !trimmed.startsWith("-")) {
      break;
    }

    if (trimmed.startsWith("-")) {
      const normalized = normalizeConfigValue(trimmed.slice(1));
      if (normalized) {
        values.push(normalized);
      }
      continue;
    }

    if (trimmed.startsWith(",") || trimmed.startsWith("#")) {
      continue;
    }

    const normalized = normalizeConfigValue(trimmed);
    if (normalized) {
      values.push(normalized);
    }
  }

  return values;
}

function parseListenerPort(value) {
  const match = String(value ?? "").match(/:(\d+)\s*$/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function psQuote(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function defaultReadConfigFile(filePath) {
  if (!filePath) {
    return {
      exists: false,
      buffer: null,
      text: "",
      error: "No config path was provided."
    };
  }

  if (!existsSync(filePath)) {
    return {
      exists: false,
      buffer: null,
      text: "",
      error: null
    };
  }

  try {
    const buffer = readFileSync(filePath);
    return {
      exists: true,
      buffer,
      text: buffer.toString("utf8").replace(/^\uFEFF/, ""),
      error: null
    };
  } catch (error) {
    return {
      exists: true,
      buffer: null,
      text: "",
      error: error.message
    };
  }
}

function defaultPowerShellJsonExecutor(script, timeoutMs = 3000) {
  if (process.platform !== "win32") {
    return {
      ok: false,
      value: null,
      error: "Windows PowerShell diagnostics are only available on win32.",
      timedOut: false
    };
  }

  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs
  });

  if (result.error) {
    return {
      ok: false,
      value: null,
      error: result.error.message,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      timedOut: result.error.code === "ETIMEDOUT"
    };
  }

  const stdout = String(result.stdout ?? "").trim();
  if (result.status !== 0) {
    return {
      ok: false,
      value: null,
      error: String(result.stderr ?? "").trim() || `PowerShell exited with status ${result.status ?? "unknown"}.`,
      stdout,
      stderr: result.stderr ?? "",
      timedOut: false
    };
  }

  if (!stdout) {
    return {
      ok: true,
      value: null,
      error: null,
      stdout,
      stderr: result.stderr ?? "",
      timedOut: false
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(stdout),
      error: null,
      stdout,
      stderr: result.stderr ?? "",
      timedOut: false
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: `Failed to parse PowerShell JSON: ${error.message}`,
      stdout,
      stderr: result.stderr ?? "",
      timedOut: false
    };
  }
}

function defaultCtlExecutor(commandPath, args = []) {
  const result = spawnSync(commandPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 2500
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
    timedOut: result.error?.code === "ETIMEDOUT"
  };
}

function buildServiceScript() {
  return [
    "$service = Get-CimInstance Win32_Service -Filter \"Name='Yggdrasil'\" -ErrorAction SilentlyContinue",
    "if ($service) {",
    "  [pscustomobject]@{",
    "    available = $true",
    "    name = $service.Name",
    "    state = $service.State",
    "    startMode = $service.StartMode",
    "    pathName = $service.PathName",
    "    processId = $service.ProcessId",
    "  } | ConvertTo-Json -Depth 5 -Compress",
    "} else {",
    "  [pscustomobject]@{",
    "    available = $false",
    "    name = 'Yggdrasil'",
    "    state = $null",
    "    startMode = $null",
    "    pathName = $null",
    "    processId = $null",
    "  } | ConvertTo-Json -Depth 5 -Compress",
    "}"
  ].join("\n");
}

function buildIpv6AndProfileScript() {
  return [
    "[pscustomobject]@{",
    "  bindings = @(Get-NetAdapterBinding -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue | Select-Object Name, InterfaceDescription, Enabled)",
    "  profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object Name, InterfaceAlias, NetworkCategory, IPv4Connectivity, IPv6Connectivity)",
    "} | ConvertTo-Json -Depth 6 -Compress"
  ].join("\n");
}

function buildListenerScript(port) {
  return [
    `$listenerPort = ${port}`,
    "[pscustomobject]@{",
    "  listeners = @(Get-NetTCPConnection -State Listen -LocalPort $listenerPort -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, OwningProcess)",
    "} | ConvertTo-Json -Depth 5 -Compress"
  ].join("\n");
}

function buildFirewallScript(programPath) {
  return [
    `$program = '${psQuote(programPath)}'`,
    "$rules = @()",
    "Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -ErrorAction SilentlyContinue | ForEach-Object {",
    "  $rule = $_",
    "  $app = $rule | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue",
    "  if ($app -and $app.Program -and $app.Program -ieq $program) {",
    "    $rules += [pscustomobject]@{",
    "      displayName = $rule.DisplayName",
    "      action = \"$($rule.Action)\"",
    "      direction = \"$($rule.Direction)\"",
    "      profile = \"$($rule.Profile)\"",
    "      enabled = \"$($rule.Enabled)\"",
    "      program = $app.Program",
    "    }",
    "  }",
    "}",
    "[pscustomobject]@{ rules = @($rules) } | ConvertTo-Json -Depth 6 -Compress"
  ].join("\n");
}

function runCtlCommand(commandPath, subcommand, parser, executor) {
  try {
    const result = executor(commandPath, [subcommand]);
    if (!result.ok) {
      return createUnavailableSection(
        result.error?.message ?? (String(result.stderr ?? "").trim() || `${subcommand} exited with status ${result.status ?? "unknown"}.`),
        {
          timedOut: Boolean(result.timedOut),
          count: 0,
          items: []
        }
      );
    }

    return parser(result.stdout);
  } catch (error) {
    return createUnavailableSection(error.message, {
      timedOut: false,
      count: 0,
      items: []
    });
  }
}

export function detectUtf8Bom(value) {
  if (Buffer.isBuffer(value)) {
    return value.length >= 3 && value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf;
  }

  const text = String(value ?? "");
  return text.charCodeAt(0) === 0xfeff;
}

export function parseYggdrasilConfigDocument(text) {
  const listen = uniqueValues([
    ...extractSectionListValues(text, "Listen"),
    ...extractInlineArrayValues(text, "Listen")
  ]);
  const peers = uniqueValues([
    ...extractSectionListValues(text, "Peers"),
    ...extractInlineArrayValues(text, "Peers")
  ]);
  const listenerPorts = uniqueValues(listen.map(parseListenerPort).filter((value) => value !== null));

  return {
    listen,
    peers,
    listenerPorts,
    expectedStaticListener: EXPECTED_STATIC_LISTENER,
    expectedStaticPort: EXPECTED_STATIC_PORT,
    expectedListenerConfigured: listen.includes(EXPECTED_STATIC_LISTENER),
    staticPeerConfigured: peers.length > 0
  };
}

export function parseYggdrasilGetPathsOutput(output) {
  const rows = extractTableRows(output);
  if (rows.length === 0) {
    return createUnavailableSection("No paths output available.", {
      count: 0,
      items: []
    });
  }

  const [headerRow, ...valueRows] = rows;
  const items = valueRows
    .filter((row) => row.length === headerRow.length)
    .map((row) => Object.fromEntries(headerRow.map((key, index) => [key, row[index] || null])));

  return {
    available: true,
    count: items.length,
    items
  };
}

export function summarizeNodeFirewallRules(rules = [], nodePath = process.execPath) {
  const items = toArray(rules).map((rule) => ({
    displayName: rule.displayName ?? null,
    action: String(rule.action ?? "").trim(),
    direction: String(rule.direction ?? "").trim(),
    profile: String(rule.profile ?? "").trim(),
    enabled: String(rule.enabled ?? "").trim(),
    program: rule.program ?? nodePath
  }));
  const allowRules = items.filter((rule) => rule.action.toLowerCase() === "allow");
  const blockRules = items.filter((rule) => rule.action.toLowerCase() === "block");
  const inboundAllowRules = allowRules.filter((rule) => rule.direction.toLowerCase() === "inbound");
  const inboundBlockRules = blockRules.filter((rule) => rule.direction.toLowerCase() === "inbound");
  const publicAllowRules = inboundAllowRules.filter((rule) => /public|any/i.test(rule.profile));
  const publicBlockRules = inboundBlockRules.filter((rule) => /public|any/i.test(rule.profile));

  return {
    available: true,
    nodePath,
    ruleCount: items.length,
    allowRuleCount: allowRules.length,
    blockRuleCount: blockRules.length,
    inboundAllowRuleCount: inboundAllowRules.length,
    inboundBlockRuleCount: inboundBlockRules.length,
    publicAllowRuleCount: publicAllowRules.length,
    publicBlockRuleCount: publicBlockRules.length,
    hasConflict: allowRules.length > 0 && blockRules.length > 0,
    hasPublicInboundBlockConflict: publicBlockRules.length > 0,
    items
  };
}

function normalizeNetworkCategory(value) {
  if (value === 0 || value === "0") {
    return "Public";
  }
  if (value === 1 || value === "1") {
    return "Private";
  }
  if (value === 2 || value === "2") {
    return "DomainAuthenticated";
  }
  return value ?? null;
}

function summarizeIpv6State(ipv6Section = {}, tunInterface = null) {
  const bindings = toArray(ipv6Section.bindings).map((entry) => ({
    name: entry.Name ?? entry.name ?? null,
    interfaceDescription: entry.InterfaceDescription ?? entry.interfaceDescription ?? null,
    enabled: toBoolean(entry.Enabled ?? entry.enabled)
  }));
  const profiles = toArray(ipv6Section.profiles).map((entry) => ({
    name: entry.Name ?? entry.name ?? null,
    interfaceAlias: entry.InterfaceAlias ?? entry.interfaceAlias ?? null,
    networkCategory: normalizeNetworkCategory(entry.NetworkCategory ?? entry.networkCategory ?? null),
    ipv4Connectivity: entry.IPv4Connectivity ?? entry.ipv4Connectivity ?? null,
    ipv6Connectivity: entry.IPv6Connectivity ?? entry.ipv6Connectivity ?? null
  }));
  const enabledBindings = bindings.filter((entry) => entry.enabled);
  const wifiIpv6Disabled = bindings.filter(
    (entry) => !entry.enabled && /wi-?fi|wireless/i.test(`${entry.name ?? ""} ${entry.interfaceDescription ?? ""}`)
  );
  const yggdrasilProfiles = profiles.filter((entry) => {
    const haystack = `${entry.name ?? ""} ${entry.interfaceAlias ?? ""}`;
    if (tunInterface) {
      return haystack.toLowerCase().includes(String(tunInterface).toLowerCase());
    }
    return /yggdrasil/i.test(haystack);
  });

  return {
    available: bindings.length > 0 || profiles.length > 0,
    bindings,
    profiles,
    enabledBindingCount: enabledBindings.length,
    ipv6EnabledSomewhere: enabledBindings.length > 0,
    wifiIpv6Disabled,
    yggdrasilProfiles,
    yggdrasilPublicProfile: yggdrasilProfiles.some(
      (entry) => String(entry.networkCategory ?? "").toLowerCase() === "public"
    )
  };
}

function summarizeListenerState(configSection, listenerSection = {}, serviceSection = {}) {
  const activeListeners = toArray(listenerSection.listeners).map((entry) => ({
    localAddress: entry.LocalAddress ?? entry.localAddress ?? null,
    localPort: parseNumber(entry.LocalPort ?? entry.localPort),
    owningProcess: parseNumber(entry.OwningProcess ?? entry.owningProcess)
  }));
  const targetPorts = configSection.listenerPorts.length > 0 ? configSection.listenerPorts : [EXPECTED_STATIC_PORT];

  return {
    available: true,
    expectedStaticListener: EXPECTED_STATIC_LISTENER,
    expectedStaticPort: EXPECTED_STATIC_PORT,
    configuredListeners: configSection.listen,
    activeListeners,
    expectedListenerConfigured: configSection.expectedListenerConfigured,
    listenerActive: activeListeners.length > 0,
    activeOnConfiguredPort: activeListeners.some((entry) => targetPorts.includes(entry.localPort)),
    serviceState: serviceSection.state ?? null
  };
}

function buildRemoteHealthSummary(remoteUrl, timeoutMs, healthProbe) {
  if (!remoteUrl) {
    return {
      diagnosticsOnly: true,
      transportDeliveryEnabled: false,
      messageDeliveryAttempted: false,
      probeAttempted: false,
      remoteUrl: null,
      note: "No remoteUrl was provided for remote HTTP availability diagnostics."
    };
  }

  return healthProbe({
    remoteUrl,
    timeoutMs
  });
}

function addStep(steps, message) {
  if (message && !steps.includes(message)) {
    steps.push(message);
  }
}

function collectRemediationSteps({
  config,
  ipv6,
  listener,
  firewall,
  node,
  remoteHealth
}) {
  const steps = [];

  if (!config.exists) {
    addStep(
      steps,
      `Create ${config.path} and keep it at the default Windows Yggdrasil location before running delivery validation.`
    );
  }
  if (config.utf8BomDetected) {
    addStep(steps, "Re-save yggdrasil.conf as UTF-8 without BOM. Windows editors may add a BOM that Yggdrasil rejects.");
  }
  if (!config.expectedListenerConfigured) {
    addStep(steps, "Add `Listen: - tls://0.0.0.0:12345` so the Windows host accepts the validated static inbound listener.");
  }
  if (!config.staticPeerConfigured) {
    addStep(steps, "Add at least one static peer entry such as `tls://<IPv4>:12345` for the two-host Windows deployment.");
  }
  if (!ipv6.ipv6EnabledSomewhere || ipv6.wifiIpv6Disabled.length > 0) {
    addStep(steps, "Enable IPv6 on the Wi-Fi or Ethernet adapter that carries the Yggdrasil underlay before bundle delivery tests.");
  }
  if (!listener.activeOnConfiguredPort) {
    addStep(steps, "Verify the Yggdrasil service is running and actually listening on port 12345 after the listener configuration is applied.");
  }
  if ((node.peers?.count ?? 0) === 0) {
    addStep(steps, "If static peers are configured but peer count is zero, verify both hosts can reach each other over IPv4 on port 12345.");
  }
  if ((node.sessions?.count ?? 0) === 0) {
    addStep(steps, "If peers are visible but sessions remain zero, verify both Yggdrasil services are running and the mesh session has converged.");
  }
  if ((node.paths?.count ?? 0) === 0) {
    addStep(steps, "Use `yggdrasilctl getpaths` to confirm route propagation before attempting controlled bundle delivery.");
  }
  if (firewall.hasPublicInboundBlockConflict) {
    addStep(
      steps,
      "Disable the conflicting inbound Public block rules for node.exe or add an explicit Public allow rule. The Yggdrasil interface commonly lands in the Public profile on Windows."
    );
  } else if (firewall.hasConflict) {
    addStep(steps, "Review the enabled Allow and Block firewall rule pairs for node.exe so inbound HTTP is not shadow-blocked.");
  }
  if (remoteHealth?.remoteUrl && remoteHealth.probeAttempted && !remoteHealth.ok) {
    addStep(steps, "Ensure the receiver agent is bound to `::`, reachable on the Yggdrasil IPv6 address, and not blocked by Windows Firewall before rerunning the health probe.");
  }
  if (remoteHealth?.remoteUrl && !remoteHealth.probeAttempted && remoteHealth.error) {
    addStep(steps, "Use a bracketed IPv6 Yggdrasil-style remoteUrl such as `http://[200:db8::1]:8788` for diagnostics-only remote health checks.");
  }

  return steps;
}

export async function describeYggdrasilDoctor(
  options = {},
  {
    environmentDescribe = describeYggdrasilEnvironment,
    nodeDescribe = describeYggdrasilLocalNode,
    healthProbe = probeYggdrasilHealth,
    readConfigFile = defaultReadConfigFile,
    powerShellJsonExecutor = defaultPowerShellJsonExecutor,
    ctlExecutor = defaultCtlExecutor
  } = {}
) {
  const configPath = options.configPath ?? (process.platform === "win32" ? DEFAULT_WINDOWS_CONFIG_PATH : null);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 3000;
  const localTimeoutMs = Math.max(timeoutMs, 30000);
  const environment = environmentDescribe();
  const node = nodeDescribe({}, { ctlExecutor });
  const configFile = readConfigFile(configPath);
  const parsedConfig = configFile.text ? parseYggdrasilConfigDocument(configFile.text) : parseYggdrasilConfigDocument("");

  const config = {
    path: configPath,
    exists: configFile.exists,
    readError: configFile.error,
    utf8BomDetected: detectUtf8Bom(configFile.buffer ?? configFile.text ?? ""),
    listen: parsedConfig.listen,
    peers: parsedConfig.peers,
    listenerPorts: parsedConfig.listenerPorts,
    expectedListenerConfigured: parsedConfig.expectedListenerConfigured,
    staticPeerConfigured: parsedConfig.staticPeerConfigured,
    expectedStaticListener: parsedConfig.expectedStaticListener,
    expectedStaticPort: parsedConfig.expectedStaticPort
  };

  const serviceResult = powerShellJsonExecutor(buildServiceScript(), localTimeoutMs);
  const ipv6Result = powerShellJsonExecutor(buildIpv6AndProfileScript(), localTimeoutMs);
  const listenerResult = powerShellJsonExecutor(
    buildListenerScript(parsedConfig.listenerPorts[0] ?? EXPECTED_STATIC_PORT),
    localTimeoutMs
  );
  const firewallResult = powerShellJsonExecutor(buildFirewallScript(process.execPath), localTimeoutMs);

  const service = serviceResult.ok
    ? serviceResult.value ?? createUnavailableSection("Yggdrasil service information is unavailable.")
    : createUnavailableSection(serviceResult.error ?? "Yggdrasil service information is unavailable.");
  const ipv6 = summarizeIpv6State(
    ipv6Result.ok ? ipv6Result.value ?? {} : {},
    node.tun?.interface ?? null
  );
  if (!ipv6Result.ok) {
    ipv6.error = ipv6Result.error ?? "IPv6 binding diagnostics are unavailable.";
  }

  const listener = summarizeListenerState(
    parsedConfig,
    listenerResult.ok ? listenerResult.value ?? {} : {},
    service
  );
  if (!listenerResult.ok) {
    listener.error = listenerResult.error ?? "Listener diagnostics are unavailable.";
  }

  const firewall = firewallResult.ok
    ? summarizeNodeFirewallRules(firewallResult.value?.rules ?? [], process.execPath)
    : {
        ...summarizeNodeFirewallRules([], process.execPath),
        available: false,
        error: firewallResult.error ?? "Firewall diagnostics are unavailable."
      };

  let paths = createUnavailableSection("yggdrasilctl is not available.", {
    count: 0,
    items: []
  });
  if (node.yggdrasilctlAvailable) {
    const commandPath = node.commandPath ?? environment.commands?.yggdrasilctl?.locations?.[0] ?? "yggdrasilctl";
    if (Array.isArray(node.supportedCommands) && node.supportedCommands.length > 0 && !node.supportedCommands.includes("getpaths")) {
      paths = createUnavailableSection("yggdrasilctl getpaths is not supported by this local installation.", {
        count: 0,
        items: []
      });
    } else {
      paths = runCtlCommand(commandPath, "getpaths", parseYggdrasilGetPathsOutput, ctlExecutor);
    }
  }

  const remoteHealth = await buildRemoteHealthSummary(options.remoteUrl ?? null, timeoutMs, healthProbe);

  const nodeSummary = {
    commandPath: node.commandPath ?? null,
    yggdrasilctlAvailable: node.yggdrasilctlAvailable,
    supportedCommands: node.supportedCommands ?? [],
    self: node.self,
    peers: node.peers,
    sessions: node.sessions,
    tun: node.tun,
    paths
  };

  const remediationSteps = collectRemediationSteps({
    config,
    ipv6,
    listener,
    firewall,
    node: nodeSummary,
    remoteHealth
  });

  return {
    diagnosticsOnly: true,
    readinessOnly: false,
    transportDeliveryEnabled: false,
    messageDeliveryEnabled: false,
    bundleDeliveryAttempted: false,
    serviceControlAttempted: false,
    configMutationAttempted: false,
    peerMutationAttempted: false,
    routingMutationAttempted: false,
    networkProbeAttempted: Boolean(remoteHealth?.probeAttempted),
    remoteUrl: options.remoteUrl ?? null,
    host: {
      platform: environment.platform,
      arch: environment.arch,
      node: environment.node
    },
    environment,
    config,
    service,
    ipv6,
    listener,
    firewall,
    node: nodeSummary,
    remoteHealth,
    remediationSteps,
    note: "Stage 5 Windows Yggdrasil doctor. Diagnostics-only validation, with an optional controlled GET /health probe when remoteUrl is provided. No bundle delivery, peer management, routing changes, or service control were attempted."
  };
}