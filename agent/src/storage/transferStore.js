import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function getDefaultTransfersFile() {
  return resolve(process.cwd(), "agent", "state", "relay-transfers.json");
}

async function loadStore(transfersFile) {
  try {
    const raw = await readFile(transfersFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.transfers) ? parsed : { version: 1, transfers: [] };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, transfers: [] };
    }
    throw error;
  }
}

async function saveStore(transfersFile, store) {
  await mkdir(dirname(transfersFile), { recursive: true });
  await writeFile(transfersFile, JSON.stringify(store, null, 2) + "\n", "utf8");
}

export function createTransferStore({ transfersFile = getDefaultTransfersFile() } = {}) {
  return {
    transfersFile,
    async listTransfers() {
      const store = await loadStore(transfersFile);
      return store.transfers;
    },
    async getTransfer(transferId) {
      const transfers = await this.listTransfers();
      return transfers.find((transfer) => transfer.transferId === transferId) ?? null;
    },
    async upsertTransfer(transfer) {
      const store = await loadStore(transfersFile);
      const now = new Date().toISOString();
      const normalizedTransfer = {
        ...transfer,
        updatedAt: now
      };

      const existingIndex = store.transfers.findIndex((item) => item.transferId === transfer.transferId);
      if (existingIndex >= 0) {
        store.transfers[existingIndex] = {
          ...store.transfers[existingIndex],
          ...normalizedTransfer
        };
      } else {
        store.transfers.push({
          ...normalizedTransfer,
          createdAt: now
        });
      }

      store.transfers.sort((left, right) =>
        (right.receivedAt ?? right.createdAt ?? "").localeCompare(left.receivedAt ?? left.createdAt ?? "")
      );
      await saveStore(transfersFile, store);
      return store.transfers.find((item) => item.transferId === transfer.transferId) ?? null;
    }
  };
}
