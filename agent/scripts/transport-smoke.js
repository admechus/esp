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
import { createDeliveryReceipt } from "../src/protocol/receipts.js";
import { createTransportBundle } from "../src/protocol/transportBundles.js";
import { createAgentRuntime } from "../src/runtime/agentRuntime.js";
import {
  applyRuntimeProfile,
  loadRuntimeProfile,
  validateRuntimeProfile
} from "../src/runtime/runtimeProfiles.js";
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
import {
  describeYggdrasilRemoteUrl,
  isLikelyYggdrasilIpv6Address,
  isLikelyYggdrasilRemoteUrl
} from "../src/transport/yggdrasilAddress.js";
import {
  describeYggdrasilEnvironment,
  detectYggdrasilCommandAvailability,
  detectYggdrasilCtlAvailability
} from "../src/transport/yggdrasilEnvironment.js";
import {
  describeYggdrasilConnectivity,
  parseYggdrasilAddressCandidates,
  parseYggdrasilctlGetSelfOutput
} from "../src/transport/yggdrasilConnectivity.js";
import {
  describeYggdrasilHealthProbe,
  probeYggdrasilHealth
} from "../src/transport/yggdrasilHealthProbe.js";
import {
  describeYggdrasilLocalNode,
  parseYggdrasilCommandListOutput,
  parseYggdrasilGetPeersOutput,
  parseYggdrasilGetSelfOutput,
  parseYggdrasilGetSessionsOutput,
  parseYggdrasilGetTunOutput
} from "../src/transport/yggdrasilNodeIntrospection.js";
import {
  describeYggdrasilDoctor,
  detectUtf8Bom,
  parseYggdrasilConfigDocument,
  parseYggdrasilGetPathsOutput,
  summarizeNodeFirewallRules
} from "../src/transport/yggdrasilDoctor.js";
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

