import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function getKnownCommandLocations(commandName) {
  if (process.platform !== "win32") {
    return [];
  }

  const fileName = `${commandName}.exe`;
  return [
    `C:\\Program Files\\Yggdrasil\\${fileName}`,
    `C:\\Program Files (x86)\\Yggdrasil\\${fileName}`
  ];
}

function getLookupCommand() {
  return process.platform === "win32"
    ? { command: "where.exe", args: [] }
    : { command: "which", args: [] };
}

function defaultLookupExecutor(commandName) {
  const lookup = getLookupCommand();
  const result = spawnSync(lookup.command, [...lookup.args, commandName], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
    lookupCommand: lookup.command
  };
}

function normalizeCommandDetection(commandName, result) {
  const locations = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    command: commandName,
    commandLookupAttempted: true,
    lookupCommand: result.lookupCommand ?? getLookupCommand().command,
    available: Boolean(result.ok),
    locations,
    error: result.error ? result.error.message : null,
    skipKnownLocations: Boolean(result.skipKnownLocations)
  };
}

function resolveKnownCommandLocation(commandName) {
  for (const location of getKnownCommandLocations(commandName)) {
    if (existsSync(location)) {
      return location;
    }
  }

  return null;
}

export function detectCommandAvailability(commandName, lookupExecutor = defaultLookupExecutor) {
  try {
    const normalized = normalizeCommandDetection(commandName, lookupExecutor(commandName));
    if (normalized.available) {
      const { skipKnownLocations, ...visibleResult } = normalized;
      return visibleResult;
    }
    if (normalized.skipKnownLocations) {
      const { skipKnownLocations, ...visibleResult } = normalized;
      return visibleResult;
    }

    const fallbackLocation = resolveKnownCommandLocation(commandName);
    if (!fallbackLocation) {
      const { skipKnownLocations, ...visibleResult } = normalized;
      return visibleResult;
    }

    const { skipKnownLocations, ...visibleResult } = normalized;
    return {
      ...visibleResult,
      available: true,
      locations: [fallbackLocation]
    };
  } catch (error) {
    const fallbackLocation = resolveKnownCommandLocation(commandName);
    return {
      command: commandName,
      commandLookupAttempted: true,
      lookupCommand: getLookupCommand().command,
      available: Boolean(fallbackLocation),
      locations: fallbackLocation ? [fallbackLocation] : [],
      error: error.message
    };
  }
}

export function detectYggdrasilCommandAvailability(lookupExecutor = defaultLookupExecutor) {
  return detectCommandAvailability("yggdrasil", lookupExecutor);
}

export function detectYggdrasilCtlAvailability(lookupExecutor = defaultLookupExecutor) {
  return detectCommandAvailability("yggdrasilctl", lookupExecutor);
}

export function describeYggdrasilEnvironment(lookupExecutor = defaultLookupExecutor) {
  const yggdrasil = detectYggdrasilCommandAvailability(lookupExecutor);
  const yggdrasilctl = detectYggdrasilCtlAvailability(lookupExecutor);

  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    checks: {
      commandLookupAttempted: yggdrasil.commandLookupAttempted || yggdrasilctl.commandLookupAttempted,
      yggdrasilAvailable: yggdrasil.available,
      yggdrasilctlAvailable: yggdrasilctl.available,
      lookupCommand: yggdrasil.lookupCommand
    },
    commands: {
      yggdrasil,
      yggdrasilctl
    },
    readinessOnly: true,
    connectivityChecked: false,
    serviceControlAttempted: false,
    note: "Local diagnostics only. No Yggdrasil service control, network calls, or transport delivery were attempted."
  };
}
