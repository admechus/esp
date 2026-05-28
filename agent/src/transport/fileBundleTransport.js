export function createFileBundleTransport({ readJsonFile, writeJsonFile }) {
  if (typeof readJsonFile !== "function" || typeof writeJsonFile !== "function") {
    throw new Error("File bundle transport requires readJsonFile and writeJsonFile.");
  }

  return {
    id: "file-bundle",
    kind: "file-bundle",
    capabilities: ["export-bundle", "import-bundle", "health"],
    metadata: {
      id: "file-bundle",
      kind: "file-bundle",
      label: "File Bundle",
      description: "Filesystem-based bundle export and import for offline carry and manual transfer.",
      capabilities: ["export-bundle", "import-bundle", "health"],
      deliveryModes: ["file-export", "file-import", "offline-carry"],
      networkClass: "offline-file",
      experimental: false,
      supports: {
        healthCheck: true,
        directSend: false,
        relayDelivery: false,
        pullRecovery: false,
        fileExport: true,
        fileImport: true,
        offlineCarry: true,
        ipv4: false,
        ipv6: false
      }
    },
    async health() {
      return {
        ok: true,
        kind: "file-bundle"
      };
    },
    async exportBundle({ filePath, bundle }) {
      await writeJsonFile(filePath, bundle);
      return {
        id: "file-bundle",
        kind: "file-bundle",
        filePath,
        bundle,
        messageCount: Array.isArray(bundle?.messages) ? bundle.messages.length : null
      };
    },
    async importBundle({ filePath }) {
      const bundle = await readJsonFile(filePath);
      return {
        id: "file-bundle",
        kind: "file-bundle",
        filePath,
        bundle,
        messageCount: Array.isArray(bundle?.messages) ? bundle.messages.length : null
      };
    }
  };
}
