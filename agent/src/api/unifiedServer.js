import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLanPresenceListener,
  DEFAULT_LAN_PRESENCE_EXPIRY_MS,
  DEFAULT_LAN_PRESENCE_PORT
} from "../network/lanPresence.js";
import { describePlatformGpio, getPlatformProfileById } from "../platform/platformProfiles.js";
import { createRequest } from "../protocol/commands.js";
import { createAgentApiServer } from "./server.js";
import { createRelayApiServer } from "./relayServer.js";
import { createAgentRuntime } from "../runtime/agentRuntime.js";
import { createDiscoveryCacheStore } from "../storage/discoveryCacheStore.js";
import { createLifecyclePlanStore } from "../storage/lifecyclePlanStore.js";
import { createHardwareActivityStore } from "../storage/hardwareActivityStore.js";
import { createRelayQueueStore } from "../storage/relayQueueStore.js";
import { createRoleBindingStore } from "../storage/roleBindingStore.js";
import { discoverWindowsEspPorts } from "../transport/windowsComDiscovery.js";
import { createWindowsSerialJsonTransport } from "../transport/windowsSerialJsonTransport.js";

const UI_FILES = {
  "/": {
    file: new URL("../../unified-ui/index.html", import.meta.url),
    contentType: "text/html; charset=utf-8"
  },
  "/ui/app.css": {
    file: new URL("../../unified-ui/app.css", import.meta.url),
    contentType: "text/css; charset=utf-8"
  },
  "/ui/app.js": {
    file: new URL("../../unified-ui/app.js", import.meta.url),
    contentType: "application/javascript; charset=utf-8"
  }
};

const DEFAULT_SHELL_STATE_DIR = fileURLToPath(new URL("../../state-shell", import.meta.url));

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function sendFile(response, pathname) {
  const entry = UI_FILES[pathname];
  if (!entry) {
    return false;
  }

  const contents = await readFile(entry.file);
  response.writeHead(200, {
    "Content-Type": entry.contentType,
    "Cache-Control": "no-store"
  });
  response.end(contents);
  return true;
}

