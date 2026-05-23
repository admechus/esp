import { sha256Buffer } from "../crypto/p256Identity.js";

function createReceiptId({
  messageId,
  envelopeId,
  senderKeyId,
  receiverAgent,
  sourceAgent,
  relayName,
  status
}) {
  const receiptMaterial = [
    messageId ?? "",
    envelopeId ?? "",
    senderKeyId ?? "",
    receiverAgent ?? "",
    sourceAgent ?? "",
    relayName ?? "",
    status ?? ""
  ].join("|");

  return `receipt:${sha256Buffer(Buffer.from(receiptMaterial, "utf8"))
    .toString("hex")
    .slice(0, 32)}`;
}

export function createDeliveryReceipt({
  messageId,
  envelopeId,
  senderKeyId,
  receiverAgent,
  sourceAgent = null,
  relayName = null,
  acceptedAt = new Date().toISOString()
}) {
  const status = "accepted_remote";
  const receiptId = createReceiptId({
    messageId,
    envelopeId,
    senderKeyId,
    receiverAgent,
    sourceAgent,
    relayName,
    status
  });

  return {
    receiptId,
    messageId,
    envelopeId,
    senderKeyId,
    receiverAgent,
    sourceAgent,
    relayName,
    status,
    acceptedAt
  };
}

export function createReadReceipt({
  messageId,
  envelopeId,
  senderKeyId,
  receiverAgent,
  sourceAgent = null,
  relayName = null,
  readAt = new Date().toISOString()
}) {
  const status = "read_remote";
  const receiptId = createReceiptId({
    messageId,
    envelopeId,
    senderKeyId,
    receiverAgent,
    sourceAgent,
    relayName,
    status
  });

  return {
    receiptId,
    messageId,
    envelopeId,
    senderKeyId,
    receiverAgent,
    sourceAgent,
    relayName,
    status,
    readAt
  };
}

export function createRelayReceipt({
  transferId,
  targetAgent,
  targetUrl,
  sourceAgent = null,
  messageCount = 0,
  receivedAt = new Date().toISOString()
}) {
  const receiptMaterial = [
    transferId ?? "",
    targetAgent ?? "",
    targetUrl ?? "",
    sourceAgent ?? "",
    String(messageCount),
    receivedAt
  ].join("|");

  const relayReceiptId = `relay:${sha256Buffer(Buffer.from(receiptMaterial, "utf8"))
    .toString("hex")
    .slice(0, 32)}`;

  return {
    relayReceiptId,
    transferId,
    targetAgent,
    targetUrl,
    sourceAgent,
    messageCount,
    receivedAt,
    status: "forwarded"
  };
}
