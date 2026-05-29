export function listTransportMetadata(registry) {
  if (!registry || typeof registry.list !== "function") {
    throw new Error("Transport diagnostics require a registry with list().");
  }

  return registry.list().map((transport) => ({
    id: transport.id,
    kind: transport.kind,
    capabilities: Array.isArray(transport.capabilities) ? [...transport.capabilities] : [],
    metadata: transport.metadata ?? null
  }));
}

export function summarizeTransportCapabilities(registry) {
  return listTransportMetadata(registry).map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    label: entry.metadata?.label ?? entry.id,
    networkClass: entry.metadata?.networkClass ?? "unknown",
    experimental: Boolean(entry.metadata?.experimental),
    capabilities: entry.capabilities,
    supports: entry.metadata?.supports ?? {}
  }));
}

export function getTransportById(registry, id) {
  if (!registry || typeof registry.get !== "function") {
    throw new Error("Transport diagnostics require a registry with get().");
  }

  const transport = registry.get(id);
  if (!transport) {
    return null;
  }

  return {
    id: transport.id,
    kind: transport.kind,
    capabilities: Array.isArray(transport.capabilities) ? [...transport.capabilities] : [],
    metadata: transport.metadata ?? null
  };
}

export async function checkTransportHealth(registry, id, options = {}) {
  if (!registry || typeof registry.get !== "function") {
    throw new Error("Transport diagnostics require a registry with get().");
  }

  const transport = registry.get(id);
  if (!transport) {
    throw new Error(`Transport ${id} is not active in this registry.`);
  }
  if (typeof transport.health !== "function") {
    throw new Error(`Transport ${id} does not expose a health() check.`);
  }

  const result = await transport.health(options);
  return {
    id: transport.id,
    kind: transport.kind,
    label: transport.metadata?.label ?? transport.id,
    networkClass: transport.metadata?.networkClass ?? "unknown",
    experimental: Boolean(transport.metadata?.experimental),
    health: result
  };
}

export async function summarizeTransportHealth(registry, options = {}) {
  if (!registry || typeof registry.list !== "function") {
    throw new Error("Transport diagnostics require a registry with list().");
  }

  const perTransportOptions = options.perTransport ?? {};
  const summaries = [];

  for (const transport of registry.list()) {
    const health = await checkTransportHealth(
      registry,
      transport.id,
      perTransportOptions[transport.id] ?? {}
    );
    summaries.push(health);
  }

  return summaries;
}
