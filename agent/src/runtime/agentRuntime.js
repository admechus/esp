import { basename, resolve } from "node:path";
import { getPlatformProfiles } from "../platform/platformProfiles.js";
import { createRequest } from "../protocol/commands.js";
import {
  createP256FingerprintHex,
  createP256KeyId,
  sha256Buffer,
  verifyEs256Signature
} from "../crypto/p256Identity.js";
import {
  createEnvelopeId,
  createEnvelopeSigningBytes,
  createSignedEnvelope,
  createUnsignedTextEnvelope,
  verifySignedEnvelope
} from "../protocol/envelopes.js";
import { createDeliveryReceipt, createReadReceipt } from "../protocol/receipts.js";
import { createTransportBundle, validateTransportBundle } from "../protocol/transportBundles.js";
import { createInboxStore } from "../storage/inboxStore.js";
import { createOutboxStore } from "../storage/outboxStore.js";
import { createReceiptStore } from "../storage/receiptStore.js";
import { readJsonFile, writeJsonFile } from "../storage/jsonFiles.js";
import { createPeerStore } from "../storage/peerStore.js";
import { createFileBundleTransport } from "../transport/fileBundleTransport.js";
import { createLocalHttpAgentTransport } from "../transport/localHttpAgentTransport.js";
import { createLocalHttpRelayTransport } from "../transport/localHttpRelayTransport.js";
import {
  checkTransportHealth as checkTransportHealthDiagnostic,
  summarizeTransportCapabilities
} from "../transport/transportDiagnostics.js";
import { createTransportRegistry } from "../transport/transportRegistry.js";
import { normalizeRemoteUrl } from "../transport/transportUrl.js";
import { discoverWindowsEspPorts } from "../transport/windowsComDiscovery.js";
import { createMockDongleTransport } from "../transport/mockDongleTransport.js";
import { createWindowsSerialJsonTransport } from "../transport/windowsSerialJsonTransport.js";
import {
  loadRuntimeProfile as loadRuntimeProfileDefinition,
  validateRuntimeProfile as validateRuntimeProfileDefinition
} from "./runtimeProfiles.js";

const serialPortCommandQueues = new Map();

function assertOkResponse(response, commandName) {
  if (!response?.ok) {
    const reason = response?.error ?? "unknown_error";
    const detail = response?.detail ? ` (${response.detail})` : "";
    throw new Error(`${commandName} failed: ${reason}${detail}`);
  }
}

function describeIdentity(response) {
  assertOkResponse(response, "IDENTITY");

  const fingerprintHex =
    response.fingerprintHex ?? createP256FingerprintHex(response.publicKeyBase64);
  const keyId = response.keyId ?? createP256KeyId(response.publicKeyBase64);

  return {
    ...response,
    fingerprintHex,
    keyId
  };
}

