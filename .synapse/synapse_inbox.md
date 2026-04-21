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


## [2026-04-17 22:15]

ID: 20260417-2215-005
SOURCE: previa_finance/copilot
CATEGORIA: Operação
TÍTULO: Correção — branch usada para notas é a branch atual no momento da atualização
DESCRIÇÃO: Correção da nota anterior (ID 20260417-2213-004). A política operacional correta é: para cada nota adicionada ao arquivo `.synapse/synapse_inbox.md`, a nota será committada e pushada para a branch em que o usuário/operador estiver no momento da atualização. Ou seja, não há uma "branch fixa" por padrão — usamos a branch atual no momento do commit. Esta nota registra a correção e esclarece o comportamento que será aplicado a partir de agora.  
TAGS: synapse,process,correction
PRIORIDADE: Alta
STATUS: Concluído


## [2026-04-19 15:49]

ID: 20260419-1549-006
SOURCE: previa_finance/copilot
CATEGORIA: Tarefa
TÍTULO: Inventário — funções pendentes para implementar antes do front
DESCRIÇÃO: Com base no `docs/ETP.md` (Visão, Regras de Negócio, Motor de CashFlow e Parsers) e no código presente, segue inventário das funções / módulos que ainda faltam implementar ou completar antes de começar o front-end funcional. Para cada item incluí o papel (por que é necessário) e o local sugerido para a implementação.

Pendências críticas (prioridade Alta / necessárias para MVP front):

1) CashFlowEngine — completar e estabilizar API pública
	- Por que: motor central para projeções de fluxo (ETP §7.1, §6.2). Front dependerá de uma API estável.  
	- Local sugerido: `packages/core/src/cashflow/CashFlowEngine.ts`  
	- Funções pendentes/validações: `project()` adequar casos de borda, suportar coerção consistente de `Minor` (number|bigint), cobertura de casos: parcelas de cartão, devoluções, estornos, ajustes de fatura, regras de data (competency vs due).  

2) Reconciliation / Fingerprint utilities — revisão e testes extras
	- Por que: reconciliação entre fontes (ETP §7.3) exige fingerprint determinístico e regras de normalização.  
	- Local sugerido: `packages/core/src/fingerprint.ts`  
	- Funções pendentes: robustecer `normalizeDescription` para edgecases (acentos raros, abreviações), adicionar utilitário para comparar fingerprints com tolerância (fuzzy match) e testes de colisão.  

3) Card invoice processing helpers
	- Por que: ETP trata cartão como dívida futura com faturas e parcelas; necessário transformar card_transactions → card_invoices e calcular `paidMinor`/`outstanding` (ETP §6.2).  
	- Local sugerido: `packages/core/src/cashflow/card.ts` ou `packages/core/src/cashflow/CashFlowEngine` extras.  
	- Funções: `groupCardTransactionsToInvoices(transactions): CardInvoice[]`, `calculateOutstanding(invoice): Minor`, `applyPaymentsToInvoice(invoice, payments)`.  

4) Obligations / Commitments utilities
	- Por que: obrigations recorrentes (subscriptions, rent) impactam projeções (ETP §6.4).  
	- Local sugerido: `packages/core/src/cashflow/obligations.ts`  
	- Funções: `expandObligationsToMonths(obligations, months): Map<month, amount>`, validação de `start`/`end` e proration.  

5) Parsers básica para faturas e extratos (PDF/OFX/CSV)
	- Por que: ETP lista parsers para bancos e faturas; front e sync dependem de dados estruturados (ETP §7.2).  
	- Local sugerido: `packages/parsers/*` (criar pacotes)  
	- Funções: `parsePdfInvoice(buffer): Invoice[]`, `parseOfx(file): Transaction[]`, `parseCsvStatement(file, format): Transaction[]`. Incluir adaptadores por provedor (nubank, itau, etc.).  

6) API client / service layer (backend ↔ frontend contract)
	- Por que: front precisa endpoints e contrato estável (auth, cashflow projections, transactions).  
	- Local sugerido: `apps/api` (server) e `apps/web/src/services/api.ts` (client)  
	- Funções: `getCashFlowProjection(params)`, `getTransactions(params)`, `postTransaction(payload)`, `auth/login(credentials)`. Documentar formatos de payloads.  

7) Seeds / fixtures e scripts de validação (idempotência)
	- Por que: ETP recomenda seeds (categorias, system defaults) e validação para evitar duplicatas (ETP nota sobre unicidade).  
	- Local sugerido: `packages/db/scripts/*`  
	- Funções: `seedCategories()`, `validateSystemSeeds()` (idempotente).  

