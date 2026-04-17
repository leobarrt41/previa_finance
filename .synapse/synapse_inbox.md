# Caixa de entrada Synapse — Previa Finance

Este arquivo é o inbox oficial do Synapse para o repositório Previa Finance.
Ele existe para manter memória operacional durável e estruturada durante o desenvolvimento.
O objetivo é permitir que ferramentas (ex.: Synapse) e assistentes recuperem eventos, decisões e bugs relevantes diretamente do repositório.

Regras importantes (em português, direto e claro):

- O que é: este arquivo é uma fila durável de notas de projeto (insights, tarefas, decisões, bugs, etc.).
- Por que existe: para preservar histórico observável do desenvolvimento e fornecer contexto persistente para agentes e integrações automáticas.
- Como usar: novas notas devem SEMPRE ser acrescentadas ao final do arquivo — nunca reescrever ou remover notas anteriores.
- Cada nota deve incluir data e hora (formato YYYY-MM-DD HH:mm) e um ID único.
- As notas só podem usar as categorias permitidas (ver seção "Categorias permitidas" abaixo).
- Bugs devem conter descrição do problema, causa provável/raiz e a solução aplicada quando disponível.
- Este arquivo foi projetado para sobreviver a reinícios de chat; assistentes humanos e automáticos devem lê-lo antes de continuar trabalho quando o contexto histórico é necessário.
- Se um item gera uma regra técnica ampla, crie também uma nota do tipo "Decisão" ou "Arquitetura" separada.

Como usar (passo a passo):
1. Ao identificar um evento relevante (bug, decisão, tarefa, insight, etc.), abra este arquivo.
2. Adicione uma nova nota AO FINAL usando o formato requerido (veja template abaixo).
3. Nunca apague notas antigas; edições só em casos excepcionais com justificativa e histórico registrado em nova nota.
4. Mantenha as notas objetivas, com fatos e contexto suficiente para entender o que mudou e por quê.
5. Permita que o Synapse importe esse arquivo periodicamente; mantenha-o coerente e append-only.

Categorias permitidas
- Insight
- Tarefa
- Decisão
- Arquitetura
- Bug
- Oportunidade
- Monetização
- Roadmap
- Pesquisa

---

# Template de nota (exemplo)

Use estritamente este formato. Substitua os campos entre colchetes pelo conteúdo real.

## [YYYY-MM-DD HH:mm]

ID: [YYYYMMDD-HHMM-<uniq>]  
SOURCE: previa_finance/copilot  
CATEGORIA: [uma das categorias permitidas]  
TÍTULO: [título curto e específico]  
DESCRIÇÃO: [descrição clara: o que aconteceu, o que foi descoberto, o que mudou. Para BUGs inclua causa provável/raiz e solução aplicada se conhecida]  
TAGS: [tag1,tag2,...]  
PRIORIDADE: [Alta|Média|Baixa]  
STATUS: [Pendente|Em andamento|Concluído]

---

# Exemplo preenchido

## 2026-04-12 14:30

ID: 20260412-1430-001  
SOURCE: previa_finance/copilot  
CATEGORIA: Tarefa  
TÍTULO: Adicionar tabela `categories` ao pacote db  
DESCRIÇÃO: Implementada a tabela `categories` no módulo `@previa/db` com suporte a hierarquia (parent_id), índices e escopo por `external_owner_id`. Não há referência direta a `users`.  
TAGS: categories,db,drizzle  
PRIORIDADE: Alta  
STATUS: Concluído

---

# Boas práticas rápidas
- Gere IDs estáveis (ex.: `YYYYMMDD-HHMM-###` ou UUID) para rastreabilidade.
- Use slugs consistentes quando mencionar recursos (ex.: `transporte`, `alimentacao`).
- Para bugs, sempre anexe passos para reproduzir quando possível.
- Para decisões/arquitetura, inclua referência ao ticket/PR se existir.

---

Observação final: este arquivo é a fonte de verdade para notas do Synapse dentro deste repositório — mantenha-o append-only, factual e legível por humanos e por ferramentas.

## [2026-04-12 17:40]

