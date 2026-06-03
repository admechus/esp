import { isIP } from "node:net";
import { spawnSync } from "node:child_process";

import { describeYggdrasilRemoteUrl, isLikelyYggdrasilIpv6Address } from "./yggdrasilAddress.js";
import { describeYggdrasilEnvironment } from "./yggdrasilEnvironment.js";

function toAddressCandidate(address) {
  return {
    address,
    likelyYggdrasil: isLikelyYggdrasilIpv6Address(address)
  };
}

function extractIpv6StringsFromValue(value, bucket) {
  if (typeof value === "string") {
    if (isIP(value) === 6) {
      bucket.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractIpv6StringsFromValue(item, bucket);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const nestedValue of Object.values(value)) {
      extractIpv6StringsFromValue(nestedValue, bucket);
    }
  }
}

function tokenizeIpv6Candidates(text) {
  const matches = String(text ?? "").match(/[\[\]A-Fa-f0-9:]{2,}/g) ?? [];
  const bucket = new Set();

  for (const match of matches) {
    const normalized = match.replace(/^\[|\]$/g, "");
    if (isIP(normalized) === 6) {
      bucket.add(normalized);
    }
  }

  return [...bucket];
}

export function parseYggdrasilAddressCandidates(output) {
  const text = String(output ?? "");
  const candidates = tokenizeIpv6Candidates(text).map(toAddressCandidate);
  return candidates;
}

export function parseYggdrasilctlGetSelfOutput(output) {
  const text = String(output ?? "").trim();
  if (!text) {
    return {
      format: "empty",
      addressCandidates: []
    };
  }

  try {
    const parsed = JSON.parse(text);
    const bucket = new Set();
    extractIpv6StringsFromValue(parsed, bucket);
    return {
      format: "json",
      addressCandidates: [...bucket].map(toAddressCandidate)
    };
  } catch {
    return {
      format: "text",
      addressCandidates: parseYggdrasilAddressCandidates(text)
    };
  }
}

function defaultYggdrasilCtlExecutor(commandPath, args = ["getSelf"]) {
  const result = spawnSync(commandPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 1500
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

export function describeYggdrasilConnectivity(
  options = {},
  {
    lookupExecutor,
    ctlExecutor = defaultYggdrasilCtlExecutor
  } = {}
) {
  const environment = describeYggdrasilEnvironment(lookupExecutor);
  const remoteUrlReadiness = describeYggdrasilRemoteUrl(options.remoteUrl ?? null);

  const local = {
    yggdrasilAvailable: environment.checks.yggdrasilAvailable,
    yggdrasilctlAvailable: environment.checks.yggdrasilctlAvailable,
    commandLookupAttempted: environment.checks.commandLookupAttempted,
    selfInspectionAttempted: false,
    selfInspectionSucceeded: false,
    inspectionCommand: null,
    inspectionError: null,
    inspectionTimedOut: false,
    inspectionFormat: null,
    addressCandidates: []
  };

  if (environment.checks.yggdrasilctlAvailable && options.inspectSelf !== false) {
    local.selfInspectionAttempted = true;
    local.inspectionCommand = "yggdrasilctl getSelf";

    try {
      const commandPath = environment.commands?.yggdrasilctl?.locations?.[0] ?? "yggdrasilctl";
      const inspection = ctlExecutor(commandPath, ["getSelf"]);
      const parsed = parseYggdrasilctlGetSelfOutput(inspection.stdout);
      local.selfInspectionSucceeded = Boolean(inspection.ok);
      local.inspectionTimedOut = Boolean(inspection.timedOut);
      local.inspectionFormat = parsed.format;
      local.addressCandidates = parsed.addressCandidates;
      local.inspectionError =
        inspection.error?.message ??
        (inspection.ok ? null : String(inspection.stderr ?? "").trim() || `yggdrasilctl exited with status ${inspection.status ?? "unknown"}`);
    } catch (error) {
      local.inspectionError = error.message;
    }
  }

  return {
    platform: environment.platform,
    arch: environment.arch,
    node: environment.node,
    readinessOnly: false,
    diagnosticsOnly: true,
    messageDeliveryEnabled: false,
    serviceControlAttempted: false,
    configMutationAttempted: false,
    remoteUrl: options.remoteUrl ?? null,
    remoteUrlReadiness,
    local,
    connectivity: {
      networkProbeAttempted: false,
      httpHealthProbeAttempted: false,
      messageDeliveryAttempted: false
    },
    note: "Diagnostics-only Yggdrasil connectivity readiness. No message delivery or service control was attempted."
  };
}
