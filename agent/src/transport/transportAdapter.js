/**
 * @typedef {Object} TransportAdapter
 * @property {string} id Stable adapter identifier.
 * @property {string} kind Transport family or implementation kind.
 * @property {string[]} capabilities Advertised transport features.
 * @property {() => Promise<unknown>} health Reports adapter health or availability.
 * @property {(input: {
 *   target: string | null,
 *   bundle: object,
 *   options?: object
 * }) => Promise<unknown>} sendBundle Sends a transport bundle to a target.
 * @property {(input: {
 *   bundle: object,
 *   metadata?: object
 * }) => Promise<unknown>} acceptBundle Accepts an inbound transport bundle.
 * @property {(input: {
 *   target: string | null
 * }) => Promise<unknown>} pullQueued Pulls queued work for a target when supported.
 * @property {() => Promise<unknown>} listRoutes Lists route metadata when supported.
 * @property {() => Promise<unknown>} listQueue Lists queue state when supported.
 */

/**
 * Stage 1 documentation-only placeholder.
 *
 * Runtime code is intentionally not wired to this contract yet. The purpose of
 * this file is to keep future transport refactors aligned with the architecture
 * and task backlog without disturbing the currently working delivery paths.
 *
 * @returns {never}
 */
export function createTransportAdapterPlaceholder() {
  throw new Error("TransportAdapter placeholder is documentation-only in Stage 1.");
}
