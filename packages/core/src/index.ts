/**
 * index.ts — @previa/core public API
 *
 * Single entry point for all core business logic exports.
 * Consumers should import from "@previa/core" and never from internal paths.
 *
 * Usage:
 *   import { generateFingerprint, buildFingerprintFromRaw, normalizeDescription } from "@previa/core"
 */

export {
  normalizeDescription,
  generateFingerprint,
  buildFingerprintFromRaw,
} from "./fingerprint";

export type {
  FingerprintInput,
  RawFingerprintInput,
} from "./fingerprint";
