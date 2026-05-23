import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function loadStore(activityFile) {
  try {
    const raw = await readFile(activityFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.entries) ? parsed : { version: 1, entries: [] };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, entries: [] };
    }
    throw error;
  }
}

async function saveStore(activityFile, store) {
  await mkdir(dirname(activityFile), { recursive: true });
  await writeFile(activityFile, JSON.stringify(store, null, 2) + "\n", "utf8");
}

function createEntryId(prefix = "hw") {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(16).slice(2, 10)}`;
}

export function createHardwareActivityStore({ activityFile, maxEntries = 60 }) {
  return {
    activityFile,
    async listEntries() {
      const store = await loadStore(activityFile);
      return store.entries.sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
    },
    async recordEntry({
      category = "hardware",
      action,
      role = null,
      target = null,
      status = "ok",
      detail = "",
      source = "unified-shell",
      data = null
    }) {
      const store = await loadStore(activityFile);
      const entry = {
        id: createEntryId(category === "discovery" ? "disc" : "hw"),
        category,
        action,
        role,
        target,
        status,
        detail,
        source,
        createdAt: new Date().toISOString(),
        data
      };
      store.entries.unshift(entry);
      store.entries = store.entries
        .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
        .slice(0, maxEntries);
      await saveStore(activityFile, store);
      return entry;
    }
  };
}
