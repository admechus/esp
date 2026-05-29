import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createEnvelopeId,
  createEnvelopeSigningBytes,
  createSignedEnvelope,
  createUnsignedTextEnvelope
} from "../src/protocol/envelopes.js";
import { createAgentRuntime } from "../src/runtime/agentRuntime.js";
import { readJsonFile, writeJsonFile } from "../src/storage/jsonFiles.js";
import {
  assertTransportFileResult,
  assertTransportMetadata,
  assertTransportPullResult,
  assertTransportSendResult
} from "../src/transport/transportAdapter.js";
import {
  checkTransportHealth,
  getTransportById,
  listTransportMetadata,
  summarizeTransportHealth,
  summarizeTransportCapabilities
} from "../src/transport/transportDiagnostics.js";
import { createFileBundleTransport } from "../src/transport/fileBundleTransport.js";
import { createLocalHttpAgentTransport } from "../src/transport/localHttpAgentTransport.js";
import { createLocalHttpRelayTransport } from "../src/transport/localHttpRelayTransport.js";
import { createMockDongleTransport } from "../src/transport/mockDongleTransport.js";
import { createTransportRegistry } from "../src/transport/transportRegistry.js";
import { createYggdrasilDirectTransport } from "../src/transport/yggdrasilDirectTransport.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function expectValidatorFailure({ fn, name, includes }) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof Error, `${name} should throw.`);
  for (const fragment of includes) {
    assert(
      thrown.message.includes(fragment),
      `${name} should mention "${fragment}", got: ${thrown.message}`
    );
  }

  return {
    name,
    ok: true,
    detail: thrown.message
  };
}

async function withJsonServer(handler) {
  const server = createServer(async (request, response) => {
    try {
      const payload = await handler(request);
      response.writeHead(payload.statusCode ?? 200, {
        "Content-Type": "application/json; charset=utf-8"
      });
      response.end(JSON.stringify(payload.body ?? {}));
    } catch (error) {
      response.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8"
      });
      response.end(
        JSON.stringify({
          ok: false,
          error: error.message
        })
      );
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  };
}

