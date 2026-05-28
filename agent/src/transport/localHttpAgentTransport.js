import { assertTransportOk, parseTransportJson } from "./transportErrors.js";
import { normalizeRemoteUrl } from "./transportUrl.js";

export function createLocalHttpAgentTransport() {
  return {
    id: "local-http-agent",
    kind: "local-http-agent",
    capabilities: ["send-bundle", "health"],
    metadata: {
      id: "local-http-agent",
      kind: "local-http-agent",
      label: "Local HTTP Agent",
      description: "Direct HTTP delivery to another agent endpoint without relay semantics.",
      capabilities: ["send-bundle", "health"],
      deliveryModes: ["direct-http"],
      networkClass: "host-http",
      experimental: false,
      supports: {
        healthCheck: true,
        directSend: true,
        relayDelivery: false,
        pullRecovery: false,
        fileExport: false,
        fileImport: false,
        offlineCarry: false,
        ipv4: true,
        ipv6: true
      }
    },
    async health({ remoteUrl }) {
      const normalizedRemoteUrl = normalizeRemoteUrl(
        remoteUrl,
        "Missing remoteUrl for transport delivery."
      );
      const response = await fetch(`${normalizedRemoteUrl}/health`);
      const payload = await parseTransportJson(response);
      assertTransportOk(response, payload, (status) => `Agent transport health failed: ${status}`);
      return {
        remoteUrl: normalizedRemoteUrl,
        payload
      };
    },
    async sendBundle({ bundle, options = {} }) {
      const normalizedRemoteUrl = normalizeRemoteUrl(
        options.remoteUrl,
        "Missing remoteUrl for transport delivery."
      );
      const response = await fetch(`${normalizedRemoteUrl}/transport/accept-bundle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ bundle })
      });

      const payload = await parseTransportJson(response);
      assertTransportOk(response, payload, (status) => `Remote delivery failed: ${status}`);

      return {
        id: "local-http-agent",
        kind: "local-http-agent",
        remoteUrl: normalizedRemoteUrl,
        remoteEntity: payload?.agent ?? null,
        accepted: payload?.result?.accepted ?? [],
        receipts: payload?.result?.receipts ?? [],
        queued: false,
        queueId: null,
        queueReason: null,
        queueError: null,
        relayReceiptId: null,
        targetAgent: null,
        payload
      };
    }
  };
}
