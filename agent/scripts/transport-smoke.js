import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readJsonFile, writeJsonFile } from "../src/storage/jsonFiles.js";
import {
  assertTransportFileResult,
  assertTransportMetadata,
  assertTransportPullResult,
  assertTransportSendResult
} from "../src/transport/transportAdapter.js";
import {
  getTransportById,
  listTransportMetadata,
  summarizeTransportCapabilities
} from "../src/transport/transportDiagnostics.js";
import { createFileBundleTransport } from "../src/transport/fileBundleTransport.js";
import { createLocalHttpAgentTransport } from "../src/transport/localHttpAgentTransport.js";
import { createLocalHttpRelayTransport } from "../src/transport/localHttpRelayTransport.js";
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

  const fileAdapter = registry.require("file-bundle");
  assert(fileAdapter.metadata.supports.fileExport === true, "file-bundle should declare file export support.");
  assert(fileAdapter.metadata.supports.fileImport === true, "file-bundle should declare file import support.");
  assert(fileAdapter.metadata.supports.offlineCarry === true, "file-bundle should declare offline carry support.");

  const relayAdapter = registry.require("local-http-relay");
  assert(relayAdapter.metadata.supports.relayDelivery === true, "local-http-relay should declare relay delivery.");
  assert(relayAdapter.metadata.supports.pullRecovery === true, "local-http-relay should declare pull recovery.");

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
  results.push(testRegisteredTransportMetadata());
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