function normalizePath(pathname) {
  return pathname.replace(/\/+$/g, "") || "/";
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function normalizeBaseUrl(url) {
  return String(url ?? "").replace(/\/+$/g, "");
}

function buildRoleServiceConfig({
  host,
  role,
  agentName,
  port,
  listenPort,
  stateDir,
  remoteUrl,
  targetAgent,
  syncIntervalMs = 15000
}) {
  return {
    role,
    agentName,
    deviceOptions: {
      port,
      agentName,
      stateDir,
      remoteUrl,
      targetAgent,
      syncIntervalMs
    },
    baseUrl: normalizeBaseUrl(`http://${host}:${listenPort}`),
    listenPort,
    stateDir
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  }
  return payload;
}

async function gatherServiceStatus(label, baseUrl) {
  try {
    const [health, state] = await Promise.all([
      fetchJson(`${baseUrl}/health`),
      fetchJson(`${baseUrl}/app/state`)
    ]);

    return {
      ok: true,
      label,
      baseUrl,
      health,
      state
    };
  } catch (error) {
    return {
      ok: false,
      label,
      baseUrl,
      error: error.message
    };
  }
}

async function readDirectDeviceInfo(transportPort) {
  if (!transportPort || !String(transportPort).startsWith("COM")) {
    return null;
  }

  try {
    const transport = createWindowsSerialJsonTransport({
      port: transportPort,
      baudRate: 115200
    });
    const response = await transport.send(createRequest("GET_INFO", {}));
    if (!response?.ok) {
      return null;
    }

    return {
      device: response.device ?? "unknown-device",
      chip: response.chip ?? "unknown-chip",
      role: response.role ?? "unknown",
      profile: response.profile ?? null,
      version: response.version ?? null,
      transport: response.transport ?? null,
      algorithm: response.algorithm ?? null,
      capabilities: Array.isArray(response.capabilities)
        ? response.capabilities
        : String(response.capabilities ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
    };
  } catch {
    return null;
  }
}

async function readDirectPlatformIo(transportPort) {
  if (!transportPort || !String(transportPort).startsWith("COM")) {
    return null;
  }

  try {
    const transport = createWindowsSerialJsonTransport({
      port: transportPort,
      baudRate: 115200
    });
    const response = await transport.send(createRequest("GET_PLATFORM_IO", {}));
    if (!response?.ok) {
      return null;
    }

    return {
      device: response.device ?? "unknown-device",
      chip: response.chip ?? "unknown-chip",
      profile: response.profile ?? null,
      transport: response.transport ?? null,
      outputs: Array.isArray(response.outputs) ? response.outputs : [],
      gpio: {
        pinCount: response.gpio?.pinCount ?? null,
        inputRange: response.gpio?.inputRange ?? "unknown",
        outputRange: response.gpio?.outputRange ?? "unknown",
        liveProbeSupported: Boolean(response.gpio?.liveProbeSupported),
        probeStatus: response.gpio?.probeStatus ?? "unknown",
        attachmentStatus: response.gpio?.attachmentStatus ?? "unknown",
        observedConnections: Array.isArray(response.gpio?.observedConnections)
          ? response.gpio.observedConnections
          : []
      },
      hardwareProfile: response.hardwareProfile ?? null
    };
  } catch {
    return null;
  }
}

async function buildRoleMap({ mode, senderStatus, receiverStatus, relayStatus, sender, receiver, relay, discoveredPorts = [] }) {
  async function buildHardwareDescriptor(status, fallbackTransport, fallbackProfileId = null) {
    const deviceInfo =
      status.state?.deviceInfo ??
      status.health?.deviceInfo ??
      (await readDirectDeviceInfo(fallbackTransport));
    const platformIo =
      status.state?.platformIo ??
      status.health?.platformIo ??
      (await readDirectPlatformIo(fallbackTransport));
    const profileId = deviceInfo?.profile ?? fallbackProfileId ?? null;
    const profile = getPlatformProfileById(profileId);
    const baseGpioPlatform = describePlatformGpio({
      profileId,
      chip: deviceInfo?.chip ?? null,
      device: deviceInfo?.device ?? null
    });
    const gpioPlatform = {
      ...baseGpioPlatform,
      pinCount: platformIo?.gpio?.pinCount ?? baseGpioPlatform.pinCount,
      inputRange: platformIo?.gpio?.inputRange ?? baseGpioPlatform.inputRange,
      outputRange: platformIo?.gpio?.outputRange ?? baseGpioPlatform.outputRange,
      liveProbeSupported: platformIo?.gpio?.liveProbeSupported ?? baseGpioPlatform.liveProbeSupported,
      probeStatus: platformIo?.gpio?.probeStatus ?? baseGpioPlatform.probeStatus,
      observedConnections: platformIo?.gpio?.observedConnections ?? baseGpioPlatform.observedConnections,
      connectionStatus: platformIo?.gpio?.attachmentStatus ?? baseGpioPlatform.connectionStatus,
      attachmentStatus: platformIo?.gpio?.attachmentStatus ?? null
    };

    return {
      device: deviceInfo?.device ?? null,
      chip: deviceInfo?.chip ?? null,
      profileId,
      profileLabel: profile?.label ?? profileId ?? null,
      capabilities: deviceInfo?.capabilities ?? [],
      outputs: Array.isArray(platformIo?.outputs) ? platformIo.outputs : [],
      hardwareProfile: platformIo?.hardwareProfile ?? null,
      gpioPlatform: {
        ...gpioPlatform,
        transport: deviceInfo?.transport ?? fallbackTransport ?? null
      },
      deviceInfoCached: Boolean(status.state?.deviceInfoCached ?? status.health?.deviceInfoCached),
      deviceInfoError: status.state?.deviceInfoError ?? status.health?.deviceInfoError ?? null,
      platformIoCached: Boolean(status.state?.platformIoCached ?? status.health?.platformIoCached),
      platformIoError: status.state?.platformIoError ?? status.health?.platformIoError ?? null
    };
  }

  const senderHardware = await buildHardwareDescriptor(
    senderStatus,
    sender.deviceOptions?.port ?? senderStatus.health?.transport,
    "identity-token"
  );
  const receiverHardware = await buildHardwareDescriptor(
    receiverStatus,
    receiver.deviceOptions?.port ?? receiverStatus.health?.transport,
    "host-attached-node"
  );

  const roleEntries = [
    {
      id: "sender",
      kind: "agent",
      role: sender.agentName,
      managed: true,
      mode: sender.embedded ? "embedded" : mode,
      ok: senderStatus.ok,
      baseUrl: senderStatus.baseUrl,
      transport: senderStatus.health?.transport ?? sender.deviceOptions?.port ?? null,
      identityKeyId: senderStatus.state?.identity?.keyId ?? null,
      remoteUrl: senderStatus.health?.remoteUrl ?? sender.deviceOptions?.remoteUrl ?? null,
      targetAgent: senderStatus.health?.targetAgent ?? sender.deviceOptions?.targetAgent ?? null,
      stateDir: senderStatus.health?.agent?.stateDir ?? sender.stateDir ?? null,
      sync: senderStatus.health?.transportSync ?? null,
      hardware: senderHardware
    },
    {
      id: "receiver",
      kind: "agent",
      role: receiver.agentName,
      managed: true,
      mode: receiver.embedded ? "embedded" : mode,
      ok: receiverStatus.ok,
      baseUrl: receiverStatus.baseUrl,
      transport: receiverStatus.health?.transport ?? receiver.deviceOptions?.port ?? null,
      identityKeyId: receiverStatus.state?.identity?.keyId ?? null,
      remoteUrl: receiverStatus.health?.remoteUrl ?? receiver.deviceOptions?.remoteUrl ?? null,
      targetAgent: receiverStatus.health?.targetAgent ?? receiver.deviceOptions?.targetAgent ?? null,
      stateDir: receiverStatus.health?.agent?.stateDir ?? receiver.stateDir ?? null,
      sync: receiverStatus.health?.transportSync ?? null,
      hardware: receiverHardware
    },
    {
      id: "relay",
      kind: "relay",
      role: relay.relayName,
      managed: true,
      mode: relay.embedded ? "embedded" : mode,
      ok: relayStatus.ok,
      baseUrl: relayStatus.baseUrl,
      transport: "http",
      identityKeyId: null,
      remoteUrl: null,
      targetAgent: null,
      stateDir: relayStatus.health?.relay?.stateDir ?? relay.stateDir ?? null,
      routes: relayStatus.state?.relay?.routes ?? relayStatus.health?.relay?.routes ?? [],
      hardware: null
    }
  ];

  const knownManagedTransports = new Set(
    roleEntries
      .map((entry) => entry.transport)
      .filter((transport) => transport && String(transport).startsWith("COM"))
  );

  for (const port of discoveredPorts) {
    if (!port?.port || knownManagedTransports.has(port.port)) {
      continue;
    }

    const observedHardware = await buildHardwareDescriptor({}, port.port, null);
    if (!observedHardware?.device && !observedHardware?.profileId && !observedHardware?.outputs?.length) {
      continue;
    }

    roleEntries.push({
      id: `observed:${port.port}`,
      kind: "observed-node",
      role: `node ${port.port}`,
      managed: false,
      mode: "observed",
      ok: true,
      baseUrl: null,
      transport: port.port,
      identityKeyId: null,
      remoteUrl: null,
      targetAgent: null,
      stateDir: null,
      sync: null,
      hardware: observedHardware
    });
  }

  return roleEntries;
}

function buildDiscoverySnapshot({
  shellName,
  mode,
  discoveredPorts,
  networkPresenceEntries,
  roleMap,
  senderStatus,
  receiverStatus,
  relayStatus
}) {
  const generatedAt = new Date().toISOString();
  const nodes = [];
  const links = [];
  const candidates = [];
  const dedupedNetworkPresenceEntries = dedupeNetworkPresenceEntries(networkPresenceEntries ?? []);
  const knownTransports = new Map();
  const knownBaseUrls = new Set(roleMap.map((entry) => entry.baseUrl).filter(Boolean));

  for (const roleEntry of roleMap) {
    nodes.push({
      id: `role:${roleEntry.id}`,
      type: roleEntry.kind,
      role: roleEntry.role,
      mode: roleEntry.mode,
      transport: roleEntry.transport,
      ok: roleEntry.ok,
      baseUrl: roleEntry.baseUrl,
      identityKeyId: roleEntry.identityKeyId
    });

    if (roleEntry.transport && String(roleEntry.transport).startsWith("COM")) {
      knownTransports.set(roleEntry.transport, roleEntry.id);
      links.push({
        source: `port:${roleEntry.transport}`,
        target: `role:${roleEntry.id}`,
        kind: "attached_transport"
      });

      if (roleEntry.id === "sender" || roleEntry.id === "receiver") {
        candidates.push({
          id: `candidate-live:${roleEntry.id}`,
          kind: "live-role-port",
          label: `${roleEntry.role} live transport`,
          port: roleEntry.transport,
          roleId: roleEntry.id,
          hint: `Current live transport for role ${roleEntry.role}.`
        });
      }
    }

    if (roleEntry.remoteUrl && roleEntry.targetAgent) {
      links.push({
        source: `role:${roleEntry.id}`,
        target: `role:${roleEntry.targetAgent}`,
        kind: "configured_route",
        via: roleEntry.remoteUrl
      });
    }
  }

  for (const port of discoveredPorts) {
    nodes.push({
      id: `port:${port.port}`,
      type: "local-port",
      role: knownTransports.has(port.port) ? "assigned-port" : "candidate-port",
      mode,
      transport: port.port,
      ok: true,
      friendlyName: port.friendlyName,
      kind: port.kind
    });

    if (!knownTransports.has(port.port)) {
      candidates.push({
        id: `candidate:${port.port}`,
        kind: "unassigned-port",
        label: port.friendlyName ?? port.port,
        port: port.port,
        hint: "Available for future role binding."
      });
    }
  }

  for (const entry of dedupedNetworkPresenceEntries) {
    nodes.push({
      id: `net:${entry.id}`,
      type: "network-agent",
      role: entry.agentName ?? entry.role ?? "network-agent",
      mode: "network-discovered",
      transport: entry.baseUrl,
      ok: true,
      baseUrl: entry.baseUrl,
      identityKeyId: entry.identity?.keyId ?? null,
      sourceAddress: entry.sourceAddress,
      sourceAddresses: entry.sourceAddresses ?? [],
      hostName: entry.hostName ?? null,
      listenPort: entry.listenPort,
      interfaceCount: entry.interfaceCount ?? 1
    });

    if (!knownBaseUrls.has(entry.baseUrl)) {
      candidates.push({
        id: `candidate-network:${entry.id}`,
        kind: "network-agent",
        label: `${entry.agentName ?? "agent"} via LAN`,
        port: null,
        baseUrl: entry.baseUrl,
        hostName: entry.hostName ?? null,
        sourceAddress: entry.sourceAddress ?? null,
        sourceAddresses: entry.sourceAddresses ?? [],
        listenPort: entry.listenPort ?? null,
        roleId: entry.role ?? null,
        identityKeyId: entry.identity?.keyId ?? null,
        hint: `LAN-discovered agent beacon from ${entry.sourceAddress ?? "unknown-address"}.`,
        lastSeenAt: entry.lastSeenAt ?? null,
        interfaceCount: entry.interfaceCount ?? 1
      });
    }
  }

  const peerSources = [
    ...((senderStatus.state?.peers ?? []).map((peer) => ({ peer, sourceRole: "sender" }))),
    ...((receiverStatus.state?.peers ?? []).map((peer) => ({ peer, sourceRole: "receiver" })))
  ];
  const seenPeers = new Set();

  for (const { peer, sourceRole } of peerSources) {
    if (!peer?.keyId || seenPeers.has(peer.keyId)) {
      continue;
    }
    seenPeers.add(peer.keyId);

    const isMappedToRole = roleMap.some((entry) => entry.identityKeyId === peer.keyId);
    nodes.push({
      id: `peer:${peer.keyId}`,
      type: "peer",
      role: peer.role ?? "peer",
      mode: "discovered",
      transport: null,
      ok: true,
      identityKeyId: peer.keyId,
      label: peer.label ?? peer.keyId,
      source: sourceRole
    });

    if (!isMappedToRole) {
      candidates.push({
        id: `candidate-peer:${peer.keyId}`,
        kind: "remote-peer",
        label: peer.label ?? peer.keyId,
        port: null,
        hint: `Known by ${sourceRole}, not bound to a live local role.`
      });
    }
  }

  const relayRoutes = relayStatus.state?.relay?.routes ?? relayStatus.health?.relay?.routes ?? [];
  for (const route of relayRoutes) {
    links.push({
      source: "role:relay",
      target: `role:${route.name}`,
      kind: "relay_route",
      via: route.targetUrl
    });
  }

  return {
    generatedAt,
    shellName,
    mode,
    summary: {
      localPorts: discoveredPorts.length,
      liveRoles: roleMap.filter((entry) => entry.ok && entry.managed !== false).length,
      networkAgents: dedupedNetworkPresenceEntries.length,
      candidateCount: candidates.length,
      linkCount: links.length
    },
    nodes,
    links,
    candidates
  };
}

function dedupeNetworkPresenceEntries(entries) {
  const mergedEntries = new Map();

  for (const entry of entries) {
    if (!entry?.baseUrl && !entry?.identity?.keyId) {
      continue;
    }

    const dedupeKey = entry.identity?.keyId
      ? `identity:${entry.identity.keyId}`
      : `base:${entry.baseUrl}`;
    const previous = mergedEntries.get(dedupeKey);
    const preferred = choosePreferredNetworkPresenceEntry(previous, entry);
    const sourceAddresses = new Set([
      ...(previous?.sourceAddresses ?? []),
      ...(entry?.sourceAddresses ?? []),
      entry?.sourceAddress
    ].filter(Boolean));
    const baseUrls = new Set([
      ...(previous?.baseUrls ?? []),
      previous?.baseUrl,
      ...(entry?.baseUrls ?? []),
      entry?.baseUrl
    ].filter(Boolean));

    mergedEntries.set(dedupeKey, {
      ...(previous ?? entry),
      ...preferred,
      id: previous?.id ?? preferred?.id ?? entry.id ?? dedupeKey,
      sourceAddress: preferred?.sourceAddress ?? previous?.sourceAddress ?? entry.sourceAddress ?? null,
      sourceAddresses: [...sourceAddresses].sort(),
      baseUrls: [...baseUrls].sort(),
      interfaceCount: sourceAddresses.size || 1,
      firstSeenAt: [previous?.firstSeenAt, entry?.firstSeenAt].filter(Boolean).sort()[0] ?? null,
      lastSeenAt: [previous?.lastSeenAt, entry?.lastSeenAt].filter(Boolean).sort().at(-1) ?? null,
      expiresAt: [previous?.expiresAt, entry?.expiresAt].filter(Boolean).sort().at(-1) ?? null
    });
  }

  return [...mergedEntries.values()].sort((left, right) => (right.lastSeenAt ?? "").localeCompare(left.lastSeenAt ?? ""));
}

function choosePreferredNetworkPresenceEntry(previous, next) {
  if (!previous) {
    return next;
  }
  if (!next) {
    return previous;
  }

  return scoreNetworkPresenceEntry(next) > scoreNetworkPresenceEntry(previous)
    ? next
    : previous;
}

function scoreNetworkPresenceEntry(entry) {
  const url = String(entry?.baseUrl ?? "");
  const sourceAddress = String(entry?.sourceAddress ?? "");
  const hostLooksLocal = (
    url.includes("127.0.0.1")
    || url.includes("localhost")
    || sourceAddress === "127.0.0.1"
    || sourceAddress === "::1"
  );
  const localityScore = hostLooksLocal ? 0 : 1;
  const freshnessScore = entry?.lastSeenAt ? Date.parse(entry.lastSeenAt) || 0 : 0;

  return (localityScore * 10_000_000_000_000) + freshnessScore;
}

function buildBindingHints(discovery, roleBindings) {
  const bindingMap = new Map(roleBindings.map((binding) => [binding.candidateId, binding]));

  return (discovery?.candidates ?? []).map((candidate) => {
    const currentBinding = bindingMap.get(candidate.id) ?? null;

    if (candidate.kind === "live-role-port") {
      const suggestedRole = candidate.roleId === "sender"
        ? "identity-token"
        : candidate.roleId === "receiver"
          ? "receiver"
          : "gateway";
      return {
        candidateId: candidate.id,
        suggestedRole,
        confidence: "high",
        reason: `This candidate reflects the current live transport for ${candidate.roleId}. Adopting it aligns the saved plan with the running lab state.`,
        currentBinding
      };
    }

    if (candidate.kind === "unassigned-port") {
      if (candidate.port?.startsWith("COM9") || candidate.label?.includes("USB JTAG")) {
        return {
          candidateId: candidate.id,
          suggestedRole: "identity-token",
          confidence: "high",
          reason: "Native Espressif USB transport is a strong fit for a primary identity token.",
          currentBinding
        };
      }

      return {
        candidateId: candidate.id,
        suggestedRole: "gateway-or-receiver",
        confidence: "medium",
        reason: "UART-attached ESP ports fit well as receiver, gateway, or test peer roles.",
        currentBinding
      };
    }

    return {
      candidateId: candidate.id,
      suggestedRole: candidate.kind === "network-agent" ? "gateway" : "remote-peer",
      confidence: "medium",
      reason: candidate.kind === "network-agent"
        ? "LAN-discovered host agent can later be promoted into a gateway, route target, or network-aware peer role."
        : "Known remote peer can later be mapped into overlay discovery or route policy.",
      currentBinding
    };
  });
}

function mapAssignedRoleToLiveRoleId(assignedRole) {
  switch (assignedRole) {
    case "identity-token":
      return "sender";
    case "receiver":
      return "receiver";
    case "gateway":
      return "relay";
    default:
      return null;
  }
}

function findLiveRoleCandidate(discovery, liveRoleId) {
  return (discovery?.candidates ?? []).find(
    (entry) => entry.kind === "live-role-port" && entry.roleId === liveRoleId
  ) ?? null;
}

function buildResolutionNextAction({ state, liveRoleId, discovery, candidatePort, liveTransport }) {
  const liveCandidate = liveRoleId ? findLiveRoleCandidate(discovery, liveRoleId) : null;

  switch (state) {
    case "matched":
      return {
        kind: "none",
        label: "No action needed",
        detail: "This planned binding already matches the live role transport.",
        candidateId: null
      };
    case "candidate-missing":
      if (liveCandidate) {
        return {
          kind: "rebind-live-role",
          label: `Adopt ${liveRoleId} live transport`,
          detail: `The saved candidate disappeared. Rebind this role to the live transport ${liveCandidate.port ?? liveRoleId}.`,
          candidateId: liveCandidate.id
        };
      }
      return {
        kind: "remove-binding",
        label: "Remove stale binding",
        detail: "The saved candidate is no longer present in discovery, so the planned binding should be removed or replaced.",
        candidateId: null
      };
    case "role-offline":
      return {
        kind: "bring-role-online",
        label: `Bring ${liveRoleId} online`,
        detail: `The mapped role is offline. Start ${liveRoleId} and refresh discovery before applying this plan again.`,
        candidateId: null
      };
    case "role-unverifiable":
      return {
        kind: "verify-manually",
        label: "Verify transport manually",
        detail: `The role is online, but the binding cannot be compared automatically because candidate transport '${candidatePort ?? "-"}' and live transport '${liveTransport ?? "-"}' are not both available.`,
        candidateId: null
      };
    case "transport-mismatch":
      if (liveCandidate) {
        return {
          kind: "rebind-live-role",
          label: `Adopt ${liveRoleId} live transport`,
          detail: `The saved transport ${candidatePort ?? "-"} does not match live transport ${liveTransport ?? "-"}. Rebind to ${liveCandidate.port ?? liveRoleId}.`,
          candidateId: liveCandidate.id
        };
      }
      return {
        kind: "remove-binding",
        label: "Remove conflicting binding",
        detail: `The saved transport ${candidatePort ?? "-"} conflicts with live transport ${liveTransport ?? "-"}. Remove or replace this binding.`,
        candidateId: null
      };
    case "planned-only":
      return {
        kind: "policy-only",
        label: "Keep as policy-only binding",
        detail: "This planned binding is not mapped to a managed live role yet, so it can remain as a future policy hint.",
        candidateId: null
      };
    default:
      return {
        kind: "review",
        label: "Review binding",
        detail: "Check the saved binding and refresh discovery before applying changes.",
        candidateId: null
      };
  }
}

function buildBindingResolution(binding, discovery, roleMap) {
  const candidate = (discovery?.candidates ?? []).find((entry) => entry.id === binding.candidateId) ?? null;
  const liveRoleId = mapAssignedRoleToLiveRoleId(binding.assignedRole);
  const liveRole = liveRoleId ? roleMap.find((entry) => entry.id === liveRoleId) ?? null : null;
  const candidatePort = candidate?.port ?? null;
  const liveTransport = liveRole?.transport ?? null;

  if (!candidate) {
    const state = "candidate-missing";
    return {
      state,
      summary: "Candidate is no longer present in the latest discovery snapshot.",
      liveRoleId,
      candidatePort,
      liveTransport,
      nextAction: buildResolutionNextAction({
        state,
        liveRoleId,
        discovery,
        candidatePort,
        liveTransport
      })
    };
  }

  if (!liveRoleId) {
    const state = "planned-only";
    return {
      state,
      summary: "Binding is saved for future policy use and is not mapped to a live managed role yet.",
      liveRoleId: null,
      candidatePort,
      liveTransport: null,
      nextAction: buildResolutionNextAction({
        state,
        liveRoleId: null,
        discovery,
        candidatePort,
        liveTransport: null
      })
    };
  }

  if (!liveRole?.ok) {
    const state = "role-offline";
    return {
      state,
      summary: `Mapped live role ${liveRoleId} is currently offline.`,
      liveRoleId,
      candidatePort,
      liveTransport,
      nextAction: buildResolutionNextAction({
        state,
        liveRoleId,
        discovery,
        candidatePort,
        liveTransport
      })
    };
  }

  if (!candidatePort || !liveTransport) {
    const state = "role-unverifiable";
    return {
      state,
      summary: `Mapped live role ${liveRoleId} is online, but there is no comparable transport to verify against the candidate.`,
      liveRoleId,
      candidatePort,
      liveTransport,
      nextAction: buildResolutionNextAction({
        state,
        liveRoleId,
        discovery,
        candidatePort,
        liveTransport
      })
    };
  }

  if (candidatePort === liveTransport) {
    const state = "matched";
    return {
      state,
      summary: `Candidate transport ${candidatePort} matches live role ${liveRoleId}.`,
      liveRoleId,
      candidatePort,
      liveTransport,
      nextAction: buildResolutionNextAction({
        state,
        liveRoleId,
        discovery,
        candidatePort,
        liveTransport
      })
    };
  }

  const state = "transport-mismatch";
  return {
    state,
    summary: `Candidate transport ${candidatePort} does not match live role ${liveRoleId} transport ${liveTransport}.`,
    liveRoleId,
    candidatePort,
    liveTransport,
    nextAction: buildResolutionNextAction({
      state,
      liveRoleId,
      discovery,
      candidatePort,
      liveTransport
    })
  };
}

function buildResolvedBindings({ roleBindings, discovery, roleMap }) {
  return roleBindings.map((binding) => ({
    ...binding,
    resolution: buildBindingResolution(binding, discovery, roleMap)
  }));
}

function buildLifecyclePlan({ shellName, mode, manageable, roleBindings, discovery, roleMap }) {
  const candidateMap = new Map((discovery?.candidates ?? []).map((candidate) => [candidate.id, candidate]));
  const plannedRoles = roleBindings.map((binding) => {
    const candidate = candidateMap.get(binding.candidateId) ?? null;
    const resolution = buildBindingResolution(binding, discovery, roleMap);
    return {
      candidateId: binding.candidateId,
      assignedRole: binding.assignedRole,
      note: binding.note ?? "",
      source: binding.source ?? "manual",
      updatedAt: binding.updatedAt ?? null,
      resolution,
      candidate: candidate
        ? {
            id: candidate.id,
            label: candidate.label ?? candidate.id,
            kind: candidate.kind ?? null,
            port: candidate.port ?? null
          }
        : null
    };
  });

  return {
    shellName,
    mode,
    manageable,
    appliedAt: new Date().toISOString(),
    summary: {
      bindingCount: plannedRoles.length,
      liveRoleCount: roleMap.filter((entry) => entry.ok).length,
      matchedBindingCount: plannedRoles.filter((entry) => entry.resolution?.state === "matched").length,
      mismatchCount: plannedRoles.filter((entry) =>
        ["candidate-missing", "role-offline", "transport-mismatch"].includes(entry.resolution?.state)
      ).length
    },
    liveRoles: roleMap.map((entry) => ({
      id: entry.id,
      role: entry.role,
      transport: entry.transport,
      identityKeyId: entry.identityKeyId ?? null,
      ok: entry.ok
    })),
    plannedRoles,
    nextStep: manageable
      ? "Embedded mode can use this plan as the basis for future managed role restarts."
      : "Attached mode stores the applied role plan for diagnostics, but does not restart external processes yet."
  };
}

export function createUnifiedClientServer({
  host = "127.0.0.1",
  port = 8795,
  shellName = "unified-client",
  shellStateDir = DEFAULT_SHELL_STATE_DIR,
  sender,
  receiver,
  relay
}) {
  const senderUrl = normalizeBaseUrl(sender.baseUrl);
  const receiverUrl = normalizeBaseUrl(receiver.baseUrl);
  const relayUrl = normalizeBaseUrl(relay.baseUrl);
  const mode = sender.embedded || receiver.embedded || relay.embedded ? "embedded" : "attached";
  const discoveryCache = createDiscoveryCacheStore({
    cacheFile: resolve(shellStateDir, "discovery-cache.json")
  });
  const hardwareActivityStore = createHardwareActivityStore({
    activityFile: resolve(shellStateDir, "hardware-activity.json")
  });
  const lifecyclePlanStore = createLifecyclePlanStore({
    planFile: resolve(shellStateDir, "lifecycle-plan.json")
  });
  const roleBindingStore = createRoleBindingStore({
    bindingsFile: resolve(shellStateDir, "role-bindings.json")
  });
  const lanPresenceListener = createLanPresenceListener({
    port: DEFAULT_LAN_PRESENCE_PORT,
    expiryMs: DEFAULT_LAN_PRESENCE_EXPIRY_MS
  });

  const embeddedServers = [];

  async function startEmbeddedServers() {
    if (!sender.embedded && !receiver.embedded && !relay.embedded) {
      return;
    }

    if (sender.embedded) {
      const senderRuntime = createAgentRuntime({
        stateDir: sender.stateDir,
        agentName: sender.agentName
      });
      const senderServer = createAgentApiServer({
        runtime: senderRuntime,
        deviceOptions: sender.deviceOptions,
        host,
        port: sender.listenPort
      });
      await senderServer.listen();
      embeddedServers.push(senderServer);
    }

    if (receiver.embedded) {
      const receiverRuntime = createAgentRuntime({
        stateDir: receiver.stateDir,
        agentName: receiver.agentName
      });
      const receiverServer = createAgentApiServer({
        runtime: receiverRuntime,
        deviceOptions: receiver.deviceOptions,
        host,
        port: receiver.listenPort
      });
      await receiverServer.listen();
      embeddedServers.push(receiverServer);
    }

    if (relay.embedded) {
      const relayServer = createRelayApiServer({
        host,
        port: relay.listenPort,
        relayName: relay.relayName,
        routes: [
          `${sender.agentName}=${senderUrl}`,
          `${receiver.agentName}=${receiverUrl}`
        ],
        stateDir: relay.stateDir
      });
      await relayServer.listen();
      embeddedServers.push(relayServer);
    }
  }

  async function getShellState() {
    const [senderStatus, receiverStatus, relayStatus] = await Promise.all([
      gatherServiceStatus("sender", senderUrl),
      gatherServiceStatus("receiver", receiverUrl),
      gatherServiceStatus("relay", relayUrl)
    ]);

    let discoveredPorts = [];
    let discoveryError = null;
    try {
      discoveredPorts = await discoverWindowsEspPorts();
    } catch (error) {
      discoveryError = error.message;
    }

    const roleMap = await buildRoleMap({
      mode,
      senderStatus,
      receiverStatus,
      relayStatus,
      sender,
      receiver,
      relay,
      discoveredPorts
    });
    const rawDiscovery = buildDiscoverySnapshot({
      shellName,
      mode,
      discoveredPorts,
      networkPresenceEntries: lanPresenceListener.listEntries(),
      roleMap,
      senderStatus,
      receiverStatus,
      relayStatus
    });
    const roleBindings = await roleBindingStore.listBindings();
    const resolvedBindings = buildResolvedBindings({
      roleBindings,
      discovery: rawDiscovery,
      roleMap
    });
    const bindingMap = new Map(resolvedBindings.map((binding) => [binding.candidateId, binding]));
    const discovery = {
      ...rawDiscovery,
      candidates: (rawDiscovery.candidates ?? []).map((candidate) => ({
        ...candidate,
        binding: bindingMap.get(candidate.id) ?? null
      }))
    };
    const latestDiscoverySnapshot = await discoveryCache.getLatestSnapshot();
    const discoveryHistory = (await discoveryCache.listSnapshots()).slice(0, 5);
    const bindingHints = buildBindingHints(discovery, resolvedBindings);
    const lifecyclePlan = await lifecyclePlanStore.getPlan();
    const hardwareActivity = await hardwareActivityStore.listEntries();

    return {
      ok: true,
      shell: {
        name: shellName,
        mode,
        host,
        port,
        links: {
          unified: normalizeBaseUrl(`http://${host}:${port}`),
          sender: senderUrl,
          receiver: receiverUrl,
          relay: relayUrl
        },
        lifecycle: {
          manageable: mode === "embedded",
          actions: {
            pullRole: true,
            pullAll: true,
            testOutput: true,
            queueDelete: true,
            discoveryRefresh: true,
            bindCandidate: true,
            applyBindings: true,
            clearAppliedPlan: true,
            adoptLiveBindings: true,
            clearConflictingBindings: true,
            reconcileLiveState: true
          }
        }
      },
      services: {
        sender: senderStatus,
        receiver: receiverStatus,
        relay: relayStatus
      },
      roleMap,
      discovery,
      roleBindings: resolvedBindings,
      bindingHints,
      lifecyclePlan,
      hardwareActivity,
      discoveryCache: {
        latestGeneratedAt: latestDiscoverySnapshot?.generatedAt ?? null,
        history: discoveryHistory
      },
      ports: discoveredPorts,
      discoveryError
    };
  }

  async function sendFromRole(fromRole, text) {
    const fromConfig = fromRole === sender.agentName ? sender : receiver;
    const toConfig = fromRole === sender.agentName ? receiver : sender;
    const targetAgent = toConfig.agentName;
    const fromUrl = normalizeBaseUrl(fromConfig.baseUrl);
    const toStatus = await gatherServiceStatus(targetAgent, normalizeBaseUrl(toConfig.baseUrl));
    if (!toStatus.ok) {
      throw new Error(`Target role ${targetAgent} is unavailable: ${toStatus.error}`);
    }

    const recipientKeyId = toStatus.state?.identity?.keyId ?? null;
    if (!recipientKeyId) {
      throw new Error(`Target role ${targetAgent} has no live identity.`);
    }

    const envelope = await fetchJson(`${fromUrl}/envelopes/text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        toKeyId: recipientKeyId,
        save: true
      })
    });

    const delivery = await fetchJson(`${fromUrl}/transport/deliver`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        remoteUrl: relayUrl,
        targetAgent
      })
    });

    return {
      fromRole,
      targetAgent,
      recipientKeyId,
      envelope,
      delivery: delivery.result ?? null
    };
  }

  async function markRead(role, messageId) {
    const roleConfig = role === sender.agentName ? sender : receiver;
    const roleUrl = normalizeBaseUrl(roleConfig.baseUrl);

    return fetchJson(`${roleUrl}/messages/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messageId
      })
    });
  }

  async function pullRole(role) {
    const roleConfig = role === sender.agentName ? sender : receiver;
    const roleUrl = normalizeBaseUrl(roleConfig.baseUrl);

    return fetchJson(`${roleUrl}/transport/pull`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        remoteUrl: relayUrl
      })
    });
  }

  async function testRoleOutput(role, target) {
    const roleConfig = role === sender.agentName ? sender : receiver;
    const roleUrl = normalizeBaseUrl(roleConfig.baseUrl);

    if (!target) {
      throw new Error("target is required.");
    }

    const result = await fetchJson(`${roleUrl}/device/test-output`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        target
      })
    });

    const resultPayload = result.result ?? result;
    const resultLines = Array.isArray(resultPayload.results) ? resultPayload.results : [];
    const failedLine = resultLines.find((entry) => entry.status && entry.status !== "ok");
    const detail = resultLines.length
      ? resultLines
          .map((entry) => `${entry.kind}:${entry.status}${entry.detail ? ` (${entry.detail})` : ""}`)
          .join(" | ")
      : `Target ${target} invoked.`;

    await hardwareActivityStore.recordEntry({
      category: "hardware",
      action: "test-output",
      role,
      target: resultPayload.target ?? target,
      status: failedLine ? failedLine.status : "ok",
      detail,
      data: resultPayload
    });

    return result;
  }

  async function deleteQueueEntry(queueId) {
    try {
      return await fetchJson(`${relayUrl}/relay/queue/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          queueId
        })
      });
    } catch (error) {
      const relayStatus = await gatherServiceStatus("relay", relayUrl);
      const relayStateDir = relayStatus.state?.relay?.stateDir ?? relayStatus.health?.relay?.stateDir ?? null;
      if (!relayStateDir) {
        throw error;
      }

      const queueStore = createRelayQueueStore({
        queueFile: resolve(relayStateDir, "relay-queue.json")
      });
      const deleted = await queueStore.deleteEntry(queueId);
      if (!deleted) {
        throw error;
      }

      const remainingEntries = await queueStore.listEntries();
      return {
        ok: true,
        relay: relayStatus.state?.relay ?? relayStatus.health?.relay ?? null,
        result: {
          deleted: true,
          queueId,
          entry: deleted,
          remainingCount: remainingEntries.length,
          fallback: "local-state"
        }
      };
    }
  }

  async function pullAllRoutes() {
    const [senderPull, receiverPull] = await Promise.all([
      pullRole(sender.agentName),
      pullRole(receiver.agentName)
    ]);

    return {
      sender: senderPull,
      receiver: receiverPull
    };
  }

  async function refreshDiscovery() {
    const currentState = await getShellState();
    await discoveryCache.saveSnapshot(currentState.discovery);
    const snapshots = await discoveryCache.listSnapshots();
    await hardwareActivityStore.recordEntry({
      category: "discovery",
      action: "refresh",
      role: "shell",
      target: "discovery",
      status: "ok",
      detail: `Ports ${currentState.discovery?.summary?.localPorts ?? 0}, roles ${currentState.discovery?.summary?.liveRoles ?? 0}, candidates ${currentState.discovery?.summary?.candidateCount ?? 0}.`,
      data: {
        generatedAt: currentState.discovery?.generatedAt ?? null,
        summary: currentState.discovery?.summary ?? null,
        snapshotCount: snapshots.length
      }
    });

    return {
      snapshot: currentState.discovery,
      cache: {
        latestGeneratedAt: snapshots[0]?.generatedAt ?? null,
        snapshotCount: snapshots.length
      }
    };
  }

  async function bindCandidate({ candidateId, assignedRole, note = "" }) {
    if (!candidateId) {
      throw new Error("candidateId is required.");
    }
    if (!assignedRole) {
      throw new Error("assignedRole is required.");
    }

    const currentState = await getShellState();
    const candidate = currentState.discovery?.candidates?.find((entry) => entry.id === candidateId) ?? null;
    if (!candidate) {
      throw new Error(`Candidate ${candidateId} is not present in the current discovery snapshot.`);
    }

    const binding = await roleBindingStore.upsertBinding({
      candidateId,
      assignedRole,
      note
    });
    await hardwareActivityStore.recordEntry({
      category: "lifecycle",
      action: "bind-candidate",
      role: assignedRole,
      target: candidateId,
      status: "ok",
      detail: `Bound ${candidate.label ?? candidateId} to planned role ${assignedRole}.`,
      data: {
        candidate,
        binding
      }
    });

    return {
      binding,
      candidate
    };
  }

  async function unbindCandidate({ candidateId }) {
    if (!candidateId) {
      throw new Error("candidateId is required.");
    }

    const deleted = await roleBindingStore.deleteBinding(candidateId);
    if (!deleted) {
      throw new Error(`No saved binding exists for ${candidateId}.`);
    }
    await hardwareActivityStore.recordEntry({
      category: "lifecycle",
      action: "unbind-candidate",
      role: deleted.assignedRole ?? null,
      target: candidateId,
      status: "ok",
      detail: `Cleared planned binding for ${candidateId}.`,
      data: {
        deleted
      }
    });

    return {
      deleted
    };
  }

  async function applyBindings() {
    const currentState = await getShellState();
    const plan = buildLifecyclePlan({
      shellName,
      mode,
      manageable: mode === "embedded",
      roleBindings: currentState.roleBindings ?? [],
      discovery: currentState.discovery,
      roleMap: currentState.roleMap ?? []
    });

    await lifecyclePlanStore.savePlan(plan);
    await hardwareActivityStore.recordEntry({
      category: "lifecycle",
      action: "apply-bindings",
      role: "shell",
      target: "lifecycle-plan",
      status: "ok",
      detail: `Applied lifecycle plan with ${plan.summary?.bindingCount ?? 0} bindings, ${plan.summary?.matchedBindingCount ?? 0} matched, ${plan.summary?.mismatchCount ?? 0} mismatched.`,
      data: {
        plan
      }
    });

    return {
      plan
    };
  }

  async function clearAppliedPlan() {
    const deleted = await lifecyclePlanStore.clearPlan();
    await hardwareActivityStore.recordEntry({
      category: "lifecycle",
      action: "clear-applied-plan",
      role: "shell",
      target: "lifecycle-plan",
      status: "ok",
      detail: deleted
        ? `Cleared lifecycle plan that had ${deleted.summary?.bindingCount ?? 0} bindings.`
        : "No lifecycle plan was stored.",
      data: {
        deleted
      }
    });
    return {
      deleted
    };
  }

  async function adoptLiveBindings() {
    const currentState = await getShellState();
    const liveCandidates = (currentState.discovery?.candidates ?? []).filter((candidate) => candidate.kind === "live-role-port");
    const existingBindings = currentState.roleBindings ?? [];
    const updated = [];
    const cleared = [];

    for (const candidate of liveCandidates) {
      const assignedRole = candidate.roleId === "sender"
        ? "identity-token"
        : candidate.roleId === "receiver"
          ? "receiver"
          : null;
      if (!assignedRole) {
        continue;
      }

      for (const binding of existingBindings.filter((entry) => entry.assignedRole === assignedRole && entry.candidateId !== candidate.id)) {
        const deleted = await roleBindingStore.deleteBinding(binding.candidateId);
        if (deleted) {
          cleared.push(deleted);
        }
      }

      const binding = await roleBindingStore.upsertBinding({
        candidateId: candidate.id,
        assignedRole,
        note: `Adopted from live role ${candidate.roleId}.`,
        source: "reconcile-live"
      });
      updated.push({
        candidate,
        binding
      });
    }

    await hardwareActivityStore.recordEntry({
      category: "lifecycle",
      action: "adopt-live-bindings",
      role: "shell",
      target: "role-bindings",
      status: "ok",
      detail: `Adopted ${updated.length} live bindings and cleared ${cleared.length} conflicting bindings.`,
      data: {
        updated,
        cleared
      }
    });

    return {
      updatedCount: updated.length,
      clearedCount: cleared.length,
      updated,
      cleared
    };
  }

  async function clearConflictingBindings() {
    const currentState = await getShellState();
    const conflicting = (currentState.roleBindings ?? []).filter((binding) =>
      ["candidate-missing", "transport-mismatch", "role-offline"].includes(binding.resolution?.state)
    );
    const cleared = [];

    for (const binding of conflicting) {
      const deleted = await roleBindingStore.deleteBinding(binding.candidateId);
      if (deleted) {
        cleared.push(deleted);
      }
    }

    await hardwareActivityStore.recordEntry({
      category: "lifecycle",
      action: "clear-conflicting-bindings",
      role: "shell",
      target: "role-bindings",
      status: "ok",
      detail: `Cleared ${cleared.length} conflicting bindings.`,
      data: {
        cleared
      }
    });

    return {
      clearedCount: cleared.length,
      cleared
    };
  }

  async function reconcileLiveState() {
    const adopted = await adoptLiveBindings();
    const applied = await applyBindings();

    await hardwareActivityStore.recordEntry({
      category: "lifecycle",
      action: "reconcile-live-state",
      role: "shell",
      target: "lifecycle-plan",
      status: "ok",
      detail: `Reconciled live state with ${adopted.updatedCount ?? 0} adopted bindings, ${adopted.clearedCount ?? 0} cleared conflicts, ${applied.plan?.summary?.matchedBindingCount ?? 0} matched, ${applied.plan?.summary?.mismatchCount ?? 0} mismatched.`,
      data: {
        adopted,
        plan: applied.plan
      }
    });

    return {
      adopted,
      plan: applied.plan
    };
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? `${host}:${port}`}`);
      const pathname = normalizePath(url.pathname);
      const method = request.method ?? "GET";

      if (method === "GET" && (await sendFile(response, pathname))) {
        return;
      }

      if (method === "GET" && pathname === "/health") {
        sendJson(response, 200, await getShellState());
        return;
      }

      if (method === "GET" && pathname === "/ready") {
        sendJson(response, 200, {
          ok: true,
          service: "esp-messenger-unified-client",
          shellName,
          mode,
          host,
          port
        });
        return;
      }

      if (method === "GET" && pathname === "/app/state") {
        sendJson(response, 200, await getShellState());
        return;
      }

      if (method === "POST" && pathname === "/actions/send") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          result: await sendFromRole(body.fromRole, body.text ?? "")
        });
        return;
      }

      if (method === "POST" && pathname === "/actions/mark-read") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          result: await markRead(body.role, body.messageId)
        });
        return;
      }

      if (method === "POST" && pathname === "/actions/pull") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          result: await pullRole(body.role)
        });
        return;
      }

      if (method === "POST" && pathname === "/actions/queue-delete") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          result: await deleteQueueEntry(body.queueId)
        });
        return;
      }

      if (method === "POST" && pathname === "/actions/pull-all") {
        sendJson(response, 200, {
          ok: true,
          result: await pullAllRoutes()
        });
        return;
      }

      if (method === "POST" && pathname === "/actions/test-output") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          result: await testRoleOutput(body.role, body.target)
        });
        return;
      }

      if (method === "POST" && pathname === "/actions/discovery-refresh") {
        sendJson(response, 200, {
          ok: true,
          result: await refreshDiscovery()
        });
        return;
      }

      if (method === "POST" && pathname === "/actions/bind-candidate") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          result: await bindCandidate(body)
        });
        return;
      }

      if (method === "POST" && pathname === "/actions/unbind-candidate") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          result: await unbindCandidate(body)
        });
        return;
      }

      if (method === "POST" && pathname === "/actions/apply-bindings") {
        sendJson(response, 200, {
          ok: true,
          result: await applyBindings()
        });
        return;
      }

      if (method === "POST" && pathname === "/actions/clear-applied-plan") {
        sendJson(response, 200, {
          ok: true,
          result: await clearAppliedPlan()
        });
        return;
      }

      if (method === "POST" && pathname === "/actions/adopt-live-bindings") {
        sendJson(response, 200, {
          ok: true,
          result: await adoptLiveBindings()
        });
        return;
      }

      if (method === "POST" && pathname === "/actions/clear-conflicting-bindings") {
        sendJson(response, 200, {
          ok: true,
          result: await clearConflictingBindings()
        });
        return;
      }

      if (method === "POST" && pathname === "/actions/reconcile-live-state") {
        sendJson(response, 200, {
          ok: true,
          result: await reconcileLiveState()
        });
        return;
      }

      sendJson(response, 404, {
        ok: false,
        error: "not_found"
      });
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error.message
      });
    }
  });

  return {
    async listen() {
      await startEmbeddedServers();
      await lanPresenceListener.start();

      await new Promise((resolvePromise, rejectPromise) => {
        server.once("error", rejectPromise);
        server.listen(port, host, () => {
          server.off("error", rejectPromise);
          resolvePromise();
        });
      });

      return {
        host,
        port,
        mode,
        links: {
          unified: normalizeBaseUrl(`http://${host}:${port}`),
          sender: senderUrl,
          receiver: receiverUrl,
          relay: relayUrl
        }
      };
    },
    async close() {
      await lanPresenceListener.stop();
      await new Promise((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      });

      while (embeddedServers.length) {
        const embeddedServer = embeddedServers.pop();
        await embeddedServer.close();
      }
    }
  };
}

