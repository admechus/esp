#!/usr/bin/env node

import { createAgentApiServer } from "./api/server.js";
import { createRelayApiServer } from "./api/relayServer.js";
import {
  createUnifiedAttachedConfig,
  createUnifiedClientServer,
  createUnifiedEmbeddedConfig
} from "./api/unifiedServer.js";
import { createAgentRuntime } from "./runtime/agentRuntime.js";
import {
  formatMessageTable,
  formatPeerTable,
  formatPortTable,
  formatProfileTable,
  formatTransportHealth,
  formatTransportTable
} from "./runtime/formatters.js";
import { applyRuntimeProfile } from "./runtime/runtimeProfiles.js";
import { describeYggdrasilRemoteUrl } from "./transport/yggdrasilAddress.js";
import { describeYggdrasilConnectivity } from "./transport/yggdrasilConnectivity.js";
import { describeYggdrasilEnvironment } from "./transport/yggdrasilEnvironment.js";
import { probeYggdrasilHealth } from "./transport/yggdrasilHealthProbe.js";
import { describeYggdrasilLocalNode } from "./transport/yggdrasilNodeIntrospection.js";

function printUsage() {
  console.log(`Usage:
  node src/cli.js list-ports
  node src/cli.js list-profiles
  node src/cli.js list-transports
  node src/cli.js runtime-state
  node src/cli.js runtime-paths
  node src/cli.js yggdrasil-readiness [--remote-url http://[200:db8::1]:8788]
  node src/cli.js yggdrasil-env
  node src/cli.js yggdrasil-connectivity [--remote-url http://[200:db8::1]:8788]
  node src/cli.js yggdrasil-health --remote-url http://[200:db8::1]:8788 [--timeout-ms 3000]
  node src/cli.js yggdrasil-node
  node src/cli.js validate-profile <path>
  node src/cli.js check-transport --transport local-http-agent [--remote-url http://127.0.0.1:8788]
  node src/cli.js export-bundle [--file <path>] [--transport file-bundle] [--profile <path>]
  node src/cli.js import-bundle <path> [--transport file-bundle] [--profile <path>]
  node src/cli.js deliver-bundle --remote-url http://127.0.0.1:8788 [--target-agent receiver] [--transport local-http-agent|local-http-relay] [--profile <path>]
  node src/cli.js ping --mock
  node src/cli.js info --mock
  node src/cli.js pull-relay [--remote-url http://127.0.0.1:8790] [--transport local-http-relay] [--profile <path>]
  node src/cli.js serve --port COM9 [--listen 8787] [--host 127.0.0.1] [--state-dir .\\agent\\state] [--agent-name sender] [--remote-url http://127.0.0.1:8788] [--sync-interval-ms 15000]
  node src/cli.js serve-relay [--listen 8790] [--host 127.0.0.1] [--state-dir .\\agent\\state-relay] [--relay-name gateway] [--route receiver=http://127.0.0.1:8788]
  node src/cli.js serve-unified [--listen 8795] [--sender-url http://127.0.0.1:8787 --receiver-url http://127.0.0.1:8788 --relay-url http://127.0.0.1:8790]
  node src/cli.js serve-unified [--listen 8795] [--sender-port COM9] [--receiver-port COM8]
  node src/cli.js gen-identity --port COM9
  node src/cli.js get-public-id --port COM9
  node src/cli.js identity-summary --port COM9
  node src/cli.js remember-self --port COM9
  node src/cli.js list-peers
  node src/cli.js list-messages
  node src/cli.js make-envelope --port COM9 "hello"
  node src/cli.js save-envelope --port COM9 "hello" [--to <keyId>] [--file <path>]
  node src/cli.js verify-envelope <path>
  node src/cli.js import-envelope <path> [--label <name>]
  node src/cli.js receive-envelope <path> [--label <name>]
  node src/cli.js sign-text --port COM9 "hello"
  node src/cli.js verify-text --port COM9 "hello"
  node src/cli.js send --mock <CMD> [jsonPayload]
  node src/cli.js send --port COM9 <CMD> [jsonPayload]`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  let listenSpecified = false;
  const options = {
    command,
    mock: false,
    port: null,
    cmd: null,
    payload: null,
    text: null,
    toKeyId: null,
    label: null,
    filePath: null,
    stateDir: null,
    agentName: null,
    remoteUrl: null,
    targetAgent: null,
    relayName: null,
    shellName: "unified-client",
    profilePath: null,
    profileName: null,
    senderUrl: null,
    receiverUrl: null,
    relayUrl: null,
    senderPort: null,
    receiverPort: null,
    senderListenPort: 8787,
    receiverListenPort: 8788,
    relayListenPort: 8790,
    senderStateDir: null,
    receiverStateDir: null,
    relayStateDir: null,
    routes: [],
    syncIntervalMs: 15000,
    timeoutMs: 3000,
    transportId: null,
    listenPort: 8787,
    host: "127.0.0.1"
  };

  const positionals = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--mock") {
      options.mock = true;
      continue;
    }
    if (token === "--port") {
      options.port = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--to") {
      options.toKeyId = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--label") {
      options.label = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--file") {
      options.filePath = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--listen") {
      options.listenPort = Number.parseInt(rest[index + 1] ?? "8787", 10);
      listenSpecified = true;
      index += 1;
      continue;
    }
    if (token === "--state-dir") {
      options.stateDir = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--agent-name") {
      options.agentName = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--remote-url") {
      options.remoteUrl = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--target-agent") {
      options.targetAgent = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--relay-name") {
      options.relayName = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--shell-name") {
      options.shellName = rest[index + 1] ?? "unified-client";
      index += 1;
      continue;
    }
    if (token === "--profile") {
      options.profilePath = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--sender-url") {
      options.senderUrl = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--receiver-url") {
      options.receiverUrl = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--relay-url") {
      options.relayUrl = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--sender-port") {
      options.senderPort = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--receiver-port") {
      options.receiverPort = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--sender-listen") {
      options.senderListenPort = Number.parseInt(rest[index + 1] ?? "8787", 10);
      index += 1;
      continue;
    }
    if (token === "--receiver-listen") {
      options.receiverListenPort = Number.parseInt(rest[index + 1] ?? "8788", 10);
      index += 1;
      continue;
    }
    if (token === "--relay-listen") {
      options.relayListenPort = Number.parseInt(rest[index + 1] ?? "8790", 10);
      index += 1;
      continue;
    }
    if (token === "--sender-state-dir") {
      options.senderStateDir = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--receiver-state-dir") {
      options.receiverStateDir = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--relay-state-dir") {
      options.relayStateDir = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--route") {
      options.routes.push(rest[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--sync-interval-ms") {
      options.syncIntervalMs = Number.parseInt(rest[index + 1] ?? "15000", 10);
      index += 1;
      continue;
    }
    if (token === "--transport") {
      options.transportId = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--host") {
      options.host = rest[index + 1] ?? "127.0.0.1";
      index += 1;
      continue;
    }
    if (token === "--timeout-ms") {
      options.timeoutMs = Number.parseInt(rest[index + 1] ?? "3000", 10);
      index += 1;
      continue;
    }
    positionals.push(token);
  }

  if (command === "send") {
    options.cmd = positionals[0] ?? null;
    options.payload = positionals[1] ? JSON.parse(positionals[1]) : {};
  }

  if (command === "sign-text" || command === "verify-text" || command === "make-envelope") {
    options.text = positionals[0] ?? "";
  }

  if (
    command === "verify-envelope" ||
    command === "import-envelope" ||
    command === "receive-envelope" ||
    command === "import-bundle"
  ) {
    options.filePath = options.filePath ?? positionals[0] ?? null;
  }

  if (command === "validate-profile") {
    options.filePath = options.filePath ?? positionals[0] ?? null;
  }

  if (command === "save-envelope") {
    options.text = positionals[0] ?? "";
  }

  if (command === "serve-relay" && !listenSpecified) {
    options.listenPort = 8790;
  }

  return options;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runtime = createAgentRuntime({
    stateDir: args.stateDir,
    agentName: args.agentName
  });
  const loadedProfile = args.profilePath ? await runtime.loadRuntimeProfile(args.profilePath) : null;
  if (loadedProfile && args.command !== "validate-profile" && !loadedProfile.ok) {
    throw new Error(loadedProfile.errors.join(" "));
  }
  const resolvedArgs = applyRuntimeProfile(args, loadedProfile);

  switch (args.command) {
    case "list-ports": {
      const ports = await runtime.listPorts();
      console.log(formatPortTable(ports));
      break;
    }
    case "list-profiles": {
      console.log(formatProfileTable(runtime.listProfiles()));
      break;
    }
    case "list-transports": {
      console.log(formatTransportTable(runtime.listTransports()));
      break;
    }
    case "runtime-state": {
      const result = await runtime.getRuntimeStateSummary();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "runtime-paths": {
      const result = await runtime.getRuntimePathDiagnostics();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "yggdrasil-readiness": {
      const result = describeYggdrasilRemoteUrl(args.remoteUrl ?? null);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "yggdrasil-env": {
      const result = describeYggdrasilEnvironment();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "yggdrasil-connectivity": {
      const result = describeYggdrasilConnectivity({
        remoteUrl: args.remoteUrl ?? null
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "yggdrasil-health": {
      if (!args.remoteUrl) {
        throw new Error("Missing --remote-url for yggdrasil-health.");
      }
      const result = await probeYggdrasilHealth({
        remoteUrl: args.remoteUrl,
        timeoutMs: args.timeoutMs
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "yggdrasil-node": {
      const result = describeYggdrasilLocalNode();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "validate-profile": {
      if (!args.filePath) {
        throw new Error("Missing profile file path.");
      }
      const result = await runtime.loadRuntimeProfile(args.filePath);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "check-transport": {
      if (!resolvedArgs.transportId) {
        throw new Error("Missing --transport for check-transport.");
      }
      const result = await runtime.checkTransportHealth(resolvedArgs.transportId, resolvedArgs);
      console.log(formatTransportHealth(result));
      break;
    }
    case "export-bundle": {
      const response = await runtime.exportOutboxBundle(resolvedArgs);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "import-bundle": {
      if (!resolvedArgs.filePath) {
        throw new Error("Missing bundle file path.");
      }
      const response = await runtime.importTransportBundle(resolvedArgs.filePath, resolvedArgs);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "deliver-bundle": {
      if (!resolvedArgs.remoteUrl) {
        throw new Error("Missing --remote-url for deliver-bundle.");
      }
      const response = await runtime.deliverTransportBundle(resolvedArgs.remoteUrl, resolvedArgs);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "ping": {
      const response = await runtime.sendCommand("PING", {}, args);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "info": {
      const response = await runtime.sendCommand("GET_INFO", {}, args);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "serve": {
      const server = createAgentApiServer({
        runtime,
        deviceOptions: args,
        host: args.host,
        port: args.listenPort
      });
      const address = await server.listen();
      console.log(
        JSON.stringify(
          {
            ok: true,
            service: "esp-messenger-agent",
            agent: runtime.getAgentInfo(),
            host: address.host,
            port: address.port,
            transport: args.mock ? "mock" : args.port ?? null,
            remoteUrl: args.remoteUrl ?? null,
            syncIntervalMs: args.syncIntervalMs
          },
          null,
          2
        )
      );
      break;
    }
    case "serve-relay": {
      const server = createRelayApiServer({
        host: args.host,
        port: args.listenPort,
        relayName: args.relayName ?? "relay",
        routes: args.routes,
        stateDir: args.stateDir
      });
      const address = await server.listen();
      console.log(
        JSON.stringify(
          {
            ok: true,
            service: "esp-messenger-relay",
            relay: {
              name: args.relayName ?? "relay",
              routes: args.routes,
              stateDir: args.stateDir ?? null
            },
            host: address.host,
            port: address.port
          },
          null,
          2
        )
      );
      break;
    }
    case "serve-unified": {
      const isAttachMode = args.senderUrl && args.receiverUrl && args.relayUrl;
      const config = isAttachMode
        ? createUnifiedAttachedConfig({
            host: args.host,
            shellName: args.shellName,
            senderUrl: args.senderUrl,
            receiverUrl: args.receiverUrl,
            relayUrl: args.relayUrl
          })
        : createUnifiedEmbeddedConfig({
            host: args.host,
            shellName: args.shellName,
            senderPort: args.senderPort,
            receiverPort: args.receiverPort,
            senderListenPort: args.senderListenPort,
            receiverListenPort: args.receiverListenPort,
            relayListenPort: args.relayListenPort,
            senderStateDir: args.senderStateDir ?? undefined,
            receiverStateDir: args.receiverStateDir ?? undefined,
            relayStateDir: args.relayStateDir ?? undefined,
            relayName: args.relayName ?? "gateway-alpha",
            syncIntervalMs: args.syncIntervalMs
          });
      const server = createUnifiedClientServer({
        host: args.host,
        port: args.listenPort,
        shellName: config.shellName,
        sender: config.sender,
        receiver: config.receiver,
        relay: config.relay
      });
      const address = await server.listen();
      console.log(
        JSON.stringify(
          {
            ok: true,
            service: "esp-messenger-unified-client",
            shellName: config.shellName,
            mode: address.mode,
            host: address.host,
            port: address.port,
            links: address.links
          },
          null,
          2
        )
      );
      break;
    }
    case "pull-relay": {
      const remoteUrl = resolvedArgs.remoteUrl;
      if (!remoteUrl) {
        throw new Error("Missing --remote-url for pull-relay.");
      }
      const response = await runtime.pullPendingFromRelay(remoteUrl, resolvedArgs);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "gen-identity": {
      const response = await runtime.generateIdentity(args);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "get-public-id": {
      const response = await runtime.getPublicId(args);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "identity-summary": {
      const response = await runtime.getIdentitySummary(args);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "remember-self": {
      const response = await runtime.rememberSelf(args);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "list-peers": {
      const peers = await runtime.listPeers();
      console.log(formatPeerTable(peers));
      break;
    }
    case "list-messages": {
      const messages = await runtime.listMessages();
      console.log(formatMessageTable(messages));
      break;
    }
    case "make-envelope": {
      const response = await runtime.createSignedTextEnvelope(args.text ?? "", args);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "save-envelope": {
      const response = await runtime.createAndSaveSignedTextEnvelope(args.text ?? "", args);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "verify-envelope": {
      if (!args.filePath) {
        throw new Error("Missing envelope file path.");
      }
      const response = await runtime.verifyEnvelopeFile(args.filePath);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "import-envelope": {
      if (!args.filePath) {
        throw new Error("Missing envelope file path.");
      }
      const response = await runtime.importEnvelope(args.filePath, args);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "receive-envelope": {
      if (!args.filePath) {
        throw new Error("Missing envelope file path.");
      }
      const response = await runtime.receiveEnvelope(args.filePath, args);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "sign-text": {
      const response = await runtime.signBytes(Buffer.from(args.text ?? "", "utf8"), args);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "verify-text": {
      const response = await runtime.verifyText(args.text ?? "", args);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    case "send": {
      if (!args.cmd) {
        throw new Error("Missing command name for send.");
      }
      const response = await runtime.sendCommand(args.cmd, args.payload, args);
      console.log(JSON.stringify(response, null, 2));
      break;
    }
    default:
      printUsage();
      process.exitCode = args.command ? 1 : 0;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