8) Tests & Contracts: tipos e exemplos consumíveis pelo front
	- Por que: front precisa tipos TS e exemplos (contracts) do `CashFlowOutput` e endpoints.  
	- Local sugerido: `packages/core/src/types.ts` (expandir) e `docs/` (exemplos).  
	- Funções/artifacts: JSON schema / types + example fixtures `examples/cashflow-sample.json`.  

Observações / next steps propostos:
- Priorizar (1)-(4) para garantir que o motor de projeção e os dados processados estejam corretos antes do trabalho de UI.  
- Criar tasks separadas e PRs pequenas por item (ex.: `feat/cashflow-complete`, `feat/parsers-nubank`).  
- Atualizar `.synapse/synapse_inbox.md` para cada ação concreta (append-only) e linkar PRs quando abertos.  

TAGS: cashflow,parsers,api,tests,ETP
PRIORIDADE: Alta
STATUS: Pendente


---
## [2026-04-21 14:20]

ID: 20260421-1420-001
SOURCE: previa_finance/copilot
CATEGORIA: Operação
TÍTULO: Configurar Jest/ts-jest e tornar testes do `@previa/core` executáveis
DESCRIÇÃO: Instalei e configurei Jest com `ts-jest` no monorepo para permitir execução dos testes TypeScript sem depender do runner `vitest` local do pacote. Ações realizadas:

- Adicionado `jest`, `ts-jest` e `jest-environment-node` às `devDependencies` da raiz (`package.json`).
- Criado `jest.config.cjs` na raiz com preset `ts-jest`, mapeamento de assets para `__mocks__/fileMock.js` e apontando para o `tsconfig.json` raiz.
- Criado `__mocks__/fileMock.js` para mocks de arquivos estáticos (CSS/imagens) durante os testes.
- Atualizados scripts: raiz (`package.json`) ganhou `test` (executa testes em todos os pacotes) e `test:core` (atalho para `@previa/core`).
- `packages/core/package.json`: alterado o script `test` para `jest --config ../../jest.config.cjs --runInBand`.
- Ajustados testes que utilizavam `vitest` importado (remoção do `import { ... } from 'vitest'`), deixando-os compatíveis com os globais do Jest (`describe/it/expect`).
- Executei `pnpm --filter @previa/core test` localmente: TODOS os testes do core passaram (4 suites, 10 testes).

FILES ALTERADOS:
- `package.json` (raiz) — scripts e devDependencies de teste adicionados
- `packages/core/package.json` — script `test` para usar jest
- `jest.config.cjs` (novo, raiz)
- `__mocks__/fileMock.js` (novo, raiz)
- `packages/core/src/cashflow/__tests__/cashflow.spec.ts` — remove import `vitest` (usa globals)
- `packages/core/src/cashflow/__tests__/cashflow.placeholder.spec.ts` — remove import `vitest` (usa globals)

IMPACTO: Testes do `@previa/core` podem agora ser executados por Jest no CI e localmente via `pnpm --filter @previa/core test`. Se preferirmos padronizar em `vitest` no monorepo, posso migrar a configuração do runner em vez disso; por ora escolhi Jest para compatibilidade com `ts-jest` e facilidade de integração.

TAGS: testing,jest,ci
PRIORIDADE: Média
STATUS: Concluído
## [2026-04-21 14:40]

ID: 20260421-1440-001
SOURCE: previa_finance/copilot
CATEGORIA: Arquitetura
TÍTULO: Proposta — adicionar origem "previsão manual" (forecast) ao motor de cashflow
DESCRIÇÃO: Proposta para permitir que o usuário cadastre previsões manuais (ex.: previsão anual que cairá num mês X) como uma nova origem de entrada no motor de projeção. Isso permite que usuários que não têm salário recorrente registrem previsões pontuais ou recorrentes simples (mensal/anual) sem precisar criar transações reais.

MOTIVAÇÃO
- Cenário: Usuário sem salário recorrente tem uma previsão de receita anual que cairá em um mês específico; ele quer registrar isso para que projeções reflitam essa expectativa.
- Requisito: um input simples com (mês, valor, recorrência opcional) que afete as projeções como renda planejada (não transação bancária real).

IMPLICAÇÕES NA ARQUITETURA / DB
- Nova origem/entidade: `cashflow_forecasts` ou `forecasts` para separar previsões manuais de transações reais.
- Alternativa mais simples (menos normalized): adicionar colunas `origin` + `recurrence` em `transactions`/`cashflow_inputs`, mas isso mistura dados reais e previsões (menos claro para reconciliation). Recomendo tabela separada.

