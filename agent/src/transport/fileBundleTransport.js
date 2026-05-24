export function createFileBundleTransport({ readJsonFile, writeJsonFile }) {
  if (typeof readJsonFile !== "function" || typeof writeJsonFile !== "function") {
    throw new Error("File bundle transport requires readJsonFile and writeJsonFile.");
  }

  return {
    id: "file-bundle",
    kind: "file-bundle",
    capabilities: ["export-bundle", "import-bundle", "health"],
    async health() {
      return {
        ok: true,
        kind: "file-bundle"
      };
    },
    async exportBundle({ filePath, bundle }) {
      await writeJsonFile(filePath, bundle);
      return {
        filePath,
        bundle
      };
    },
    async importBundle({ filePath }) {
      const bundle = await readJsonFile(filePath);
      return {
        filePath,
        bundle
      };
    }
  };
}
