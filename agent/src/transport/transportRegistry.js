export function createTransportRegistry({
  localHttpAgent,
  localHttpRelay,
  fileBundle
} = {}) {
  const transports = new Map();

  for (const transport of [localHttpAgent, localHttpRelay, fileBundle]) {
    if (!transport?.id) {
      continue;
    }
    transports.set(transport.id, transport);
  }

  return {
    list() {
      return Array.from(transports.values());
    },
    get(id) {
      return transports.get(id) ?? null;
    },
    require(id) {
      const transport = transports.get(id);
      if (!transport) {
        throw new Error(`Unknown transport adapter: ${id}`);
      }
      return transport;
    }
  };
}
