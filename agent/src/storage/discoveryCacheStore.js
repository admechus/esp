import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function loadStore(cacheFile) {
  try {
    const raw = await readFile(cacheFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.snapshots) ? parsed : { version: 1, snapshots: [] };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, snapshots: [] };
    }
    throw error;
  }
}

async function saveStore(cacheFile, store) {
  await mkdir(dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, JSON.stringify(store, null, 2) + "\n", "utf8");
}

export function createDiscoveryCacheStore({ cacheFile, maxSnapshots = 12 }) {
  return {
    cacheFile,
    async listSnapshots() {
      const store = await loadStore(cacheFile);
      return store.snapshots;
    },
    async getLatestSnapshot() {
      const snapshots = await this.listSnapshots();
      return snapshots[0] ?? null;
    },
    async saveSnapshot(snapshot) {
      const store = await loadStore(cacheFile);
      store.snapshots.unshift(snapshot);
      store.snapshots = store.snapshots
        .sort((left, right) => (right.generatedAt ?? "").localeCompare(left.generatedAt ?? ""))
        .slice(0, maxSnapshots);
      await saveStore(cacheFile, store);
      return snapshot;
    }
  };
}
