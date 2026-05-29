import { assertTransportOk, parseTransportJson } from "./transportErrors.js";
import { normalizeRemoteUrl } from "./transportUrl.js";

export function createLocalHttpRelayTransport() {
  return {
    id: "local-http-relay",
    kind: "local-http-relay",
    capabilities: ["send-bundle", "pull-queued", "list-routes", "list-queue", "health"],
    metadata: {
      id: "local-http-relay",
      kind: "local-http-relay",
      label: "Local HTTP Relay",
      description: "HTTP relay transport for queued forwarding, route inspection, and pull recovery.",
      capabilities: ["send-bundle", "pull-queued", "list-routes", "list-queue", "health"],
      deliveryModes: ["relay-http", "queued-http"],
      networkClass: "host-http-relay",
      experimental: false,
      configRequirements: [
        {
          name: "remoteUrl",
          required: true,
          description: "Remote relay base URL for relay delivery, queue operations, and health checks.",
          example: "http://127.0.0.1:8790"
        },
        {
          name: "targetAgent",
          required: false,
          description: "Explicit relay target agent for queued forwarding or pull recovery operations.",
          example: "receiver"
        }
      ],
      supports: {
        healthCheck: true,
        directSend: false,
        relayDelivery: true,
        pullRecovery: true,
        fileExport: false,
        fileImport: false,
        offlineCarry: true,
        ipv4: true,
        ipv6: true
      }
    },
    async health({ remoteUrl }) {
      const normalizedRemoteUrl = normalizeRemoteUrl(
        remoteUrl,
        "Missing remoteUrl for relay transport."
      );
      const response = await fetch(`${normalizedRemoteUrl}/health`);
      const payload = await parseTransportJson(response);
      assertTransportOk(response, payload, (status) => `Relay transport health failed: ${status}`);
      return {
        remoteUrl: normalizedRemoteUrl,
        payload
      };
    },
    async sendBundle({ target, bundle, options = {} }) {
      const normalizedRemoteUrl = normalizeRemoteUrl(
        options.remoteUrl,
        "Missing remoteUrl for relay transport."
      );
      const response = await fetch(`${normalizedRemoteUrl}/relay/deliver`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          bundle,
          targetAgent: target
        })
      });

      const payload = await parseTransportJson(response);
      assertTransportOk(response, payload, (status) => `Remote delivery failed: ${status}`);

      return {
        id: "local-http-relay",
        kind: "local-http-relay",
        remoteUrl: normalizedRemoteUrl,
        remoteEntity: payload?.relay ?? payload?.agent ?? null,
        accepted: payload?.result?.accepted ?? [],
        receipts: payload?.result?.receipts ?? payload?.result?.downstream?.receipts ?? [],
        queued: Boolean(payload?.result?.queued),
        queueId: payload?.result?.queueId ?? null,
        queueReason: payload?.result?.queueReason ?? null,
        queueError: payload?.result?.error ?? null,
        relayReceiptId: payload?.result?.relayReceiptId ?? null,
        targetAgent: target ?? null,
        payload
      };
    },
    async pullQueued({ target, options = {} }) {
      const normalizedRemoteUrl = normalizeRemoteUrl(
        options.remoteUrl,
        "Missing remoteUrl for relay transport."
      );
      const response = await fetch(`${normalizedRemoteUrl}/relay/pull`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          targetAgent: target
        })
      });

      const payload = await parseTransportJson(response);
      assertTransportOk(response, payload, (status) => `Relay pull failed: ${status}`);

      return {
        id: "local-http-relay",
        kind: "local-http-relay",
        remoteUrl: normalizedRemoteUrl,
        targetAgent: target ?? null,
        pulledCount: payload?.result?.pulledCount ?? 0,
        deliveredCount: payload?.result?.deliveredCount ?? 0,
        failedCount: payload?.result?.failedCount ?? 0,
        remainingCount: payload?.result?.remainingCount ?? 0,
        delivered: payload?.result?.delivered ?? [],
        failed: payload?.result?.failed ?? [],
        relay: payload?.relay ?? null,
        payload
      };
    },
    async listRoutes({ options = {} } = {}) {
      const normalizedRemoteUrl = normalizeRemoteUrl(
        options.remoteUrl,
        "Missing remoteUrl for relay transport."
      );
      const response = await fetch(`${normalizedRemoteUrl}/relay/routes`);
      const payload = await parseTransportJson(response);
      assertTransportOk(response, payload, (status) => `Relay route listing failed: ${status}`);
      return {
        remoteUrl: normalizedRemoteUrl,
        payload
      };
    },
    async listQueue({ options = {}, target = null } = {}) {
      const normalizedRemoteUrl = normalizeRemoteUrl(
        options.remoteUrl,
        "Missing remoteUrl for relay transport."
      );
      const queueUrl = new URL(`${normalizedRemoteUrl}/relay/queue`);
      if (target) {
        queueUrl.searchParams.set("targetAgent", target);
      }
      const response = await fetch(queueUrl);
      const payload = await parseTransportJson(response);
      assertTransportOk(response, payload, (status) => `Relay queue listing failed: ${status}`);
      return {
        remoteUrl: normalizedRemoteUrl,
        payload
      };
    }
  };
}
