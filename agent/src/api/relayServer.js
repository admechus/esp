import { createServer } from "node:http";
import { resolve } from "node:path";
import { createRelayReceipt } from "../protocol/receipts.js";
import { createTransportBundle, validateTransportBundle } from "../protocol/transportBundles.js";
import { createRelayQueueStore } from "../storage/relayQueueStore.js";
import { createTransferStore } from "../storage/transferStore.js";

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
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

function normalizeRouteMap(routes = []) {
  const routeMap = new Map();

  for (const route of routes) {
    if (!route) {
      continue;
    }

    const separatorIndex = route.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid route definition: ${route}`);
    }

    const name = route.slice(0, separatorIndex).trim();
    const targetUrl = route.slice(separatorIndex + 1).trim().replace(/\/+$/g, "");
    if (!name || !targetUrl) {
      throw new Error(`Invalid route definition: ${route}`);
    }

    routeMap.set(name, targetUrl);
  }

  return routeMap;
}

async function forwardBundleToTarget({
  bundle,
  targetAgent,
  targetUrl,
  relayName,
  transferStore
}) {
  const transferId = `transfer:${Date.now()}`;
  const relayReceipt = createRelayReceipt({
    transferId,
    targetAgent,
    targetUrl,
    sourceAgent: bundle.source?.agentName ?? null,
    messageCount: bundle.messageCount ?? bundle.messages.length
  });

  const downstreamResponse = await fetch(`${targetUrl}/transport/accept-bundle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      bundle: createTransportBundle({
        source: {
          ...bundle.source,
          relayName
        },
        messages: bundle.messages
      })
    })
  });
  const downstreamPayload = await downstreamResponse.json().catch(() => null);
  if (!downstreamResponse.ok || downstreamPayload?.ok === false) {
    throw new Error(downstreamPayload?.error ?? `Relay forward failed: ${downstreamResponse.status}`);
  }

  const transferRecord = await transferStore.upsertTransfer({
    transferId,
    relayReceiptId: relayReceipt.relayReceiptId,
    relayName,
    sourceAgent: bundle.source?.agentName ?? null,
    targetAgent,
    targetUrl,
    messageCount: bundle.messageCount ?? bundle.messages.length,
    receivedAt: relayReceipt.receivedAt,
    receipts: downstreamPayload?.result?.receipts ?? [],
    accepted: downstreamPayload?.result?.accepted ?? []
  });

  return {
    transferRecord,
    relayReceipt,
    downstreamPayload
  };
}

