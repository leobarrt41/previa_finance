#!/usr/bin/env bash
set -euo pipefail

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Erro: pnpm nao encontrado no PATH." >&2
  exit 1
fi

if [[ -d ".venv/bin" ]]; then
  export PATH="$PWD/.venv/bin:$PATH"
  export PREVIA_PYTHON="$PWD/.venv/bin/python3"
else
  export PREVIA_PYTHON="$(command -v python3)"
fi

if ! python3 -c "import pdfplumber" >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Erro: pdfplumber nao esta disponivel para o python3 do ambiente atual.
Crie a venv local e instale as dependencias antes de rodar o start.sh:

  python3 -m venv .venv
  source .venv/bin/activate
  pip install pdfplumber pikepdf

EOF
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

wait_for_port_free() {
  local port="$1"
  local attempts="${2:-40}"
  local delay="${3:-0.25}"

  local i=0
  while (( i < attempts )); do
    mapfile -t remaining < <(find_listening_pids "$port")
    if (( ${#remaining[@]} == 0 )); then
      return 0
    fi
    sleep "$delay"
    i=$((i + 1))
  done

  return 1
}

stop_port_if_busy() {
  local port="$1"
  local label="$2"

  mapfile -t pids < <(find_listening_pids "$port")
  if (( ${#pids[@]} == 0 )); then
    return
  fi

  echo "$label ja esta em execucao na porta $port (PID: ${pids[*]}). Encerrando processo antigo..."
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  fi
  for pid in "${pids[@]}"; do
    kill_process_group "$pid"
  done

  if wait_for_port_free "$port" 40 0.25; then
    return
  fi

  if command -v fuser >/dev/null 2>&1; then
    echo "$label ainda ocupava a porta $port. Forcando encerramento..."
    fuser -k -KILL "${port}/tcp" 2>/dev/null || true
  fi

  if ! wait_for_port_free "$port" 40 0.25; then
    echo "Erro: nao foi possivel liberar a porta $port para $label." >&2
    exit 1
  fi
}

kill_process_group() {
  local pid="$1"
  if [[ -z "$pid" ]]; then
    return
  fi

  local pgid=""
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
  if [[ -n "$pgid" ]]; then
    kill -- "-$pgid" 2>/dev/null || true
    sleep 0.5
    kill -9 -- "-$pgid" 2>/dev/null || true
    return
  fi

  kill "$pid" 2>/dev/null || true
  sleep 0.5
  kill -9 "$pid" 2>/dev/null || true
}

cleanup() {
  if [[ "${CLEANED_UP:-0}" == "1" ]]; then
    return
  fi
  CLEANED_UP=1

  echo "Parando API e WEB..."
  [[ -n "${API_PID:-}" ]] && kill_process_group "$API_PID"
  [[ -n "${WEB_PID:-}" ]] && kill_process_group "$WEB_PID"
  wait 2>/dev/null || true
}

start_services() {
  pnpm --filter @previa/core build
  pnpm --filter @previa/db build
  pnpm --filter @previa/parser-bb build
  pnpm --filter @previa/parser-bradesco build
  pnpm --filter @previa/parser-itau build

  set -a
  # The DB runner reads DB_* variables from .env and applies any pending SQL migrations.
  source .env
  set +a
  pnpm --filter @previa/db db:setup

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
