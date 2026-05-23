import { generateKeyPairSync, sign } from "node:crypto";
import { createP256FingerprintHex, createP256KeyId } from "../crypto/p256Identity.js";

function toBase64Url(value) {
  return value.replace(/-/g, "+").replace(/_/g, "/");
}

function createMockIdentity() {
  const keyPair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = keyPair.publicKey.export({ format: "jwk" });
  const x = Buffer.from(toBase64Url(jwk.x), "base64");
  const y = Buffer.from(toBase64Url(jwk.y), "base64");
  const publicKey = Buffer.concat([Buffer.from([0x04]), x, y]).toString("base64");
  const fingerprintHex = createP256FingerprintHex(publicKey);
  const keyId = createP256KeyId(publicKey);

  return {
    publicKey,
    fingerprintHex,
    keyId,
    signPayload(payloadBuffer) {
      return sign("sha256", payloadBuffer, keyPair.privateKey).toString("base64");
    }
  };
}

export function createMockDongleTransport() {
  const identity = createMockIdentity();

  return {
    async send(request) {
      switch (request.cmd) {
        case "PING":
          return { id: request.id, ok: true, result: "PONG" };
        case "GET_INFO":
          return {
            id: request.id,
            ok: true,
            device: "mock-dongle",
            chip: "esp32s3",
            role: "identity",
            profile: "identity-token",
            version: "0.1.0",
            transport: "mock",
            algorithm: "ES256",
            capabilities: ["sign", "identity", "mock", "get_info"]
          };
        case "GET_PLATFORM_IO":
          return {
            id: request.id,
            ok: true,
            device: "mock-dongle",
            chip: "esp32s3",
            profile: "identity-token",
            transport: "mock",
            outputs: [
              {
                kind: "display",
                driver: "st7735",
                resolution: "80x160",
                status: "declared"
              },
              {
                kind: "rgb-led",
                status: "declared"
              }
            ],
            gpio: {
              pinCount: 49,
              inputRange: "0-48",
              outputRange: "0-48",
              liveProbeSupported: false,
              probeStatus: "mock"
            }
          };
        case "TEST_OUTPUT":
          return {
            id: request.id,
            ok: true,
            device: "mock-dongle",
            chip: "esp32s3",
            profile: "identity-token",
            transport: "mock",
            target: request.target ?? "all",
            results: [
              {
                kind: request.target ?? "all",
                status: "ok",
                detail: "Mock output test completed."
              }
            ]
          };
        case "GEN_IDENTITY":
          return {
            id: request.id,
            ok: true,
            algorithm: "ES256",
            curve: "P-256",
            keyId: identity.keyId,
            fingerprintHex: identity.fingerprintHex,
            publicKeyBase64: identity.publicKey,
            created: true
          };
        case "GET_PUBLIC_ID":
          return {
            id: request.id,
            ok: true,
            algorithm: "ES256",
            curve: "P-256",
            keyId: identity.keyId,
            fingerprintHex: identity.fingerprintHex,
            publicKeyBase64: identity.publicKey
          };
        case "SIGN_BYTES": {
          const payloadBuffer = Buffer.from(request.payloadBase64 ?? "", "base64");
          return {
            id: request.id,
            ok: true,
            algorithm: "ES256",
            curve: "P-256",
            keyId: identity.keyId,
            fingerprintHex: identity.fingerprintHex,
            publicKeyBase64: identity.publicKey,
            signatureBase64: identity.signPayload(payloadBuffer)
          };
        }
        default:
          return { id: request.id, ok: false, error: `Unsupported command ${request.cmd}` };
      }
    }
  };
}
