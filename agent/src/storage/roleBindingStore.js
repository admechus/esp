import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function loadStore(bindingsFile) {
  try {
    const raw = await readFile(bindingsFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.bindings) ? parsed : { version: 1, bindings: [] };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, bindings: [] };
    }
    throw error;
  }
}

async function saveStore(bindingsFile, store) {
  await mkdir(dirname(bindingsFile), { recursive: true });
  await writeFile(bindingsFile, JSON.stringify(store, null, 2) + "\n", "utf8");
}

export function createRoleBindingStore({ bindingsFile }) {
  return {
    bindingsFile,
    async listBindings() {
      const store = await loadStore(bindingsFile);
      return store.bindings.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
    },
    async getBinding(candidateId) {
      const bindings = await this.listBindings();
      return bindings.find((binding) => binding.candidateId === candidateId) ?? null;
    },
    async upsertBinding({ candidateId, assignedRole, note = "", source = "manual" }) {
      const store = await loadStore(bindingsFile);
      const now = new Date().toISOString();
      const existingIndex = store.bindings.findIndex((binding) => binding.candidateId === candidateId);
      const existing = existingIndex >= 0 ? store.bindings[existingIndex] : null;
      const binding = {
        candidateId,
        assignedRole,
        note,
        source,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };

      if (existingIndex >= 0) {
        store.bindings[existingIndex] = binding;
      } else {
        store.bindings.push(binding);
      }

      await saveStore(bindingsFile, store);
      return binding;
    },
    async deleteBinding(candidateId) {
      const store = await loadStore(bindingsFile);
      const existing = store.bindings.find((binding) => binding.candidateId === candidateId) ?? null;
      if (!existing) {
        return null;
      }

      store.bindings = store.bindings.filter((binding) => binding.candidateId !== candidateId);
      await saveStore(bindingsFile, store);
      return existing;
    }
  };
}
