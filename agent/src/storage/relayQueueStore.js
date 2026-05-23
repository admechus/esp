import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256Buffer } from "../crypto/p256Identity.js";

function getDefaultQueueFile() {
  return resolve(process.cwd(), "agent", "state", "relay-queue.json");
}

async function loadStore(queueFile) {
  try {
    const raw = await readFile(queueFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.queue) ? parsed : { version: 1, queue: [] };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, queue: [] };
    }
    throw error;
  }
}

async function saveStore(queueFile, store) {
  await mkdir(dirname(queueFile), { recursive: true });
  await writeFile(queueFile, JSON.stringify(store, null, 2) + "\n", "utf8");
}

function createQueueId({ bundle, targetAgent, queuedAt }) {
  const idMaterial = [
    targetAgent ?? "",
    bundle?.createdAt ?? "",
    bundle?.source?.agentName ?? "",
    String(bundle?.messageCount ?? bundle?.messages?.length ?? 0),
    queuedAt
  ].join("|");

  return `queue:${sha256Buffer(Buffer.from(idMaterial, "utf8")).toString("hex").slice(0, 32)}`;
}

export function createRelayQueueStore({ queueFile = getDefaultQueueFile() } = {}) {
  return {
    queueFile,
    async listEntries() {
      const store = await loadStore(queueFile);
      return store.queue;
    },
    async getEntry(queueId) {
      const entries = await this.listEntries();
      return entries.find((entry) => entry.queueId === queueId) ?? null;
    },
    async listPendingEntries(targetAgent = null) {
      const entries = await this.listEntries();
      return entries.filter(
        (entry) => entry.status === "queued" && (!targetAgent || entry.targetAgent === targetAgent)
      );
    },
    async enqueueBundle({
      targetAgent,
      targetUrl,
      sourceAgent = null,
      relayName = null,
      bundle,
      queueReason = "downstream_unavailable",
      lastError = null
    }) {
      const store = await loadStore(queueFile);
      const now = new Date().toISOString();
      const queueId = createQueueId({
        bundle,
        targetAgent,
        queuedAt: now
      });

      const entry = {
        queueId,
        targetAgent,
        targetUrl,
        sourceAgent,
        relayName,
        messageCount: bundle?.messageCount ?? bundle?.messages?.length ?? 0,
        status: "queued",
        queueReason,
        lastError,
        queuedAt: now,
        updatedAt: now,
        bundle
      };

      store.queue.push(entry);
      store.queue.sort((left, right) =>
        (right.queuedAt ?? right.createdAt ?? "").localeCompare(left.queuedAt ?? left.createdAt ?? "")
      );
      await saveStore(queueFile, store);
      return entry;
    },
    async markDelivered(queueId, details = {}) {
      const store = await loadStore(queueFile);
      const now = new Date().toISOString();
      const entryIndex = store.queue.findIndex((entry) => entry.queueId === queueId);
      if (entryIndex < 0) {
        return null;
      }

      store.queue[entryIndex] = {
        ...store.queue[entryIndex],
        ...details,
        status: "delivered",
        deliveredAt: details.deliveredAt ?? now,
        updatedAt: now,
        lastError: null
      };
      await saveStore(queueFile, store);
      return store.queue[entryIndex];
    },
    async markFailed(queueId, errorMessage) {
      const store = await loadStore(queueFile);
      const now = new Date().toISOString();
      const entryIndex = store.queue.findIndex((entry) => entry.queueId === queueId);
      if (entryIndex < 0) {
        return null;
      }

      store.queue[entryIndex] = {
        ...store.queue[entryIndex],
        status: "queued",
        lastError: errorMessage,
        lastAttemptAt: now,
        updatedAt: now
      };
      await saveStore(queueFile, store);
      return store.queue[entryIndex];
    },
    async deleteEntry(queueId) {
      const store = await loadStore(queueFile);
      const entryIndex = store.queue.findIndex((entry) => entry.queueId === queueId);
      if (entryIndex < 0) {
        return null;
      }

      const [deletedEntry] = store.queue.splice(entryIndex, 1);
      await saveStore(queueFile, store);
      return deletedEntry;
    }
  };
}
