import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function loadPlan(planFile) {
  try {
    const raw = await readFile(planFile, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { version: 1, plan: null };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, plan: null };
    }
    throw error;
  }
}

async function savePlan(planFile, payload) {
  await mkdir(dirname(planFile), { recursive: true });
  await writeFile(planFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

export function createLifecyclePlanStore({ planFile }) {
  return {
    planFile,
    async getPlan() {
      const store = await loadPlan(planFile);
      return store.plan ?? null;
    },
    async savePlan(plan) {
      await savePlan(planFile, {
        version: 1,
        plan
      });
      return plan;
    },
    async clearPlan() {
      const existing = await this.getPlan();
      await savePlan(planFile, {
        version: 1,
        plan: null
      });
      return existing;
    }
  };
}
