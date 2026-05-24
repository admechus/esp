import { assertTransportOk, parseTransportJson } from "./transportErrors.js";
import { normalizeRemoteUrl } from "./transportUrl.js";

export function createLocalHttpRelayTransport() {
  return {
    id: "local-http-relay",
    kind: "local-http-relay",
    capabilities: ["send-bundle", "pull-queued", "list-routes", "list-queue", "health"],
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
        remoteUrl: normalizedRemoteUrl,
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
        remoteUrl: normalizedRemoteUrl,
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
