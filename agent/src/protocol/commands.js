export const COMMANDS = {
  PING: {
    request: [],
    response: ["result"]
  },
  GET_INFO: {
    request: [],
    response: ["device", "role", "profile", "version", "capabilities"]
  },
  GET_PLATFORM_IO: {
    request: [],
    response: ["device", "chip", "profile", "transport", "outputs", "gpio"]
  },
  TEST_OUTPUT: {
    request: ["target"],
    response: ["device", "chip", "profile", "transport", "target", "results"]
  },
  GEN_IDENTITY: {
    request: [],
    response: ["algorithm", "curve", "keyId", "fingerprintHex", "publicKeyBase64", "created"]
  },
  GET_PUBLIC_ID: {
    request: [],
    response: ["algorithm", "curve", "keyId", "fingerprintHex", "publicKeyBase64"]
  },
  SIGN_BYTES: {
    request: ["payloadBase64"],
    response: ["algorithm", "curve", "keyId", "fingerprintHex", "signatureBase64", "publicKeyBase64"]
  },
  SIGN_HASH: {
    request: ["digestBase64"],
    response: ["algorithm", "curve", "keyId", "fingerprintHex", "signatureBase64", "publicKeyBase64"]
  }
};

let requestCounter = 1;

export function createRequest(cmd, payload = {}) {
  if (!COMMANDS[cmd]) {
    throw new Error(`Unknown command: ${cmd}`);
  }

  return {
    id: requestCounter++,
    cmd,
    ...payload
  };
}

export function assertValidCommand(cmd) {
  if (!COMMANDS[cmd]) {
    throw new Error(`Unsupported command: ${cmd}`);
  }
}
