#!/usr/bin/env bash
set -euo pipefail

INBOX_FILE=".synapse/synapse_inbox.md"
mkdir -p "$(dirname "$INBOX_FILE")"

usage() {
  cat <<EOF
Usage: ./appendSynapseNote.sh [-T <TITULO>] [-d <DESCRIÇÃO|->] [-g <TAGS>] [-p <PRIORIDADE>] [-s <STATUS>] [-o <SOURCE>]

Behavior:
  The script will prompt: "What happened?" when no description (-d) is provided.
  It will infer the best Synapse category, title, tags, priority and status from the description.

Options:
  -T TITULO      Optional override for inferred title
  -d DESCRIÇÃO   Description text. Use '-' to read from stdin (multi-line). If omitted the script will prompt interactively.
  -g TAGS        Comma-separated tags (optional, merged with inferred tags)
  -p PRIORIDADE  Optional override: Alta|Média|Baixa
  -s STATUS      Optional override: Pendente|Em andamento|Concluído
  -o SOURCE      SOURCE string (default: previa_finance/copilot)
  -h             Show this help

Examples:
  ./appendSynapseNote.sh
  ./appendSynapseNote.sh -d "Fixed production bug in sync worker"
  echo "Multi-line description" | ./appendSynapseNote.sh -d -
EOF
}

# Defaults (many fields will be inferred)
TAGS=""
PRIORITY=""
STATUS=""
SOURCE="previa_finance/copilot"
DESCRIPTION=""
TITLE=""

# parse options (category is inferred automatically)
while getopts ":T:d:g:p:s:o:h" opt; do
  case $opt in
    T) TITLE="$OPTARG" ;;
    d) DESCRIPTION="$OPTARG" ;;
    g) TAGS="$OPTARG" ;;
    p) PRIORITY="$OPTARG" ;;
    s) STATUS="$OPTARG" ;;
    o) SOURCE="$OPTARG" ;;
    h) usage; exit 0 ;;
    \?) echo "Invalid option: -$OPTARG" >&2; usage; exit 1 ;;
    :) echo "Option -$OPTARG requires an argument." >&2; usage; exit 1 ;;
  esac
done

# Read description from stdin if '-' provided
if [ "$DESCRIPTION" = "-" ]; then
  DESCRIPTION="$(cat -)"
fi

# If no description provided, prompt the user per new workflow
if [ -z "$DESCRIPTION" ]; then
  echo "What happened? (finish input with Ctrl+D)"
  DESCRIPTION="$(cat -)"
fi

# Trim description
DESCRIPTION="$(echo "$DESCRIPTION" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

# Inference rules: decide category, title, tags, priority, status from description
lowerDesc="$(echo "$DESCRIPTION" | tr '[:upper:]' '[:lower:]')"

# Category inference (ordered, prefer precise)
CATEGORY="Insight"
if echo "$lowerDesc" | grep -Eiq "\b(bug|error|fail|failed|exception|crash|regression|fix)\b"; then
  CATEGORY="Bug"
elif echo "$lowerDesc" | grep -Eiq "\b(archit|architecture|schema|migration|database|db|refactor|design|fk|foreign key)\b"; then
  CATEGORY="Arquitetura"
elif echo "$lowerDesc" | grep -Eiq "\b(decid|decision|decidido|decidir|we will|we'll|choose|adopt)\b"; then
  CATEGORY="Decisão"
elif echo "$lowerDesc" | grep -Eiq "\b(pricing|price|revenue|billing|stripe|subscription|plan|premium|monetiz)\b"; then
  CATEGORY="Monetização"
elif echo "$lowerDesc" | grep -Eiq "\b(opportunit|opportunidade|lead|growth|market)\b"; then
  CATEGORY="Oportunidade"
elif echo "$lowerDesc" | grep -Eiq "\b(roadmap|plan\b|milestone|backlog|next|quarter|q1|q2)\b"; then
  CATEGORY="Roadmap"
elif echo "$lowerDesc" | grep -Eiq "\b(research|investigate|validate|experiment|hypothesis|study)\b"; then
  CATEGORY="Pesquisa"
elif echo "$lowerDesc" | grep -Eiq "\b(todo|task|implement|add|create|setup|build|deploy|improve|action item|fix)\b"; then
  CATEGORY="Tarefa"
fi

# Title inference: first line or first sentence, truncated
if [ -z "$TITLE" ]; then
  firstLine="$(echo "$DESCRIPTION" | head -n1)"
  titleCandidate="$(echo "$firstLine" | awk -F'.' '{print $1}')"
  TITLE="$(echo "$titleCandidate" | sed -E 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [ -z "$TITLE" ]; then
    TITLE="$(echo "$DESCRIPTION" | tr '\n' ' ' | awk '{for(i=1;i<=6 && i<=NF;i++) printf $i" "; print ""}')"
  fi
  TITLE="$(echo "$TITLE" | cut -c1-80)"
fi

# Tags inference: simple keyword scanning
inferredTags=()
for kw in git commit categories db drizzle seed migration auth users bug architecture decision ci build typecheck stripe payment seed performance ux api; do
  if echo "$lowerDesc" | grep -q "$kw"; then
    inferredTags+=("$kw")
  fi
done
if [ -n "$TAGS" ]; then
  IFS=',' read -r -a userTags <<< "$TAGS"
  for t in "${userTags[@]}"; do
    tTrim="$(echo "$t" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    inferredTags+=("$tTrim")
  done
fi
# dedupe
tagsUnique="$(printf "%s\n" "${inferredTags[@]}" | awk '!seen[$0]++' | paste -sd, -)"

# Priority inference
if [ -z "$PRIORITY" ]; then
  if echo "$lowerDesc" | grep -Eiq "\b(urgent|critical|blocker|production|prod|alta|high)\b"; then
    PRIORITY="Alta"
  elif echo "$lowerDesc" | grep -Eiq "\b(low|minor|cosmetic|baixa)\b"; then
    PRIORITY="Baixa"
  else
    PRIORITY="Média"
  fi
fi

# Status inference
if [ -z "$STATUS" ]; then
  if echo "$lowerDesc" | grep -Eiq "\b(fixed|fixed:|resolved|done|implemented|applied|completed)\b"; then
    STATUS="Concluído"
  elif echo "$lowerDesc" | grep -Eiq "\b(in progress|in-progress|wip|ongoing|started|implementing)\b"; then
    STATUS="Em andamento"
  else
    STATUS="Pendente"
  fi
fi

# Show inferred summary to stdout
echo "Inferred CATEGORY: $CATEGORY"
echo "Inferred TITLE: $TITLE"
echo "Inferred TAGS: $tagsUnique"
echo "Inferred PRIORITY: $PRIORITY"
echo "Inferred STATUS: $STATUS"

# Timestamps and ID
NOW="$(date '+%F %R')"
ID="$(date +%Y%m%d%H%M%S)-$RANDOM"

# Ensure file exists and has header (if not, create minimal header to be safe)
if [ ! -f "$INBOX_FILE" ]; then
  cat > "$INBOX_FILE" <<'EOF'
# Synapse inbox

(Arquivo criado automaticamente)

EOF
fi

# Append note
cat >> "$INBOX_FILE" <<EOF

## [$NOW]

ID: $ID
SOURCE: $SOURCE
CATEGORIA: $CATEGORY
TÍTULO: $TITLE
DESCRIÇÃO: ${DESCRIPTION}
TAGS: ${tagsUnique}
PRIORIDADE: ${PRIORITY}
STATUS: ${STATUS}

---
EOF

echo "Appended note $ID to $INBOX_FILE"
