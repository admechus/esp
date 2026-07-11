import { spawnSync } from "node:child_process";

import { detectYggdrasilCtlAvailability } from "./yggdrasilEnvironment.js";

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

  const normalized = String(value).replace(/,/g, "");
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function createUnavailableSection(error = null) {
  return {
    available: false,
    error
  };
}

function createTableCollection(items) {
  return {
    available: true,
    count: items.length,
    items
  };
}

export function parseYggdrasilGetSelfOutput(output) {
  const rows = extractTableRows(output);
  if (rows.length === 0) {
    return {
      available: false,
      error: "No self output available."
    };
  }

  const values = Object.fromEntries(
    rows
      .filter((row) => row.length >= 2)
      .map(([key, value]) => [key.replace(/:$/, ""), value])
  );

  return {
    available: true,
    buildName: values["Build name"] ?? null,
    buildVersion: values["Build version"] ?? null,
    ipv6Address: values["IPv6 address"] ?? null,
    ipv6Subnet: values["IPv6 subnet"] ?? null,
    routingTableSize: parseNumber(values["Routing table size"]),
    publicKey: values["Public key"] ?? null
  };
}

export function parseYggdrasilGetPeersOutput(output) {
  const rows = extractTableRows(output);
  if (rows.length === 0) {
    return createUnavailableSection("No peers output available.");
  }

  const [headerRow, ...valueRows] = rows;
  const items = valueRows
    .filter((row) => row.length === headerRow.length)
    .map((row) => Object.fromEntries(headerRow.map((key, index) => [key, row[index] || null])));

  return createTableCollection(items);
}

export function parseYggdrasilGetSessionsOutput(output) {
  const rows = extractTableRows(output);
  if (rows.length === 0) {
    return createUnavailableSection("No sessions output available.");
  }

  const [headerRow, ...valueRows] = rows;
  const items = valueRows
    .filter((row) => row.length === headerRow.length)
    .map((row) => Object.fromEntries(headerRow.map((key, index) => [key, row[index] || null])));

  return createTableCollection(items);
}

export function parseYggdrasilGetTunOutput(output) {
  const rows = extractTableRows(output);
  if (rows.length === 0) {
    return createUnavailableSection("No TUN output available.");
  }

  const values = Object.fromEntries(
    rows
      .filter((row) => row.length >= 2)
      .map(([key, value]) => [key.replace(/:$/, ""), value])
  );

  return {
    available: true,
    interface: values["Interface name"] ?? null,
    mtu: parseNumber(values["Interface MTU"]),
    tunEnabled: values["TUN enabled"] === "true",
    localSummary: rows.map((row) => row.join(" = "))
  };
}

export function parseYggdrasilCommandListOutput(output) {
  const rows = extractTableRows(output);
  if (rows.length === 0) {
    return [];
  }

  const [, ...valueRows] = rows;
  return valueRows
    .map((row) => row[0] ?? null)
    .filter(Boolean)
    .map((value) => value.toLowerCase());
}

function defaultYggdrasilCtlExecutor(commandPath, args = []) {
  const result = spawnSync(commandPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 2000
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

function runIntrospectionCommand(commandPath, subcommand, parser, executor) {
  try {
    const result = executor(commandPath, [subcommand]);
    if (!result.ok) {
      const stderrText = String(result.stderr ?? "").trim();
      const failureMessage =
        result.error?.message ?? (stderrText || `${subcommand} exited with status ${result.status ?? "unknown"}`);
      return {
        parsed: createUnavailableSection(failureMessage),
        error: result.error?.message ?? null,
        timedOut: Boolean(result.timedOut)
      };
    }

    return {
      parsed: parser(result.stdout),
      error: null,
      timedOut: Boolean(result.timedOut)
    };
  } catch (error) {
    return {
      parsed: createUnavailableSection(error.message),
      error: error.message,
      timedOut: false
    };
  }
}

export function describeYggdrasilLocalNode(
  options = {},
  {
    lookupExecutor,
    ctlExecutor = defaultYggdrasilCtlExecutor
  } = {}
) {
  const commandAvailability = detectYggdrasilCtlAvailability(lookupExecutor);
  const commandPath = commandAvailability.locations?.[0] ?? "yggdrasilctl";
  const response = {
    diagnosticsOnly: true,
    messageDeliveryEnabled: false,
    serviceControlAttempted: false,
    configMutationAttempted: false,
    networkProbeAttempted: false,
    commandLookupAttempted: commandAvailability.commandLookupAttempted,
    yggdrasilctlAvailable: commandAvailability.available,
    commandPath: commandAvailability.available ? commandPath : null,
    self: createUnavailableSection("yggdrasilctl is not available."),
    peers: createUnavailableSection("yggdrasilctl is not available."),
    sessions: createUnavailableSection("yggdrasilctl is not available."),
    tun: createUnavailableSection("yggdrasilctl is not available."),
    supportedCommands: []
  };

  if (!commandAvailability.available) {
    return response;
  }

  const listResult = runIntrospectionCommand(commandPath, "list", parseYggdrasilCommandListOutput, ctlExecutor);
  const selfResult = runIntrospectionCommand(commandPath, "getself", parseYggdrasilGetSelfOutput, ctlExecutor);
  const peersResult = runIntrospectionCommand(commandPath, "getpeers", parseYggdrasilGetPeersOutput, ctlExecutor);
  const sessionsResult = runIntrospectionCommand(commandPath, "getsessions", parseYggdrasilGetSessionsOutput, ctlExecutor);
  const tunResult = runIntrospectionCommand(commandPath, "gettun", parseYggdrasilGetTunOutput, ctlExecutor);

  response.supportedCommands = Array.isArray(listResult.parsed) ? listResult.parsed : [];
  response.self = selfResult.parsed;
  response.peers = peersResult.parsed;
  response.sessions = sessionsResult.parsed;
  response.tun = tunResult.parsed;

  return response;
}