export function createUnifiedAttachedConfig({
  host = "127.0.0.1",
  shellName = "unified-client",
  senderUrl,
  receiverUrl,
  relayUrl
}) {
  return {
    host,
    shellName,
    sender: {
      agentName: "sender",
      baseUrl: normalizeBaseUrl(senderUrl)
    },
    receiver: {
      agentName: "receiver",
      baseUrl: normalizeBaseUrl(receiverUrl)
    },
    relay: {
      relayName: "gateway-alpha",
      baseUrl: normalizeBaseUrl(relayUrl)
    }
  };
}

export function createUnifiedEmbeddedConfig({
  host = "127.0.0.1",
  shellName = "unified-client",
  senderPort,
  receiverPort,
  senderListenPort = 8787,
  receiverListenPort = 8788,
  relayListenPort = 8790,
  senderStateDir = resolve(process.cwd(), "agent", "state"),
  receiverStateDir = resolve(process.cwd(), "agent", "state-receiver"),
  relayStateDir = resolve(process.cwd(), "agent", "state-relay"),
  relayName = "gateway-alpha",
  syncIntervalMs = 15000
}) {
  const relayUrl = normalizeBaseUrl(`http://${host}:${relayListenPort}`);
  const sender = buildRoleServiceConfig({
    host,
    role: "sender",
    agentName: "sender",
    port: senderPort,
    listenPort: senderListenPort,
    stateDir: senderStateDir,
    remoteUrl: relayUrl,
    targetAgent: "receiver",
    syncIntervalMs
  });
  const receiver = buildRoleServiceConfig({
    host,
    role: "receiver",
    agentName: "receiver",
    port: receiverPort,
    listenPort: receiverListenPort,
    stateDir: receiverStateDir,
    remoteUrl: relayUrl,
    targetAgent: "sender",
    syncIntervalMs
  });

  return {
    host,
    shellName,
    sender: {
      ...sender,
      embedded: true
    },
    receiver: {
      ...receiver,
      embedded: true
    },
    relay: {
      relayName,
      baseUrl: relayUrl,
      stateDir: relayStateDir,
      listenPort: relayListenPort,
      embedded: true
    }
  };
}
