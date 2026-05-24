function normalizeRemoteUrl(remoteUrl) {
  if (!remoteUrl) {
    throw new Error("Missing remoteUrl for transport delivery.");
  }

  const url = new URL(remoteUrl);
  return url.toString().replace(/\/+$/g, "");
}

export function createLocalHttpAgentTransport() {
  return {
    id: "local-http-agent",
    kind: "local-http-agent",
    capabilities: ["send-bundle", "health"],
    async health({ remoteUrl }) {
      const normalizedRemoteUrl = normalizeRemoteUrl(remoteUrl);
      const response = await fetch(`${normalizedRemoteUrl}/health`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error ?? `Agent transport health failed: ${response.status}`);
      }
      return {
        remoteUrl: normalizedRemoteUrl,
        payload
      };
    },
    async sendBundle({ bundle, options = {} }) {
      const normalizedRemoteUrl = normalizeRemoteUrl(options.remoteUrl);
      const response = await fetch(`${normalizedRemoteUrl}/transport/accept-bundle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ bundle })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error ?? `Remote delivery failed: ${response.status}`);
      }

      return {
        remoteUrl: normalizedRemoteUrl,
        payload
      };
    }
  };
}
