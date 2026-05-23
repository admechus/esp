import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function getDefaultReceiptsFile() {
  return resolve(process.cwd(), "agent", "state", "receipts.json");
}

async function loadStore(receiptsFile) {
  try {
    const raw = await readFile(receiptsFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.receipts) ? parsed : { version: 1, receipts: [] };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, receipts: [] };
    }
    throw error;
  }
}

async function saveStore(receiptsFile, store) {
  await mkdir(dirname(receiptsFile), { recursive: true });
  await writeFile(receiptsFile, JSON.stringify(store, null, 2) + "\n", "utf8");
}

export function createReceiptStore({ receiptsFile = getDefaultReceiptsFile() } = {}) {
  return {
    receiptsFile,
    async listReceipts() {
      const store = await loadStore(receiptsFile);
      return store.receipts;
    },
    async getReceipt(receiptId) {
      const receipts = await this.listReceipts();
      return receipts.find((receipt) => receipt.receiptId === receiptId) ?? null;
    },
    async upsertReceipt(receipt) {
      const store = await loadStore(receiptsFile);
      const now = new Date().toISOString();
      const normalizedReceipt = {
        ...receipt,
        updatedAt: now
      };

      const existingIndex = store.receipts.findIndex((item) => item.receiptId === receipt.receiptId);
      if (existingIndex >= 0) {
        store.receipts[existingIndex] = {
          ...store.receipts[existingIndex],
          ...normalizedReceipt
        };
      } else {
        store.receipts.push({
          ...normalizedReceipt,
          createdAt: now
        });
      }

      store.receipts.sort((left, right) =>
        (right.acceptedAt ?? right.createdAt ?? "").localeCompare(left.acceptedAt ?? left.createdAt ?? "")
      );
      await saveStore(receiptsFile, store);
      return store.receipts.find((item) => item.receiptId === receipt.receiptId) ?? null;
    }
  };
}