async function withTempRuntime(fn, { agentName = "sender" } = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), "esp-runtime-smoke-"));
  const runtime = createAgentRuntime({
    stateDir,
    agentName
  });

  try {
    return await fn(runtime, stateDir);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

async function createMockSignedEnvelope(text) {
  const mockTransport = createMockDongleTransport();
  const identity = await mockTransport.send({
    id: 1,
    cmd: "GET_PUBLIC_ID"
  });
  const unsignedEnvelope = createUnsignedTextEnvelope({
    sender: {
      algorithm: identity.algorithm,
      curve: identity.curve,
      keyId: identity.keyId,
      fingerprintHex: identity.fingerprintHex,
      publicKeyBase64: identity.publicKeyBase64
    },
    text
  });
  const signingBytes = createEnvelopeSigningBytes(unsignedEnvelope);
  const signature = await mockTransport.send({
    id: 2,
    cmd: "SIGN_BYTES",
    payloadBase64: signingBytes.toString("base64")
  });
  const envelope = createSignedEnvelope(unsignedEnvelope, signature.signatureBase64);

  return {
    envelope,
    envelopeId: createEnvelopeId(envelope),
    senderKeyId: identity.keyId
  };
}

async function seedPendingOutboxMessage(runtime, text = "transport smoke hello") {
  const { envelope, envelopeId, senderKeyId } = await createMockSignedEnvelope(text);
  const outboxFile = runtime.getAgentInfo().outboxFile;
  await writeJsonFile(outboxFile, {
    version: 1,
    messages: [
      {
        messageId: envelopeId,
        envelopeId,
        envelopeCreatedAt: envelope.createdAt,
        status: "saved",
        senderKeyId,
        recipientKeyId: null,
        recipientKnown: false,
        locallyVerified: true,
        textPreview: text.slice(0, 160),
        sourceFilePath: `outbox:${envelopeId}`,
        envelope
      }
    ]
  });
}

async function testLocalHttpAgentErrorHandling() {
  const adapter = createLocalHttpAgentTransport();
  const server = await withJsonServer(async (request) => {
    assert(
      request.method === "POST" && request.url === "/transport/accept-bundle",
      "Agent adapter hit unexpected endpoint."
    );

    return {
      statusCode: 503,
      body: {
        ok: false,
        error: "agent_downstream_unavailable"
      }
    };
  });

  try {
    let thrown = null;
    try {
      await adapter.sendBundle({
        bundle: { version: 1, kind: "transport-bundle", messages: [] },
        options: { remoteUrl: server.baseUrl }
      });
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof Error, "Agent adapter should throw on non-ok response.");
    assert(
      thrown.message === "agent_downstream_unavailable",
      `Agent adapter should propagate payload error, got: ${thrown.message}`
    );

    return {
      name: "local-http-agent error handling",
      ok: true,
      detail: thrown.message
    };
  } finally {
    await server.close();
  }
}

async function testLocalHttpAgentSendShape() {
  const adapter = createLocalHttpAgentTransport();
  const server = await withJsonServer(async (request) => {
    assert(
      request.method === "POST" && request.url === "/transport/accept-bundle",
      "Agent adapter hit unexpected endpoint."
    );

    return {
      statusCode: 200,
      body: {
        ok: true,
        agent: {
          name: "receiver"
        },
        result: {
          accepted: [{ messageId: "message:1" }],
          receipts: [{ receiptId: "receipt:1" }]
        }
      }
    };
  });

  try {
    const result = await adapter.sendBundle({
      bundle: { version: 1, kind: "transport-bundle", messages: [] },
      options: { remoteUrl: server.baseUrl }
    });

    assertTransportSendResult(result, "local-http-agent sendBundle");
    assert(result.remoteEntity?.name === "receiver", "Agent adapter should preserve remote agent info.");

    return {
      name: "local-http-agent send result shape",
      ok: true,
      detail: JSON.stringify({
        accepted: result.accepted,
        receipts: result.receipts,
        remoteEntity: result.remoteEntity
      })
    };
  } finally {
    await server.close();
  }
}

async function testLocalHttpRelayPullShape() {
  const adapter = createLocalHttpRelayTransport();
  const mockPayload = {
    ok: true,
    relay: {
      name: "gateway-alpha"
    },
    result: {
      pulledCount: 2,
      deliveredCount: 2,
      failedCount: 0,
      remainingCount: 1,
      delivered: [{ transferId: "transfer:1" }],
      failed: []
    }
  };

  const server = await withJsonServer(async (request) => {
    assert(request.method === "POST" && request.url === "/relay/pull", "Relay pull hit unexpected endpoint.");

    return {
      statusCode: 200,
      body: mockPayload
    };
  });

  try {
    const result = await adapter.pullQueued({
      target: "receiver",
      options: { remoteUrl: server.baseUrl }
    });

    assertTransportPullResult(result, "local-http-relay pullQueued");
    assert(result.remoteUrl === server.baseUrl, "Relay adapter should return normalized remoteUrl.");
    assert(result.pulledCount === 2, "Relay adapter should preserve pulledCount.");
    assert(Array.isArray(result.delivered), "Relay adapter should preserve delivered array.");

    return {
      name: "local-http-relay pullQueued result shape",
      ok: true,
      detail: JSON.stringify({
        pulledCount: result.pulledCount,
        deliveredCount: result.deliveredCount,
        failedCount: result.failedCount,
        remainingCount: result.remainingCount,
        delivered: result.delivered,
        failed: result.failed
      })
    };
  } finally {
    await server.close();
  }
}

async function testFileBundleRoundtrip() {
  const tempRoot = await mkdtemp(join(tmpdir(), "esp-transport-smoke-"));
  const bundleFile = join(tempRoot, "bundle.json");
  const adapter = createFileBundleTransport({
    readJsonFile,
    writeJsonFile
  });
  const bundle = {
    version: 1,
    kind: "transport-bundle",
    createdAt: new Date().toISOString(),
    source: {
      agentName: "sender"
    },
    messageCount: 1,
    messages: [
      {
        messageId: "message:1",
        envelopeId: "envelope:1",
        envelope: {
          version: 1,
          kind: "signed-envelope"
        }
      }
    ]
  };

  try {
    const exported = await adapter.exportBundle({
      filePath: bundleFile,
      bundle
    });
    const imported = await adapter.importBundle({
      filePath: bundleFile
    });

    assertTransportFileResult(exported, "file-bundle exportBundle");
    assertTransportFileResult(imported, "file-bundle importBundle");
    assert(exported.filePath === bundleFile, "File bundle export should return the target path.");
    assert(
      JSON.stringify(imported.bundle) === JSON.stringify(bundle),
      "File bundle roundtrip should preserve bundle JSON."
    );

    return {
      name: "file-bundle export/import roundtrip",
      ok: true,
      detail: bundleFile
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function testYggdrasilDirectSendShape() {
  const adapter = createYggdrasilDirectTransport();
  const server = await withJsonServer(async (request) => {
    assert(
      request.method === "POST" && request.url === "/transport/accept-bundle",
      "Yggdrasil direct adapter hit unexpected endpoint."
    );

    return {
      statusCode: 200,
      body: {
        ok: true,
        peer: {
          name: "ygg-peer-alpha",
          transport: "yggdrasil-direct"
        },
        result: {
          accepted: [{ messageId: "message:ygg:1" }],
          receipts: [{ receiptId: "receipt:ygg:1" }]
        }
      }
    };
  });

  try {
    const result = await adapter.sendBundle({
      target: "ygg-peer-alpha",
      bundle: { version: 1, kind: "transport-bundle", messages: [] },
      options: { remoteUrl: server.baseUrl }
    });

    assertTransportSendResult(result, "yggdrasil-direct sendBundle");
    assert(result.kind === "yggdrasil-direct", "Yggdrasil adapter should preserve transport kind.");
    assert(result.targetAgent === "ygg-peer-alpha", "Yggdrasil adapter should preserve target peer.");

    return {
      name: "yggdrasil-direct send result shape (contract-only)",
      ok: true,
      detail: JSON.stringify({
        remoteUrl: result.remoteUrl,
        remoteEntity: result.remoteEntity,
        accepted: result.accepted,
        receipts: result.receipts
      })
    };
  } finally {
    await server.close();
  }
}

async function testTransportHealthLocalHttpAgent() {
  const registry = createTransportRegistry({
    localHttpAgent: createLocalHttpAgentTransport()
  });
  const server = await withJsonServer(async (request) => {
    assert(request.method === "GET" && request.url === "/health", "Agent health should hit /health.");
    return {
      statusCode: 200,
      body: {
        ok: true,
        service: "esp-messenger-agent",
        agent: { name: "receiver-health" }
      }
    };
  });

  try {
    const result = await checkTransportHealth(registry, "local-http-agent", {
      remoteUrl: server.baseUrl
    });
    assert(result.id === "local-http-agent", "Agent health should preserve id.");
    assert(result.health.remoteUrl === server.baseUrl, "Agent health should preserve remoteUrl.");

    return {
      name: "transport health local-http-agent",
      ok: true,
      detail: JSON.stringify({
        id: result.id,
        remoteUrl: result.health.remoteUrl,
        payload: result.health.payload
      })
    };
  } finally {
    await server.close();
  }
}

async function testTransportHealthLocalHttpRelay() {
  const registry = createTransportRegistry({
    localHttpRelay: createLocalHttpRelayTransport()
  });
  const server = await withJsonServer(async (request) => {
    assert(request.method === "GET" && request.url === "/health", "Relay health should hit /health.");
    return {
      statusCode: 200,
      body: {
        ok: true,
        service: "esp-messenger-relay",
        relay: { name: "gateway-health" }
      }
    };
  });

  try {
    const result = await checkTransportHealth(registry, "local-http-relay", {
      remoteUrl: server.baseUrl
    });
    assert(result.id === "local-http-relay", "Relay health should preserve id.");
    assert(result.health.remoteUrl === server.baseUrl, "Relay health should preserve remoteUrl.");

    return {
      name: "transport health local-http-relay",
      ok: true,
      detail: JSON.stringify({
        id: result.id,
        remoteUrl: result.health.remoteUrl,
        payload: result.health.payload
      })
    };
  } finally {
    await server.close();
  }
}

async function testTransportHealthFileBundle() {
  const registry = createTransportRegistry({
    fileBundle: createFileBundleTransport({
      readJsonFile,
      writeJsonFile
    })
  });
  const result = await checkTransportHealth(registry, "file-bundle");
  assert(result.id === "file-bundle", "File-bundle health should preserve id.");
  assert(result.health.ok === true, "File-bundle health should be statically ok.");

  return {
    name: "transport health file-bundle",
    ok: true,
    detail: JSON.stringify(result.health)
  };
}

async function testTransportHealthUnknownFailure() {
  return withTempRuntime(async (runtime) => {
    let thrown = null;
    try {
      await runtime.checkTransportHealth("unknown-transport");
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof Error, "Unknown transport health should throw.");
    assert(
      thrown.message.includes("Transport unknown-transport is not active in this registry."),
      `Unexpected unknown transport health error: ${thrown?.message}`
    );

    return {
      name: "transport health unknown transport fails clearly",
      ok: true,
      detail: thrown.message
    };
  });
}

async function testTransportHealthRuntimeYggFailure() {
  return withTempRuntime(async (runtime) => {
    let thrown = null;
    try {
      await runtime.checkTransportHealth("yggdrasil-direct", {
        remoteUrl: "http://127.0.0.1:9999"
      });
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof Error, "Inactive runtime ygg health should throw.");
    assert(
      thrown.message.includes("Transport yggdrasil-direct is not active in this registry."),
      `Unexpected runtime ygg health error: ${thrown?.message}`
    );

    return {
      name: "transport health runtime yggdrasil-direct is rejected",
      ok: true,
      detail: thrown.message
    };
  });
}

async function testTransportHealthDiagnosticsYggRegistry() {
  const registry = createTransportRegistry({
    yggdrasilDirect: createYggdrasilDirectTransport()
  });
  const server = await withJsonServer(async (request) => {
    assert(request.method === "GET" && request.url === "/health", "Ygg health should hit /health.");
    return {
      statusCode: 200,
      body: {
        ok: true,
        service: "ygg-peer",
        peer: { name: "ygg-peer-health" }
      }
    };
  });

  try {
    const result = await checkTransportHealth(registry, "yggdrasil-direct", {
      remoteUrl: server.baseUrl
    });
    assert(result.experimental === true, "Diagnostics ygg health should remain experimental.");

    return {
      name: "transport health diagnostics ygg test registry",
      ok: true,
      detail: JSON.stringify({
        id: result.id,
        experimental: result.experimental,
        remoteUrl: result.health.remoteUrl
      })
    };
  } finally {
    await server.close();
  }
}

async function testRuntimeDefaultDirectDeliveryPath() {
  return withTempRuntime(async (runtime) => {
    await seedPendingOutboxMessage(runtime, "default direct path");
    const server = await withJsonServer(async (request) => {
      assert(
        request.method === "POST" && request.url === "/transport/accept-bundle",
        "Default direct delivery should hit /transport/accept-bundle."
      );

      return {
        statusCode: 200,
        body: {
          ok: true,
          agent: { name: "receiver-default" },
          result: {
            accepted: [],
            receipts: []
          }
        }
      };
    });

    try {
      const result = await runtime.deliverTransportBundle(server.baseUrl, { mock: true });
      assert(result.targetAgent === null, "Default direct delivery should not target relay agent.");
      assert(result.remoteAgent?.name === "receiver-default", "Default direct delivery should preserve remote agent.");

      return {
        name: "runtime default direct delivery path",
        ok: true,
        detail: JSON.stringify({
          remoteAgent: result.remoteAgent?.name ?? null,
          queued: result.queued,
          messageCount: result.messageCount
        })
      };
    } finally {
      await server.close();
    }
  });
}

async function testRuntimeDefaultRelayDeliveryPath() {
  return withTempRuntime(async (runtime) => {
    await seedPendingOutboxMessage(runtime, "default relay path");
    const server = await withJsonServer(async (request) => {
      assert(
        request.method === "POST" && request.url === "/relay/deliver",
        "Default relay delivery should hit /relay/deliver."
      );

      return {
        statusCode: 200,
        body: {
          ok: true,
          relay: { name: "gateway-default" },
          result: {
            accepted: [],
            receipts: [],
            queued: true,
            queueId: "queue:default"
          }
        }
      };
    });

    try {
      const result = await runtime.deliverTransportBundle(server.baseUrl, {
        mock: true,
        targetAgent: "receiver-default"
      });
      assert(result.targetAgent === "receiver-default", "Default relay delivery should preserve targetAgent.");
      assert(result.queued === true, "Default relay delivery should preserve relay queueing state.");

      return {
        name: "runtime default relay delivery path",
        ok: true,
        detail: JSON.stringify({
          remoteAgent: result.remoteAgent?.name ?? null,
          queueId: result.queueId,
          queued: result.queued,
          targetAgent: result.targetAgent
        })
      };
    } finally {
      await server.close();
    }
  });
}

async function testRuntimeExplicitLocalHttpAgentSelection() {
  return withTempRuntime(async (runtime) => {
    await seedPendingOutboxMessage(runtime, "explicit agent transport");
    const server = await withJsonServer(async (request) => {
      assert(
        request.method === "POST" && request.url === "/transport/accept-bundle",
        "Explicit local-http-agent selection should hit /transport/accept-bundle."
      );

      return {
        statusCode: 200,
        body: {
          ok: true,
          agent: { name: "receiver-explicit-agent" },
          result: {
            accepted: [],
            receipts: []
          }
        }
      };
    });

    try {
      const result = await runtime.deliverTransportBundle(server.baseUrl, {
        mock: true,
        transportId: "local-http-agent"
      });
      assert(result.remoteAgent?.name === "receiver-explicit-agent", "Explicit local-http-agent should be used.");

      return {
        name: "runtime explicit local-http-agent selection",
        ok: true,
        detail: JSON.stringify({
          transportId: "local-http-agent",
          remoteAgent: result.remoteAgent?.name ?? null,
          queued: result.queued
        })
      };
    } finally {
      await server.close();
    }
  });
}

async function testRuntimeExplicitLocalHttpRelayPullSelection() {
  return withTempRuntime(async (runtime) => {
    const server = await withJsonServer(async (request) => {
      assert(
        request.method === "POST" && request.url === "/relay/pull",
        "Explicit local-http-relay pull should hit /relay/pull."
      );

      return {
        statusCode: 200,
        body: {
          ok: true,
          relay: { name: "gateway-explicit-relay" },
          result: {
            pulledCount: 1,
            deliveredCount: 1,
            failedCount: 0,
            remainingCount: 0,
            delivered: [{ transferId: "transfer:relay:1" }],
            failed: []
          }
        }
      };
    });

    try {
      const result = await runtime.pullPendingFromRelay(server.baseUrl, {
        transportId: "local-http-relay",
        pullTargetAgent: "receiver-explicit-relay"
      });
      assert(result.targetAgent === "receiver-explicit-relay", "Explicit local-http-relay pull should preserve target.");
      assert(result.pulledCount === 1, "Explicit local-http-relay pull should preserve pulledCount.");

      return {
        name: "runtime explicit local-http-relay pull selection",
        ok: true,
        detail: JSON.stringify({
          transportId: "local-http-relay",
          targetAgent: result.targetAgent,
          pulledCount: result.pulledCount
        })
      };
    } finally {
      await server.close();
    }
  });
}

async function testRuntimeExplicitFileBundleSelection() {
  return withTempRuntime(async (runtime, stateDir) => {
    const bundleFile = join(stateDir, "explicit-file-bundle.json");
    await seedPendingOutboxMessage(runtime, "explicit file bundle");
    const exported = await runtime.exportOutboxBundle({
      mock: true,
      transportId: "file-bundle",
      filePath: bundleFile
    });
    const imported = await runtime.importTransportBundle(bundleFile, {
      transportId: "file-bundle"
    });

    assert(exported.filePath === bundleFile, "Explicit file-bundle export should preserve file path.");
    assert(imported.filePath === bundleFile, "Explicit file-bundle import should preserve file path.");

    return {
      name: "runtime explicit file-bundle selection",
      ok: true,
      detail: JSON.stringify({
        transportId: "file-bundle",
        exportedFile: exported.filePath,
        importedCount: imported.messageCount
      })
    };
  });
}

async function testRuntimeUnknownTransportFailure() {
  return withTempRuntime(async (runtime) => {
    await seedPendingOutboxMessage(runtime, "unknown transport failure");
    let thrown = null;
    try {
      await runtime.deliverTransportBundle("http://127.0.0.1:9999", {
        mock: true,
        transportId: "unknown-transport"
      });
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof Error, "Unknown transport selection should throw.");
    assert(
      thrown.message.includes("Transport unknown-transport is not active in this runtime."),
      `Unexpected unknown transport error: ${thrown?.message}`
    );

    return {
      name: "runtime unknown transport selection fails clearly",
      ok: true,
      detail: thrown.message
    };
  });
}

async function testRuntimeUnsupportedTransportFailure() {
  return withTempRuntime(async (runtime) => {
    await seedPendingOutboxMessage(runtime, "unsupported file transport");
    let thrown = null;
    try {
      await runtime.deliverTransportBundle("http://127.0.0.1:9999", {
        mock: true,
        transportId: "file-bundle"
      });
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof Error, "Unsupported runtime transport should throw.");
    assert(
      thrown.message.includes("Transport file-bundle is not supported for remote bundle delivery."),
      `Unexpected unsupported transport error: ${thrown?.message}`
    );

    return {
      name: "runtime unsupported transport for delivery fails clearly",
      ok: true,
      detail: thrown.message
    };
  });
}

async function testRuntimeYggTransportFailure() {
  return withTempRuntime(async (runtime) => {
    await seedPendingOutboxMessage(runtime, "ygg inactive transport");
    let thrown = null;
    try {
      await runtime.deliverTransportBundle("http://127.0.0.1:9999", {
        mock: true,
        transportId: "yggdrasil-direct"
      });
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof Error, "Inactive yggdrasil-direct transport should throw.");
    assert(
      thrown.message.includes("Transport yggdrasil-direct is not active in this runtime."),
      `Unexpected ygg transport error: ${thrown?.message}`
    );

    return {
      name: "runtime yggdrasil-direct active delivery hint is rejected",
      ok: true,
      detail: thrown.message
    };
  });
}

function testRegisteredTransportMetadata() {
  const registry = createTransportRegistry({
    localHttpAgent: createLocalHttpAgentTransport(),
    localHttpRelay: createLocalHttpRelayTransport(),
    fileBundle: createFileBundleTransport({
      readJsonFile,
      writeJsonFile
    }),
    yggdrasilDirect: createYggdrasilDirectTransport()
  });

  const adapters = registry.list();
  assert(adapters.length === 4, `Expected 4 registered adapters, got ${adapters.length}.`);

  for (const adapter of adapters) {
    assertTransportMetadata(adapter.metadata, `${adapter.id} metadata`);
    assert(adapter.id === adapter.metadata.id, `${adapter.id} metadata id should match adapter id.`);
    assert(adapter.kind === adapter.metadata.kind, `${adapter.id} metadata kind should match adapter kind.`);
    assert(
      JSON.stringify(adapter.capabilities) === JSON.stringify(adapter.metadata.capabilities),
      `${adapter.id} metadata capabilities should match adapter capabilities.`
    );
  }

  const yggAdapter = registry.require("yggdrasil-direct");
  assert(yggAdapter.metadata.experimental === true, "yggdrasil-direct should be marked experimental.");
  assert(yggAdapter.metadata.supports.ipv6 === true, "yggdrasil-direct should declare IPv6 support.");
  assert(
    Array.isArray(yggAdapter.metadata.configRequirements) &&
      yggAdapter.metadata.configRequirements.some((item) => item.name === "remoteUrl"),
    "yggdrasil-direct should declare remoteUrl config requirement."
  );

  const fileAdapter = registry.require("file-bundle");
  assert(fileAdapter.metadata.supports.fileExport === true, "file-bundle should declare file export support.");
  assert(fileAdapter.metadata.supports.fileImport === true, "file-bundle should declare file import support.");
  assert(fileAdapter.metadata.supports.offlineCarry === true, "file-bundle should declare offline carry support.");
  assert(
    Array.isArray(fileAdapter.metadata.configRequirements) &&
      fileAdapter.metadata.configRequirements.some((item) => item.name === "filePath"),
    "file-bundle should declare filePath config requirement."
  );

  const relayAdapter = registry.require("local-http-relay");
  assert(relayAdapter.metadata.supports.relayDelivery === true, "local-http-relay should declare relay delivery.");
  assert(relayAdapter.metadata.supports.pullRecovery === true, "local-http-relay should declare pull recovery.");
  assert(
    Array.isArray(relayAdapter.metadata.configRequirements) &&
      relayAdapter.metadata.configRequirements.some((item) => item.name === "remoteUrl") &&
      relayAdapter.metadata.configRequirements.some((item) => item.name === "targetAgent"),
    "local-http-relay should declare remoteUrl and targetAgent config requirements."
  );

  const agentAdapter = registry.require("local-http-agent");
  assert(
    Array.isArray(agentAdapter.metadata.configRequirements) &&
      agentAdapter.metadata.configRequirements.some((item) => item.name === "remoteUrl"),
    "local-http-agent should declare remoteUrl config requirement."
  );

  return {
    name: "transport registry metadata passports",
    ok: true,
    detail: JSON.stringify(
      adapters.map((adapter) => ({
        id: adapter.id,
        kind: adapter.kind,
        experimental: adapter.metadata.experimental,
        supports: adapter.metadata.supports
      }))
    )
  };
}

function testTransportConfigRequirementsMetadata() {
  const registry = createTransportRegistry({
    localHttpAgent: createLocalHttpAgentTransport(),
    localHttpRelay: createLocalHttpRelayTransport(),
    fileBundle: createFileBundleTransport({
      readJsonFile,
      writeJsonFile
    }),
    yggdrasilDirect: createYggdrasilDirectTransport()
  });

  const summaries = summarizeTransportCapabilities(registry);
  for (const summary of summaries) {
    assert(
      Array.isArray(summary.configRequirements),
      `${summary.id} should expose configRequirements array in diagnostics summary.`
    );
    for (const requirement of summary.configRequirements) {
      assert(typeof requirement.name === "string" && requirement.name, `${summary.id} config requirement name missing.`);
      assert(typeof requirement.required === "boolean", `${summary.id} config requirement required flag invalid.`);
      assert(
        typeof requirement.description === "string" && requirement.description,
        `${summary.id} config requirement description missing.`
      );
      assert(
        typeof requirement.example === "string" && requirement.example,
        `${summary.id} config requirement example missing.`
      );
    }
  }

  return {
    name: "transport config requirements metadata",
    ok: true,
    detail: JSON.stringify(
      summaries.map((summary) => ({
        id: summary.id,
        experimental: summary.experimental,
        requirements: summary.configRequirements.map((item) => item.name)
      }))
    )
  };
}

function createExplodingAdapter({
  id,
  kind,
  metadata,
  capabilities
}) {
  return {
    id,
    kind,
    capabilities,
    metadata,
    async health() {
      throw new Error(`${id} health should not be called by diagnostics.`);
    },
    async sendBundle() {
      throw new Error(`${id} sendBundle should not be called by diagnostics.`);
    },
    async pullQueued() {
      throw new Error(`${id} pullQueued should not be called by diagnostics.`);
    }
  };
}

function testTransportDiagnosticsStableVisibility() {
  const diagnosticsRegistry = createTransportRegistry({
    localHttpAgent: createExplodingAdapter({
      id: "local-http-agent",
      kind: "local-http-agent",
      capabilities: ["send-bundle", "health"],
      metadata: createLocalHttpAgentTransport().metadata
    }),
    localHttpRelay: createExplodingAdapter({
      id: "local-http-relay",
      kind: "local-http-relay",
      capabilities: ["send-bundle", "pull-queued", "list-routes", "list-queue", "health"],
      metadata: createLocalHttpRelayTransport().metadata
    }),
    fileBundle: createExplodingAdapter({
      id: "file-bundle",
      kind: "file-bundle",
      capabilities: ["export-bundle", "import-bundle", "health"],
      metadata: createFileBundleTransport({
        readJsonFile,
        writeJsonFile
      }).metadata
    })
  });

  const metadataList = listTransportMetadata(diagnosticsRegistry);
  const capabilitySummary = summarizeTransportCapabilities(diagnosticsRegistry);
  const relayMetadata = getTransportById(diagnosticsRegistry, "local-http-relay");

  assert(metadataList.length === 3, `Expected 3 stable runtime transports, got ${metadataList.length}.`);
  assert(capabilitySummary.length === 3, `Expected 3 transport summaries, got ${capabilitySummary.length}.`);
  assert(relayMetadata?.metadata?.supports?.pullRecovery === true, "Relay metadata should expose pullRecovery.");

  return {
    name: "transport diagnostics stable visibility",
    ok: true,
    detail: JSON.stringify(
      capabilitySummary.map((entry) => ({
        id: entry.id,
        networkClass: entry.networkClass,
        experimental: entry.experimental
      }))
    )
  };
}

function testTransportDiagnosticsYggTestRegistry() {
  const diagnosticsRegistry = createTransportRegistry({
    localHttpAgent: createLocalHttpAgentTransport(),
    localHttpRelay: createLocalHttpRelayTransport(),
    fileBundle: createFileBundleTransport({
      readJsonFile,
      writeJsonFile
    }),
    yggdrasilDirect: createYggdrasilDirectTransport()
  });

  const metadataList = listTransportMetadata(diagnosticsRegistry);
  const yggMetadata = getTransportById(diagnosticsRegistry, "yggdrasil-direct");

  assert(metadataList.length === 4, `Expected 4 transports in test registry, got ${metadataList.length}.`);
  assert(yggMetadata?.metadata?.experimental === true, "Yggdrasil metadata should be experimental in diagnostics.");

  return {
    name: "transport diagnostics ygg test registry visibility",
    ok: true,
    detail: JSON.stringify({
      id: yggMetadata.id,
      kind: yggMetadata.kind,
      experimental: yggMetadata.metadata.experimental,
      networkClass: yggMetadata.metadata.networkClass
    })
  };
}

async function testTransportHealthSummaryExplicitOnly() {
  const registry = createTransportRegistry({
    fileBundle: createFileBundleTransport({
      readJsonFile,
      writeJsonFile
    })
  });
  const result = await summarizeTransportHealth(registry);
  assert(Array.isArray(result) && result.length === 1, "Transport health summary should return one result.");
  assert(result[0].id === "file-bundle", "Transport health summary should preserve file-bundle id.");

  return {
    name: "transport health summary explicit-only",
    ok: true,
    detail: JSON.stringify(result.map((entry) => ({
      id: entry.id,
      ok: entry.health?.ok ?? null
    })))
  };
}

function testTransportSendNegativePaths() {
  return [
    expectValidatorFailure({
      name: "TransportSendResult missing id",
      fn() {
        assertTransportSendResult(
          {
            kind: "local-http-agent",
            remoteUrl: "http://127.0.0.1:8788",
            accepted: [],
            receipts: [],
            queued: false,
            queueId: null,
            queueReason: null,
            queueError: null,
            relayReceiptId: null,
            targetAgent: null
          },
          "negative TransportSendResult missing id"
        );
      },
      includes: ["TransportSendResult", "id"]
    }),
    expectValidatorFailure({
      name: "TransportSendResult wrong receipts shape",
      fn() {
        assertTransportSendResult(
          {
            id: "local-http-agent",
            kind: "local-http-agent",
            remoteUrl: "http://127.0.0.1:8788",
            accepted: [],
            receipts: {},
            queued: false,
            queueId: null,
            queueReason: null,
            queueError: null,
            relayReceiptId: null,
            targetAgent: null
          },
          "negative TransportSendResult wrong receipts shape"
        );
      },
      includes: ["TransportSendResult", "receipts"]
    }),
    expectValidatorFailure({
      name: "TransportSendResult invalid queued type",
      fn() {
        assertTransportSendResult(
          {
            id: "local-http-agent",
            kind: "local-http-agent",
            remoteUrl: "http://127.0.0.1:8788",
            accepted: [],
            receipts: [],
            queued: "false",
            queueId: null,
            queueReason: null,
            queueError: null,
            relayReceiptId: null,
            targetAgent: null
          },
          "negative TransportSendResult invalid queued type"
        );
      },
      includes: ["TransportSendResult", "queued"]
    })
  ];
}

function testTransportPullNegativePaths() {
  return [
    expectValidatorFailure({
      name: "TransportPullResult missing remoteUrl",
      fn() {
        assertTransportPullResult(
          {
            id: "local-http-relay",
            kind: "local-http-relay",
            targetAgent: "receiver",
            pulledCount: 1,
            deliveredCount: 1,
            failedCount: 0,
            remainingCount: 0,
            delivered: [],
            failed: []
          },
          "negative TransportPullResult missing remoteUrl"
        );
      },
      includes: ["TransportPullResult", "remoteUrl"]
    }),
    expectValidatorFailure({
      name: "TransportPullResult invalid delivered shape",
      fn() {
        assertTransportPullResult(
          {
            id: "local-http-relay",
            kind: "local-http-relay",
            remoteUrl: "http://127.0.0.1:8790",
            targetAgent: "receiver",
            pulledCount: 1,
            deliveredCount: 1,
            failedCount: 0,
            remainingCount: 0,
            delivered: {},
            failed: []
          },
          "negative TransportPullResult invalid delivered shape"
        );
      },
      includes: ["TransportPullResult", "delivered"]
    }),
    expectValidatorFailure({
      name: "TransportPullResult invalid remainingCount type",
      fn() {
        assertTransportPullResult(
          {
            id: "local-http-relay",
            kind: "local-http-relay",
            remoteUrl: "http://127.0.0.1:8790",
            targetAgent: "receiver",
            pulledCount: 1,
            deliveredCount: 1,
            failedCount: 0,
            remainingCount: "0",
            delivered: [],
            failed: []
          },
          "negative TransportPullResult invalid remainingCount type"
        );
      },
      includes: ["TransportPullResult", "remainingCount"]
    })
  ];
}

function testTransportFileNegativePaths() {
  return [
    expectValidatorFailure({
      name: "TransportFileResult missing filePath",
      fn() {
        assertTransportFileResult(
          {
            id: "file-bundle",
            kind: "file-bundle",
            bundle: {},
            messageCount: 0
          },
          "negative TransportFileResult missing filePath"
        );
      },
      includes: ["TransportFileResult", "filePath"]
    }),
    expectValidatorFailure({
      name: "TransportFileResult invalid bundle shape",
      fn() {
        assertTransportFileResult(
          {
            id: "file-bundle",
            kind: "file-bundle",
            filePath: "C:\\temp\\bundle.json",
            bundle: null,
            messageCount: 0
          },
          "negative TransportFileResult invalid bundle shape"
        );
      },
      includes: ["bundle", "object"]
    }),
    expectValidatorFailure({
      name: "TransportFileResult invalid messageCount type",
      fn() {
        assertTransportFileResult(
          {
            id: "file-bundle",
            kind: "file-bundle",
            filePath: "C:\\temp\\bundle.json",
            bundle: {},
            messageCount: "1"
          },
          "negative TransportFileResult invalid messageCount type"
        );
      },
      includes: ["TransportFileResult", "messageCount"]
    })
  ];
}

async function main() {
  const results = [];
  results.push(await testLocalHttpAgentErrorHandling());
  results.push(await testLocalHttpAgentSendShape());
  results.push(await testLocalHttpRelayPullShape());
  results.push(await testFileBundleRoundtrip());
  results.push(await testYggdrasilDirectSendShape());
  results.push(await testTransportHealthLocalHttpAgent());
  results.push(await testTransportHealthLocalHttpRelay());
  results.push(await testTransportHealthFileBundle());
  results.push(await testTransportHealthUnknownFailure());
  results.push(await testTransportHealthRuntimeYggFailure());
  results.push(await testTransportHealthDiagnosticsYggRegistry());
  results.push(await testTransportHealthSummaryExplicitOnly());
  results.push(await testRuntimeDefaultDirectDeliveryPath());
  results.push(await testRuntimeDefaultRelayDeliveryPath());
  results.push(await testRuntimeExplicitLocalHttpAgentSelection());
  results.push(await testRuntimeExplicitLocalHttpRelayPullSelection());
  results.push(await testRuntimeExplicitFileBundleSelection());
  results.push(await testRuntimeUnknownTransportFailure());
  results.push(await testRuntimeUnsupportedTransportFailure());
  results.push(await testRuntimeYggTransportFailure());
  results.push(testRegisteredTransportMetadata());
  results.push(testTransportConfigRequirementsMetadata());
  results.push(testTransportDiagnosticsStableVisibility());
  results.push(testTransportDiagnosticsYggTestRegistry());
  results.push(...testTransportSendNegativePaths());
  results.push(...testTransportPullNegativePaths());
  results.push(...testTransportFileNegativePaths());

  console.log(
    JSON.stringify(
      {
        ok: true,
        suite: "transport-smoke",
        results
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        suite: "transport-smoke",
        error: error.message
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
