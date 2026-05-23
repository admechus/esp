import dgram from "node:dgram";
import os from "node:os";

export const DEFAULT_LAN_PRESENCE_PORT = 36111;
export const DEFAULT_LAN_PRESENCE_INTERVAL_MS = 5000;
export const DEFAULT_LAN_PRESENCE_EXPIRY_MS = 20000;
const PRESENCE_PROTOCOL = "esp-messenger-lan-presence/v1";

function normalizeAddress(address) {
  if (!address) {
    return null;
  }

  if (address === "::1") {
    return "127.0.0.1";
  }

  if (address.startsWith("::ffff:")) {
    return address.slice("::ffff:".length);
  }

  return address;
}

function chooseAdvertisedHost({ advertiseHost, listenHost, sourceAddress }) {
  if (advertiseHost) {
    return advertiseHost;
  }

  if (listenHost && listenHost !== "0.0.0.0" && listenHost !== "::" && listenHost !== "127.0.0.1") {
    return listenHost;
  }

  return normalizeAddress(sourceAddress) ?? os.hostname();
}

function createBasePayload({
  agentName,
  listenHost,
  listenPort,
  advertiseHost,
  runtime,
  role = "agent"
}) {
  return {
    protocol: PRESENCE_PROTOCOL,
    emittedAt: new Date().toISOString(),
    nodeType: "host-agent",
    role,
    agentName,
    listenPort,
    listenHost,
    advertiseHost,
    hostName: os.hostname(),
    agent: runtime.getAgentInfo()
  };
}

export function createLanPresenceAdvertiser({
  runtime,
  deviceOptions = {},
  agentName,
  role = "agent",
  listenHost = "127.0.0.1",
  listenPort,
  advertiseHost = null,
  beaconPort = DEFAULT_LAN_PRESENCE_PORT,
  intervalMs = DEFAULT_LAN_PRESENCE_INTERVAL_MS,
  targets = ["255.255.255.255", "127.0.0.1"]
}) {
  let socket = null;
  let timer = null;

  async function buildPayload() {
    const identity = await runtime.getCachedIdentitySummary().catch(() => null);
    const deviceInfo = await runtime.getCachedDeviceInfo().catch(() => null);
    const platformIo = await runtime.getCachedPlatformIo().catch(() => null);

    return {
      ...createBasePayload({
        agentName,
        listenHost,
        listenPort,
        advertiseHost,
        runtime,
        role
      }),
      identity: identity
        ? {
            keyId: identity.keyId ?? null,
            fingerprintHex: identity.fingerprintHex ?? null,
            algorithm: identity.algorithm ?? null,
            curve: identity.curve ?? null
          }
        : null,
      deviceInfo: deviceInfo
        ? {
            device: deviceInfo.device ?? null,
            chip: deviceInfo.chip ?? null,
            profile: deviceInfo.profile ?? null,
            transport: deviceInfo.transport ?? null,
            version: deviceInfo.version ?? null
          }
        : null,
      outputs: Array.isArray(platformIo?.outputs)
        ? platformIo.outputs.map((output) => ({
            kind: output.kind ?? null,
            status: output.status ?? null,
            driver: output.driver ?? null,
            driverFamily: output.driverFamily ?? null,
            i2cAddress: output.i2cAddress ?? null
          }))
        : []
    };
  }

  async function broadcastOnce() {
    if (!socket) {
      return;
    }

    const payload = Buffer.from(JSON.stringify(await buildPayload()));
    await Promise.all(
      targets.map(
        (target) =>
          new Promise((resolve) => {
            socket.send(payload, beaconPort, target, () => resolve());
          })
      )
    );
  }

  return {
    async start() {
      if (socket) {
        return;
      }

      socket = dgram.createSocket("udp4");
      await new Promise((resolve, reject) => {
        socket.once("error", reject);
        socket.bind(0, "0.0.0.0", () => {
          socket.off("error", reject);
          socket.setBroadcast(true);
          resolve();
        });
      });

      await broadcastOnce();
      timer = setInterval(() => {
        broadcastOnce().catch(() => {});
      }, intervalMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      if (!socket) {
        return;
      }

      await new Promise((resolve) => {
        socket.close(() => resolve());
      });
      socket = null;
    }
  };
}

export function createLanPresenceListener({
  port = DEFAULT_LAN_PRESENCE_PORT,
  expiryMs = DEFAULT_LAN_PRESENCE_EXPIRY_MS
}) {
  let socket = null;
  const entries = new Map();

  function pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of entries.entries()) {
      if (!entry.expiresAt || Date.parse(entry.expiresAt) <= now) {
        entries.delete(key);
      }
    }
  }

  function handleMessage(message, rinfo) {
    try {
      const payload = JSON.parse(message.toString("utf8"));
      if (payload?.protocol !== PRESENCE_PROTOCOL) {
        return;
      }

      const sourceAddress = normalizeAddress(rinfo.address);
      const advertisedHost = chooseAdvertisedHost({
        advertiseHost: payload.advertiseHost,
        listenHost: payload.listenHost,
        sourceAddress
      });
      const listenPort = Number.parseInt(String(payload.listenPort ?? ""), 10);
      if (!listenPort) {
        return;
      }

      const now = new Date();
      const entry = {
        id: `${payload.agentName ?? "agent"}@${sourceAddress}:${listenPort}`,
        protocol: payload.protocol,
        agentName: payload.agentName ?? "agent",
        role: payload.role ?? "agent",
        nodeType: payload.nodeType ?? "host-agent",
        hostName: payload.hostName ?? null,
        sourceAddress,
        advertisedHost,
        listenPort,
        baseUrl: `http://${advertisedHost}:${listenPort}`,
        identity: payload.identity ?? null,
        deviceInfo: payload.deviceInfo ?? null,
        outputs: Array.isArray(payload.outputs) ? payload.outputs : [],
        firstSeenAt: entries.get(`${payload.agentName ?? "agent"}@${sourceAddress}:${listenPort}`)?.firstSeenAt ?? now.toISOString(),
        lastSeenAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + expiryMs).toISOString()
      };

      entries.set(entry.id, entry);
      pruneExpired();
    } catch {
      // ignore malformed beacons
    }
  }

  return {
    async start() {
      if (socket) {
        return;
      }

      socket = dgram.createSocket("udp4");
      socket.on("message", handleMessage);
      await new Promise((resolve, reject) => {
        socket.once("error", reject);
        socket.bind(port, "0.0.0.0", () => {
          socket.off("error", reject);
          resolve();
        });
      });
    },
    async stop() {
      if (!socket) {
        return;
      }

      await new Promise((resolve) => {
        socket.close(() => resolve());
      });
      socket = null;
    },
    listEntries() {
      pruneExpired();
      return [...entries.values()].sort((left, right) => (right.lastSeenAt ?? "").localeCompare(left.lastSeenAt ?? ""));
    }
  };
}
