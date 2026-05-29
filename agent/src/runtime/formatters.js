export function formatPortTable(ports) {
  if (!ports.length) {
    return "No ESP-related ports found.";
  }

  const lines = [
    "Port   Kind            Friendly name",
    "-----  --------------  -----------------------------------------------"
  ];

  for (const port of ports) {
    lines.push(
      `${(port.port ?? "").padEnd(5)}  ${(port.kind ?? "").padEnd(14)}  ${port.friendlyName ?? ""}`
    );
  }

  return lines.join("\n");
}

export function formatProfileTable(profiles) {
  return profiles
    .map((profile) => {
      return [
        `${profile.label} (${profile.id})`,
        `  examples: ${profile.examples.join(", ")}`,
        `  connectivity: ${profile.connectivity.join(", ")}`,
        `  storage: ${profile.storage.join(", ")}`,
        `  trust: ${profile.trustLevel}`,
        `  roles: ${profile.roles.join(", ")}`
      ].join("\n");
    })
    .join("\n\n");
}

export function formatPeerTable(peers) {
  if (!peers.length) {
    return "No peers stored.";
  }

  const lines = [
    "Key ID                             Role      Source        Label",
    "---------------------------------  --------  ------------  ----------------"
  ];

  for (const peer of peers) {
    lines.push(
      `${(peer.keyId ?? "").padEnd(33)}  ${(peer.role ?? "").padEnd(8)}  ${(peer.source ?? "").padEnd(12)}  ${peer.label ?? ""}`
    );
  }

  return lines.join("\n");
}

export function formatMessageTable(messages) {
  if (!messages.length) {
    return "No messages stored.";
  }

  const lines = [
    "When                      Direction  Sender                             Text",
    "------------------------  ---------  ---------------------------------  ------------------------"
  ];

  for (const message of messages) {
    lines.push(
      `${(message.envelopeCreatedAt ?? "").padEnd(24)}  ${(message.direction ?? "").padEnd(9)}  ${(message.senderKeyId ?? "").padEnd(33)}  ${(message.textPreview ?? "").slice(0, 24)}`
    );
  }

  return lines.join("\n");
}

export function formatTransportTable(transports) {
  if (!transports.length) {
    return "No transports registered.";
  }

  return transports
    .map((transport) => {
      const supports = Object.entries(transport.supports ?? {})
        .filter(([, value]) => value)
        .map(([key]) => key)
        .join(", ");
      const configRequirements = Array.isArray(transport.configRequirements)
        ? transport.configRequirements
            .map((requirement) =>
              `${requirement.name}${requirement.required ? "*" : ""}=${requirement.example}`
            )
            .join(", ")
        : "";

      return [
        `${transport.label ?? transport.id} (${transport.id})`,
        `  kind: ${transport.kind}`,
        `  network: ${transport.networkClass ?? "unknown"}`,
        `  experimental: ${transport.experimental ? "yes" : "no"}`,
        `  capabilities: ${(transport.capabilities ?? []).join(", ") || "none"}`,
        `  supports: ${supports || "none"}`,
        `  config: ${configRequirements || "none"}`
      ].join("\n");
    })
    .join("\n\n");
}

export function formatTransportHealth(transportHealth) {
  const health = transportHealth.health ?? {};
  const payloadSummary =
    health.payload && typeof health.payload === "object"
      ? JSON.stringify(health.payload)
      : health.payload ?? null;

  return [
    `${transportHealth.label ?? transportHealth.id} (${transportHealth.id})`,
    `  kind: ${transportHealth.kind}`,
    `  network: ${transportHealth.networkClass ?? "unknown"}`,
    `  experimental: ${transportHealth.experimental ? "yes" : "no"}`,
    `  ok: ${typeof health.ok === "boolean" ? (health.ok ? "yes" : "no") : "unknown"}`,
    `  remoteUrl: ${health.remoteUrl ?? "n/a"}`,
    `  payload: ${payloadSummary ?? "n/a"}`
  ].join("\n");
}
