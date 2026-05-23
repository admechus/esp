import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function getDefaultOutboxFile() {
  return resolve(process.cwd(), "agent", "state", "outbox-log.json");
}

async function loadStore(outboxFile) {
  try {
    const raw = await readFile(outboxFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.messages) ? parsed : { version: 1, messages: [] };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, messages: [] };
    }
    throw error;
  }
}

async function saveStore(outboxFile, store) {
  await mkdir(dirname(outboxFile), { recursive: true });
  await writeFile(outboxFile, JSON.stringify(store, null, 2) + "\n", "utf8");
}

export function createOutboxStore({ outboxFile = getDefaultOutboxFile() } = {}) {
  return {
    outboxFile,
    async listMessages() {
      const store = await loadStore(outboxFile);
      return store.messages;
    },
    async getMessage(messageId) {
      const messages = await this.listMessages();
      return messages.find((message) => message.messageId === messageId) ?? null;
    },
    async upsertMessage(message) {
      const store = await loadStore(outboxFile);
      const now = new Date().toISOString();
      const normalizedMessage = {
        ...message,
        updatedAt: now
      };

      const existingIndex = store.messages.findIndex((item) => item.messageId === message.messageId);
      if (existingIndex >= 0) {
        store.messages[existingIndex] = {
          ...store.messages[existingIndex],
          ...normalizedMessage
        };
      } else {
        store.messages.push({
          ...normalizedMessage,
          createdAt: now
        });
      }

      store.messages.sort((left, right) =>
        (right.envelopeCreatedAt ?? "").localeCompare(left.envelopeCreatedAt ?? "")
      );
      await saveStore(outboxFile, store);
      return store.messages.find((item) => item.messageId === message.messageId) ?? null;
    }
  };
}
