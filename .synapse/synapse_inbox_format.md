# Formato do Synapse Inbox — Previa Finance

Este documento descreve o formato esperado para notas do Synapse.

## Objetivo

- manter memória operacional durável e estruturada;
- registrar decisões, bugs, tarefas e insights relevantes;
- permitir importação consistente por ferramentas automáticas.

## Regras

- novas notas devem ser acrescentadas ao final do arquivo de inbox;
- notas antigas não devem ser apagadas;
- cada nota deve conter data/hora e um `ID` único;
- apenas categorias permitidas devem ser usadas;
- bugs devem registrar causa provável e solução aplicada quando disponível.

## Categorias permitidas

- Insight
- Tarefa
- Decisão
- Arquitetura
- Bug
- Oportunidade
- Monetização
- Roadmap
- Pesquisa

## Template canônico

Use este formato no arquivo `.synapse/synapse_inbox.md`:

```md
---
## [YYYY-MM-DD HH:mm]

ID: [YYYYMMDD-HHMM-<uniq>]
SOURCE: previa_finance/copilot
CATEGORIA: [uma das categorias permitidas]
TÍTULO: [título curto e específico]
DESCRIÇÃO: [descrição clara do fato, mudança, descoberta ou correção]
TAGS: [tag1,tag2,...]
PRIORIDADE: [Alta|Média|Baixa]
STATUS: [Pendente|Em andamento|Concluido]
```

## Boas práticas

- gere IDs estáveis e rastreáveis;
- use tags curtas e consistentes;
- para bugs, inclua passos de reprodução quando fizer sentido;
- para decisões/arquitetura, inclua contexto suficiente para auditoria futura.