async function withIpv6JsonServer(handler) {
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

  await new Promise((resolve) => server.listen(0, "::1", resolve));
  const address = server.address();
  const baseUrl = `http://[::1]:${address.port}`;

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

async function withTempJsonFile(value, fileName, fn) {
  const tempRoot = await mkdtemp(join(tmpdir(), "esp-profile-smoke-"));
  const filePath = join(tempRoot, fileName);
  try {
    await writeJsonFile(filePath, value);
    return await fn(filePath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
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

async function testRuntimeProfileLoadAndValidate() {
  return withTempRuntime(async (runtime) =>
    withTempJsonFile(
      {
        profileName: "local-relay-test",
        transport: "local-http-relay",
        remoteUrl: "http://127.0.0.1:8790",
        targetAgent: "receiver"
      },
      "local-relay-test.json",
      async (filePath) => {
        const result = await runtime.loadRuntimeProfile(filePath);
        assert(result.ok === true, "Runtime profile should validate successfully.");
        assert(result.transport?.id === "local-http-relay", "Runtime profile should resolve relay transport.");

        return {
          name: "runtime profile load and validate",
          ok: true,
          detail: JSON.stringify({
            filePath: result.filePath,
            profileName: result.profile?.profileName ?? null,
            transport: result.transport?.id ?? null
          })
        };
      }
    )
  );
}

async function testRuntimeProfileMissingProfileNameFailure() {
  return withTempRuntime(async (runtime) =>
    withTempJsonFile(
      {
        transport: "local-http-agent",
        remoteUrl: "http://127.0.0.1:8788"
      },
      "missing-profile-name.json",
      async (filePath) => {
        const result = await runtime.loadRuntimeProfile(filePath);
        assert(result.ok === false, "Profile missing profileName should fail validation.");
        assert(
          result.errors.some((error) => error.includes("profileName")),
          `Expected profileName validation error, got: ${result.errors.join(" | ")}`
        );

        return {
          name: "runtime profile missing profileName fails",
          ok: true,
          detail: result.errors.join(" | ")
        };
      }
    )
  );
}

async function testRuntimeProfileMissingRequiredConfigFailure() {
  return withTempRuntime(async (runtime) =>
    withTempJsonFile(
      {
        profileName: "missing-remote-url",
        transport: "local-http-agent"
      },
      "missing-remote-url.json",
      async (filePath) => {
        const result = await runtime.loadRuntimeProfile(filePath);
        assert(result.ok === false, "Profile missing required remoteUrl should fail validation.");
        assert(
          result.errors.some((error) => error.includes("remoteUrl")),
          `Expected remoteUrl validation error, got: ${result.errors.join(" | ")}`
        );

        return {
          name: "runtime profile missing required config fails",
          ok: true,
          detail: result.errors.join(" | ")
        };
      }
    )
  );
}

async function testRuntimeProfileInactiveTransportFailure() {
  return withTempRuntime(async (runtime) =>
    withTempJsonFile(
      {
        profileName: "ygg-spike",
        transport: "yggdrasil-direct",
        remoteUrl: "http://[200:1111:2222:3333:4444:5555:6666:7777]:8788"
      },
      "ygg-spike.json",
      async (filePath) => {
        const result = await runtime.loadRuntimeProfile(filePath);
        assert(result.ok === false, "Inactive runtime transport profile should fail validation.");
        assert(
          result.errors.some((error) => error.includes("not active in this runtime registry")),
          `Expected inactive transport validation error, got: ${result.errors.join(" | ")}`
        );

        return {
          name: "runtime profile inactive transport fails",
          ok: true,
          detail: result.errors.join(" | ")
        };
      }
    )
  );
}

function testRuntimeProfileManualMerge() {
  const registry = createTransportRegistry({
    localHttpRelay: createLocalHttpRelayTransport()
  });
  const validatedProfile = validateRuntimeProfile(
    {
      profileName: "relay-manual",
      transport: "local-http-relay",
      remoteUrl: "http://127.0.0.1:8790",
      targetAgent: "receiver"
    },
    registry
  );
  const merged = applyRuntimeProfile(
    {
      transportId: "local-http-relay",
      remoteUrl: "http://127.0.0.1:9999"
    },
    validatedProfile
  );

  assert(merged.remoteUrl === "http://127.0.0.1:9999", "Explicit CLI remoteUrl should override profile.");
  assert(merged.targetAgent === "receiver", "Profile targetAgent should fill missing CLI target.");

  return {
    name: "runtime profile manual merge",
    ok: true,
    detail: JSON.stringify({
      profileName: merged.profileName ?? null,
      transportId: merged.transportId ?? null,
      remoteUrl: merged.remoteUrl ?? null,
      targetAgent: merged.targetAgent ?? null
    })
  };
}

async function testRuntimeProfileValidateDiagnostics() {
  return withTempRuntime(async (runtime) =>
    withTempJsonFile(
      {
        profileName: "relay-diagnostics",
        transport: "local-http-relay",
        remoteUrl: "http://127.0.0.1:8790",
        targetAgent: "receiver"
      },
      "relay-diagnostics.json",
      async (filePath) => {
        const result = await runtime.loadRuntimeProfile(filePath);
        assert(result.ok === true, "Profile diagnostics should validate successfully.");
        assert(result.resolvedTransportId === "local-http-relay", "Profile diagnostics should expose resolved transport id.");
        assert(result.requiredFields.includes("remoteUrl"), "Profile diagnostics should expose required fields.");
        assert(result.providedFields.includes("remoteUrl"), "Profile diagnostics should expose provided fields.");
        assert(result.missingFields.length === 0, "Profile diagnostics should not report missing fields.");

        return {
          name: "runtime profile diagnostics fields",
          ok: true,
          detail: JSON.stringify({
            resolvedTransportId: result.resolvedTransportId,
            requiredFields: result.requiredFields,
            providedFields: result.providedFields,
            missingFields: result.missingFields
          })
        };
      }
    )
  );
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

function testYggdrasilReadinessValidBracketedIpv6Url() {
  const result = describeYggdrasilRemoteUrl("http://[200:db8::1]:8788");
  assert(result.validUrl === true, "Bracketed IPv6 URL should parse.");
  assert(result.isHttpUrl === true, "Bracketed IPv6 URL should be http/https.");
  assert(result.isIpv6 === true, "Bracketed IPv6 URL should be IPv6.");
  assert(result.isBracketedIpv6HttpUrl === true, "Bracketed IPv6 URL should preserve bracketed host form.");
  assert(result.likelyYggdrasilIpv6Address === true, "Example IPv6 should match lightweight Ygg readiness heuristic.");
  assert(result.likelyYggdrasilRemoteUrl === true, "Bracketed IPv6 HTTP URL should look Ygg-ready.");
  assert(isLikelyYggdrasilRemoteUrl("http://[200:db8::1]:8788") === true, "Predicate should accept bracketed Ygg-like URL.");

  return {
    name: "yggdrasil readiness valid bracketed ipv6 url",
    ok: true,
    detail: JSON.stringify({
      hostname: result.hostname,
      port: result.port,
      likelyYggdrasilRemoteUrl: result.likelyYggdrasilRemoteUrl
    })
  };
}

function testYggdrasilReadinessInvalidUnbracketedIpv6Url() {
  const result = describeYggdrasilRemoteUrl("http://200:db8::1:8788");
  assert(result.validUrl === false, "Unbracketed IPv6 HTTP URL should fail parsing.");
  assert(result.connectivityChecked === false, "Readiness diagnostics should stay offline-only.");
  assert(isLikelyYggdrasilRemoteUrl("http://200:db8::1:8788") === false, "Predicate should reject unbracketed IPv6 URL.");

  return {
    name: "yggdrasil readiness invalid unbracketed ipv6 url",
    ok: true,
    detail: result.parseError ?? "parse failed as expected"
  };
}

function testYggdrasilReadinessLocalhostUrl() {
  const result = describeYggdrasilRemoteUrl("http://127.0.0.1:8788");
  assert(result.validUrl === true, "Localhost HTTP URL should parse.");
  assert(result.isIpv6 === false, "IPv4 localhost should not be IPv6.");
  assert(result.likelyYggdrasilRemoteUrl === false, "IPv4 localhost should not look Ygg-ready.");
  assert(isLikelyYggdrasilIpv6Address("127.0.0.1") === false, "IPv4 localhost should fail Ygg IPv6 heuristic.");

  return {
    name: "yggdrasil readiness non-ygg localhost url",
    ok: true,
    detail: JSON.stringify({
      hostname: result.hostname,
      isIpv6: result.isIpv6,
      likelyYggdrasilRemoteUrl: result.likelyYggdrasilRemoteUrl
    })
  };
}

function testYggdrasilReadinessOfflineOnly() {
  const result = describeYggdrasilRemoteUrl("http://[200:db8::1]:8788");
  assert(result.readinessOnly === true, "Ygg readiness should be explicitly diagnostics-only.");
  assert(result.connectivityChecked === false, "Ygg readiness should not perform connectivity checks.");
  assert(
    typeof result.note === "string" && result.note.includes("No Yggdrasil tools or network calls were used."),
    "Ygg readiness note should explain offline-only behavior."
  );

  return {
    name: "yggdrasil readiness diagnostics are offline-only",
    ok: true,
    detail: JSON.stringify({
      readinessOnly: result.readinessOnly,
      connectivityChecked: result.connectivityChecked
    })
  };
}

async function testYggdrasilInactiveInActiveRuntimeRegistry() {
  return withTempRuntime(async (runtime) => {
    const transports = runtime.listTransports();
    assert(
      transports.every((entry) => entry.id !== "yggdrasil-direct"),
      "Active runtime registry should not expose yggdrasil-direct."
    );

    return {
      name: "yggdrasil-direct remains inactive in active runtime registry",
      ok: true,
      detail: JSON.stringify(transports.map((entry) => entry.id))
    };
  });
}

function createUnavailableLookupExecutor() {
  return function unavailableLookupExecutor() {
    return {
      ok: false,
      status: 1,
      stdout: "",
      stderr: "",
      error: null,
      lookupCommand: process.platform === "win32" ? "where.exe" : "which",
      skipKnownLocations: true
    };
  };
}

function testYggdrasilEnvironmentDiagnosticsShape() {
  const lookupExecutor = createUnavailableLookupExecutor();
  const result = describeYggdrasilEnvironment(lookupExecutor);
  assert(typeof result.platform === "string" && result.platform, "Ygg environment should expose platform.");
  assert(typeof result.arch === "string" && result.arch, "Ygg environment should expose arch.");
  assert(typeof result.node === "string" && result.node, "Ygg environment should expose Node version.");
  assert(result.checks.commandLookupAttempted === true, "Ygg environment should report lookup attempt.");
  assert(result.readinessOnly === true, "Ygg environment should remain readiness-only.");

  return {
    name: "yggdrasil env diagnostics shape",
    ok: true,
    detail: JSON.stringify({
      platform: result.platform,
      arch: result.arch,
      node: result.node,
      checks: result.checks
    })
  };
}

function testYggdrasilEnvironmentCommandAbsenceNonFatal() {
  const lookupExecutor = createUnavailableLookupExecutor();
  const yggdrasil = detectYggdrasilCommandAvailability(lookupExecutor);
  const yggdrasilctl = detectYggdrasilCtlAvailability(lookupExecutor);
  assert(yggdrasil.available === false, "Missing yggdrasil command should report unavailable.");
  assert(yggdrasilctl.available === false, "Missing yggdrasilctl command should report unavailable.");
  assert(yggdrasil.commandLookupAttempted === true, "Missing command should still report lookup attempt.");

  return {
    name: "yggdrasil env command absence is non-fatal",
    ok: true,
    detail: JSON.stringify({
      yggdrasilAvailable: yggdrasil.available,
      yggdrasilctlAvailable: yggdrasilctl.available
    })
  };
}

function testYggdrasilEnvironmentLocalOnly() {
  const result = describeYggdrasilEnvironment(createUnavailableLookupExecutor());
  assert(result.readinessOnly === true, "Environment diagnostics should be readiness-only.");
  assert(result.connectivityChecked === false, "Environment diagnostics should not test connectivity.");
  assert(result.serviceControlAttempted === false, "Environment diagnostics should not attempt service control.");
  assert(
    typeof result.note === "string" && result.note.includes("No Yggdrasil service control"),
    "Environment diagnostics note should explain local-only behavior."
  );

  return {
    name: "yggdrasil env diagnostics are local-only",
    ok: true,
    detail: JSON.stringify({
      readinessOnly: result.readinessOnly,
      connectivityChecked: result.connectivityChecked,
      serviceControlAttempted: result.serviceControlAttempted
    })
  };
}

function testYggdrasilConnectivityCommandAbsenceNonFatal() {
  const lookupExecutor = createUnavailableLookupExecutor();
  const result = describeYggdrasilConnectivity(
    {
      remoteUrl: "http://[200:db8::1]:8788"
    },
    {
      lookupExecutor
    }
  );

  assert(result.diagnosticsOnly === true, "Connectivity diagnostics should remain diagnostics-only.");
  assert(result.local.yggdrasilctlAvailable === false, "Missing yggdrasilctl should report unavailable.");
  assert(result.local.selfInspectionAttempted === false, "Self inspection should not run when yggdrasilctl is unavailable.");

  return {
    name: "yggdrasil connectivity command absence is non-fatal",
    ok: true,
    detail: JSON.stringify({
      yggdrasilctlAvailable: result.local.yggdrasilctlAvailable,
      selfInspectionAttempted: result.local.selfInspectionAttempted
    })
  };
}

function testYggdrasilConnectivityRemoteUrlIncluded() {
  const result = describeYggdrasilConnectivity(
    {
      remoteUrl: "http://[200:db8::1]:8788"
    },
    {
      lookupExecutor: createUnavailableLookupExecutor()
    }
  );

  assert(result.remoteUrlReadiness.validUrl === true, "Connectivity diagnostics should include remote URL readiness.");
  assert(
    result.remoteUrlReadiness.likelyYggdrasilRemoteUrl === true,
    "Connectivity diagnostics should preserve Ygg-ready remoteUrl result."
  );

  return {
    name: "yggdrasil connectivity includes remoteUrl readiness",
    ok: true,
    detail: JSON.stringify({
      remoteUrl: result.remoteUrl,
      likelyYggdrasilRemoteUrl: result.remoteUrlReadiness.likelyYggdrasilRemoteUrl
    })
  };
}

function testYggdrasilConnectivityParserHandlesSampleOutput() {
  const parsedJson = parseYggdrasilctlGetSelfOutput(
    JSON.stringify({
      self: {
        address: "200:1111:2222:3333:4444:5555:6666:7777"
      },
      other: ["300:aaaa::1"]
    })
  );
  const parsedText = parseYggdrasilAddressCandidates(
    "Local addresses: [200:1111:2222:3333:4444:5555:6666:7777] and 300:aaaa::1"
  );

  assert(parsedJson.format === "json", "JSON parser should detect JSON format.");
  assert(parsedJson.addressCandidates.length >= 2, "JSON parser should extract IPv6 candidates.");
  assert(parsedText.length >= 2, "Text parser should extract IPv6 candidates.");
  assert(
    parsedJson.addressCandidates.some((candidate) => candidate.likelyYggdrasil === true),
    "Parser should classify likely Yggdrasil-like addresses."
  );

  return {
    name: "yggdrasil connectivity parser handles sample output",
    ok: true,
    detail: JSON.stringify({
      jsonCandidates: parsedJson.addressCandidates,
      textCandidates: parsedText
    })
  };
}

function testYggdrasilConnectivityNoMutationOrDelivery() {
  const result = describeYggdrasilConnectivity(
    {
      remoteUrl: "http://[200:db8::1]:8788"
    },
    {
      lookupExecutor: createUnavailableLookupExecutor()
    }
  );

  assert(result.messageDeliveryEnabled === false, "Connectivity diagnostics should not enable message delivery.");
  assert(result.serviceControlAttempted === false, "Connectivity diagnostics should not attempt service control.");
  assert(result.configMutationAttempted === false, "Connectivity diagnostics should not mutate config.");
  assert(result.connectivity.networkProbeAttempted === false, "Connectivity diagnostics should not probe network.");
  assert(result.connectivity.httpHealthProbeAttempted === false, "Connectivity diagnostics should not probe HTTP health.");
  assert(result.connectivity.messageDeliveryAttempted === false, "Connectivity diagnostics should not attempt delivery.");

  return {
    name: "yggdrasil connectivity diagnostics avoid mutation and delivery",
    ok: true,
    detail: JSON.stringify({
      messageDeliveryEnabled: result.messageDeliveryEnabled,
      serviceControlAttempted: result.serviceControlAttempted,
      configMutationAttempted: result.configMutationAttempted,
      connectivity: result.connectivity
    })
  };
}

function testYggdrasilHealthEndpointBuild() {
  const result = describeYggdrasilHealthProbe({
    remoteUrl: "http://[200:db8::1]:8788"
  });
  assert(result.error === null, "Valid bracketed IPv6 URL should be accepted for health probe.");
  assert(result.probeAttempted === false, "Describe helper should not perform probe.");
  assert(
    result.healthEndpoint === "http://[200:db8::1]:8788/health",
    `Expected /health endpoint, got ${result.healthEndpoint}`
  );

  return {
    name: "yggdrasil health valid remoteUrl builds endpoint",
    ok: true,
    detail: JSON.stringify({
      remoteUrl: result.remoteUrl,
      healthEndpoint: result.healthEndpoint
    })
  };
}

async function testYggdrasilHealthInvalidUnbracketedIpv6DoesNotProbe() {
  const result = await probeYggdrasilHealth({
    remoteUrl: "http://200:db8::1:8788"
  });
  assert(result.probeAttempted === false, "Invalid unbracketed IPv6 URL should not be probed.");
  assert(
    result.error === "Yggdrasil health probe requires a bracketed IPv6 HTTP/HTTPS remoteUrl.",
    `Unexpected invalid URL error: ${result.error}`
  );

  return {
    name: "yggdrasil health invalid unbracketed ipv6 does not probe",
    ok: true,
    detail: result.error
  };
}

async function testYggdrasilHealthMockSuccessResponse() {
  const server = await withIpv6JsonServer(async (request) => {
    assert(request.method === "GET", "Yggdrasil health probe should use GET.");
    assert(request.url === "/health", "Yggdrasil health probe should only hit /health.");
    return {
      statusCode: 200,
      body: {
        ok: true,
        service: "esp-messenger-agent",
        agent: {
          name: "receiver-ygg-health"
        }
      }
    };
  });

  try {
    const result = await probeYggdrasilHealth({
      remoteUrl: server.baseUrl,
      timeoutMs: 1000
    });
    assert(result.probeAttempted === true, "Health probe should be attempted for valid IPv6 URL.");
    assert(result.ok === true, "Mock /health success should report ok.");
    assert(result.httpStatus === 200, "Mock /health success should preserve status code.");
    assert(result.messageDeliveryAttempted === false, "Health probe should not attempt message delivery.");

    return {
      name: "yggdrasil health mock http success",
      ok: true,
      detail: JSON.stringify({
        healthEndpoint: result.healthEndpoint,
        httpStatus: result.httpStatus,
        payload: result.payload
      })
    };
  } finally {
    await server.close();
  }
}

async function testYggdrasilHealthMockFailureResponse() {
  const server = await withIpv6JsonServer(async (request) => {
    assert(request.method === "GET", "Yggdrasil health failure probe should use GET.");
    assert(request.url === "/health", "Yggdrasil health failure probe should only hit /health.");
    return {
      statusCode: 503,
      body: {
        ok: false,
        error: "agent_temporarily_unavailable"
      }
    };
  });

  try {
    const result = await probeYggdrasilHealth({
      remoteUrl: server.baseUrl,
      timeoutMs: 1000
    });
    assert(result.probeAttempted === true, "Failure probe should still be attempted.");
    assert(result.ok === false, "Failure response should report ok=false.");
    assert(result.httpStatus === 503, "Failure response should preserve status.");
    assert(result.error === "agent_temporarily_unavailable", `Unexpected failure error: ${result.error}`);

    return {
      name: "yggdrasil health mock http failure",
      ok: true,
      detail: JSON.stringify({
        httpStatus: result.httpStatus,
        error: result.error
      })
    };
  } finally {
    await server.close();
  }
}

async function testYggdrasilHealthTimeoutOrUnreachableStructuredFailure() {
  const server = await withIpv6JsonServer(
    async () =>
      new Promise((resolve) => {
        setTimeout(
          () =>
            resolve({
              statusCode: 200,
              body: {
                ok: true
              }
            }),
          200
        );
      })
  );

  try {
    const result = await probeYggdrasilHealth({
      remoteUrl: server.baseUrl,
      timeoutMs: 25
    });
    assert(result.probeAttempted === true, "Timeout path should still mark probeAttempted.");
    assert(result.ok === false, "Timeout path should report ok=false.");
    assert(result.timedOut === true, "Timeout path should report timedOut=true.");

    return {
      name: "yggdrasil health timeout returns structured failure",
      ok: true,
      detail: JSON.stringify({
        timedOut: result.timedOut,
        error: result.error
      })
    };
  } finally {
    await server.close();
  }
}

function testYggdrasilHealthNoMessageDeliveryAttempted() {
  const result = describeYggdrasilHealthProbe({
    remoteUrl: "http://[200:db8::1]:8788"
  });
  assert(result.diagnosticsOnly === true, "Yggdrasil health should remain diagnostics-only.");
  assert(result.transportDeliveryEnabled === false, "Yggdrasil health should not enable transport delivery.");
  assert(result.messageDeliveryAttempted === false, "Yggdrasil health should not attempt message delivery.");

  return {
    name: "yggdrasil health diagnostics confirm no message delivery",
    ok: true,
    detail: JSON.stringify({
      diagnosticsOnly: result.diagnosticsOnly,
      transportDeliveryEnabled: result.transportDeliveryEnabled,
      messageDeliveryAttempted: result.messageDeliveryAttempted
    })
  };
}

function testYggdrasilNodeParseGetSelfOutput() {
  const parsed = parseYggdrasilGetSelfOutput(`в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ
в”‚ Build name:         в”‚ yggdrasil                                                        в”‚
в”‚ Build version:      в”‚ 0.5.13                                                           в”‚
в”‚ IPv6 address:       в”‚ 201:7529:92cb:9f24:5f19:bdaa:4cc6:5c23                           в”‚
в”‚ IPv6 subnet:        в”‚ 301:7529:92cb:9f24::/64                                          в”‚
в”‚ Routing table size: в”‚ 1                                                                в”‚
в”‚ Public key:         в”‚ 62b59b4d1836e83990956cce68f714a3589b62fe27392ac6f48f8e06da878415 в”‚
в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”`);

  assert(parsed.available === true, "getself parser should mark structured output available.");
  assert(parsed.buildName === "yggdrasil", "getself parser should extract build name.");
  assert(parsed.buildVersion === "0.5.13", "getself parser should extract build version.");
  assert(parsed.routingTableSize === 1, "getself parser should extract routing table size.");

  return {
    name: "yggdrasil node parse getself output",
    ok: true,
    detail: JSON.stringify({
      buildName: parsed.buildName,
      buildVersion: parsed.buildVersion,
      ipv6Address: parsed.ipv6Address,
      publicKey: parsed.publicKey
    })
  };
}

function testYggdrasilNodeParseEmptyPeersOutput() {
  const parsed = parseYggdrasilGetPeersOutput(`в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ
в”‚ URI в”‚ State в”‚ Dir в”‚ IP Address в”‚ Uptime в”‚ RTT в”‚ RX в”‚ TX в”‚ Down в”‚ Up в”‚ Pr в”‚ Cost в”‚ Last Error в”‚
в””в”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”`);

  assert(parsed.available === true, "empty peers table should still be available.");
  assert(parsed.count === 0, "empty peers table should report zero peers.");

  return {
    name: "yggdrasil node parse empty peers output",
    ok: true,
    detail: JSON.stringify(parsed)
  };
}

function testYggdrasilNodeParseEmptySessionsOutput() {
  const parsed = parseYggdrasilGetSessionsOutput(`в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”ђ
в”‚ Public Key в”‚ IP Address в”‚ Uptime в”‚ RX в”‚ TX в”‚
в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”`);

  assert(parsed.available === true, "empty sessions table should still be available.");
  assert(parsed.count === 0, "empty sessions table should report zero sessions.");

  return {
    name: "yggdrasil node parse empty sessions output",
    ok: true,
    detail: JSON.stringify(parsed)
  };
}

function testYggdrasilNodeParseTunOutput() {
  const parsed = parseYggdrasilGetTunOutput(`в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ
в”‚ TUN enabled:    в”‚ true      в”‚
в”‚ Interface name: в”‚ Yggdrasil в”‚
в”‚ Interface MTU:  в”‚ 65535     в”‚
в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”`);

  assert(parsed.available === true, "gettun parser should mark output available.");
  assert(parsed.interface === "Yggdrasil", "gettun parser should extract interface name.");
  assert(parsed.mtu === 65535, "gettun parser should extract MTU.");

  return {
    name: "yggdrasil node parse tun output",
    ok: true,
    detail: JSON.stringify({
      interface: parsed.interface,
      mtu: parsed.mtu,
      tunEnabled: parsed.tunEnabled
    })
  };
}

function testYggdrasilNodeParseCommandListOutput() {
  const parsed = parseYggdrasilCommandListOutput(`в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ
в”‚        Command         в”‚       Arguments        в”‚                      Description                      в”‚
в”њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”јв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”јв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¤
в”‚ addpeer                в”‚ uri=..., interface=... в”‚ Add a peer to the peer list                           в”‚
в”‚ getpeers               в”‚ sort=...               в”‚ Show directly connected peers                         в”‚
в”‚ getself                в”‚                        в”‚ Show details about this node                          в”‚
в”‚ getsessions            в”‚                        в”‚ Show established traffic sessions with remote nodes   в”‚
в”‚ gettun                 в”‚                        в”‚ Show information about the node's TUN interface       в”‚
в”‚ list                   в”‚                        в”‚ List available commands                               в”‚
в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ґв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”`);

  assert(parsed.includes("getself"), "command list parser should include getself.");
  assert(parsed.includes("getpeers"), "command list parser should include getpeers.");
  assert(parsed.includes("getsessions"), "command list parser should include getsessions.");
  assert(parsed.includes("gettun"), "command list parser should include gettun.");

  return {
    name: "yggdrasil node parse command list output",
    ok: true,
    detail: JSON.stringify(parsed)
  };
}

function testYggdrasilNodeMissingYggdrasilctl() {
  const parsed = describeYggdrasilLocalNode(
    {},
    {
      lookupExecutor: createUnavailableLookupExecutor()
    }
  );

  assert(parsed.yggdrasilctlAvailable === false, "missing yggdrasilctl should be reported unavailable.");
  assert(parsed.self.available === false, "self should be unavailable when yggdrasilctl is missing.");
  assert(parsed.supportedCommands.length === 0, "missing yggdrasilctl should return empty supported command list.");

  return {
    name: "yggdrasil node missing yggdrasilctl",
    ok: true,
    detail: JSON.stringify({
      yggdrasilctlAvailable: parsed.yggdrasilctlAvailable,
      selfAvailable: parsed.self.available
    })
  };
}

function testYggdrasilNodeDiagnosticsOnlyGuarantees() {
  const parsed = describeYggdrasilLocalNode(
    {},
    {
      lookupExecutor: createUnavailableLookupExecutor()
    }
  );

  assert(parsed.diagnosticsOnly === true, "node introspection should remain diagnostics-only.");
  assert(parsed.networkProbeAttempted === false, "node introspection should not attempt network probes.");
  assert(parsed.messageDeliveryEnabled === false, "node introspection should not enable message delivery.");
  assert(parsed.serviceControlAttempted === false, "node introspection should not attempt service control.");
  assert(parsed.configMutationAttempted === false, "node introspection should not mutate config.");

  return {
    name: "yggdrasil node diagnostics-only guarantees",
    ok: true,
    detail: JSON.stringify({
      diagnosticsOnly: parsed.diagnosticsOnly,
      networkProbeAttempted: parsed.networkProbeAttempted,
      messageDeliveryEnabled: parsed.messageDeliveryEnabled,
      serviceControlAttempted: parsed.serviceControlAttempted,
      configMutationAttempted: parsed.configMutationAttempted
    })
  };
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

async function testRuntimeProfileBackedRelayPull() {
  return withTempRuntime(async (runtime) =>
    withTempJsonFile(
      {
        profileName: "relay-pull-profile",
        transport: "local-http-relay",
        remoteUrl: "http://127.0.0.1:8790",
        targetAgent: "receiver-profile"
      },
      "relay-pull-profile.json",
      async (filePath) => {
        const loadedProfile = await runtime.loadRuntimeProfile(filePath);
        assert(loadedProfile.ok === true, "Relay pull profile should validate.");
        const merged = applyRuntimeProfile({}, loadedProfile);
        assert(merged.remoteUrl === "http://127.0.0.1:8790", "Profile should supply relay remoteUrl.");
        assert(merged.targetAgent === "receiver-profile", "Profile should supply targetAgent.");
        assert(merged.transportId === "local-http-relay", "Profile should supply transport id.");

        return {
          name: "runtime profile-backed relay pull configuration",
          ok: true,
          detail: JSON.stringify({
            transportId: merged.transportId,
            remoteUrl: merged.remoteUrl,
            targetAgent: merged.targetAgent
          })
        };
      }
    )
  );
}

async function testRuntimeProfileBackedHealthCheck() {
  return withTempRuntime(async (runtime) =>
    withTempJsonFile(
      {
        profileName: "transport-health-profile",
        transport: "local-http-agent",
        remoteUrl: "http://127.0.0.1:8788"
      },
      "transport-health-profile.json",
      async (filePath) => {
        const loadedProfile = await runtime.loadRuntimeProfile(filePath);
        assert(loadedProfile.ok === true, "Health profile should validate.");
        const merged = applyRuntimeProfile({}, loadedProfile);
        assert(merged.transportId === "local-http-agent", "Profile should supply transport id for health check.");
        assert(merged.remoteUrl === "http://127.0.0.1:8788", "Profile should supply remoteUrl for health check.");

        return {
          name: "runtime profile-backed transport health configuration",
          ok: true,
          detail: JSON.stringify({
            transportId: merged.transportId,
            remoteUrl: merged.remoteUrl
          })
        };
      }
    )
  );
}

async function testRuntimeProfileBackedDeliveryResolution() {
  return withTempRuntime(async (runtime) =>
    withTempJsonFile(
      {
        profileName: "relay-delivery-profile",
        transport: "local-http-relay",
        remoteUrl: "http://127.0.0.1:8790",
        targetAgent: "receiver-profile"
      },
      "relay-delivery-profile.json",
      async (filePath) => {
        const loadedProfile = await runtime.loadRuntimeProfile(filePath);
        assert(loadedProfile.ok === true, "Delivery profile should validate.");
        const merged = applyRuntimeProfile({}, loadedProfile);
        assert(merged.transportId === "local-http-relay", "Delivery profile should resolve local-http-relay.");
        assert(merged.remoteUrl === "http://127.0.0.1:8790", "Delivery profile should resolve remoteUrl.");
        assert(merged.targetAgent === "receiver-profile", "Delivery profile should resolve targetAgent.");

        return {
          name: "runtime profile-backed delivery configuration resolution",
          ok: true,
          detail: JSON.stringify({
            transportId: merged.transportId,
            remoteUrl: merged.remoteUrl,
            targetAgent: merged.targetAgent
          })
        };
      }
    )
  );
}

async function testRuntimeProfileOverrideBehavior() {
  return withTempRuntime(async (runtime) =>
    withTempJsonFile(
      {
        profileName: "relay-override-profile",
        transport: "local-http-relay",
        remoteUrl: "http://127.0.0.1:8790",
        targetAgent: "receiver"
      },
      "relay-override-profile.json",
      async (filePath) => {
        const loadedProfile = await runtime.loadRuntimeProfile(filePath);
        assert(loadedProfile.ok === true, "Override profile should validate.");
        const merged = applyRuntimeProfile(
          {
            targetAgent: "receiver-2"
          },
          loadedProfile
        );

        assert(merged.targetAgent === "receiver-2", "Explicit CLI targetAgent should override profile targetAgent.");
        assert(merged.remoteUrl === "http://127.0.0.1:8790", "Profile remoteUrl should fill missing value.");

        return {
          name: "runtime profile CLI override behavior",
          ok: true,
          detail: JSON.stringify({
            transportId: merged.transportId,
            remoteUrl: merged.remoteUrl,
            targetAgent: merged.targetAgent
          })
        };
      }
    )
  );
}

async function testRuntimeProfileMissingRequiredFailsClearly() {
  return withTempRuntime(async (runtime) =>
    withTempJsonFile(
      {
        profileName: "broken-relay-profile",
        transport: "local-http-relay"
      },
      "broken-relay-profile.json",
      async (filePath) => {
        const loadedProfile = await runtime.loadRuntimeProfile(filePath);
        assert(loadedProfile.ok === false, "Broken profile should fail validation.");
        assert(
          loadedProfile.errors.some((error) => error.includes("missing required field remoteUrl")),
          `Expected clear remoteUrl error, got: ${loadedProfile.errors.join(" | ")}`
        );

        return {
          name: "runtime profile missing required values fail clearly",
          ok: true,
          detail: loadedProfile.errors.join(" | ")
        };
      }
    )
  );
}

async function testRuntimeStateSummaryDiagnostics() {
  return withTempRuntime(async (runtime) => {
    const summary = await runtime.getRuntimeStateSummary();
    assert(summary.counts.peers === 0, "Fresh runtime summary should start with zero peers.");
    assert(summary.counts.inbox === 0, "Fresh runtime summary should start with zero inbox messages.");
    assert(summary.counts.outbox === 0, "Fresh runtime summary should start with zero outbox messages.");
    assert(summary.counts.receipts === 0, "Fresh runtime summary should start with zero receipts.");
    assert(Array.isArray(summary.derivedState), "Runtime summary should expose derivedState.");
    assert(Array.isArray(summary.transientState), "Runtime summary should expose transientState.");

    return {
      name: "runtime state summary diagnostics",
      ok: true,
      detail: JSON.stringify({
        counts: summary.counts,
        derivedState: summary.derivedState,
        transientState: summary.transientState
      })
    };
  });
}

async function testRuntimePathDiagnosticsDefault() {
  const runtime = createAgentRuntime({
    agentName: "default-path-audit"
  });
  const diagnostics = runtime.getRuntimePathDiagnostics();
  assert(diagnostics.stateDirSource === "cwd-derived-default", "Default runtime path diagnostics should report cwd-derived-default.");
  assert(typeof diagnostics.cwd === "string" && diagnostics.cwd, "Runtime path diagnostics should expose cwd.");
  assert(Array.isArray(diagnostics.cacheFiles) && diagnostics.cacheFiles.length === 3, "Runtime path diagnostics should expose cache files.");
  assert(Array.isArray(diagnostics.warnings) && diagnostics.warnings.length >= 1, "Runtime path diagnostics should expose warnings.");

  return {
    name: "runtime path diagnostics default cwd-derived",
    ok: true,
    detail: JSON.stringify({
      cwd: diagnostics.cwd,
      stateDir: diagnostics.stateDir,
      stateDirSource: diagnostics.stateDirSource,
      warnings: diagnostics.warnings
    })
  };
}

async function testRuntimePathDiagnosticsExplicitStateDir() {
  const stateDir = await mkdtemp(join(tmpdir(), "esp-runtime-path-explicit-"));
  try {
    const runtime = createAgentRuntime({
      stateDir,
      agentName: "path-audit"
    });
    const diagnostics = runtime.getRuntimePathDiagnostics();

    assert(diagnostics.stateDirSource === "explicit", "Explicit stateDir should report explicit source.");
    assert(diagnostics.userProvidedStateDir === stateDir, "Explicit stateDir should be preserved in diagnostics.");
    assert(diagnostics.stateDir === stateDir, "Resolved stateDir should match explicit stateDir.");

    return {
      name: "runtime path diagnostics explicit stateDir",
      ok: true,
      detail: JSON.stringify({
        stateDir: diagnostics.stateDir,
        stateDirSource: diagnostics.stateDirSource,
        relayStateDir: diagnostics.relayStateDir
      })
    };
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

async function testRuntimePathDiagnosticsConsistency() {
  return withTempRuntime(async (runtime) => {
    const diagnostics = runtime.getRuntimePathDiagnostics();
    assert(
      diagnostics.stateFiles.every((filePath) => filePath.startsWith(diagnostics.stateDir)),
      "State files should resolve under stateDir."
    );
    assert(
      diagnostics.artifactPaths.outboxDir.startsWith(diagnostics.stateDir) &&
        diagnostics.artifactPaths.transfersDir.startsWith(diagnostics.stateDir),
      "Artifact paths should resolve under stateDir."
    );

    return {
      name: "runtime path diagnostics consistency",
      ok: true,
      detail: JSON.stringify({
        stateDir: diagnostics.stateDir,
        stateFiles: diagnostics.stateFiles,
        artifactPaths: diagnostics.artifactPaths
      })
    };
  });
}

async function testRuntimeRestartStateReload() {
  const stateDir = await mkdtemp(join(tmpdir(), "esp-runtime-restart-"));
  try {
    const runtime1 = createAgentRuntime({
      stateDir,
      agentName: "restart-audit"
    });
    await runtime1.rememberSelf({ mock: true });
    await seedPendingOutboxMessage(runtime1, "restart persisted outbox");

    const { envelope, envelopeId } = await createMockSignedEnvelope("restart inbound");
    const bundle = createTransportBundle({
      source: {
        agentName: "sender-restart"
      },
      messages: [
        {
          messageId: envelopeId,
          envelopeId,
          envelope
        }
      ]
    });

    await runtime1.importTransportBundleData(bundle, {}, {
      sourceLabel: "bundle:restart-audit",
      deliveryStatus: "delivered_bundle"
    });

    const summaryBeforeRestart = await runtime1.getRuntimeStateSummary();

    const runtime2 = createAgentRuntime({
      stateDir,
      agentName: "restart-audit"
    });
    const summaryAfterRestart = await runtime2.getRuntimeStateSummary();

    assert(summaryAfterRestart.counts.peers === summaryBeforeRestart.counts.peers, "Peer count should survive restart.");
    assert(summaryAfterRestart.counts.inbox === summaryBeforeRestart.counts.inbox, "Inbox count should survive restart.");
    assert(summaryAfterRestart.counts.outbox === summaryBeforeRestart.counts.outbox, "Outbox count should survive restart.");
    assert(summaryAfterRestart.counts.receipts === summaryBeforeRestart.counts.receipts, "Receipt count should survive restart.");

    return {
      name: "runtime restart persisted state reload",
      ok: true,
      detail: JSON.stringify({
        before: summaryBeforeRestart.counts,
        after: summaryAfterRestart.counts
      })
    };
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

async function testDuplicateReceiptProcessing() {
  return withTempRuntime(async (runtime) => {
    await seedPendingOutboxMessage(runtime, "duplicate receipt audit");
    const outboxMessage = (await runtime.listOutboxMessages())[0];
    const receipt = createDeliveryReceipt({
      messageId: outboxMessage.messageId,
      envelopeId: outboxMessage.envelopeId,
      senderKeyId: outboxMessage.senderKeyId,
      receiverAgent: "receiver-audit",
      sourceAgent: "receiver-audit",
      relayName: "relay-audit"
    });

    await runtime.acceptReceipt(receipt, {
      deliverySource: "http://127.0.0.1:8790",
      remoteAgent: "receiver-audit",
      relayReceiptId: "relay:duplicate"
    });
    await runtime.acceptReceipt(receipt, {
      deliverySource: "http://127.0.0.1:8790",
      remoteAgent: "receiver-audit",
      relayReceiptId: "relay:duplicate"
    });

    const receipts = await runtime.listReceipts();
    const updatedOutbox = await runtime.getOutboxMessage(outboxMessage.messageId);

    assert(receipts.length === 1, `Duplicate receipt processing should keep one stored receipt, got ${receipts.length}.`);
    assert(updatedOutbox.status === "delivered_remote_ack", "Duplicate receipt processing should keep delivered_remote_ack state.");

    return {
      name: "runtime duplicate receipt processing",
      ok: true,
      detail: JSON.stringify({
        receiptCount: receipts.length,
        outboxStatus: updatedOutbox.status,
        receiptId: receipts[0]?.receiptId ?? null
      })
    };
  });
}

async function testDuplicateBundleImportHandling() {
  return withTempRuntime(async (runtime) => {
    const { envelope, envelopeId } = await createMockSignedEnvelope("duplicate bundle audit");
    const bundle = createTransportBundle({
      source: {
        agentName: "sender-duplicate"
      },
      messages: [
        {
          messageId: envelopeId,
          envelopeId,
          envelope
        }
      ]
    });

    await runtime.importTransportBundleData(bundle, {}, {
      sourceLabel: "bundle:duplicate-audit",
      deliveryStatus: "delivered_bundle"
    });
    await runtime.importTransportBundleData(bundle, {}, {
      sourceLabel: "bundle:duplicate-audit",
      deliveryStatus: "delivered_bundle"
    });

    const messages = await runtime.listMessages();
    const receipts = await runtime.listReceipts();

    assert(messages.length === 1, `Duplicate bundle import should keep one inbox message, got ${messages.length}.`);
    assert(receipts.length === 1, `Duplicate bundle import should keep one receipt, got ${receipts.length}.`);

    return {
      name: "runtime duplicate bundle import handling",
      ok: true,
      detail: JSON.stringify({
        inboxCount: messages.length,
        receiptCount: receipts.length,
        messageId: messages[0]?.messageId ?? null
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

function testYggdrasilDoctorDetectUtf8Bom() {
  assert(detectUtf8Bom(Buffer.from([0xef, 0xbb, 0xbf, 0x61])) === true, "UTF-8 BOM should be detected.");
  assert(detectUtf8Bom(Buffer.from("plain text", "utf8")) === false, "Plain UTF-8 text should not report BOM.");

  return {
    name: "yggdrasil doctor detects UTF-8 BOM",
    ok: true,
    detail: JSON.stringify({
      bomDetected: true,
      plainDetected: false
    })
  };
}

function testYggdrasilDoctorParseConfigDocument() {
  const parsed = parseYggdrasilConfigDocument(`Listen:\n  - tls://0.0.0.0:12345\nPeers:\n  - tls://192.168.1.50:12345\n`);

  assert(parsed.expectedListenerConfigured === true, "Doctor config parser should detect the validated static listener.");
  assert(parsed.staticPeerConfigured === true, "Doctor config parser should detect static peers.");
  assert(parsed.listenerPorts.includes(12345), "Doctor config parser should extract the listener port.");

  return {
    name: "yggdrasil doctor parses listener and peer config",
    ok: true,
    detail: JSON.stringify(parsed)
  };
}

function testYggdrasilDoctorParsePathsOutput() {
  const parsed = parseYggdrasilGetPathsOutput(
    [`
│ Remote key │ Path │
│ key-alpha │ 200:1111:2222:3333::/64 │
`.trim()].join("\n")
  );

  assert(parsed.available === true, "Doctor should parse getpaths output.");
  assert(parsed.count === 1, `Expected one parsed path row, got ${parsed.count}.`);
  assert(parsed.items[0]["Remote key"] === "key-alpha", "Doctor should preserve getpaths table headers.");

  return {
    name: "yggdrasil doctor parses getpaths output",
    ok: true,
    detail: JSON.stringify(parsed)
  };
}

function testYggdrasilDoctorFirewallConflictSummary() {
  const summary = summarizeNodeFirewallRules([
    {
      displayName: "Node Allow Public",
      action: "Allow",
      direction: "Inbound",
      profile: "Public",
      enabled: "True",
      program: "C:\\Program Files\\nodejs\\node.exe"
    },
    {
      displayName: "Node Block Public",
      action: "Block",
      direction: "Inbound",
      profile: "Public",
      enabled: "True",
      program: "C:\\Program Files\\nodejs\\node.exe"
    }
  ]);

  assert(summary.hasConflict === true, "Doctor firewall summary should detect allow/block conflicts.");
  assert(summary.hasPublicInboundBlockConflict === true, "Doctor firewall summary should flag Public inbound block rules.");
  assert(summary.publicBlockRuleCount === 1, "Doctor firewall summary should count Public block rules.");

  return {
    name: "yggdrasil doctor summarizes node firewall conflicts",
    ok: true,
    detail: JSON.stringify(summary)
  };
}

async function testYggdrasilDoctorDiagnosticsShape() {
  const result = await describeYggdrasilDoctor(
    {
      remoteUrl: "http://[200:db8::1]:8788",
      timeoutMs: 1500
    },
    {
      environmentDescribe() {
        return {
          platform: "win32",
          arch: "x64",
          node: "v22.0.0",
          checks: {
            commandLookupAttempted: true,
            yggdrasilAvailable: true,
            yggdrasilctlAvailable: true,
            lookupCommand: "where.exe"
          },
          commands: {
            yggdrasil: {
              available: true,
              locations: ["C:\\Program Files\\Yggdrasil\\yggdrasil.exe"]
            },
            yggdrasilctl: {
              available: true,
              locations: ["C:\\Program Files\\Yggdrasil\\yggdrasilctl.exe"]
            }
          },
          readinessOnly: true,
          connectivityChecked: false,
          serviceControlAttempted: false,
          note: "mocked"
        };
      },
      nodeDescribe() {
        return {
          diagnosticsOnly: true,
          yggdrasilctlAvailable: true,
          commandPath: "C:\\Program Files\\Yggdrasil\\yggdrasilctl.exe",
          supportedCommands: ["getself", "getpeers", "getsessions", "gettun", "getpaths"],
          self: {
            available: true,
            ipv6Address: "200:1111:2222:3333::1",
            publicKey: "pubkey"
          },
          peers: {
            available: true,
            count: 1,
            items: [{ Endpoint: "tls://192.168.1.20:12345" }]
          },
          sessions: {
            available: true,
            count: 1,
            items: [{ Endpoint: "tls://192.168.1.20:12345" }]
          },
          tun: {
            available: true,
            interface: "Yggdrasil",
            mtu: 65535
          }
        };
      },
      healthProbe: async ({ remoteUrl, timeoutMs }) => ({
        diagnosticsOnly: true,
        transportDeliveryEnabled: false,
        messageDeliveryAttempted: false,
        remoteUrl,
        remoteUrlReadiness: {
          validUrl: true,
          isHttpUrl: true,
          isBracketedIpv6HttpUrl: true
        },
        probeAttempted: true,
        healthEndpoint: `${remoteUrl}/health`,
        httpStatus: 200,
        ok: true,
        payload: {
          ok: true
        },
        error: null,
        timedOut: false,
        timeoutMs
      }),
      readConfigFile() {
        return {
          exists: true,
          buffer: Buffer.from([0xef, 0xbb, 0xbf, 0x4c]),
          text: `Listen:\n  - tls://0.0.0.0:12345\nPeers:\n  - tls://192.168.1.20:12345\n`,
          error: null
        };
      },
      powerShellJsonExecutor(script) {
        if (script.includes("Get-CimInstance Win32_Service")) {
          return {
            ok: true,
            value: {
              available: true,
              name: "Yggdrasil",
              state: "Running",
              startMode: "Auto",
              pathName: "C:\\Program Files\\Yggdrasil\\yggdrasil.exe",
              processId: 1200
            }
          };
        }
        if (script.includes("Get-NetAdapterBinding")) {
          return {
            ok: true,
            value: {
              bindings: [{ Name: "Wi-Fi", InterfaceDescription: "Wireless Adapter", Enabled: true }],
              profiles: [
                {
                  Name: "Yggdrasil",
                  InterfaceAlias: "Yggdrasil",
                  NetworkCategory: "Public",
                  IPv4Connectivity: "NoTraffic",
                  IPv6Connectivity: "Internet"
                }
              ]
            }
          };
        }
        if (script.includes("Get-NetTCPConnection")) {
          return {
            ok: true,
            value: {
              listeners: [{ LocalAddress: "0.0.0.0", LocalPort: 12345, OwningProcess: 1200 }]
            }
          };
        }
        if (script.includes("Get-NetFirewallRule")) {
          return {
            ok: true,
            value: {
              rules: [
                {
                  displayName: "Node Allow Public",
                  action: "Allow",
                  direction: "Inbound",
                  profile: "Public",
                  enabled: "True",
                  program: "C:\\Program Files\\nodejs\\node.exe"
                },
                {
                  displayName: "Node Block Public",
                  action: "Block",
                  direction: "Inbound",
                  profile: "Public",
                  enabled: "True",
                  program: "C:\\Program Files\\nodejs\\node.exe"
                }
              ]
            }
          };
        }

        return {
          ok: false,
          error: `Unexpected PowerShell script: ${script}`
        };
      },
      ctlExecutor(commandPath, args) {
        assert(commandPath.includes("yggdrasilctl.exe"), "Doctor should reuse the detected yggdrasilctl path.");
        assert(args[0] === "getpaths", `Unexpected control subcommand: ${args[0]}`);
        return {
          ok: true,
          status: 0,
          stdout: [`
│ Remote key │ Path │
│ key-alpha │ 200:1111:2222:3333::/64 │
`.trim()].join("\n"),
          stderr: "",
          error: null,
          timedOut: false
        };
      }
    }
  );

  assert(result.diagnosticsOnly === true, "Doctor should remain diagnostics-only.");
  assert(result.transportDeliveryEnabled === false, "Doctor should not enable transport delivery.");
  assert(result.messageDeliveryEnabled === false, "Doctor should not enable message delivery.");
  assert(result.bundleDeliveryAttempted === false, "Doctor should not attempt bundle delivery.");
  assert(result.config.utf8BomDetected === true, "Doctor should surface BOM detection.");
  assert(result.listener.activeOnConfiguredPort === true, "Doctor should report the active listener.");
  assert(result.firewall.hasPublicInboundBlockConflict === true, "Doctor should report firewall conflicts.");
  assert(result.node.paths.count === 1, "Doctor should include parsed route/path diagnostics.");
  assert(result.remoteHealth.ok === true, "Doctor should include remote health diagnostics when requested.");
  assert(
    result.remediationSteps.some((step) => step.includes("UTF-8 without BOM")),
    "Doctor should provide remediation guidance for BOM detection."
  );

  return {
    name: "yggdrasil doctor diagnostics shape",
    ok: true,
    detail: JSON.stringify({
      listenerActive: result.listener.activeOnConfiguredPort,
      firewallConflict: result.firewall.hasPublicInboundBlockConflict,
      remoteHealthOk: result.remoteHealth.ok,
      remediationSteps: result.remediationSteps
    })
  };
}

async function testYggdrasilDoctorSkipsRemoteProbeWithoutRemoteUrl() {
  let probeCalled = false;
  const result = await describeYggdrasilDoctor(
    {},
    {
      environmentDescribe() {
        return {
          platform: "win32",
          arch: "x64",
          node: "v22.0.0",
          checks: {
            commandLookupAttempted: false,
            yggdrasilAvailable: false,
            yggdrasilctlAvailable: false,
            lookupCommand: "where.exe"
          },
          commands: {
            yggdrasil: { available: false, locations: [] },
            yggdrasilctl: { available: false, locations: [] }
          },
          readinessOnly: true,
          connectivityChecked: false,
          serviceControlAttempted: false,
          note: "mocked"
        };
      },
      nodeDescribe() {
        return {
          diagnosticsOnly: true,
          yggdrasilctlAvailable: false,
          commandPath: null,
          supportedCommands: [],
          self: { available: false, error: "missing" },
          peers: { available: false, count: 0, items: [], error: "missing" },
          sessions: { available: false, count: 0, items: [], error: "missing" },
          tun: { available: false, error: "missing" }
        };
      },
      healthProbe: async () => {
        probeCalled = true;
        throw new Error("doctor should not probe health without a remoteUrl");
      },
      readConfigFile() {
        return {
          exists: false,
          buffer: null,
          text: "",
          error: null
        };
      },
      powerShellJsonExecutor() {
        return {
          ok: false,
          error: "mock unavailable"
        };
      }
    }
  );

  assert(probeCalled === false, "Doctor should skip the remote probe when remoteUrl is missing.");
  assert(result.networkProbeAttempted === false, "Doctor should report no network probe when remoteUrl is missing.");
  assert(result.remoteHealth.probeAttempted === false, "Doctor should keep remote health in skipped mode.");

  return {
    name: "yggdrasil doctor skips remote probe without remoteUrl",
    ok: true,
    detail: JSON.stringify(result.remoteHealth)
  };
}

async function main() {
  const results = [];
  results.push(await testLocalHttpAgentErrorHandling());
  results.push(await testLocalHttpAgentSendShape());
  results.push(await testLocalHttpRelayPullShape());
  results.push(await testFileBundleRoundtrip());
  results.push(await testYggdrasilDirectSendShape());
  results.push(testYggdrasilReadinessValidBracketedIpv6Url());
  results.push(testYggdrasilReadinessInvalidUnbracketedIpv6Url());
  results.push(testYggdrasilReadinessLocalhostUrl());
  results.push(testYggdrasilReadinessOfflineOnly());
  results.push(await testYggdrasilInactiveInActiveRuntimeRegistry());
  results.push(testYggdrasilEnvironmentDiagnosticsShape());
  results.push(testYggdrasilEnvironmentCommandAbsenceNonFatal());
  results.push(testYggdrasilEnvironmentLocalOnly());
  results.push(testYggdrasilConnectivityCommandAbsenceNonFatal());
  results.push(testYggdrasilConnectivityRemoteUrlIncluded());
  results.push(testYggdrasilConnectivityParserHandlesSampleOutput());
  results.push(testYggdrasilConnectivityNoMutationOrDelivery());
  results.push(testYggdrasilHealthEndpointBuild());
  results.push(await testYggdrasilHealthInvalidUnbracketedIpv6DoesNotProbe());
  results.push(await testYggdrasilHealthMockSuccessResponse());
  results.push(await testYggdrasilHealthMockFailureResponse());
  results.push(await testYggdrasilHealthTimeoutOrUnreachableStructuredFailure());
  results.push(testYggdrasilHealthNoMessageDeliveryAttempted());
  results.push(testYggdrasilNodeParseGetSelfOutput());
  results.push(testYggdrasilNodeParseEmptyPeersOutput());
  results.push(testYggdrasilNodeParseEmptySessionsOutput());
  results.push(testYggdrasilNodeParseTunOutput());
  results.push(testYggdrasilNodeParseCommandListOutput());
  results.push(testYggdrasilNodeMissingYggdrasilctl());
  results.push(testYggdrasilNodeDiagnosticsOnlyGuarantees());
  results.push(testYggdrasilDoctorDetectUtf8Bom());
  results.push(testYggdrasilDoctorParseConfigDocument());
  results.push(testYggdrasilDoctorParsePathsOutput());
  results.push(testYggdrasilDoctorFirewallConflictSummary());
  results.push(await testYggdrasilDoctorDiagnosticsShape());
  results.push(await testYggdrasilDoctorSkipsRemoteProbeWithoutRemoteUrl());
  results.push(await testRuntimeProfileLoadAndValidate());
  results.push(await testRuntimeProfileMissingProfileNameFailure());
  results.push(await testRuntimeProfileMissingRequiredConfigFailure());
  results.push(await testRuntimeProfileInactiveTransportFailure());
  results.push(testRuntimeProfileManualMerge());
  results.push(await testRuntimeProfileValidateDiagnostics());
  results.push(await testRuntimeProfileBackedRelayPull());
  results.push(await testRuntimeProfileBackedHealthCheck());
  results.push(await testRuntimeProfileBackedDeliveryResolution());
  results.push(await testRuntimeProfileOverrideBehavior());
  results.push(await testRuntimeProfileMissingRequiredFailsClearly());
  results.push(await testRuntimeStateSummaryDiagnostics());
  results.push(await testRuntimePathDiagnosticsDefault());
  results.push(await testRuntimePathDiagnosticsExplicitStateDir());
  results.push(await testRuntimePathDiagnosticsConsistency());
  results.push(await testRuntimeRestartStateReload());
  results.push(await testDuplicateReceiptProcessing());
  results.push(await testDuplicateBundleImportHandling());
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
