# @previa/core

Core domain utilities for Previa Finance.

Includes the CashFlow engine, fingerprint utilities and shared types.

Quick start (cashflow example):

```ts
import { CashFlowEngine } from './src/cashflow/CashFlowEngine'

const engine = new CashFlowEngine()
// TODO: configure engine with transactions and run `project()`
```

See `packages/core/src/cashflow` for engine implementation and tests.
