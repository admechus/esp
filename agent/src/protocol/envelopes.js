import { randomBytes } from "node:crypto";
import { canonicalStringify } from "./canonicalJson.js";
import {
  createP256FingerprintHex,
  createP256KeyId,
  sha256Buffer,
  verifyEs256Signature
} from "../crypto/p256Identity.js";

function createEnvelopeNonce() {
  return randomBytes(16).toString("hex");
}

export function createUnsignedTextEnvelope({ sender, recipientKeyId = null, text }) {
  return {
    version: 1,
    kind: "signed-envelope",
    algorithm: sender.algorithm ?? "ES256",
    curve: sender.curve ?? "P-256",
    createdAt: new Date().toISOString(),
    nonceHex: createEnvelopeNonce(),
    sender: {
      keyId: sender.keyId,
      fingerprintHex: sender.fingerprintHex,
      publicKeyBase64: sender.publicKeyBase64
    },
    recipient: recipientKeyId ? { keyId: recipientKeyId } : null,
    payload: {
      type: "text/plain",
      encoding: "utf8",
      bodyBase64: Buffer.from(text, "utf8").toString("base64")
    }
  };
}

export function createEnvelopeSigningBytes(unsignedEnvelope) {
  return Buffer.from(canonicalStringify(unsignedEnvelope), "utf8");
}

export function createSignedEnvelope(unsignedEnvelope, signatureBase64) {
  return {
    ...unsignedEnvelope,
    signatureBase64
  };
}

export function pickSignedEnvelopeFields(envelope) {
  return {
    version: envelope.version,
    kind: envelope.kind,
    algorithm: envelope.algorithm,
    curve: envelope.curve,
    createdAt: envelope.createdAt,
    nonceHex: envelope.nonceHex,
    sender: envelope.sender,
    recipient: envelope.recipient,
    payload: envelope.payload,
    signatureBase64: envelope.signatureBase64
  };
}

export function createEnvelopeId(envelope) {
  const signedEnvelope = pickSignedEnvelopeFields(envelope);
  return sha256Buffer(Buffer.from(canonicalStringify(signedEnvelope), "utf8")).toString("hex");
}

export function verifySignedEnvelope(envelope) {
  if (!envelope?.sender?.publicKeyBase64) {
    throw new Error("Envelope is missing sender.publicKeyBase64.");
  }
  if (!envelope?.signatureBase64) {
    throw new Error("Envelope is missing signatureBase64.");
  }

  const unsignedEnvelope = {
    version: envelope.version,
    kind: envelope.kind,
    algorithm: envelope.algorithm,
    curve: envelope.curve,
    createdAt: envelope.createdAt,
    nonceHex: envelope.nonceHex,
    sender: envelope.sender,
    recipient: envelope.recipient,
    payload: envelope.payload
  };

  const signingBytes = createEnvelopeSigningBytes(unsignedEnvelope);
  const publicKeyBase64 = envelope?.sender?.publicKeyBase64;
  const fingerprintHex = createP256FingerprintHex(publicKeyBase64);
  const keyId = createP256KeyId(publicKeyBase64);
  const envelopeId = createEnvelopeId(envelope);

  const verified = verifyEs256Signature({
    payload: signingBytes,
    publicKeyBase64,
    signatureBase64: envelope.signatureBase64
  });

  return {
    verified,
    envelopeId,
    keyId,
    fingerprintHex,
    text:
      envelope?.payload?.encoding === "utf8"
        ? Buffer.from(envelope.payload.bodyBase64 ?? "", "base64").toString("utf8")
        : null,
    matchesEnvelopeIdentity:
      envelope?.sender?.keyId === keyId && envelope?.sender?.fingerprintHex === fingerprintHex
  };
}
