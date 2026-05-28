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
