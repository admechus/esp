import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readJsonFile, writeJsonFile } from "../src/storage/jsonFiles.js";
import { createFileBundleTransport } from "../src/transport/fileBundleTransport.js";
import { createLocalHttpAgentTransport } from "../src/transport/localHttpAgentTransport.js";
import { createLocalHttpRelayTransport } from "../src/transport/localHttpRelayTransport.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

    assert(result.remoteUrl === server.baseUrl, "Relay adapter should return normalized remoteUrl.");
    assert(result.payload?.result?.pulledCount === 2, "Relay adapter should preserve pulledCount.");
    assert(Array.isArray(result.payload?.result?.delivered), "Relay adapter should preserve delivered array.");

    return {
      name: "local-http-relay pullQueued result shape",
      ok: true,
      detail: JSON.stringify(result.payload.result)
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

async function main() {
  const results = [];
  results.push(await testLocalHttpAgentErrorHandling());
  results.push(await testLocalHttpRelayPullShape());
  results.push(await testFileBundleRoundtrip());

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
