#!/usr/bin/env bash
set -euo pipefail

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Erro: pnpm nao encontrado no PATH." >&2
  exit 1
fi

find_listening_pids() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
    return
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -lptn "sport = :$port" 2>/dev/null \
      | awk -F'pid=' 'NR>1 && NF>1 { split($2, a, ","); print a[1] }' \
      | sort -u || true
  fi
}

stop_port_if_busy() {
  local port="$1"
  local label="$2"

  mapfile -t pids < <(find_listening_pids "$port")
  if (( ${#pids[@]} == 0 )); then
    return
  fi

  echo "$label ja esta em execucao na porta $port (PID: ${pids[*]}). Encerrando processo antigo..."
  kill "${pids[@]}" 2>/dev/null || true
}

cleanup() {
  if [[ "${CLEANED_UP:-0}" == "1" ]]; then
    return
  fi
  CLEANED_UP=1

  echo "Parando API e WEB..."
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}

start_services() {
  pnpm --filter @previa/core build
  pnpm --filter @previa/db build
  pnpm --filter @previa/parser-bb build
  pnpm --filter @previa/parser-bradesco build
  pnpm --filter @previa/parser-itau build

  pnpm --filter @previa/api dev &
  API_PID=$!

  pnpm --filter previa-finance dev &
  WEB_PID=$!
}

trap cleanup INT TERM EXIT

while true; do
  CLEANED_UP=0
  API_PID=""
  WEB_PID=""

  stop_port_if_busy 3001 "API"
  stop_port_if_busy 5173 "WEB"

  echo "Subindo API e WEB..."
  start_services

  set +e
  wait -n "$API_PID" "$WEB_PID"
  EXIT_CODE=$?
  set -e

  echo "Um dos processos caiu (codigo $EXIT_CODE). Reiniciando os dois em 2s..."
  cleanup
  sleep 2
done