ID: 20260412-1740-001  
SOURCE: previa_finance/copilot  
CATEGORIA: Bug  
TÍTULO: Criação acidental da tabela `users` dentro de `@previa/db`  
DESCRIÇÃO: Foi adicionada por engano uma definição de tabela `users` (TS + migration `v4/0004_users.sql`) dentro do pacote `packages/db`, contrariando a arquitetura que define `users` como responsabilidade do módulo de autenticação. Causa provável: desenvolvimento inicial da feature de identidade sem alinhar com o domínio de autenticação. Solução aplicada: arquivos relacionados (`packages/db/src/users.ts`, `packages/db/src/schema/users.ts`, `packages/db/migrations/v4/0004_users.sql`) foram removidos; exports adicionais e enums foram revertidos; placeholders temporários também removidos para evitar arquivos-fantasma. Comentários `// @external-fk: users.id` foram mantidos nas tabelas do domínio.  
TAGS: users,bug,cleanup,architecture  
PRIORIDADE: Alta  
STATUS: Concluído

---

## [2026-04-12 17:41]

ID: 20260412-1741-002  
SOURCE: previa_finance/copilot  
CATEGORIA: Decisão  
TÍTULO: `users` permanece externo; `categories` pertence ao domínio financeiro  
DESCRIÇÃO: Decidido e aplicado: o pacote `@previa/db` NÃO deve possuir tabela `users`. A responsabilidade do armazenamento de identidade fica para o módulo de autenticação (ex.: `@previa/auth`). Em contrapartida, a modelagem de `categories` (hierárquica, com escopo por `external_owner_id`) foi implementada dentro de `@previa/db` porque pertence ao domínio financeiro. Não foram adicionadas FKs para `users` — apenas referências externas (nullable) quando necessário.  
TAGS: architecture,decision,users,categories  
PRIORIDADE: Alta  
STATUS: Concluído

---

## [2026-04-12 17:42]

ID: 20260412-1742-003  
SOURCE: previa_finance/copilot  
CATEGORIA: Tarefa  
TÍTULO: Adicionar schema `categories` e seed de categorias sistêmicas  
DESCRIÇÃO: Implementado `packages/db/src/schema/categories.ts` com suporte a hierarquia via `parent_id`, escopo opcional por `external_owner_id`, índices (parent_id, type, external_owner_id, slug) e índice único prático em (external_owner_id, slug). Também adicionado script de seed em `packages/db/scripts/seedCategories.ts` que insere as categorias sistêmicas (Transporte, Alimentação, Moradia) e seus filhos com IDs estáveis baseados em slugs. O seed usa `INSERT ... ON DUPLICATE KEY UPDATE` para idempotência e não depende de tabela `users`.  
TAGS: categories,db,drizzle,seed  
PRIORIDADE: Alta  
STATUS: Concluído

---

## [2026-04-12 17:43]

ID: 20260412-1743-004  
SOURCE: previa_finance/copilot  
CATEGORIA: Insight  
TÍTULO: Caveat de unicidade com NULL em MySQL para `external_owner_id`  
DESCRIÇÃO: A estratégia atual aplica um índice único em (`external_owner_id`, `slug`) para evitar duplicatas por dono. Em MySQL, índices únicos permitem múltiplos `NULL`, então isso NÃO previne duplicates entre categorias `isSystem` (com `external_owner_id = NULL`). Recomendações: (1) validar unicidade de system slugs na aplicação durante seed, ou (2) adotar um sentinel (`'SYSTEM'`) como `external_owner_id` para categorias do sistema, ou (3) adicionar coluna gerada/coalesce e índice único sobre essa coluna + slug. Escolhi manter a abordagem simples e documentada no schema; aplicação/lógica de seed deve garantir unicidade inicial.  
TAGS: db,mysql,uniqueness,design  
PRIORIDADE: Média  
STATUS: Pendente

---

## [2026-04-12 17:44]

ID: 20260412-1744-005  
SOURCE: previa_finance/copilot  
CATEGORIA: Tarefa  
TÍTULO: Validar build e typecheck após mudanças no schema  
DESCRIÇÃO: Executados `pnpm --filter @previa/db run typecheck` e `pnpm --filter @previa/db run build` após as alterações (remoção de artefatos de users, adição de categories e seed). Resultado: TypeScript `tsc` executou e compilação completou sem erros relatados na sessão.  
TAGS: ci,build,typecheck  
PRIORIDADE: Alta  
STATUS: Concluído

---

## [2026-04-12 16:51]

ID: 20260412165102-996
SOURCE: previa_finance/copilot
CATEGORIA: Bug
TÍTULO: Fixed production bug in sync worker causing duplicate inserts
DESCRIÇÃO: Fixed production bug in sync worker causing duplicate inserts
TAGS: bug
PRIORIDADE: Alta
STATUS: Concluído

---

## [2026-04-12 16:54]

