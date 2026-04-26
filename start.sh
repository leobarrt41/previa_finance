#!/usr/bin/env bash
set -euo pipefail

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Erro: pnpm nao encontrado no PATH." >&2
  exit 1
fi

cleanup() {
  echo "\nParando API e WEB..."
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

pnpm --filter @previa/api dev &
API_PID=$!

pnpm --filter previa-finance dev &
WEB_PID=$!

wait -n "$API_PID" "$WEB_PID"