function describeDeviceInfo(response) {
  assertOkResponse(response, "GET_INFO");

  const rawCapabilities = response.capabilities;
  const capabilities = Array.isArray(rawCapabilities)
    ? rawCapabilities
    : String(rawCapabilities ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  return {
    device: response.device ?? "unknown-device",
    chip: response.chip ?? "unknown-chip",
    role: response.role ?? "unknown",
    profile: response.profile ?? null,
    version: response.version ?? null,
    transport: response.transport ?? null,
    algorithm: response.algorithm ?? null,
    capabilities
  };
}

function describePlatformIo(response) {
  assertOkResponse(response, "GET_PLATFORM_IO");

  const outputs = Array.isArray(response.outputs)
    ? response.outputs.map((output) => ({
        kind: output?.kind ?? "unknown-output",
        driver: output?.driver ?? null,
        driverFamily: output?.driverFamily ?? null,
        resolution: output?.resolution ?? null,
        status: output?.status ?? null,
        detection: output?.detection ?? null,
        confidence: output?.confidence ?? null,
        learned: Boolean(output?.learned),
        i2cAddress: output?.i2cAddress ?? null,
        sda: Number.isFinite(output?.sda) ? output.sda : null,
        scl: Number.isFinite(output?.scl) ? output.scl : null,
        mosi: Number.isFinite(output?.mosi) ? output.mosi : null,
        miso: Number.isFinite(output?.miso) ? output.miso : null,
        sclk: Number.isFinite(output?.sclk) ? output.sclk : null,
        cs: Number.isFinite(output?.cs) ? output.cs : null,
        dc: Number.isFinite(output?.dc) ? output.dc : null,
        rst: Number.isFinite(output?.rst) ? output.rst : null,
        backlight: Number.isFinite(output?.backlight) ? output.backlight : null,
        preset: Number.isFinite(output?.preset) ? output.preset : null,
        signature: output?.signature ?? null,
        note: output?.note ?? null
      }))
    : [];

  return {
    device: response.device ?? "unknown-device",
    chip: response.chip ?? "unknown-chip",
    profile: response.profile ?? null,
    transport: response.transport ?? null,
    outputs,
    gpio: {
      pinCount: response.gpio?.pinCount ?? null,
      inputRange: response.gpio?.inputRange ?? "unknown",
      outputRange: response.gpio?.outputRange ?? "unknown",
      liveProbeSupported: Boolean(response.gpio?.liveProbeSupported),
      probeStatus: response.gpio?.probeStatus ?? "unknown",
      attachmentStatus: response.gpio?.attachmentStatus ?? "unknown",
      observedConnections: Array.isArray(response.gpio?.observedConnections)
        ? response.gpio.observedConnections
        : []
    },
    hardwareProfile: response.hardwareProfile ?? null
  };
}

function describeOutputTest(response) {
  assertOkResponse(response, "TEST_OUTPUT");

  const results = Array.isArray(response.results)
    ? response.results.map((result) => ({
        kind: result?.kind ?? "unknown-output",
        status: result?.status ?? "unknown",
        detail: result?.detail ?? null
      }))
    : [];

  return {
    device: response.device ?? "unknown-device",
    chip: response.chip ?? "unknown-chip",
    profile: response.profile ?? null,
    transport: response.transport ?? null,
    target: response.target ?? "all",
    results
  };
}

function getDefaultStateDir() {
  return resolve(process.cwd(), "agent", "state");
}

function resolveStateRoot(stateDir) {
  return resolve(stateDir ?? getDefaultStateDir());
}

function createStatePaths(stateDir) {
  const root = resolveStateRoot(stateDir);
    return {
      root,
      peersFile: resolve(root, "peers.json"),
      inboxFile: resolve(root, "inbox.json"),
      outboxFile: resolve(root, "outbox-log.json"),
      receiptsFile: resolve(root, "receipts.json"),
      identityCacheFile: resolve(root, "identity-cache.json"),
      deviceInfoCacheFile: resolve(root, "device-info-cache.json"),
      platformIoCacheFile: resolve(root, "platform-io-cache.json"),
      outboxDir: resolve(root, "outbox"),
      transfersDir: resolve(root, "transfers")
    };
}

function resolveOutputPath(filePath, statePaths) {
  if (!filePath) {
    return resolve(statePaths.outboxDir, `envelope-${Date.now()}.json`);
  }

  return resolve(filePath);
}

function resolveTransferPath(filePath, statePaths) {
  if (!filePath) {
    return resolve(statePaths.transfersDir, `bundle-${Date.now()}.json`);
  }

  return resolve(filePath);
}

function getRequestedTransportId(options = {}) {
  return options.transportId ?? options.transport ?? null;
}

function requireRuntimeTransport(registry, transportId, purpose, allowedIds) {
  const requestedTransportId = String(transportId ?? "").trim();
  if (!requestedTransportId) {
    throw new Error(`Missing transport id for ${purpose}.`);
  }

  const transport = registry.get(requestedTransportId);
  if (!transport) {
    throw new Error(`Transport ${requestedTransportId} is not active in this runtime.`);
  }

  if (!allowedIds.includes(requestedTransportId)) {
    throw new Error(
      `Transport ${requestedTransportId} is not supported for ${purpose}. Allowed: ${allowedIds.join(", ")}.`
    );
  }

  return transport;
}

function getOutboxStatusFromReceipt(receiptStatus, currentStatus) {
  if (receiptStatus === "read_remote") {
    return "read_remote";
  }

  if (currentStatus === "read_remote") {
    return currentStatus;
  }

  if (receiptStatus === "accepted_remote") {
    return "delivered_remote_ack";
  }

  return currentStatus ?? "saved";
}

function queueSerialPortCommand(port, commandFactory) {
  const key = String(port ?? "").toUpperCase();
  const previous = serialPortCommandQueues.get(key) ?? Promise.resolve();
  const run = previous
    .catch(() => {})
    .then(async () => commandFactory());

  serialPortCommandQueues.set(
    key,
    run.finally(() => {
      if (serialPortCommandQueues.get(key) === run) {
        serialPortCommandQueues.delete(key);
      }
    })
  );

  return run;
}

export function createAgentRuntime({ stateDir, agentName } = {}) {
  const statePaths = createStatePaths(stateDir);
  const resolvedAgentName = agentName ?? basename(statePaths.root) ?? "local-agent";
  const peerStore = createPeerStore({ peersFile: statePaths.peersFile });
  const inboxStore = createInboxStore({ inboxFile: statePaths.inboxFile });
  const outboxStore = createOutboxStore({ outboxFile: statePaths.outboxFile });
  const receiptStore = createReceiptStore({ receiptsFile: statePaths.receiptsFile });
  const transportRegistry = createTransportRegistry({
    localHttpAgent: createLocalHttpAgentTransport(),
    localHttpRelay: createLocalHttpRelayTransport(),
    fileBundle: createFileBundleTransport({
      readJsonFile,
      writeJsonFile
    })
  });

  return {
    getAgentInfo() {
      return {
        name: resolvedAgentName,
        stateDir: statePaths.root,
        peersFile: statePaths.peersFile,
        inboxFile: statePaths.inboxFile,
        outboxFile: statePaths.outboxFile,
        receiptsFile: statePaths.receiptsFile,
        identityCacheFile: statePaths.identityCacheFile,
        deviceInfoCacheFile: statePaths.deviceInfoCacheFile,
        platformIoCacheFile: statePaths.platformIoCacheFile,
        outboxDir: statePaths.outboxDir,
        transfersDir: statePaths.transfersDir
      };
    },
    listProfiles() {
      return getPlatformProfiles();
    },
    listTransports() {
      return summarizeTransportCapabilities(transportRegistry);
    },
    validateRuntimeProfile(profile) {
      return validateRuntimeProfileDefinition(profile, transportRegistry);
    },
    async loadRuntimeProfile(filePath) {
      return loadRuntimeProfileDefinition(filePath, transportRegistry);
    },
    async checkTransportHealth(transportId, options = {}) {
      return checkTransportHealthDiagnostic(transportRegistry, transportId, {
        remoteUrl: options.remoteUrl ?? null
      });
    },
    async listPorts() {
      return discoverWindowsEspPorts();
    },
    async sendCommand(commandName, payload = {}, options = {}) {
      const request = createRequest(commandName, payload);
      if (options.mock) {
        const transport = createMockDongleTransport();
        return transport.send(request);
      }
      if (options.port) {
        return queueSerialPortCommand(options.port, async () => {
          const transport = createWindowsSerialJsonTransport({
            port: options.port,
            baudRate: 115200
          });
          return transport.send(request);
        });
      }
      throw new Error("Choose either --mock or --port COMx.");
    },
    async generateIdentity(options = {}) {
      const response = await this.sendCommand("GEN_IDENTITY", {}, options);
      return describeIdentity(response);
    },
    async getPublicId(options = {}) {
      const response = await this.sendCommand("GET_PUBLIC_ID", {}, options);
      return describeIdentity(response);
    },
    async getDeviceInfo(options = {}) {
      const response = await this.sendCommand("GET_INFO", {}, options);
      const deviceInfo = describeDeviceInfo(response);
      await writeJsonFile(statePaths.deviceInfoCacheFile, {
        ...deviceInfo,
        cachedAt: new Date().toISOString()
      });
      return deviceInfo;
    },
    async getCachedDeviceInfo() {
      try {
        return await readJsonFile(statePaths.deviceInfoCacheFile);
      } catch (error) {
        if (error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    async getPlatformIo(options = {}) {
      const response = await this.sendCommand("GET_PLATFORM_IO", {}, options);
      const platformIo = describePlatformIo(response);
      await writeJsonFile(statePaths.platformIoCacheFile, {
        ...platformIo,
        cachedAt: new Date().toISOString()
      });
      return platformIo;
    },
    async getCachedPlatformIo() {
      try {
        return await readJsonFile(statePaths.platformIoCacheFile);
      } catch (error) {
        if (error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    async testOutput(target = "all", options = {}) {
      const response = await this.sendCommand("TEST_OUTPUT", { target }, options);
      return describeOutputTest(response);
    },
    async signBytes(payloadBuffer, options = {}) {
      const response = await this.sendCommand(
        "SIGN_BYTES",
        { payloadBase64: Buffer.from(payloadBuffer).toString("base64") },
        options
      );
      assertOkResponse(response, "SIGN_BYTES");
      return describeIdentity(response);
    },
    async signHash(digestBuffer, options = {}) {
      const response = await this.sendCommand(
        "SIGN_HASH",
        { digestBase64: Buffer.from(digestBuffer).toString("base64") },
        options
      );
      assertOkResponse(response, "SIGN_HASH");
      return describeIdentity(response);
    },
    async getIdentitySummary(options = {}) {
      const identity = await this.getPublicId(options);
      const summary = {
        algorithm: identity.algorithm,
        curve: identity.curve ?? "P-256",
        keyId: identity.keyId,
        fingerprintHex: identity.fingerprintHex,
        publicKeyBase64: identity.publicKeyBase64
      };
      await writeJsonFile(statePaths.identityCacheFile, {
        ...summary,
        cachedAt: new Date().toISOString()
      });
      return summary;
    },
    async getCachedIdentitySummary() {
      try {
        return await readJsonFile(statePaths.identityCacheFile);
      } catch (error) {
        if (error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    async rememberSelf(options = {}) {
      const identity = await this.getIdentitySummary(options);
      return peerStore.upsertPeer({
        keyId: identity.keyId,
        fingerprintHex: identity.fingerprintHex,
        publicKeyBase64: identity.publicKeyBase64,
        algorithm: identity.algorithm,
        curve: identity.curve,
        label: options.label ?? "local-dongle",
        source: options.mock ? "mock-dongle" : options.port ?? "unknown-port",
        role: "identity"
      });
    },
    async listPeers() {
      return peerStore.listPeers();
    },
    async getPeer(keyId) {
      return peerStore.getPeer(keyId);
    },
    async listMessages() {
      return inboxStore.listMessages();
    },
    async getMessage(messageId) {
      return inboxStore.getMessage(messageId);
    },
    async listOutboxMessages() {
      return outboxStore.listMessages();
    },
    async getOutboxMessage(messageId) {
      return outboxStore.getMessage(messageId);
    },
    async listReceipts() {
      return receiptStore.listReceipts();
    },
    async getReceipt(receiptId) {
      return receiptStore.getReceipt(receiptId);
    },
    async acceptReceipt(receipt, metadata = {}) {
      if (!receipt?.receiptId) {
        throw new Error("Receipt is missing receiptId.");
      }

      const storedReceipt = await receiptStore.upsertReceipt({
        ...receipt,
        relayName: receipt.relayName ?? metadata.relayName ?? null
      });

      const outboxMessage =
        (await outboxStore.getMessage(storedReceipt.messageId)) ??
        (await outboxStore.getMessage(storedReceipt.envelopeId));

      if (outboxMessage) {
        await outboxStore.upsertMessage({
          ...outboxMessage,
          status: getOutboxStatusFromReceipt(storedReceipt.status, outboxMessage.status),
          deliveredAt: outboxMessage.deliveredAt ?? new Date().toISOString(),
          deliverySource: metadata.deliverySource ?? outboxMessage.deliverySource ?? null,
          remoteAgent: storedReceipt.receiverAgent ?? metadata.remoteAgent ?? outboxMessage.remoteAgent ?? null,
          deliveryReceiptId:
            storedReceipt.status === "accepted_remote"
              ? storedReceipt.receiptId
              : outboxMessage.deliveryReceiptId ?? null,
          deliveryAcceptedAt:
            storedReceipt.acceptedAt ?? outboxMessage.deliveryAcceptedAt ?? null,
          readReceiptId:
            storedReceipt.status === "read_remote"
              ? storedReceipt.receiptId
              : outboxMessage.readReceiptId ?? null,
          readAt:
            storedReceipt.readAt ?? outboxMessage.readAt ?? null,
          relayReceiptId: metadata.relayReceiptId ?? outboxMessage.relayReceiptId ?? null
        });
      }

      return storedReceipt;
    },
    async receiveEnvelopeData(envelope, metadata = {}, options = {}) {
      const verification = this.verifyEnvelope(envelope);
      if (!verification.verified) {
        throw new Error("Envelope signature verification failed.");
      }
      if (!verification.matchesEnvelopeIdentity) {
        throw new Error("Envelope sender identity does not match its public key.");
      }

      const sourceLabel = metadata.sourceLabel ?? "envelope-memory";
      const existingPeer = await peerStore.getPeer(verification.keyId);
      const peer = await peerStore.upsertPeer({
        keyId: verification.keyId,
        fingerprintHex: verification.fingerprintHex,
        publicKeyBase64: envelope.sender.publicKeyBase64,
        algorithm: envelope.algorithm ?? "ES256",
        curve: envelope.curve ?? "P-256",
        label:
          options.label ??
          existingPeer?.label ??
          `imported-${verification.keyId.slice(0, 12)}`,
        source:
          existingPeer?.role === "identity"
            ? existingPeer.source
            : sourceLabel,
        role: existingPeer?.role === "identity" ? "identity" : "peer",
        lastImportedEnvelopeAt: envelope.createdAt ?? null
      });

      const identityPeers = (await peerStore.listPeers()).filter((storedPeer) => storedPeer.role === "identity");
      const recipientKeyId = envelope?.recipient?.keyId ?? null;
      const recipientOwned = recipientKeyId
        ? identityPeers.some((storedPeer) => storedPeer.keyId === recipientKeyId)
        : false;
      const senderIsLocalIdentity = identityPeers.some((storedPeer) => storedPeer.keyId === verification.keyId);
      const direction = senderIsLocalIdentity ? "self" : "inbound";
      const messageId = verification.envelopeId ?? createEnvelopeId(envelope);
      const existingMessage = await inboxStore.getMessage(messageId);
      const message = await inboxStore.upsertMessage({
        ...existingMessage,
        messageId,
        envelopeId: messageId,
        envelopeCreatedAt: envelope.createdAt ?? null,
        direction,
        senderKeyId: verification.keyId,
        recipientKeyId,
        recipientOwned,
        verified: verification.verified,
        matchesEnvelopeIdentity: verification.matchesEnvelopeIdentity,
        payloadType: envelope?.payload?.type ?? null,
        textPreview: verification.text ? verification.text.slice(0, 160) : null,
        sourceFilePath: metadata.sourceFilePath ?? sourceLabel,
        sourceAgent: metadata.sourceAgent ?? existingMessage?.sourceAgent ?? null,
        relayName: metadata.relayName ?? existingMessage?.relayName ?? null,
        readAt: existingMessage?.readAt ?? null,
        peerLabel: peer.label,
        envelope
      });

      const existingOutbox = await outboxStore.getMessage(messageId);
      if (existingOutbox) {
        await outboxStore.upsertMessage({
          ...existingOutbox,
          status:
            existingOutbox.status === "read_remote"
              ? existingOutbox.status
              : metadata.deliveryStatus ?? "delivered_local",
          deliveredAt: new Date().toISOString(),
          deliverySource: sourceLabel,
          inboxMessageId: message.messageId
        });
      }

      return {
        accepted: true,
        message,
        importedPeer: peer
      };
    },
    async createSignedTextEnvelope(text, options = {}) {
      const identity = await this.getIdentitySummary(options);
      let recipientPeer = null;

      if (options.toKeyId) {
        recipientPeer = await peerStore.getPeer(options.toKeyId);
        if (!recipientPeer) {
          throw new Error(`Unknown recipient keyId: ${options.toKeyId}`);
        }
      }

      const unsignedEnvelope = createUnsignedTextEnvelope({
        sender: identity,
        recipientKeyId: recipientPeer?.keyId ?? null,
        text
      });
      const signingBytes = createEnvelopeSigningBytes(unsignedEnvelope);
      const digest = sha256Buffer(signingBytes);
      const signature = await this.signHash(digest, options);

      if (signature.keyId !== identity.keyId) {
        throw new Error("Dongle returned a different keyId while building envelope.");
      }

      const envelope = createSignedEnvelope(unsignedEnvelope, signature.signatureBase64);
      const verification = verifySignedEnvelope(envelope);
      return {
        ...envelope,
        locallyVerified: verification.verified && verification.matchesEnvelopeIdentity,
        recipientKnown: Boolean(recipientPeer)
      };
    },
    async saveEnvelope(envelope, options = {}) {
      const filePath = resolveOutputPath(options.filePath, statePaths);
      await writeJsonFile(filePath, envelope);
      return {
        filePath,
        envelope
      };
    },
    async createAndSaveSignedTextEnvelope(text, options = {}) {
      const envelope = await this.createSignedTextEnvelope(text, options);
      const saved = await this.saveEnvelope(envelope, options);
      const envelopeId = createEnvelopeId(envelope);
      const outboxMessage = await outboxStore.upsertMessage({
        messageId: envelopeId,
        envelopeId,
        envelopeCreatedAt: envelope.createdAt,
        status: "saved",
        senderKeyId: envelope.sender.keyId,
        recipientKeyId: envelope?.recipient?.keyId ?? null,
        recipientKnown: Boolean(envelope.recipientKnown),
        locallyVerified: Boolean(envelope.locallyVerified),
        textPreview:
          envelope?.payload?.encoding === "utf8"
            ? Buffer.from(envelope.payload.bodyBase64 ?? "", "base64").toString("utf8").slice(0, 160)
            : null,
        sourceFilePath: saved.filePath,
        envelope
      });

      return {
        ...saved,
        locallyVerified: envelope.locallyVerified,
        outboxMessage
      };
    },
    async createPendingTransportBundle(options = {}) {
      const outboxMessages = await outboxStore.listMessages();
      const pendingMessages = outboxMessages.filter(
        (message) => message.status === "saved" || message.status === "packaged"
      );

      if (!pendingMessages.length) {
        throw new Error("No pending outbox messages to transport.");
      }

      const sourceIdentity = await this.getIdentitySummary(options).catch(() => null);
      const bundle = createTransportBundle({
        source: {
          agentName: resolvedAgentName,
          identity: sourceIdentity
        },
        messages: pendingMessages.map((message) => ({
          messageId: message.messageId,
          envelopeId: message.envelopeId,
          envelopeCreatedAt: message.envelopeCreatedAt,
          senderKeyId: message.senderKeyId,
          recipientKeyId: message.recipientKeyId,
          envelope: message.envelope
        }))
      });

      return {
        bundle,
        pendingMessages
      };
    },
    async loadEnvelope(filePath) {
      return readJsonFile(resolve(filePath));
    },
    verifyEnvelope(envelope) {
      return verifySignedEnvelope(envelope);
    },
    async verifyEnvelopeFile(filePath) {
      const envelope = await this.loadEnvelope(filePath);
      const verification = this.verifyEnvelope(envelope);

      return {
        filePath: resolve(filePath),
        envelope,
        ...verification,
        sender: envelope.sender,
        recipient: envelope.recipient,
        payloadType: envelope?.payload?.type ?? null,
        createdAt: envelope.createdAt ?? null
      };
    },
    async importEnvelope(filePath, options = {}) {
      const verification = await this.verifyEnvelopeFile(filePath);
      if (!verification.verified) {
        throw new Error("Envelope signature verification failed.");
      }
      if (!verification.matchesEnvelopeIdentity) {
        throw new Error("Envelope sender identity does not match its public key.");
      }

      const envelope = verification.envelope;
      const existingPeer = await peerStore.getPeer(verification.keyId);
      const peer = await peerStore.upsertPeer({
        keyId: verification.keyId,
        fingerprintHex: verification.fingerprintHex,
        publicKeyBase64: envelope.sender.publicKeyBase64,
        algorithm: envelope.algorithm ?? "ES256",
        curve: envelope.curve ?? "P-256",
        label:
          options.label ??
          existingPeer?.label ??
          `imported-${verification.keyId.slice(0, 12)}`,
        source:
          existingPeer?.role === "identity"
            ? existingPeer.source
            : `envelope:${basename(filePath)}`,
        role: existingPeer?.role === "identity" ? "identity" : "peer",
        lastImportedEnvelopeAt: verification.createdAt
      });

      return {
        filePath: resolve(filePath),
        imported: true,
        peer,
        verification: {
          verified: verification.verified,
          matchesEnvelopeIdentity: verification.matchesEnvelopeIdentity,
          keyId: verification.keyId,
          fingerprintHex: verification.fingerprintHex,
          text: verification.text
        }
      };
    },
    async receiveEnvelope(filePath, options = {}) {
      const resolvedPath = resolve(filePath);
      const envelope = await this.loadEnvelope(resolvedPath);
      const result = await this.receiveEnvelopeData(
        envelope,
        {
          sourceFilePath: resolvedPath,
          sourceLabel: `envelope:${basename(resolvedPath)}`,
          deliveryStatus: "delivered_file"
        },
        options
      );
      return {
        filePath: resolvedPath,
        ...result
      };
    },
    async receiveOutboxMessage(messageId, options = {}) {
      const outboxMessage = await outboxStore.getMessage(messageId);
      if (!outboxMessage) {
        throw new Error(`Unknown outbox message: ${messageId}`);
      }
      if (!outboxMessage.envelope) {
        throw new Error("Outbox message does not have an envelope.");
      }
      return this.receiveEnvelopeData(
        outboxMessage.envelope,
        {
          sourceFilePath: outboxMessage.sourceFilePath ?? `outbox:${messageId}`,
          sourceLabel: `outbox:${messageId}`,
          deliveryStatus: "delivered_local"
        },
        options
      );
    },
    async markMessageRead(messageId, options = {}) {
      const message = await inboxStore.getMessage(messageId);
      if (!message) {
        throw new Error(`Unknown inbox message: ${messageId}`);
      }

      const readAt = message.readAt ?? new Date().toISOString();
      const updatedMessage = await inboxStore.upsertMessage({
        ...message,
        readAt
      });

      const existingReadReceipt = (await receiptStore.listReceipts()).find(
        (item) =>
          item.messageId === message.messageId &&
          item.status === "read_remote" &&
          item.receiverAgent === resolvedAgentName
      );

      const localReceipt = await receiptStore.upsertReceipt(
        existingReadReceipt ??
          createReadReceipt({
            messageId: message.messageId,
            envelopeId: message.envelopeId,
            senderKeyId: message.senderKeyId,
            receiverAgent: resolvedAgentName,
            sourceAgent: message.sourceAgent ?? null,
            relayName: message.relayName ?? null,
            readAt
          })
      );

      const remoteUrl = options.remoteUrl ?? null;
      const targetAgent = options.targetAgent ?? message.sourceAgent ?? null;
      if (!remoteUrl || !targetAgent) {
        return {
          message: updatedMessage,
          receipt: localReceipt,
          forwarded: false
        };
      }

      const normalizedRemoteUrl = normalizeRemoteUrl(
        remoteUrl,
        "Missing remoteUrl for transport delivery."
      );
      const forwardResponse = await fetch(`${normalizedRemoteUrl}/relay/forward-receipt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          receipt: localReceipt,
          targetAgent
        })
      });
      const forwardPayload = await forwardResponse.json().catch(() => null);
      if (!forwardResponse.ok || forwardPayload?.ok === false) {
        throw new Error(forwardPayload?.error ?? `Receipt forward failed: ${forwardResponse.status}`);
      }

      return {
        message: updatedMessage,
        receipt: localReceipt,
        forwarded: true,
        targetAgent,
        remoteUrl: normalizedRemoteUrl,
        relay: forwardPayload?.relay ?? null,
        remoteAgent: forwardPayload?.agent ?? forwardPayload?.result?.agent ?? null
      };
    },
    async exportOutboxBundle(options = {}) {
      const filePath = resolveTransferPath(options.filePath, statePaths);
      const { bundle, pendingMessages } = await this.createPendingTransportBundle(options);
      const requestedTransportId = getRequestedTransportId(options);
      const fileBundleTransport = requestedTransportId
        ? requireRuntimeTransport(
            transportRegistry,
            requestedTransportId,
            "bundle export",
            ["file-bundle"]
          )
        : transportRegistry.require("file-bundle");

      await fileBundleTransport.exportBundle({ filePath, bundle });

      for (const message of pendingMessages) {
        await outboxStore.upsertMessage({
          ...message,
          status: "packaged",
          exportedAt: new Date().toISOString(),
          bundleFilePath: filePath
        });
      }

      return {
        filePath,
        bundle,
        messageCount: bundle.messages.length
      };
    },
    async importTransportBundleData(bundle, options = {}, metadata = {}) {
      const validatedBundle = validateTransportBundle(bundle);
      const accepted = [];
      const receipts = [];
      const sourceLabel = metadata.sourceLabel ?? `bundle:${resolvedAgentName}`;
      const sourceAgent = validatedBundle.source?.agentName ?? null;

      for (const item of validatedBundle.messages) {
        const result = await this.receiveEnvelopeData(
          item.envelope,
          {
            sourceFilePath: metadata.sourceFilePath ?? sourceLabel,
            sourceLabel,
            deliveryStatus: metadata.deliveryStatus ?? "delivered_bundle",
            sourceAgent,
            relayName: metadata.relayName ?? null
          },
          options
        );
        accepted.push({
          envelopeId: result.message.envelopeId,
          messageId: result.message.messageId,
          textPreview: result.message.textPreview
        });

        if (metadata.createReceipts !== false) {
          const receipt = await receiptStore.upsertReceipt(
            createDeliveryReceipt({
              messageId: result.message.messageId,
              envelopeId: result.message.envelopeId,
              senderKeyId: result.message.senderKeyId,
              receiverAgent: resolvedAgentName,
              sourceAgent,
              relayName: metadata.relayName ?? null
            })
          );
          receipts.push(receipt);
        }
      }

      return {
        bundleCreatedAt: validatedBundle.createdAt,
        messageCount: accepted.length,
        accepted,
        source: validatedBundle.source ?? null,
        receipts
      };
    },
    async importTransportBundle(filePath, options = {}) {
      const resolvedPath = resolve(filePath);
      const requestedTransportId = getRequestedTransportId(options);
      const fileBundleTransport = requestedTransportId
        ? requireRuntimeTransport(
            transportRegistry,
            requestedTransportId,
            "bundle import",
            ["file-bundle"]
          )
        : transportRegistry.require("file-bundle");
      const imported = await fileBundleTransport.importBundle({ filePath: resolvedPath });
      const bundle = imported.bundle;
      const result = await this.importTransportBundleData(bundle, options, {
        sourceFilePath: resolvedPath,
        sourceLabel: `bundle:${basename(resolvedPath)}`,
        deliveryStatus: "delivered_bundle"
      });

      return {
        filePath: resolvedPath,
        ...result
      };
    },
    async deliverTransportBundle(remoteUrl, options = {}) {
      const normalizedRemoteUrl = normalizeRemoteUrl(
        remoteUrl,
        "Missing remoteUrl for transport delivery."
      );
      const { bundle, pendingMessages } = await this.createPendingTransportBundle(options);
      const targetAgent = options.targetAgent ?? null;
      const requestedTransportId = getRequestedTransportId(options);
      const transport = requestedTransportId
        ? requireRuntimeTransport(
            transportRegistry,
            requestedTransportId,
            "remote bundle delivery",
            ["local-http-agent", "local-http-relay"]
          )
        : transportRegistry.require(targetAgent ? "local-http-relay" : "local-http-agent");
      const deliveryResult = await transport.sendBundle({
        target: targetAgent,
        bundle,
        options: {
          remoteUrl: normalizedRemoteUrl
        }
      });

      const remoteAgentInfo = deliveryResult.remoteEntity;
      const downstreamReceipts = deliveryResult.receipts;
      const relayReceiptId = deliveryResult.relayReceiptId;
      const queued = deliveryResult.queued;
      const queueId = deliveryResult.queueId;

      for (const receipt of downstreamReceipts) {
        await this.acceptReceipt(receipt, {
          deliverySource: normalizedRemoteUrl,
          remoteAgent: remoteAgentInfo?.name ?? deliveryResult.targetAgent ?? null,
          relayReceiptId
        });
      }

      for (const message of pendingMessages) {
        const matchingReceipt =
          downstreamReceipts.find((receipt) => receipt.messageId === message.messageId) ??
          downstreamReceipts.find((receipt) => receipt.envelopeId === message.envelopeId) ??
          null;
        if (!matchingReceipt) {
          await outboxStore.upsertMessage({
            ...message,
            status: queued ? "queued_relay" : "delivered_remote",
            deliveredAt: queued ? message.deliveredAt ?? null : new Date().toISOString(),
            deliverySource: normalizedRemoteUrl,
            remoteAgent: remoteAgentInfo?.name ?? deliveryResult.targetAgent ?? null,
            relayReceiptId,
            queueId
          });
        }
      }

      return {
        remoteUrl: normalizedRemoteUrl,
        remoteAgent: remoteAgentInfo,
        messageCount: bundle.messages.length,
        accepted: deliveryResult.accepted,
        receipts: downstreamReceipts,
        queued,
        queueId,
        queueReason: deliveryResult.queueReason,
        queueError: deliveryResult.queueError,
        relayReceiptId,
        targetAgent,
        source: bundle.source ?? null
      };
    },
    async pullPendingFromRelay(remoteUrl, options = {}) {
      const normalizedRemoteUrl = normalizeRemoteUrl(
        remoteUrl,
        "Missing remoteUrl for transport delivery."
      );
      const targetAgent = options.pullTargetAgent ?? resolvedAgentName;
      const requestedTransportId = getRequestedTransportId(options);
      const relayTransport = requestedTransportId
        ? requireRuntimeTransport(
            transportRegistry,
            requestedTransportId,
            "relay pull recovery",
            ["local-http-relay"]
          )
        : transportRegistry.require("local-http-relay");
      const pullResult = await relayTransport.pullQueued({
        target: targetAgent,
        options: {
          remoteUrl: normalizedRemoteUrl
        }
      });

      return {
        remoteUrl: pullResult.remoteUrl,
        targetAgent,
        pulledCount: pullResult.pulledCount,
        deliveredCount: pullResult.deliveredCount,
        failedCount: pullResult.failedCount,
        remainingCount: pullResult.remainingCount,
        delivered: pullResult.delivered,
        failed: pullResult.failed,
        relay: pullResult.relay
      };
    },
    async verifyText(text, options = {}) {
      const payloadBuffer = Buffer.from(text, "utf8");
      const publicIdentity = await this.getPublicId(options);
      const signature = await this.signBytes(payloadBuffer, options);

      if (publicIdentity.publicKeyBase64 !== signature.publicKeyBase64) {
        throw new Error("SIGN_BYTES returned a different public key than GET_PUBLIC_ID.");
      }
      if (publicIdentity.keyId !== signature.keyId) {
        throw new Error("SIGN_BYTES returned a different keyId than GET_PUBLIC_ID.");
      }

      const verified = verifyEs256Signature({
        payload: payloadBuffer,
        publicKeyBase64: publicIdentity.publicKeyBase64,
        signatureBase64: signature.signatureBase64
      });

      return {
        algorithm: publicIdentity.algorithm,
        curve: publicIdentity.curve ?? "P-256",
        text,
        keyId: publicIdentity.keyId,
        fingerprintHex: publicIdentity.fingerprintHex,
        publicKeyBase64: publicIdentity.publicKeyBase64,
        signatureBase64: signature.signatureBase64,
        verified
      };
    }
  };
}



