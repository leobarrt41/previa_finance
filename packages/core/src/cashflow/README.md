# CashFlowEngine — implementation plan and checklist

This folder contains the CashFlow engine and related helpers. Goal of the `feat/cashflow-complete` branch:

- Stabilize the public API of `CashFlowEngine.project()`
- Add unit tests covering typical flows (inflows/outflows, card invoices, installments, refunds)
- Ensure types and exports are consistent with `packages/core/src/cashflow/types.ts`

Skeleton tasks in this branch:

1. Add tests in `__tests__/` covering happy path + edge cases.
2. Add examples in this README showing expected input/output shapes for the frontend contract.
3. Run `pnpm --filter @previa/core test` and fix failing types/tests.

Notes for reviewers:
- This branch intentionally contains placeholders only — implementation will follow in focused commits.
