function normalizeRemoteUrl(remoteUrl) {
  if (!remoteUrl) {
    throw new Error("Missing remoteUrl for relay transport.");
  }

  const url = new URL(remoteUrl);
  return url.toString().replace(/\/+$/g, "");
}

export function createLocalHttpRelayTransport() {
  return {
    id: "local-http-relay",
    kind: "local-http-relay",
    capabilities: ["send-bundle", "pull-queued", "list-routes", "list-queue", "health"],
    async health({ remoteUrl }) {
      const normalizedRemoteUrl = normalizeRemoteUrl(remoteUrl);
      const response = await fetch(`${normalizedRemoteUrl}/health`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error ?? `Relay transport health failed: ${response.status}`);
      }
      return {
        remoteUrl: normalizedRemoteUrl,
        payload
      };
    },
    async sendBundle({ target, bundle, options = {} }) {
      const normalizedRemoteUrl = normalizeRemoteUrl(options.remoteUrl);
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

      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error ?? `Remote delivery failed: ${response.status}`);
      }

      return {
        remoteUrl: normalizedRemoteUrl,
        payload
      };
    },
    async pullQueued({ target, options = {} }) {
      const normalizedRemoteUrl = normalizeRemoteUrl(options.remoteUrl);
      const response = await fetch(`${normalizedRemoteUrl}/relay/pull`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          targetAgent: target
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error ?? `Relay pull failed: ${response.status}`);
      }

      return {
        remoteUrl: normalizedRemoteUrl,
        payload
      };
    },
    async listRoutes({ options = {} } = {}) {
      const normalizedRemoteUrl = normalizeRemoteUrl(options.remoteUrl);
      const response = await fetch(`${normalizedRemoteUrl}/relay/routes`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error ?? `Relay route listing failed: ${response.status}`);
      }
      return {
        remoteUrl: normalizedRemoteUrl,
        payload
      };
    },
    async listQueue({ options = {}, target = null } = {}) {
      const normalizedRemoteUrl = normalizeRemoteUrl(options.remoteUrl);
      const queueUrl = new URL(`${normalizedRemoteUrl}/relay/queue`);
      if (target) {
        queueUrl.searchParams.set("targetAgent", target);
      }
      const response = await fetch(queueUrl);
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error ?? `Relay queue listing failed: ${response.status}`);
      }
      return {
        remoteUrl: normalizedRemoteUrl,
        payload
      };
    }
  };
}
