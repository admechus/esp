import { assertTransportSendResult } from "./transportAdapter.js";
import { assertTransportOk, parseTransportJson } from "./transportErrors.js";
import { normalizeRemoteUrl } from "./transportUrl.js";

export function createYggdrasilDirectTransport() {
  return {
    id: "yggdrasil-direct",
    kind: "yggdrasil-direct",
    capabilities: ["direct-send", "ipv6"],
    metadata: {
      id: "yggdrasil-direct",
      kind: "yggdrasil-direct",
      label: "Yggdrasil Direct",
      description: "Experimental direct-send scaffold for future HTTP-over-Yggdrasil IPv6 delivery.",
      capabilities: ["direct-send", "ipv6"],
      deliveryModes: ["direct-http", "ipv6-direct-spike"],
      networkClass: "overlay-ipv6-spike",
      experimental: true,
      supports: {
        healthCheck: true,
        directSend: true,
        relayDelivery: false,
        pullRecovery: false,
        fileExport: false,
        fileImport: false,
        offlineCarry: false,
        ipv4: false,
        ipv6: true
      }
    },
    async health({ remoteUrl }) {
      const normalizedRemoteUrl = normalizeRemoteUrl(
        remoteUrl,
        "Missing remoteUrl for Yggdrasil direct transport."
      );
      const response = await fetch(`${normalizedRemoteUrl}/health`);
      const payload = await parseTransportJson(response);
      assertTransportOk(response, payload, (status) => `Yggdrasil direct transport health failed: ${status}`);
      return {
        id: "yggdrasil-direct",
        kind: "yggdrasil-direct",
        remoteUrl: normalizedRemoteUrl,
        payload
      };
    },
    async sendBundle({ target = null, bundle, options = {} }) {
      const normalizedRemoteUrl = normalizeRemoteUrl(
        options.remoteUrl,
        "Missing remoteUrl for Yggdrasil direct transport."
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

      const result = {
        id: "yggdrasil-direct",
        kind: "yggdrasil-direct",
        remoteUrl: normalizedRemoteUrl,
        remoteEntity: payload?.peer ?? payload?.agent ?? null,
        accepted: payload?.result?.accepted ?? [],
        receipts: payload?.result?.receipts ?? [],
        queued: false,
        queueId: null,
        queueReason: null,
        queueError: null,
        relayReceiptId: null,
        targetAgent: target,
        payload
      };

      return assertTransportSendResult(result, "yggdrasil-direct sendBundle");
    }
  };
}
