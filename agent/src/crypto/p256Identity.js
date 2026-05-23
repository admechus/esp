import { createHash, createPublicKey, verify } from "node:crypto";

function toBase64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createP256PublicKeyFromRaw(publicKeyBase64) {
  const raw = Buffer.from(publicKeyBase64, "base64");
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error("Expected an uncompressed P-256 public key.");
  }

  const x = raw.subarray(1, 33);
  const y = raw.subarray(33, 65);

  return createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: toBase64Url(x),
      y: toBase64Url(y)
    },
    format: "jwk"
  });
}

export function verifyEs256Signature({ payload, publicKeyBase64, signatureBase64 }) {
  const publicKey = createP256PublicKeyFromRaw(publicKeyBase64);
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const signature = Buffer.from(signatureBase64, "base64");

  return verify("sha256", payloadBuffer, publicKey, signature);
}

export function createP256FingerprintHex(publicKeyBase64) {
  const raw = Buffer.from(publicKeyBase64, "base64");
  return createHash("sha256").update(raw).digest("hex");
}

export function createP256KeyId(publicKeyBase64) {
  return `p256:${createP256FingerprintHex(publicKeyBase64).slice(0, 32)}`;
}

export function sha256Buffer(payload) {
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  return createHash("sha256").update(payloadBuffer).digest();
}
