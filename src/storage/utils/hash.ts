/**
 * SHA-256 hash computation utility for event sourcing system.
 * Uses Node.js built-in crypto module for cryptographic operations.
 * @module storage/utils/hash
 */

import { createHash } from "crypto";

/**
 * Input structure for computing event hashes in the event sourcing system.
 * All fields are used to compute the canonical hash for chain verification.
 */
export interface EventHashInput {
  /** Unique event identifier */
  id: number;
  /** ISO 8601 timestamp of event creation */
  timestamp: string;
  /** Type of event (e.g., "character_created", "item_acquired") */
  event_type: string;
  /** ID of the actor performing the action, null for system events */
  actor_id: string | null;
  /** ID of the target entity, null if not applicable */
  target_id: string | null;
  /** JSON string containing event-specific data */
  payload: string;
  /** Hash of the previous event in the chain */
  prev_hash: string;
}

/**
 * Genesis hash constant - SHA-256 hash of the string "genesis".
 *
 * The first event in any chain uses this as prev_hash since there is no
 * preceding event to reference. This establishes the cryptographic anchor
 * for the entire event chain.
 *
 * Value: "aeebad4a796fcc2e15dc4c6061b45ed9b373f26adfc798ca7d2d8cc58182718e"
 *
 * @constant
 * @example
 * ```typescript
 * // First event in a new world's event chain
 * const firstEvent: EventHashInput = {
 *   id: 1,
 *   timestamp: new Date().toISOString(),
 *   event_type: "world_created",
 *   actor_id: "system",
 *   target_id: "world_001",
 *   payload: '{"name":"New World"}',
 *   prev_hash: GENESIS_HASH  // No previous event, use genesis
 * };
 * ```
 */
export const GENESIS_HASH: string = computeHash("genesis");

/**
 * Computes a SHA-256 hash of the input data.
 *
 * @param data - The string data to hash
 * @returns Lowercase hex-encoded SHA-256 hash (64 characters)
 *
 * @example
 * ```typescript
 * const hash = computeHash("hello world");
 * // Returns: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
 * ```
 */
export function computeHash(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Computes a SHA-256 hash for an event in the event sourcing system.
 * The hash is computed over canonical JSON (sorted keys, no whitespace)
 * to ensure deterministic hash computation regardless of field order.
 *
 * @param event - The event data to hash
 * @returns Lowercase hex-encoded SHA-256 hash (64 characters)
 *
 * @example
 * ```typescript
 * const eventHash = computeEventHash({
 *   id: 1,
 *   timestamp: "2025-01-01T00:00:00.000Z",
 *   event_type: "character_created",
 *   actor_id: "system",
 *   target_id: "char_001",
 *   payload: '{"name":"Hero"}',
 *   prev_hash: GENESIS_HASH
 * });
 * ```
 */
export function computeEventHash(event: EventHashInput): string {
  // Build canonical object with sorted keys for deterministic serialization
  const canonical = {
    actor_id: event.actor_id,
    event_type: event.event_type,
    id: event.id,
    payload: event.payload,
    prev_hash: event.prev_hash,
    target_id: event.target_id,
    timestamp: event.timestamp,
  };

  // Serialize with no whitespace for canonical representation
  const canonicalJson = JSON.stringify(canonical);

  return computeHash(canonicalJson);
}

/**
 * Verifies that a hash matches the expected value using timing-safe comparison.
 *
 * @param data - The original string data
 * @param expectedHash - The expected hex-encoded SHA-256 hash to verify against
 * @returns True if the computed hash matches the expected hash, false otherwise
 *
 * @example
 * ```typescript
 * const data = "hello world";
 * const hash = computeHash(data);
 * const isValid = verifyHash(data, hash); // true
 * const isInvalid = verifyHash(data, "wrong_hash"); // false
 * ```
 */
export function verifyHash(data: string, expectedHash: string): boolean {
  const computedHash = computeHash(data);

  // Use constant-time comparison to prevent timing attacks
  if (computedHash.length !== expectedHash.length) {
    return false;
  }

  // Simple constant-time comparison for hex strings
  let result = 0;
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }

  return result === 0;
}