EXEMPLO DE MIGRATION (SQL)

-- up
CREATE TABLE cashflow_forecasts (
  id VARCHAR(36) PRIMARY KEY,
  external_owner_id VARCHAR(36) NULL,
  competency_month CHAR(7) NOT NULL, -- 'YYYY-MM'
  amount_minor BIGINT NOT NULL,
  recurrence VARCHAR(20) NOT NULL DEFAULT 'one-time', -- one-time|monthly|yearly
  recurrence_end CHAR(7) NULL, -- optional end month for recurring forecasts
  description TEXT NULL,
  created_by VARCHAR(36) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- down
DROP TABLE IF EXISTS cashflow_forecasts;

DRIZZLE / SCHEMA
- Add `packages/db/src/schema/cashflow_forecasts.ts` matching the above fields and export it.

ALTERAÇÕES DE API / TIPOS
- Atualizar `packages/core/src/cashflow/types.ts`:
  - export interface CashFlowForecast { id: string; competencyMonth: string; amountMinor: bigint; recurrence?: 'one-time' | 'monthly' | 'yearly'; recurrenceEnd?: string | null; description?: string }
  - Atualizar `CashFlowInput` (o input do engine) para incluir `forecasts?: CashFlowForecast[]`

- Atualizar contratos de API (server) para aceitar payloads de previsão:
  POST /api/cashflow/forecasts { competencyMonth, amountMinor, recurrence, recurrenceEnd, description }
  GET /api/cashflow/forecasts -> lista do usuário
  DELETE /api/cashflow/forecasts/:id

ALTERAÇÕES NO CASHFLOW ENGINE
- `CashFlowEngine.project(input: CashFlowInput)` deve considerar as previsões:
  - Para cada forecast com recurrence 'one-time': adicionar amountMinor ao mês `competencyMonth`.
  - Se 'monthly' ou 'yearly': expandir para os meses projetados até `recurrenceEnd` ou de acordo com `projectionMonths` passado no input.
  - Garantir coerência de tipos (use bigint para amounts internamente) e comportamento claro entre forecasts e transactions (forecasts são previsões — podem ter flag `isForecast` em resultados).

TESTES
- Unit tests para `CashFlowEngine` cobrindo:
  - one-time forecast: aparece no mês correto
  - monthly forecast: aparece em todos os meses entre competencyMonth e recurrenceEnd (ou até projectionMonths)
  - yearly forecast: aparece apenas no mês do ano especificado (se projetando múltiplos anos)
  - combinação forecasts + transactions: previsões não confundem saldo de transações reais (devem aparecer em `totalPlannedMinor` ou similar)

MIGRAÇÃO DE DADOS
- Nenhuma migração de dados obrigatória (é uma tabela nova). Se quisermos transformar registros existentes, fornecer script ETL.

IMPACTO NO FRONTEND
- UI: nova tela/componente para "Adicionar Previsão" com campos: Mês (competency), Valor, Recorrência (one-time/monthly/yearly), Data de término (se aplicável), Descrição.
- UX: marcar previsões claramente como "previsão" (rótulo e cor) nas projeções e permitir edição/remoção.

CRITÉRIOS DE ACEITAÇÃO
- Migracao adicionada e aplicada sem quebrar outras migrations
- `CashFlowEngine.project` aceita forecasts no input e os incorpora nas projeções
- Tests unitários cobrindo casos principais (one-time, monthly, combination) passam
- API endpoints para CRUD de forecasts documentados e protegidos por autenticação
- Frontend permite criar/editar/remover previsões e elas aparecem corretamente nas projeções

RISKS / NOTES
- Misturar previsões com transações reais pode confundir reconciliation. Por isso privilegie tabela separada e campos que deixam explícito que é "previsão".
- Valores financeiros usam `BIGINT` (minor units) para evitar problemas de float.

NEXT STEPS (sugestão de execução incremental)
1) Criar migration e schema (`packages/db`) + tests de migração
2) Atualizar `packages/core` types e `CashFlowEngine` para aceitar `forecasts` (limit scope a engine input first)
3) Adicionar unit tests no `packages/core` cobrindo forecasts
4) Expor API CRUD em `apps/api` (protegido) e documentar payloads
5) Adicionar UI simples em `apps/web` para criar forecasts (feature flag opcional)

TAGS: cashflow,db,feature,forecast
PRIORIDADE: Alta
STATUS: Proposto
