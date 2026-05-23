export function createTransportBundle({ source = null, messages = [] }) {
  return {
    version: 1,
    kind: "transport-bundle",
    createdAt: new Date().toISOString(),
    source,
    messageCount: messages.length,
    messages
  };
}

export function validateTransportBundle(bundle) {
  if (!bundle || bundle.kind !== "transport-bundle") {
    throw new Error("Invalid transport bundle.");
  }
  if (!Array.isArray(bundle.messages)) {
    throw new Error("Transport bundle is missing messages.");
  }
  return bundle;
}
