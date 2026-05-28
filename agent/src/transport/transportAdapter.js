/**
 * @typedef {Object} TransportMetadata
 * @property {string} id Stable adapter identifier.
 * @property {string} kind Transport family or implementation kind.
 * @property {string} label Human-readable transport label.
 * @property {string} description Short descriptive summary of the transport.
 * @property {string[]} capabilities Declared transport features.
 * @property {string[]} deliveryModes Descriptive delivery mode tags.
 * @property {string} networkClass Descriptive network class tag.
 * @property {boolean} experimental Whether the transport is experimental.
 * @property {{
 *   healthCheck: boolean,
 *   directSend: boolean,
 *   relayDelivery: boolean,
 *   pullRecovery: boolean,
 *   fileExport: boolean,
 *   fileImport: boolean,
 *   offlineCarry: boolean,
 *   ipv4: boolean,
 *   ipv6: boolean
 * }} supports Descriptive support flags only.
 */

/**
 * @typedef {Object} TransportHealthResult
 * @property {string} [id] Transport adapter identifier when included by the adapter.
 * @property {string} kind Transport family or implementation kind.
 * @property {string | null} [remoteUrl] Normalized remote transport URL when applicable.
 * @property {boolean} [ok] Optional direct health flag for adapters that can report it locally.
 * @property {unknown} [payload] Raw transport payload retained for diagnostics.
 */

/**
 * @typedef {Object} TransportSendResult
 * @property {string} id Stable adapter identifier.
 * @property {string} kind Transport family or implementation kind.
 * @property {string} remoteUrl Normalized remote transport URL.
 * @property {object | null} remoteEntity Remote relay or agent descriptor when present.
 * @property {object[]} accepted Transport-level accepted result items.
 * @property {object[]} receipts Transport-level receipt artifacts returned by the remote side.
 * @property {boolean} queued Transport-level queue flag.
 * @property {string | null} queueId Queue identifier when provided.
 * @property {string | null} queueReason Queue reason when provided.
 * @property {string | null} queueError Queue-side error when provided.
 * @property {string | null} relayReceiptId Relay receipt identifier when provided.
 * @property {string | null} targetAgent Explicit relay target when provided.
 * @property {unknown} [payload] Raw transport payload retained for diagnostics.
 */

/**
 * @typedef {Object} TransportPullResult
 * @property {string} id Stable adapter identifier.
 * @property {string} kind Transport family or implementation kind.
 * @property {string} remoteUrl Normalized remote transport URL.
 * @property {string | null} targetAgent Explicit relay target when provided.
 * @property {number} pulledCount Number of items pulled from queue processing.
 * @property {number} deliveredCount Number of items delivered during pull.
 * @property {number} failedCount Number of items that failed during pull.
 * @property {number} remainingCount Number of items still queued after pull.
 * @property {object[]} delivered Delivered transfer records.
 * @property {object[]} failed Failed transfer records.
 * @property {object | null} relay Relay descriptor when provided.
 * @property {unknown} [payload] Raw transport payload retained for diagnostics.
 */

/**
 * @typedef {Object} TransportFileResult
 * @property {string} id Stable adapter identifier.
 * @property {string} kind Transport family or implementation kind.
 * @property {string} filePath Absolute or resolved file path.
 * @property {object} bundle Transport bundle artifact as read or written.
 * @property {number | null} messageCount Number of messages when available.
 */

/**
 * @typedef {Object} TransportAdapter
 * @property {string} id Stable adapter identifier.
 * @property {string} kind Transport family or implementation kind.
 * @property {string[]} capabilities Advertised transport features.
 * @property {TransportMetadata} metadata Descriptive transport passport.
 * @property {(input?: object) => Promise<TransportHealthResult>} health Reports adapter health or availability.
 * @property {(input: {
 *   target?: string | null,
 *   bundle: object,
 *   options?: object
 * }) => Promise<TransportSendResult>} [sendBundle] Sends a transport bundle to a target.
 * @property {(input: {
 *   bundle: object,
 *   metadata?: object
 * }) => Promise<unknown>} [acceptBundle] Accepts an inbound transport bundle.
 * @property {(input: {
 *   target?: string | null,
 *   options?: object
 * }) => Promise<TransportPullResult>} [pullQueued] Pulls queued work for a target when supported.
 * @property {(input?: object) => Promise<unknown>} [listRoutes] Lists route metadata when supported.
 * @property {(input?: object) => Promise<unknown>} [listQueue] Lists queue state when supported.
 * @property {(input: {
 *   filePath: string,
 *   bundle: object
 * }) => Promise<TransportFileResult>} [exportBundle] Exports a bundle artifact to disk when supported.
 * @property {(input: {
 *   filePath: string
 * }) => Promise<TransportFileResult>} [importBundle] Imports a bundle artifact from disk when supported.
 */

function assertArray(value, fieldName, context) {
  if (!Array.isArray(value)) {
    throw new Error(`${context} is missing array field ${fieldName}.`);
  }
}

function assertObject(value, context) {
  if (!value || typeof value !== "object") {
    throw new Error(`${context} must be an object.`);
  }
}

