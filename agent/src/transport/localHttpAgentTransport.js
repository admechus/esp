import { assertTransportOk, parseTransportJson } from "./transportErrors.js";
import { normalizeRemoteUrl } from "./transportUrl.js";

export function createLocalHttpAgentTransport() {
  return {
    id: "local-http-agent",
    kind: "local-http-agent",
    capabilities: ["send-bundle", "health"],
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
        remoteUrl: normalizedRemoteUrl,
        payload
      };
    }
  };
}
