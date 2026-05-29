import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import {
  createLanPresenceAdvertiser,
  DEFAULT_LAN_PRESENCE_INTERVAL_MS,
  DEFAULT_LAN_PRESENCE_PORT
} from "../network/lanPresence.js";

const UI_FILES = {
  "/": {
    file: new URL("../../ui/index.html", import.meta.url),
    contentType: "text/html; charset=utf-8"
  },
  "/ui/app.css": {
    file: new URL("../../ui/app.css", import.meta.url),
    contentType: "text/css; charset=utf-8"
  },
  "/ui/app.js": {
    file: new URL("../../ui/app.js", import.meta.url),
    contentType: "application/javascript; charset=utf-8"
  }
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function sendFile(response, pathname) {
  const entry = UI_FILES[pathname];
  if (!entry) {
    return false;
  }

  const contents = await readFile(entry.file);
  response.writeHead(200, {
    "Content-Type": entry.contentType,
    "Cache-Control": "no-store"
  });
  response.end(contents);
  return true;
}

function sendNotFound(response) {
  sendJson(response, 404, {
    ok: false,
    error: "not_found"
  });
}

function normalizePath(pathname) {
  return pathname.replace(/\/+$/g, "") || "/";
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function buildDeviceOptions(baseOptions, body = {}) {
  return {
    ...baseOptions,
    label: body.label ?? baseOptions.label,
    toKeyId: body.toKeyId ?? baseOptions.toKeyId,
    filePath: body.filePath ?? baseOptions.filePath,
    remoteUrl: body.remoteUrl ?? baseOptions.remoteUrl,
    targetAgent: body.targetAgent ?? baseOptions.targetAgent,
    transportId: body.transportId ?? body.transport ?? baseOptions.transportId ?? null
  };
}

export function createAgentApiServer({
  runtime,
  deviceOptions = {},
  host = "127.0.0.1",
  port = 8787
}) {
  let syncTimer = null;
  let lanAdvertiser = null;
  let syncInFlight = false;
  const transportSync = {
    enabled: Boolean(deviceOptions.remoteUrl),
    intervalMs: deviceOptions.syncIntervalMs ?? 15000,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastResult: null
  };

  async function runTransportPull(reason = "scheduled") {
    if (!deviceOptions.remoteUrl || syncInFlight) {
      return {
        skipped: true,
        reason: !deviceOptions.remoteUrl ? "remote_not_configured" : "pull_in_flight"
      };
    }

    syncInFlight = true;
    transportSync.lastAttemptAt = new Date().toISOString();
    try {
      const result = await runtime.pullPendingFromRelay(deviceOptions.remoteUrl, {
        pullTargetAgent: runtime.getAgentInfo().name
      });
      transportSync.lastSuccessAt = new Date().toISOString();
      transportSync.lastError = null;
      transportSync.lastResult = {
        reason,
        pulledCount: result.pulledCount,
        deliveredCount: result.deliveredCount,
        failedCount: result.failedCount,
        remainingCount: result.remainingCount
      };
      return result;
    } catch (error) {
      transportSync.lastError = error.message;
      transportSync.lastResult = {
        reason,
        error: error.message
      };
      throw error;
    } finally {
      syncInFlight = false;
    }
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? `${host}:${port}`}`);
      const pathname = normalizePath(url.pathname);
      const method = request.method ?? "GET";

      if (method === "GET" && (await sendFile(response, pathname))) {
        return;
      }

      if (method === "GET" && pathname === "/health") {
        try {
          const deviceInfo = await runtime.getDeviceInfo(deviceOptions);
          let platformIo = null;
          let platformIoCached = false;
          let platformIoError = null;
          try {
            platformIo = await runtime.getPlatformIo(deviceOptions);
          } catch (error) {
            platformIo = await runtime.getCachedPlatformIo();
            platformIoCached = Boolean(platformIo);
            platformIoError = error.message;
          }
          sendJson(response, 200, {
            ok: true,
            service: "esp-messenger-agent",
            agent: runtime.getAgentInfo(),
            transport: deviceOptions.mock ? "mock" : deviceOptions.port ?? null,
            remoteUrl: deviceOptions.remoteUrl ?? null,
            targetAgent: deviceOptions.targetAgent ?? null,
            lanPresence: {
              enabled: !deviceOptions.mock,
              beaconPort: deviceOptions.lanBeaconPort ?? DEFAULT_LAN_PRESENCE_PORT,
              intervalMs: deviceOptions.lanBeaconIntervalMs ?? DEFAULT_LAN_PRESENCE_INTERVAL_MS
            },
            transportSync,
            deviceInfo,
            platformIo,
            platformIoCached,
            platformIoError
          });
        } catch (error) {
          const cachedDeviceInfo = await runtime.getCachedDeviceInfo();
          const cachedPlatformIo = await runtime.getCachedPlatformIo();
          sendJson(response, 200, {
            ok: true,
            service: "esp-messenger-agent",
            agent: runtime.getAgentInfo(),
            transport: deviceOptions.mock ? "mock" : deviceOptions.port ?? null,
            remoteUrl: deviceOptions.remoteUrl ?? null,
            targetAgent: deviceOptions.targetAgent ?? null,
            lanPresence: {
              enabled: !deviceOptions.mock,
              beaconPort: deviceOptions.lanBeaconPort ?? DEFAULT_LAN_PRESENCE_PORT,
              intervalMs: deviceOptions.lanBeaconIntervalMs ?? DEFAULT_LAN_PRESENCE_INTERVAL_MS
            },
            transportSync,
            deviceInfo: cachedDeviceInfo,
            deviceInfoCached: Boolean(cachedDeviceInfo),
            deviceInfoError: error.message,
            platformIo: cachedPlatformIo,
            platformIoCached: Boolean(cachedPlatformIo),
            platformIoError: error.message
          });
        }
        return;
      }

      if (method === "GET" && pathname === "/transport/sync-status") {
        sendJson(response, 200, {
          ok: true,
          transportSync
        });
        return;
      }

      if (method === "GET" && pathname === "/app/state") {
        const peers = await runtime.listPeers();
        const messages = await runtime.listMessages();
        const outbox = await runtime.listOutboxMessages();
        const receipts = await runtime.listReceipts();
        const agent = {
          ...runtime.getAgentInfo(),
          transport: deviceOptions.mock ? "mock" : deviceOptions.port ?? null,
          remoteUrl: deviceOptions.remoteUrl ?? null,
          targetAgent: deviceOptions.targetAgent ?? null,
          lanPresence: {
            enabled: !deviceOptions.mock,
            beaconPort: deviceOptions.lanBeaconPort ?? DEFAULT_LAN_PRESENCE_PORT,
            intervalMs: deviceOptions.lanBeaconIntervalMs ?? DEFAULT_LAN_PRESENCE_INTERVAL_MS
          },
          syncIntervalMs: deviceOptions.syncIntervalMs ?? 15000
        };
        let deviceInfo = null;
        let deviceInfoCached = false;
        let deviceInfoError = null;
        let platformIo = null;
        let platformIoCached = false;
        let platformIoError = null;
        try {
          deviceInfo = await runtime.getDeviceInfo(deviceOptions);
        } catch (error) {
          deviceInfo = await runtime.getCachedDeviceInfo();
          deviceInfoCached = Boolean(deviceInfo);
          deviceInfoError = error.message;
        }
        try {
          platformIo = await runtime.getPlatformIo(deviceOptions);
        } catch (error) {
          platformIo = await runtime.getCachedPlatformIo();
          platformIoCached = Boolean(platformIo);
          platformIoError = error.message;
        }
        try {
          const identity = await runtime.getIdentitySummary(deviceOptions);
          sendJson(response, 200, {
            ok: true,
            agent,
            transportSync,
            deviceInfo,
            deviceInfoCached,
            deviceInfoError,
            platformIo,
            platformIoCached,
            platformIoError,
            identity,
            peers,
            messages,
            outbox,
            receipts
          });
        } catch (error) {
          const cachedIdentity = await runtime.getCachedIdentitySummary();
          sendJson(response, 200, {
            ok: true,
            agent,
            transportSync,
            deviceInfo,
            deviceInfoCached,
            deviceInfoError,
            platformIo,
            platformIoCached,
            platformIoError,
            identity: cachedIdentity,
            identityCached: Boolean(cachedIdentity),
            identityError: error.message,
            peers,
            messages,
            outbox,
            receipts
          });
        }
        return;
      }

      if (method === "GET" && pathname === "/profiles") {
        sendJson(response, 200, {
          ok: true,
          profiles: runtime.listProfiles()
        });
        return;
      }

      if (method === "GET" && pathname === "/ports") {
        sendJson(response, 200, {
          ok: true,
          ports: await runtime.listPorts()
        });
        return;
      }

      if (method === "GET" && pathname === "/identity/summary") {
        sendJson(response, 200, {
          ok: true,
          identity: await runtime.getIdentitySummary(deviceOptions)
        });
        return;
      }

      if (method === "POST" && pathname === "/identity/remember-self") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          peer: await runtime.rememberSelf(buildDeviceOptions(deviceOptions, body))
        });
        return;
      }

      if (method === "POST" && pathname === "/device/test-output") {
        const body = await readJsonBody(request);
        const options = buildDeviceOptions(deviceOptions, body);
        sendJson(response, 200, {
          ok: true,
          result: await runtime.testOutput(body.target ?? "all", options)
        });
        return;
      }

      if (method === "GET" && pathname === "/peers") {
        sendJson(response, 200, {
          ok: true,
          peers: await runtime.listPeers()
        });
        return;
      }

      if (method === "GET" && pathname.startsWith("/peers/")) {
        const keyId = decodeURIComponent(pathname.slice("/peers/".length));
        const peer = await runtime.getPeer(keyId);
        if (!peer) {
          sendNotFound(response);
          return;
        }

        sendJson(response, 200, {
          ok: true,
          peer
        });
        return;
      }

      if (method === "GET" && pathname === "/messages") {
        sendJson(response, 200, {
          ok: true,
          messages: await runtime.listMessages()
        });
        return;
      }

      if (method === "GET" && pathname === "/outbox") {
        sendJson(response, 200, {
          ok: true,
          messages: await runtime.listOutboxMessages()
        });
        return;
      }

      if (method === "GET" && pathname === "/receipts") {
        sendJson(response, 200, {
          ok: true,
          receipts: await runtime.listReceipts()
        });
        return;
      }

      if (method === "GET" && pathname.startsWith("/outbox/")) {
        const messageId = decodeURIComponent(pathname.slice("/outbox/".length));
        const message = await runtime.getOutboxMessage(messageId);
        if (!message) {
          sendNotFound(response);
          return;
        }

        sendJson(response, 200, {
          ok: true,
          message
        });
        return;
      }

      if (method === "GET" && pathname.startsWith("/messages/")) {
        const messageId = decodeURIComponent(pathname.slice("/messages/".length));
        const message = await runtime.getMessage(messageId);
        if (!message) {
          sendNotFound(response);
          return;
        }

        sendJson(response, 200, {
          ok: true,
          message
        });
        return;
      }

      if (method === "POST" && pathname === "/messages/read") {
        const body = await readJsonBody(request);
        const options = buildDeviceOptions(deviceOptions, body);
        sendJson(response, 200, {
          ok: true,
          result: await runtime.markMessageRead(body.messageId, options)
        });
        return;
      }

      if (method === "POST" && pathname === "/envelopes/text") {
        const body = await readJsonBody(request);
        const options = buildDeviceOptions(deviceOptions, body);
        const save = Boolean(body.save);
        const payload = save
          ? await runtime.createAndSaveSignedTextEnvelope(body.text ?? "", options)
          : await runtime.createSignedTextEnvelope(body.text ?? "", options);

        sendJson(response, 200, {
          ok: true,
          ...payload
        });
        return;
      }

      if (method === "POST" && pathname === "/envelopes/verify") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          verification: await runtime.verifyEnvelopeFile(body.filePath)
        });
        return;
      }

      if (method === "POST" && pathname === "/envelopes/import") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          result: await runtime.importEnvelope(body.filePath, body)
        });
        return;
      }

      if (method === "POST" && pathname === "/envelopes/receive") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          result: await runtime.receiveEnvelope(body.filePath, body)
        });
        return;
      }

      if (method === "POST" && pathname === "/outbox/receive") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          result: await runtime.receiveOutboxMessage(body.messageId, body)
        });
        return;
      }

      if (method === "POST" && pathname === "/transport/export") {
        const body = await readJsonBody(request);
        const options = buildDeviceOptions(deviceOptions, body);
        sendJson(response, 200, {
          ok: true,
          result: await runtime.exportOutboxBundle(options)
        });
        return;
      }

      if (method === "POST" && pathname === "/transport/import") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          result: await runtime.importTransportBundle(body.filePath, body)
        });
        return;
      }

      if (method === "POST" && pathname === "/transport/accept-bundle") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          agent: runtime.getAgentInfo(),
          result: await runtime.importTransportBundleData(body.bundle, body, {
            sourceLabel: `remote:${body.bundle?.source?.agentName ?? "unknown-agent"}`,
            deliveryStatus: "delivered_remote",
            relayName: body.bundle?.source?.relayName ?? body.relayName ?? null
          })
        });
        return;
      }

      if (method === "POST" && pathname === "/transport/deliver") {
        const body = await readJsonBody(request);
        const options = buildDeviceOptions(deviceOptions, body);
        const remoteUrl = options.remoteUrl;
        sendJson(response, 200, {
          ok: true,
          result: await runtime.deliverTransportBundle(remoteUrl, options)
        });
        return;
      }

      if (method === "POST" && pathname === "/transport/pull") {
        await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          result: await runTransportPull("manual")
        });
        return;
      }

      if (method === "POST" && pathname === "/receipts/accept") {
        const body = await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          agent: runtime.getAgentInfo(),
          result: await runtime.acceptReceipt(body.receipt, body)
        });
        return;
      }

      sendNotFound(response);
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error.message
      });
    }
  });

  return {
    async listen() {
      await new Promise((resolvePromise, rejectPromise) => {
        server.once("error", rejectPromise);
        server.listen(port, host, () => {
          server.off("error", rejectPromise);
          resolvePromise();
        });
      });

      if (transportSync.enabled && Number.isFinite(transportSync.intervalMs) && transportSync.intervalMs > 0) {
        syncTimer = setInterval(() => {
          runTransportPull("scheduled").catch(() => {});
        }, transportSync.intervalMs);
        syncTimer.unref?.();
        queueMicrotask(() => {
          runTransportPull("startup").catch(() => {});
        });
      }

      if (!deviceOptions.mock) {
        lanAdvertiser = createLanPresenceAdvertiser({
          runtime,
          deviceOptions,
          agentName: runtime.getAgentInfo().name,
          listenHost: host,
          listenPort: port,
          advertiseHost: deviceOptions.advertiseHost ?? null,
          beaconPort: deviceOptions.lanBeaconPort ?? DEFAULT_LAN_PRESENCE_PORT,
          intervalMs: deviceOptions.lanBeaconIntervalMs ?? DEFAULT_LAN_PRESENCE_INTERVAL_MS
        });
        await lanAdvertiser.start();
      }

      return {
        host,
        port
      };
    },
    async close() {
      if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
      }
      if (lanAdvertiser) {
        await lanAdvertiser.stop();
        lanAdvertiser = null;
      }
      await new Promise((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      });
    }
  };
}