ID: 20260412165457-11127
SOURCE: previa_finance/copilot
CATEGORIA: Monetização
TÍTULO: Investigate pricing model and potential new premium plan; run experiments
DESCRIÇÃO: Investigate pricing model and potential new premium plan; run experiments
TAGS: ci
PRIORIDADE: Média
STATUS: Pendente

---

## [2026-04-12 18:19]

ID: 20260412181900-25137
SOURCE: previa_finance/copilot
CATEGORIA: Insight
TÍTULO: Nota
DESCRIÇÃO: 2026-04-12
TAGS: 
PRIORIDADE: Média
STATUS: Pendente

---

## [2026-04-12 18:19]

ID: 20260412181917-24359
SOURCE: previa_finance/copilot
CATEGORIA: Arquitetura
TÍTULO: Refactor categories schema to coalesce external_owner_id and document uniqueness
DESCRIÇÃO: Refactor categories schema to coalesce external_owner_id and document uniqueness
TAGS: categories
PRIORIDADE: Média
STATUS: Pendente

---

## [2026-04-12 19:59]

ID: 20260412195936-26374
SOURCE: previa_finance/copilot
CATEGORIA: Insight
TÍTULO: Implemented CashFlowEngine initial version with 6 tests passing
DESCRIÇÃO: Implemented CashFlowEngine initial version with 6 tests passing
TAGS: 
PRIORIDADE: Média
STATUS: Concluído


## [2026-04-17 10:00]

ID: 20260417-1000-001  
SOURCE: previa_finance/copilot  
CATEGORIA: Tarefa  
TÍTULO: Implementar CashFlowEngine em `packages/core`  
DESCRIÇÃO: Revisar e finalizar a implementação do `CashFlowEngine` em `packages/core/src/cashflow/CashFlowEngine.ts`. Garantir consistência com as interfaces em `packages/core/src/cashflow/types.ts`, ajustar/acomodar os testes existentes em `packages/core/src/cashflow/__tests__/*` e adicionar casos faltantes (entradas/saídas, períodos, agrupamentos, valores zero/negativos). Validar que `pnpm --filter @previa/core test` e `pnpm -w test` rodem com sucesso e que `tsc` passe sem erros.  
TAGS: cashflow,core,tests  
PRIORIDADE: Alta  
STATUS: Pendente


## [2026-04-17 10:01]

ID: 20260417-1001-002  
SOURCE: previa_finance/copilot  
CATEGORIA: Tarefa  
TÍTULO: Reorganizar estrutura de `packages` (mover domain-specific)  
DESCRIÇÃO: Planejar e executar a reorganização de packages domain-specific para `packages/domains/*` (ex.: mover `packages/db` para `packages/domains/db`) e organizar libs em `packages/libs/*` conforme aplicável. Incluir inventário de pacotes, mapa de dependências cruzadas, atualização de `workspaces` no `package.json` raiz, ajustes em `tsconfig.json` `paths`/aliases, e checklist de PR com validações (build, typecheck, tests). Priorizar migração incremental e PRs pequenos para reduzir risco.  
TAGS: reorg,packages,monorepo  
PRIORIDADE: Alta  
STATUS: Pendente


## [2026-04-17 10:32]

ID: 20260417-1032-003
SOURCE: previa_finance/copilot
CATEGORIA: Arquitetura
TÍTULO: Atualizar workspaces para suportar `packages/domains/*` e `packages/libs/*`
DESCRIÇÃO: Atualizado o `package.json` raiz para incluir explicitamente os workspaces `packages/domains/*` e `packages/libs/*`. Essa mudança permite mover pacotes para `packages/domains/*` sem que saiam do conjunto de workspaces do monorepo. A modificação foi commitada e pushada no branch `feat/db-redesign`. Não houve alterações de código além do `package.json` raiz e desta nota de registro.  
TAGS: workspaces,monorepo,architecture
PRIORIDADE: Alta
STATUS: Concluído


## [2026-04-17 22:13]

ID: 20260417-2213-004
SOURCE: previa_finance/copilot
CATEGORIA: Operação
TÍTULO: Registrar branch padrão para notas Synapse
DESCRIÇÃO: Decidido e aplicado: a branch local atual `feat/db-redesign` será utilizada como destino para commits de notas no arquivo `.synapse/synapse_inbox.md`. As próximas notas serão commitadas e pushadas para esta branch por padrão, a menos que indicado o contrário. Esta nota serve como registro da decisão operacional e do branch associado.  
TAGS: synapse,branches,process
PRIORIDADE: Média
STATUS: Concluído


---
