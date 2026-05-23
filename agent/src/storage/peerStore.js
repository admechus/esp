import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function getDefaultPeersFile() {
  return resolve(process.cwd(), "agent", "state", "peers.json");
}

async function loadStore(peersFile) {
  try {
    const raw = await readFile(peersFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.peers) ? parsed : { version: 1, peers: [] };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, peers: [] };
    }
    throw error;
  }
}

async function saveStore(peersFile, store) {
  await mkdir(dirname(peersFile), { recursive: true });
  await writeFile(peersFile, JSON.stringify(store, null, 2) + "\n", "utf8");
}

export function createPeerStore({ peersFile = getDefaultPeersFile() } = {}) {
  return {
    peersFile,
    async listPeers() {
      const store = await loadStore(peersFile);
      return store.peers;
    },
    async getPeer(keyId) {
      const peers = await this.listPeers();
      return peers.find((peer) => peer.keyId === keyId) ?? null;
    },
    async upsertPeer(peer) {
      const store = await loadStore(peersFile);
      const now = new Date().toISOString();
      const normalizedPeer = {
        ...peer,
        updatedAt: now
      };

      const existingIndex = store.peers.findIndex((item) => item.keyId === peer.keyId);
      if (existingIndex >= 0) {
        store.peers[existingIndex] = {
          ...store.peers[existingIndex],
          ...normalizedPeer
        };
      } else {
        store.peers.push({
          ...normalizedPeer,
          createdAt: now
        });
      }

      store.peers.sort((left, right) => left.keyId.localeCompare(right.keyId));
      await saveStore(peersFile, store);
      return store.peers.find((item) => item.keyId === peer.keyId) ?? null;
    }
  };
}
