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

# Title inference: prefer a meaningful short title. Never use the timestamp as title.
# Rule: if user provided -T, keep it. Otherwise attempt, in order:
# 1) first non-empty line (first sentence) that is not date-like
# 2) first 6 words from description
# 3) fallback to a generic 'Nota' (shouldn't happen)

is_date_like() {
  local s="$1"
  # common date/time patterns: YYYY-MM-DD, DD/MM/YYYY, HH:MM, full timestamp
  if echo "$s" | grep -Eiq "^[[:space:]]*[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}"; then
    return 0
  fi
  if echo "$s" | grep -Eiq "^[[:space:]]*[0-9]{1,2}[:][0-9]{2}"; then
    return 0
  fi
  if echo "$s" | grep -Eiq "^[[:space:]]*[0-9]{8,}$"; then
    return 0
  fi
  # if the string contains mostly digits, separators and spaces, treat as date-like
  if echo "$s" | sed 's/[0-9][: \-\/\.]*//g' | grep -q '^$'; then
    return 0
  fi
  return 1
}

if [ -z "$TITLE" ]; then
  # candidate: first line, then first sentence
  firstLine="$(echo "$DESCRIPTION" | sed -n '1p' | sed -e 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  # choose the first sentence from the first line
  titleCandidate="$(echo "$firstLine" | awk -F'[\.\n]' '{print $1}')"
  titleCandidate="$(echo "$titleCandidate" | sed -E 's/^[[:space:]]*//;s/[[:space:]]*$//')"

  if [ -n "$titleCandidate" ] && ! is_date_like "$titleCandidate"; then
    TITLE="$titleCandidate"
  else
    # try to find the first non-date-like line in the description
    TITLE=""
    while IFS= read -r line; do
      lineTrim="$(echo "$line" | sed -e 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      if [ -n "$lineTrim" ] && ! is_date_like "$lineTrim"; then
        # take first sentence from this line
        t="$(echo "$lineTrim" | awk -F'[\.\n]' '{print $1}')"
        TITLE="$(echo "$t" | sed -E 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        break
      fi
    done <<EOF
$DESCRIPTION
EOF

    # if still empty, take first 6 words as fallback (not a timestamp)
    if [ -z "$TITLE" ]; then
      TITLE="$(echo "$DESCRIPTION" | tr '\n' ' ' | awk '{for(i=1;i<=6 && i<=NF;i++) printf $i" "; print ""}')"
      TITLE="$(echo "$TITLE" | sed -E 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    fi
  fi

  # final safety: if title is empty or date-like, use a safe generic label
  if [ -z "$TITLE" ] || is_date_like "$TITLE"; then
    TITLE="Nota"  # minimal fallback (in Portuguese to match file)
  fi

  # truncate to a reasonable length
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