async function forwardReceiptToTarget({
  receipt,
  targetAgent,
  targetUrl,
  relayName
}) {
  const downstreamResponse = await fetch(`${targetUrl}/receipts/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      receipt: {
        ...receipt,
        relayName: receipt.relayName ?? relayName
      },
      relayName
    })
  });
  const downstreamPayload = await downstreamResponse.json().catch(() => null);
  if (!downstreamResponse.ok || downstreamPayload?.ok === false) {
    throw new Error(
      downstreamPayload?.error ?? `Relay receipt forward failed: ${downstreamResponse.status}`
    );
  }

  return downstreamPayload;
}

export function createRelayApiServer({
  host = "127.0.0.1",
  port = 8790,
  relayName = "relay",
  routes = [],
  stateDir = resolve(process.cwd(), "agent", "state-relay")
}) {
  const routeMap = normalizeRouteMap(routes);
  const transferStore = createTransferStore({
    transfersFile: resolve(stateDir, "relay-transfers.json")
  });
  const queueStore = createRelayQueueStore({
    queueFile: resolve(stateDir, "relay-queue.json")
  });

  const relayInfo = {
    name: relayName,
    stateDir: resolve(stateDir),
    queueFile: resolve(stateDir, "relay-queue.json"),
    routes: Array.from(routeMap.entries()).map(([name, targetUrl]) => ({
      name,
      targetUrl
    }))
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? `${host}:${port}`}`);
      const pathname = normalizePath(url.pathname);
      const method = request.method ?? "GET";

      if (method === "GET" && pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          service: "esp-messenger-relay",
          relay: relayInfo
        });
        return;
      }

      if (method === "GET" && pathname === "/relay/routes") {
        sendJson(response, 200, {
          ok: true,
          relay: relayInfo,
          routes: relayInfo.routes
        });
        return;
      }

      if (method === "GET" && pathname === "/relay/transfers") {
        sendJson(response, 200, {
          ok: true,
          relay: relayInfo,
          transfers: await transferStore.listTransfers()
        });
        return;
      }

      if (method === "GET" && pathname === "/app/state") {
        sendJson(response, 200, {
          ok: true,
          relay: relayInfo,
          transfers: await transferStore.listTransfers(),
          queue: await queueStore.listEntries()
        });
        return;
      }

      if (method === "GET" && pathname === "/relay/queue") {
        const targetAgent = url.searchParams.get("targetAgent") ?? null;
        sendJson(response, 200, {
          ok: true,
          relay: relayInfo,
          targetAgent,
          queue: targetAgent
            ? await queueStore.listPendingEntries(targetAgent)
            : await queueStore.listEntries()
        });
        return;
      }

      if (method === "POST" && pathname === "/relay/deliver") {
        const body = await readJsonBody(request);
        const bundle = validateTransportBundle(body.bundle);
        const targetAgent = body.targetAgent ?? null;
        const allowQueue = body.allowQueue !== false;
        const storeOnly = body.storeOnly === true;

        if (!targetAgent) {
          throw new Error("Missing targetAgent for relay delivery.");
        }

        const targetUrl = routeMap.get(targetAgent);
        if (!targetUrl) {
          throw new Error(`Unknown relay target: ${targetAgent}`);
        }

        if (storeOnly) {
          const queued = await queueStore.enqueueBundle({
            targetAgent,
            targetUrl,
            sourceAgent: bundle.source?.agentName ?? null,
            relayName,
            bundle,
            queueReason: "manual_store_only"
          });

          sendJson(response, 200, {
            ok: true,
            relay: relayInfo,
            result: {
              queued: true,
              queueId: queued.queueId,
              queueReason: queued.queueReason,
              targetAgent,
              targetUrl,
              messageCount: queued.messageCount
            }
          });
          return;
        }

        try {
          const { transferRecord, relayReceipt, downstreamPayload } = await forwardBundleToTarget({
            bundle,
            targetAgent,
            targetUrl,
            relayName,
            transferStore
          });

          sendJson(response, 200, {
            ok: true,
            relay: relayInfo,
            result: {
              queued: false,
              transferId: transferRecord.transferId,
              relayReceiptId: relayReceipt.relayReceiptId,
              targetAgent,
              targetUrl,
              accepted: downstreamPayload?.result?.accepted ?? [],
              receipts: downstreamPayload?.result?.receipts ?? [],
              downstream: downstreamPayload?.result ?? null
            }
          });
        } catch (error) {
          if (!allowQueue) {
            throw error;
          }

          const queued = await queueStore.enqueueBundle({
            targetAgent,
            targetUrl,
            sourceAgent: bundle.source?.agentName ?? null,
            relayName,
            bundle,
            queueReason: "downstream_unavailable",
            lastError: error.message
          });

          sendJson(response, 200, {
            ok: true,
            relay: relayInfo,
            result: {
              queued: true,
              queueId: queued.queueId,
              queueReason: queued.queueReason,
              error: error.message,
              targetAgent,
              targetUrl,
              messageCount: queued.messageCount
            }
          });
        }
        return;
      }

      if (method === "POST" && pathname === "/relay/pull") {
        const body = await readJsonBody(request);
        const targetAgent = body.targetAgent ?? null;
        if (!targetAgent) {
          throw new Error("Missing targetAgent for relay pull.");
        }

        const queuedEntries = await queueStore.listPendingEntries(targetAgent);
        const delivered = [];
        const failed = [];

        for (const entry of queuedEntries) {
          const targetUrl = routeMap.get(targetAgent) ?? entry.targetUrl;
          if (!targetUrl) {
            await queueStore.markFailed(entry.queueId, `Unknown relay target: ${targetAgent}`);
            failed.push({
              queueId: entry.queueId,
              error: `Unknown relay target: ${targetAgent}`
            });
            continue;
          }

          try {
            const { transferRecord, relayReceipt, downstreamPayload } = await forwardBundleToTarget({
              bundle: entry.bundle,
              targetAgent,
              targetUrl,
              relayName,
              transferStore
            });

            await queueStore.markDelivered(entry.queueId, {
              transferId: transferRecord.transferId,
              relayReceiptId: relayReceipt.relayReceiptId,
              targetUrl
            });

            const receiptForwarded = [];
            const receiptForwardFailures = [];
            const sourceTargetUrl = entry.sourceAgent ? routeMap.get(entry.sourceAgent) : null;
            for (const receipt of downstreamPayload?.result?.receipts ?? []) {
              if (!entry.sourceAgent || !sourceTargetUrl) {
                receiptForwardFailures.push({
                  receiptId: receipt.receiptId,
                  error: "No source agent route for queued receipt forwarding."
                });
                continue;
              }

              try {
                await forwardReceiptToTarget({
                  receipt,
                  targetAgent: entry.sourceAgent,
                  targetUrl: sourceTargetUrl,
                  relayName
                });
                receiptForwarded.push(receipt.receiptId);
              } catch (error) {
                receiptForwardFailures.push({
                  receiptId: receipt.receiptId,
                  error: error.message
                });
              }
            }

            delivered.push({
              queueId: entry.queueId,
              transferId: transferRecord.transferId,
              relayReceiptId: relayReceipt.relayReceiptId,
              targetAgent,
              targetUrl,
              accepted: downstreamPayload?.result?.accepted ?? [],
              receipts: downstreamPayload?.result?.receipts ?? [],
              receiptForwarded,
              receiptForwardFailures
            });
          } catch (error) {
            await queueStore.markFailed(entry.queueId, error.message);
            failed.push({
              queueId: entry.queueId,
              targetAgent,
              targetUrl,
              error: error.message
            });
          }
        }

        const remaining = await queueStore.listPendingEntries(targetAgent);
        sendJson(response, 200, {
          ok: true,
          relay: relayInfo,
          result: {
            targetAgent,
            pulledCount: queuedEntries.length,
            deliveredCount: delivered.length,
            failedCount: failed.length,
            remainingCount: remaining.length,
            delivered,
            failed
          }
        });
        return;
      }

      if (method === "POST" && pathname === "/relay/queue/delete") {
        const body = await readJsonBody(request);
        const queueId = body.queueId ?? null;
        if (!queueId) {
          throw new Error("Missing queueId for relay queue delete.");
        }

        const deleted = await queueStore.deleteEntry(queueId);
        if (!deleted) {
          throw new Error(`Unknown relay queue entry: ${queueId}`);
        }

        sendJson(response, 200, {
          ok: true,
          relay: relayInfo,
          result: {
            deleted: true,
            queueId,
            entry: deleted,
            remainingCount: (await queueStore.listEntries()).length
          }
        });
        return;
      }

      if (method === "POST" && pathname === "/relay/forward-receipt") {
        const body = await readJsonBody(request);
        const receipt = body.receipt ?? null;
        const targetAgent = body.targetAgent ?? null;

        if (!receipt?.receiptId) {
          throw new Error("Missing receipt for relay forwarding.");
        }
        if (!targetAgent) {
          throw new Error("Missing targetAgent for receipt forwarding.");
        }

        const targetUrl = routeMap.get(targetAgent);
        if (!targetUrl) {
          throw new Error(`Unknown relay target: ${targetAgent}`);
        }

        const downstreamPayload = await forwardReceiptToTarget({
          receipt,
          targetAgent,
          targetUrl,
          relayName
        });

        sendJson(response, 200, {
          ok: true,
          relay: relayInfo,
          agent: downstreamPayload?.agent ?? null,
          result: {
            targetAgent,
            targetUrl,
            receipt: downstreamPayload?.result ?? null
          }
        });
        return;
      }

      sendJson(response, 404, {
        ok: false,
        error: "not_found"
      });
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

      return {
        host,
        port
      };
    },
    async close() {
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