function assertString(value, fieldName, context) {
  if (typeof value !== "string" || !value) {
    throw new Error(`${context} is missing string field ${fieldName}.`);
  }
}

function assertNullableString(value, fieldName, context) {
  if (value !== null && typeof value !== "string") {
    throw new Error(`${context} has invalid string field ${fieldName}.`);
  }
}

function assertNullableNumber(value, fieldName, context) {
  if (value !== null && !Number.isFinite(value)) {
    throw new Error(`${context} has invalid number field ${fieldName}.`);
  }
}

function assertBoolean(value, fieldName, context) {
  if (typeof value !== "boolean") {
    throw new Error(`${context} has invalid boolean field ${fieldName}.`);
  }
}

/**
 * @param {unknown} metadata
 * @param {string} [context]
 * @returns {TransportMetadata}
 */
export function assertTransportMetadata(metadata, context = "TransportMetadata") {
  assertObject(metadata, context);
  assertString(metadata.id, "id", context);
  assertString(metadata.kind, "kind", context);
  assertString(metadata.label, "label", context);
  assertString(metadata.description, "description", context);
  assertArray(metadata.capabilities, "capabilities", context);
  assertArray(metadata.deliveryModes, "deliveryModes", context);
  assertString(metadata.networkClass, "networkClass", context);
  assertBoolean(metadata.experimental, "experimental", context);
  assertObject(metadata.supports, `${context}.supports`);
  assertBoolean(metadata.supports.healthCheck, "supports.healthCheck", context);
  assertBoolean(metadata.supports.directSend, "supports.directSend", context);
  assertBoolean(metadata.supports.relayDelivery, "supports.relayDelivery", context);
  assertBoolean(metadata.supports.pullRecovery, "supports.pullRecovery", context);
  assertBoolean(metadata.supports.fileExport, "supports.fileExport", context);
  assertBoolean(metadata.supports.fileImport, "supports.fileImport", context);
  assertBoolean(metadata.supports.offlineCarry, "supports.offlineCarry", context);
  assertBoolean(metadata.supports.ipv4, "supports.ipv4", context);
  assertBoolean(metadata.supports.ipv6, "supports.ipv6", context);
  return /** @type {TransportMetadata} */ (metadata);
}

/**
 * @param {unknown} result
 * @param {string} [context]
 * @returns {TransportSendResult}
 */
export function assertTransportSendResult(result, context = "TransportSendResult") {
  assertObject(result, context);
  assertString(result.id, "id", context);
  assertString(result.kind, "kind", context);
  assertString(result.remoteUrl, "remoteUrl", context);
  assertArray(result.accepted, "accepted", context);
  assertArray(result.receipts, "receipts", context);
  if (typeof result.queued !== "boolean") {
    throw new Error(`${context} has invalid boolean field queued.`);
  }
  assertNullableString(result.queueId, "queueId", context);
  assertNullableString(result.queueReason, "queueReason", context);
  assertNullableString(result.queueError, "queueError", context);
  assertNullableString(result.relayReceiptId, "relayReceiptId", context);
  assertNullableString(result.targetAgent, "targetAgent", context);
  return /** @type {TransportSendResult} */ (result);
}

/**
 * @param {unknown} result
 * @param {string} [context]
 * @returns {TransportPullResult}
 */
export function assertTransportPullResult(result, context = "TransportPullResult") {
  assertObject(result, context);
  assertString(result.id, "id", context);
  assertString(result.kind, "kind", context);
  assertString(result.remoteUrl, "remoteUrl", context);
  assertNullableString(result.targetAgent, "targetAgent", context);
  if (!Number.isFinite(result.pulledCount)) {
    throw new Error(`${context} has invalid number field pulledCount.`);
  }
  if (!Number.isFinite(result.deliveredCount)) {
    throw new Error(`${context} has invalid number field deliveredCount.`);
  }
  if (!Number.isFinite(result.failedCount)) {
    throw new Error(`${context} has invalid number field failedCount.`);
  }
  if (!Number.isFinite(result.remainingCount)) {
    throw new Error(`${context} has invalid number field remainingCount.`);
  }
  assertArray(result.delivered, "delivered", context);
  assertArray(result.failed, "failed", context);
  return /** @type {TransportPullResult} */ (result);
}

/**
 * @param {unknown} result
 * @param {string} [context]
 * @returns {TransportFileResult}
 */
export function assertTransportFileResult(result, context = "TransportFileResult") {
  assertObject(result, context);
  assertString(result.id, "id", context);
  assertString(result.kind, "kind", context);
  assertString(result.filePath, "filePath", context);
  assertObject(result.bundle, `${context}.bundle`);
  assertNullableNumber(result.messageCount, "messageCount", context);
  return /** @type {TransportFileResult} */ (result);
}

/**
 * Stage 1 documentation-only placeholder.
 *
 * Runtime code is intentionally not wired to this constructor contract. The
 * purpose of this file is to keep transport result contracts and future
 * transport refactors aligned with the architecture and task backlog without
 * disturbing the currently working delivery paths.
 *
 * @returns {never}
 */
export function createTransportAdapterPlaceholder() {
  throw new Error("TransportAdapter placeholder is documentation-only in Stage 1.");
}
