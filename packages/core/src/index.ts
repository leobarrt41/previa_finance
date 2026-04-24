/**
 * index.ts — @previa/core public API
 *
 * Single entry point for all core business logic exports.
 * Consumers should import from "@previa/core" and never from internal paths.
 *
 * Usage:
 *   import { generateFingerprint, buildFingerprintFromRaw, normalizeDescription } from "@previa/core"
 *   import { BudgetEngine, ImpactCalculator } from "@previa/core"
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

// Cashflow engine exports
export {
  CashFlowEngine,
} from "./cashflow";

export type {
  CashFlowInput,
  CashFlowOutput,
  MonthlyCashFlow,
} from "./cashflow";

// Budget analysis exports - NEW for photo-to-analysis feature
export {
  BudgetEngine,
  ImpactCalculator,
} from "./budget";

export type {
  CategoryBudget,
  CategorySpending,
  BudgetAnalysis,
  BudgetStatus,
  BudgetImpact,
  TransactionImpact,
  TransactionAnalysisInput,
  SpendingPattern,
  BudgetStatusType,
  BudgetPeriod,
} from "./budget";
