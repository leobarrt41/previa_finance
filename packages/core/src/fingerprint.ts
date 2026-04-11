/**
 * fingerprint.ts — Deterministic transaction fingerprint generator
 *
 * Purpose:
 *   Generate a stable, deterministic hash for a financial transaction so that
 *   the same real-world event — arriving from different sources (Pluggy, PDF
 *   invoice, nota_fiscal) — always produces the same fingerprint. This is the
 *   foundation of the reconciliation engine.
 *
 * Algorithm:
 *   SHA-256( competencyMonth | amountMinor | normalizedDescription )
 *
 * Why these three fields?
 *   - competencyMonth (YYYY-MM): anchors the event in time without being
 *     sensitive to the exact timestamp, which varies across sources.
 *   - amountMinor: the value in centavos is precise and source-independent.
 *   - normalizedDescription: the merchant name after stripping noise
 *     (accents, punctuation, extra spaces, uppercase).
 *
 * Why NOT use the exact date?
 *   The same purchase can appear on different days depending on the source:
 *   Pluggy uses the settlement date, a PDF invoice uses the purchase date,
 *   and a nota_fiscal uses the emission date. Using the month avoids false
 *   negatives while keeping the hash specific enough to avoid false positives.
 *
 * Collision risk:
 *   Two different transactions in the same month with the same amount and
 *   the same merchant (e.g., two identical grocery purchases) will produce
 *   the same fingerprint. This is an acceptable trade-off — the reconciliation
 *   engine must handle this case by checking quantity and context, not by
 *   relying solely on the fingerprint.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FingerprintInput {
  /** Competency month in YYYY-MM format (e.g. "2026-04") */
  competencyMonth: string;
  /** Transaction value in minor units (centavos). Always positive. */
  amountMinor: bigint;
  /** Normalized description (output of normalizeDescription()) */
  normalizedDescription: string;
}

// ---------------------------------------------------------------------------
// normalizeDescription
// Strips noise from a transaction description to produce a stable string.
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw transaction description for fingerprinting.
 *
 * Steps applied:
 *   1. Convert to uppercase
 *   2. Remove accents and diacritics (NFD decomposition + strip combining marks)
 *   3. Remove all non-alphanumeric characters (keep letters and digits only)
 *   4. Collapse multiple spaces into one
 *   5. Trim leading/trailing whitespace
 *
 * @example
 *   normalizeDescription("Pão de Açúcar #1234 - SP")
 *   // → "PAO DE ACUCAR 1234 SP"
 */
export function normalizeDescription(raw: string): string {
  return raw
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritical marks
    .replace(/[^A-Z0-9 ]/g, " ")     // keep only letters, digits and spaces
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// generateFingerprint
// ---------------------------------------------------------------------------

/**
 * Generates a deterministic SHA-256 fingerprint for a transaction.
 *
 * The fingerprint is stored in the `fingerprint` column of both
 * `transactions` and `card_transactions` tables.
 *
 * @returns Hex-encoded SHA-256 string (64 characters)
 *
 * @example
 *   const fp = generateFingerprint({
 *     competencyMonth: "2026-04",
 *     amountMinor: 4990n,
 *     normalizedDescription: "NETFLIX",
 *   });
 *   // → "a3f1c9..." (64-char hex)
 */
export function generateFingerprint(input: FingerprintInput): string {
  const { competencyMonth, amountMinor, normalizedDescription } = input;

  // Validate competencyMonth format
  if (!/^\d{4}-\d{2}$/.test(competencyMonth)) {
    throw new Error(
      `generateFingerprint: invalid competencyMonth "${competencyMonth}". Expected YYYY-MM.`,
    );
  }

  // Build a stable canonical string
  // Separator "|" is safe because normalizedDescription only contains A-Z, 0-9 and spaces
  const canonical = `${competencyMonth}|${amountMinor.toString()}|${normalizedDescription}`;

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// buildFingerprintFromRaw
// Convenience wrapper that normalizes the description before hashing.
// Use this when working directly with raw data from parsers or Open Finance.
// ---------------------------------------------------------------------------

export interface RawFingerprintInput {
  competencyMonth: string;
  amountMinor: bigint;
  /** Raw description as it comes from the source (will be normalized internally) */
  rawDescription: string;
}

/**
 * Normalizes the description and generates the fingerprint in one step.
 *
 * @example
 *   const fp = buildFingerprintFromRaw({
 *     competencyMonth: "2026-04",
 *     amountMinor: 4990n,
 *     rawDescription: "Pão de Açúcar #1234 - SP",
 *   });
 */
export function buildFingerprintFromRaw(input: RawFingerprintInput): {
  fingerprint: string;
  normalizedDescription: string;
} {
  const normalizedDescription = normalizeDescription(input.rawDescription);
  const fingerprint = generateFingerprint({
    competencyMonth: input.competencyMonth,
    amountMinor: input.amountMinor,
    normalizedDescription,
  });
  return { fingerprint, normalizedDescription };
}
