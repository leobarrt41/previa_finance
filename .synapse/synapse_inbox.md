s tabelas para # Caixa de entrada Synapse — Previa Finance

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

---

## 2026-04-23 15:45

ID: 20260423-1545-frontend-manus  
SOURCE: previa_finance/copilot  
CATEGORIA: Decisão  
TÍTULO: Frontend será gerado pelo Manus  
DESCRIÇÃO: Decisão arquitetural importante - o frontend da aplicação Previa Finance será gerado automaticamente pelo assistente Manus, não desenvolvido manualmente. Isso acelera drasticamente a Phase 2 do roadmap, permitindo focar recursos no backend e integrações. A API já está 100% funcional e pronta para consumo por qualquer frontend.  
TAGS: frontend,manus,automacao,phase2,decisao-arquitetural  
PRIORIDADE: Alta  

## 2026-04-23 15:46

ID: 20260423-1546-auth-clerk  
SOURCE: previa_finance/copilot  
CATEGORIA: Arquitetura  
TÍTULO: Autenticação via Clerk - sem tabela users local  
DESCRIÇÃO: A arquitetura atual usa Clerk para autenticação externa. Não existe tabela 'users' no banco local - o user_id é referência externa ao Clerk. Todas as tabelas do schema usam int("user_id") com comentário @external-fk: users.id para marcar esta dependência externa. JWT do Clerk é validado no middleware da API.  
TAGS: auth,clerk,external-fk,user-id,jwt  
PRIORIDADE: Média  

## 2026-04-23 15:47

ID: 20260423-1547-db-config  
SOURCE: previa_finance/copilot  
CATEGORIA: Insight  
TÍTULO: Configuração DB via variáveis ambiente sem .env  
DESCRIÇÃO: O banco está configurado via env.ts com fallbacks locais: DB_HOST=localhost, DB_USERNAME=root, DB_PASSWORD='', DB_NAME=previa_finance. Não existe arquivo .env no repositório. Para produção, usar DATABASE_URL no drizzle.config.ts ou definir as variáveis específicas (DB_HOST, DB_PORT, etc). MySQL 8+ é requerido.  
TAGS: database,mysql,env-vars,config,localhost  
PRIORIDADE: Média  
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

---

## [2026-05-05 19:24]

ID: 20260505-1924-ocr-debt-state  
SOURCE: previa_finance/copilot  
CATEGORIA: Decisão  
TÍTULO: Consolidado parcial de OCR de notas e semântica dos avaliadores  
DESCRIÇÃO: Até este ponto, o projeto consolidou três frentes principais. 1) Avaliadores: ajustes em `Budget` e `DebtAssessor` para aproximar a leitura ao Fluxo de caixa, separando melhor compras no cartão, despesas fixas/gastos e saldo real. 2) Notas fiscais: o fluxo de `receipt_documents` passou a extrair mais pistas opcionais de cartão via IA/OCR, salvar hints no `rawPayload` e expor essa leitura na interface para inspeção. 3) Reconciliação: a importação de faturas continua reconciliando notas projetadas por valor/merchant/mês, com preparação para usar identidade de cartão quando existir. A leitura de imagem ainda depende fortemente da qualidade do comprovante e continua sendo ponto crítico a validar com casos reais.  
TAGS: assess,receipt_documents,ocr,reconciliation,cashflow  
PRIORIDADE: Alta  
STATUS: Em andamento

---

## [2026-05-05 19:29]

ID: 20260505-1929-modular-roadmap  
SOURCE: previa_finance/copilot  
CATEGORIA: Arquitetura  
TÍTULO: Ordem modular de evolução do domínio financeiro  
DESCRIÇÃO: Definida a ordem modular de trabalho para reduzir regressões e ambiguidade de domínio. Sequência acordada: 1) Extrato/Caixa, 2) Cartão/Fatura, 3) Fluxo de caixa, 4) Notas fiscais/Comprovantes, 5) Recorrências/Projeções, 6) Avaliador de Dívidas, 7) Orçamento, 8) Avaliador de Gastos. Regra arquitetural associada: tudo que define o significado financeiro do número deve sair do frontend e ser resolvido no backend; o frontend deve ficar responsável por exibição, filtros e interação, não por interpretar competência, caixa, saldo aberto, projeção ou conciliação.  
TAGS: arquitetura,modulos,backend,frontend,roadmap-financeiro  
PRIORIDADE: Alta  
STATUS: Em andamento

---

## [2026-05-05 19:38]

ID: 20260505-1938-handoff-state  
SOURCE: previa_finance/copilot  
CATEGORIA: Tarefa  
TÍTULO: Estado atual de retomada remota via SSH/VS Code  
DESCRIÇÃO: Handoff operacional para retomada do trabalho em outra sessão. Branch ativa: `feat/frontend-manus`. Commit de checkpoint enviado ao remoto: `7d6214c` (`feat: checkpoint assess and receipt flows`). Estado atual: ajustes já feitos em `assess`, `DebtAssessor`, `Budget`, `receipt_documents` e UI de `Notas Fiscais`, incluindo exibição de hints de OCR na tela. Próxima direção acordada: trabalhar por módulos, começando por Extrato/Caixa, depois Cartão/Fatura, Fluxo de caixa, Notas fiscais/Comprovantes, Recorrências/Projeções e só então avaliadores. Regra de retomada: evitar empurrar semântica financeira para o frontend; contratos semânticos devem sair do backend.  
TAGS: handoff,ssh,vscode,checkpoint,retomada  
PRIORIDADE: Alta  
STATUS: Em andamento
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

---

## [2026-04-27 22:41]

ID: 20260427-2241-invoice-update-save-fix  
SOURCE: previa_finance/copilot  
CATEGORIA: Bug  
TÍTULO: Falha ao salvar fatura existente no import (`value.toISOString is not a function`)  
DESCRIÇÃO: Reproduzido com payload real de fatura BB no endpoint `POST /api/invoices/import`. O caminho de criação (`insert`) funcionava, mas o caminho de atualização da fatura existente (`update`) falhava com erro interno do Drizzle em mapper de `timestamp` (`MySqlTimestamp.mapToDriverValue`). Causa raiz prática: bug no caminho de `update` do `card_invoices` ao persistir valores monetários/estado em combinação com o mapper da versão atual do ORM. Solução aplicada: substituir apenas o update dessa rota por SQL parametrizado com `db.execute(sql\`...\`)`, convertendo valores monetários para string (`toString()`) e mantendo `updated_at = CURRENT_TIMESTAMP`. Validação: build da API passou e reimport no mesmo mês retornou HTTP 200 sem erro.  
TAGS: api,invoices,import,drizzle,mysql,bugfix  
PRIORIDADE: Alta  
STATUS: Concluído
PRIORIDADE: Alta  
STATUS: Pendente


## [2026-04-17 10:32]

ID: 20260417-1032-003
SOURCE: previa_finance/copilot
CATEGORIA: Arquitetura
TÍTULO: Atualizar workspaces para suportar `packages/domains/*` e `packages/libs/*`
DESCRIÇÃO: Atualizado o `package.json` raiz para incluir explicitamente os workspaces `packages/domains/*` e `packages/libs/*`. Essa mudança permite mover pacotes para `packages/domains/*` sem que saiam do conjunto de workspaces do monorepo. A modificação foi commitada e pushada no branch `feat/db-redesign`. Não houve alterações de código além do `package.json` raiz e desta nota de registro.  
TAGS: workspaces,monorepo,architecture

## [2026-04-23 20:04]

ID: 20260423-2004-001  
SOURCE: previa_finance/copilot  
CATEGORIA: Roadmap  
TÍTULO: Status atual do app antes do commit  
DESCRIÇÃO: Revisão estática do repositório mostrou que a Fase 1 está parcialmente pronta: há servidor HTTP básico em `apps/api` com health check, CORS, helmet, conexão com banco e rotas `/api/cashflow`, `/api/budget`, `/api/categories`; porém `/api/transactions` ainda é stub e autenticação simples não está implementada, apesar de existirem dependências de `jsonwebtoken` e `bcryptjs`. Na Fase 2, `BudgetEngine`, `ImpactCalculator` e `CashFlowEngine` já existem em `packages/core` com testes, mas os parsers robustos ainda são skeletons (ex.: Nubank retorna array vazio) e os seeds completos não estão fechados. Na Fase 3, há schema/migrations para Open Finance, webhook e sync no `packages/db`, mas não encontrei integração Pluggy, sincronização automática nem endpoints/worker de webhooks no backend. A UI web ainda está no starter padrão do Vite/React.  
TAGS: status,roadmap,api,auth,parsers,open-finance,frontend  
PRIORIDADE: Alta  
STATUS: Concluído

## [2026-04-23 22:41]

ID: 20260423-2241-001  
SOURCE: previa_finance/copilot  
CATEGORIA: Arquitetura  
TÍTULO: Clerk e categoria textual alinhados na Fase 1  
DESCRIÇÃO: Corrigido o caminho da Fase 1 para autenticação externa com Clerk sem tabela local de `users`, mantendo apenas um mapeamento interno de owner para compatibilidade com os `user_id` inteiros já existentes no schema. O contrato de `transactions.categoryId` foi alinhado com `categories.id` string, com migration nova para `transactions` e `card_transactions`. A API ganhou rotas de auth/transactions consistentes com Clerk e o core deixou de compilar testes no build de produção após excluir `__tests__` do `tsconfig` de `@previa/core`. Validações executadas com sucesso: `pnpm --filter @previa/db build`, `pnpm --filter @previa/core build`, `pnpm --filter @previa/api build`.  
TAGS: clerk,auth,transactions,categories,db,core,build  
PRIORIDADE: Alta  
STATUS: Concluído
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

---

## [2026-04-24 12:13]

ID: 20260424-1213-001
SOURCE: previa_finance/copilot
CATEGORIA: Tarefa
TÍTULO: Atualizar inbox do Synapse e sincronizar branch no GitHub
DESCRIÇÃO: Registrada a atualização operacional do arquivo `.synapse/synapse_inbox.md` na branch atual (`feat/forecast-support`) e iniciada a sincronização das alterações locais para o repositório remoto no GitHub, preservando o histórico append-only das notas do projeto.
TAGS: synapse,github,operacao,branch,registro
PRIORIDADE: Alta
STATUS: Concluído

---

## [2026-04-25 21:38]

ID: 20260425-2138-001
SOURCE: previa_finance/copilot
CATEGORIA: Decisão
TÍTULO: Regra de projeção de dívidas do cartão no CashFlow
DESCRIÇÃO: Decisão funcional consolidada para o CashFlow. 1) Parcela identificada no formato N/T (ex.: 3/12) deve gerar previsão das parcelas restantes dentro da janela de meses selecionada na projeção. 2) O mês atual deve priorizar realizado por extrato (auditoria), sem parear previsto vs pago no mesmo mês para simplificar a regra operacional. 3) Para cartão, valores em aberto permanecem como despesa projetada até evidência de pagamento via extrato atualizado (sem Open Finance/Pluggy). 4) Lançamentos manuais representam previsão (dívida futura, despesa esperada ou expectativa de receita) e não movimento real de caixa. 5) Metáfora visual aprovada para o gráfico: despesa paga em azul claro, cartão/projeção em laranja, e receita em linha azul escuro como linha de vida do orçamento; ultrapassagem da despesa sobre a receita indica risco financeiro.
TAGS: cashflow,cartao,parcelas,projecao,extrato,regra-negocio,ux
PRIORIDADE: Alta
STATUS: Concluído

---

## [2026-04-25 21:45]

ID: 20260425-2145-001
SOURCE: previa_finance/copilot
CATEGORIA: Bug
TÍTULO: Import de fatura salva em `transactions` em vez de `card_transactions` + `card_invoice`
DESCRIÇÃO: O endpoint POST /api/invoices/import (apps/api/src/routes/invoices.ts) está inserindo as compras de cartão diretamente na tabela `transactions` com movementType = 'card_purchase', contrariando o ETP §6.2 e §9. O modelo correto exige: (1) criar ou recuperar um registro em `card_invoices` para o mês da fatura, (2) inserir cada compra em `card_transactions` vinculada ao card_invoice_id. A tabela `transactions` deve receber apenas o pagamento da fatura (extrato bancário), não as compras individuais. Causa: atalho de implementação na Fase 2 sem seguir o modelo de domínio especificado no ETP. Impacto atual: zero no cashflow (projeção é stateless), mas causará distorção quando o banco for integrado ao cashflow — compras seriam contadas como saída real de caixa. Solução: corrigir o endpoint de import para usar card_invoices + card_transactions. A correção será feita via prompt para o Manus.
TAGS: bug,import,card_transactions,card_invoices,transactions,ETP,cashflow
PRIORIDADE: Alta
STATUS: Pendente

---

## [2026-04-26 15:10]

ID: 20260426-1510-001
SOURCE: previa_finance/copilot
CATEGORIA: Tarefa
TÍTULO: Implementar parser de fatura Itaú com paridade de dados do parser BB
DESCRIÇÃO: Definido escopo para implementação do parser de faturas do Itaú via Manus. O novo parser deve extrair o mesmo conjunto de informações já disponível no parser do Banco do Brasil: dados de fatura (banco, bandeira/produto, quatro últimos dígitos do cartão, mês de referência, vencimento, fechamento, saldo em aberto), transações detalhadas (data, descrição, valor em centavos, parcela N/T quando houver), além de detecção e agregação de compras nacionais vs estrangeiras. Também deve implementar conversões de moeda para compras internacionais quando os dados estiverem presentes na fatura (valor original, moeda e valor convertido em BRL), preservando o contrato de resposta usado em `/api/invoices/parse` para integração transparente com preview e import.
TAGS: parser,itau,faturas,pdf,moeda,internacional,cashflow
PRIORIDADE: Alta
STATUS: Pendente
---

## [2026-04-27 22:50]

ID: 20260427-2250-accounts-category-bad-gateway-fix  
SOURCE: previa_finance/copilot  
CATEGORIA: Bug  
TÍTULO: Troca de categoria em fatura derrubava API e causava Bad Gateway no frontend  
DESCRIÇÃO: Ao chamar `PATCH /api/accounts/card-transactions/:id/category`, a rota lançava `createError('Categoria nao encontrada.', 404)` dentro de handler async sem encapsulamento com `try/catch` + `next`, causando queda do processo Node no Express 4 e cascata de `socket hang up`/`ECONNREFUSED` no Vite proxy (Bad Gateway). Além disso, havia desalinhamento funcional: `/api/categories` usa store em memória, enquanto a validação da rota de accounts consultava apenas a tabela `categories` do DB, gerando falso negativo para categorias criadas pelo front. Solução aplicada: (1) encapsular a rota PATCH com `try/catch` e repassar erros para middleware global via `next(error)`; (2) tornar a checagem de categoria não-bloqueante nessa rota para compatibilidade com o store atual de categorias. Build da API validado com sucesso após patch.  
TAGS: bug,accounts,categories,bad-gateway,express,api,frontend-proxy  
PRIORIDADE: Alta  
STATUS: Concluído

---

## [2026-04-28 00:16]

ID: 20260428-0016-statement-import-save-error
SOURCE: previa_finance/copilot
CATEGORIA: Bug
TÍTULO: Upload de extrato parse OK, falha na etapa de salvar/importar
DESCRIÇÃO: No fluxo novo de `Upload de Extratos Bancários` (OFX/CSV), o endpoint `POST /api/transactions/statement/parse` já retorna 200 com transações parseadas, porém a etapa de import/salvamento ainda apresenta erro em runtime no ambiente local. Hipótese principal levantada durante a sessão: inconsistência de tabela/colunas ou conflito de dados na gravação do import. Ação combinada: pausar investigação e retomar amanhã a partir da etapa de salvar (`/api/transactions/statement/import`), validando schema real no MySQL e query de insert/deduplicação.
TAGS: bug,statement-upload,ofx,csv,transactions,import,deduplicacao
PRIORIDADE: Alta
STATUS: Em andamento

## [2026-04-29 19:26]

ID: 20260429192627-6249
SOURCE: previa_finance/copilot
CATEGORIA: Insight
TÍTULO: Checkpoint solicitado pelo usuário antes da implementação de persistência de
DESCRIÇÃO: Checkpoint solicitado pelo usuário antes da implementação de persistência de previsões recorrentes. Inclui ajustes em upload/classificação de extrato, categorização por histórico/regras/IA, bloqueio de edição para transferências neutras, exibição de usuário ativo no layout, separação de contas bancárias e faturas, correções de auth por owner, melhorias em cashflow (sinais/visualização) e uso opcional de webHint na classificação.
TAGS: auth,ci,checkpoint,git,synapse,cashflow,statement,classificacao,contas
PRIORIDADE: Média
STATUS: Concluído

---

## [2026-04-30 17:30]

ID: 20260430-1730-cashflow-heuristic-month-cursor  
SOURCE: previa_finance/copilot  
CATEGORIA: Bug  
TÍTULO: Heurístico de reconciliação de faturas ignorava pagamentos anteriores ao `startMonth`  
DESCRIÇÃO: O cursor de meses do heurístico `inferredPaidCardInvoices` em `apps/api/src/routes/cashflow.ts` era gerado com `buildProjectionMonths(startMonth, data.months)`, ou seja, começava exatamente em `startMonth`. Pagamentos de fatura com `competencyMonth < startMonth` (ex.: fatura paga em fevereiro quando a projeção começa em abril) nunca eram casados com a fatura correspondente, deixando `paidMinor = 0` e exibindo a fatura como dívida em aberto no gráfico mesmo após quitada. Causa raiz: cursor de meses não incluía meses históricos com `liability_payment` no banco. Solução aplicada: o cursor passou a ser a união de todos os meses com pagamentos em `remainingByMonth` + os meses de projeção, ordenados cronologicamente. Arquivo alterado: `apps/api/src/routes/cashflow.ts`. Build validado com sucesso.  
TAGS: cashflow,heuristic,reconciliation,bugfix,cartao,fatura  
PRIORIDADE: Alta  
STATUS: Concluído

---

## [2026-04-30 17:31]

ID: 20260430-1731-cashflow-engine-debtopen-double-count  
SOURCE: previa_finance/copilot  
CATEGORIA: Bug  
TÍTULO: `debtOpenMinor` contado em dobro no mês de vencimento da fatura  
DESCRIÇÃO: Em `packages/core/src/cashflow/CashFlowEngine.ts`, a lógica de cálculo do `debtOpen` acumulava `outVal` duas vezes para o mesmo mês quando `inv.dueMonth === month`: uma vez pelo bloco `inv.competencyMonth <= month` (correto — mantém dívida visível até quitação) e novamente pelo bloco `inv.dueMonth === month` (que deveria apenas adicionar ao `committed`). Resultado prático: o valor da coluna laranja ("Cartão em aberto") era o dobro do real no mês de vencimento, e faturas quitadas ainda apareciam com saldo residual no gráfico. Solução aplicada: removida a linha `debtOpen = add(debtOpen, outVal)` do bloco de `dueMonth`; o bloco agora só soma ao `committed` (compromisso de saída). Arquivo alterado: `packages/core/src/cashflow/CashFlowEngine.ts`. Build de `packages/core` e `apps/api` validados com sucesso.  
TAGS: cashflow,engine,debtOpen,cartao,fatura,bugfix,double-count  
PRIORIDADE: Alta  
STATUS: Concluído

---

## [2026-04-30 20:15]
ID: 20260430-2015-cashflow-cartao-desconhecido
SOURCE: previa_finance/manus
CATEGORIA: Bug
TITULO: Painel de faturas exibia Cartao desconhecido para faturas importadas via OFX
DESCRICAO: A query do cardInvoicesPanel em apps/api/src/routes/cashflow.ts buscava institutionName, cardBrand e cardLast4 directamente de card_invoices. Quando a fatura era criada a partir de um import OFX, esses campos ficavam NULL na tabela. Solucao aplicada: adicionado LEFT JOIN accounts e COALESCE(card_invoices.institution_name, accounts.institution_name) para os 3 campos de identidade. Arquivo alterado: apps/api/src/routes/cashflow.ts. Commit: 98c687e.
TAGS: cashflow,cartao,institutionName,cardBrand,cardLast4,ofx,bugfix
PRIORIDADE: Alta
STATUS: Concluido

## [2026-05-01 19:35]

ID: 20260501-1935-cashflow-manual-projections-persist  
SOURCE: previa_finance/copilot  
CATEGORIA: UX  
TÍTULO: Projecções avulsas do CashFlow passaram a persistir  
DESCRIÇÃO: A lista de projecções avulsas removíveis do CashFlow deixou de viver apenas em memória e agora é salva em `localStorage` no browser. Com isso, o usuário mantém os itens entre recarregamentos, sem transformar essas projeções em recorrentes do backend.  
TAGS: cashflow,localstorage,persistencia,projecao,frontend  
PRIORIDADE: Media  
STATUS: Concluido

## [2026-05-01 19:22]

ID: 20260501-1922-cashflow-projection-labels  
SOURCE: previa_finance/copilot  
CATEGORIA: UX  
TÍTULO: Projecções avulsas ficaram explícitas como removíveis  
DESCRIÇÃO: A secção manual do CashFlow foi renomeada para deixar claro que as projeções avulsas podem ser editadas ou removidas direto na tela. A cópia também foi ajustada para reforçar que valores positivos sobem a linha azul de recebido, enquanto o azul claro continua reservado para saídas do extrato.  
TAGS: cashflow,ux,labels,projecao,frontend  
PRIORIDADE: Media  
STATUS: Concluido

## [2026-05-01 19:12]

ID: 20260501-1912-cashflow-projections-vs-statement  
SOURCE: previa_finance/copilot  
CATEGORIA: Bug  
TÍTULO: Projeções avulsas do CashFlow não devem contaminar o azul  
DESCRIÇÃO: A entrada manual do lado esquerdo passou a ser tratada como projeção avulsa editável, com mês ajustável e persistência até o usuário alterar/remover. No backend, essas projeções entram por `extraForecasts`, enquanto a barra azul segue apenas as transações reais do extrato (`statementOutflowMinor`). Isso evita misturar previsão com extrato e mantém o vermelho para despesas projetadas.  
TAGS: cashflow,projecao,extrato,azul,frontend,bugfix  
PRIORIDADE: Alta  
STATUS: Concluido

## [2026-05-01 18:58]

ID: 20260501-1858-cashflow-blue-statement-only  
SOURCE: previa_finance/copilot  
CATEGORIA: Bug  
TÍTULO: Azul do CashFlow deve vir só do extrato real  
DESCRIÇÃO: A série azul deixou de depender de `totalExpenseMinor` da projeção e passou a usar um agregado explícito de `statementOutflowMinor`, calculado apenas a partir das transações reais do extrato (`expense` + `liability_payment`). Isso impede que o azul herde previsões recorrentes em meses futuros e preserva o comportamento de abril aparecer azul só em abril.  
TAGS: cashflow,azul,extrato,statement,frontend,bugfix  
PRIORIDADE: Alta  
STATUS: Concluido
---
## [2026-04-30 20:15]
ID: 20260430-2015-reconcile-janela-assimetrica
SOURCE: previa_finance/manus
CATEGORIA: Bug
TITULO: Janela de +-45 dias em reconcileInvoicePayment alocava pagamentos em faturas erradas
DESCRICAO: A funcao reconcileInvoicePayment em apps/api/src/routes/transactions.ts usava janela simetrica de +-45 dias. Isso permitia que um pagamento de marco fosse alocado numa fatura de janeiro ainda em aberto, inflando paidAmountMinor. Solucao aplicada: janela corrigida para assimetrica de -60 / +5 dias. Arquivo alterado: apps/api/src/routes/transactions.ts. Commit: 98c687e.
TAGS: cashflow,reconciliacao,cardInvoicePayments,paidAmountMinor,bugfix,janela
PRIORIDADE: Alta
STATUS: Concluido
---
## [2026-04-30 20:15]
ID: 20260430-2015-cashflow-aberto-anterior-cascata
SOURCE: previa_finance/manus
CATEGORIA: Bug
TITULO: Calculo de abertoAnterior usava totalAmountMinor - paidAmountMinor (cascata do bug de janela)
DESCRICAO: O campo abertoAnterior no cardInvoicesPanel era calculado como BigInt(prevInv.totalAmountMinor) - BigInt(prevInv.paidAmountMinor). Como paidAmountMinor podia estar inflado pelo bug da janela +-45 dias, o resultado propagava erro para o totalFatura do mes seguinte. Solucao aplicada: abertoAnterior passou a usar openAmountMinor directamente. Arquivo alterado: apps/api/src/routes/cashflow.ts. Commit: 98c687e.
TAGS: cashflow,abertoAnterior,openAmountMinor,totalFatura,bugfix,cascata
PRIORIDADE: Alta
STATUS: Concluido
---
## [2026-04-30 21:00]
ID: 20260430-2100-reconcile-pagamento-generico-bb
SOURCE: previa_finance/manus
CATEGORIA: Bug
TITULO: Pagamento generico do BB nao reconciliava com fatura do Itau
DESCRICAO: O OFX do Banco do Brasil registra o pagamento de fatura como "Pagto cartao credito" sem nomear a instituicao destino. Dois problemas: (1) CARD_PAYMENT_PATTERN nao reconhecia o texto "Pagto cartao credito" (faltava a variante "PAGTO CART\b"), entao a transacao nunca era classificada como liability_payment e a reconcileInvoicePayment nunca era chamada; (2) mesmo corrigindo o pattern, a funcao filtrava faturas por accounts.institutionName LIKE '%Banco do Brasil%', nao encontrando a fatura do Itau. Solucao em 2 partes: (1) CARD_PAYMENT_PATTERN expandido com "PAGTO CART\b" e "PAGTO CARTAO CREDITO"; (2) reconcileInvoicePayment detecta pagamentos genericos (targetInstitution == sourceInstitution) e busca todas as faturas em aberto na janela, priorizando match exato por valor (openAmountMinor == paymentAmount). Arquivo alterado: apps/api/src/routes/transactions.ts. Commit: fe2b7d4.
TAGS: cashflow,reconciliacao,cardInvoicePayments,CARD_PAYMENT_PATTERN,bb,itau,pagamento-generico,bugfix
PRIORIDADE: Alta
STATUS: Concluido
---

## [2026-05-01 13:58]

ID: 20260501-1358-synapse-before-commit  
SOURCE: previa_finance/copilot  
CATEGORIA: Decisão  
TÍTULO: Atualizar synapse_inbox antes de commitar  
DESCRIÇÃO: Definida a regra operacional para este repositório: antes de criar um commit com mudanças relevantes, atualizar o arquivo `.synapse/synapse_inbox.md` no padrão append-only para registrar a motivacao, a correção aplicada e o contexto do trabalho. Isso garante memoria duravel e evita perder o histórico operacional entre sessões.  
TAGS: synapse,processo,commit,memoria-operacional  
PRIORIDADE: Média  
STATUS: Concluido

## [2026-05-01 15:31]

ID: 20260501-1531-cashflow-remove-manual-invoices  
SOURCE: previa_finance/copilot  
CATEGORIA: Tarefa  
TÍTULO: Remover janela manual de faturas do CashFlow  
DESCRIÇÃO: Removido o formulário manual de faturas da tela de CashFlow em `apps/web/src/pages/CashFlow.tsx`. A entrada de faturas agora fica restrita ao fluxo real de importação/persistência em `card_invoices` e `card_transactions`; a projeção do CashFlow continua lendo as faturas importadas da API. O `CashFlow.js` gerado também foi recompilado para refletir a remoção.  
TAGS: cashflow,frontend,faturas,ux,refactor  
PRIORIDADE: Média  
STATUS: Concluido

## [2026-05-01 15:38]

ID: 20260501-1538-cashflow-blue-from-invoice-payments  
SOURCE: previa_finance/copilot  
CATEGORIA: Bug  
TÍTULO: Azul do CashFlow não usava os pagamentos conciliados do extrato  
DESCRIÇÃO: A projeção do CashFlow estava alimentando `totalLiabilityPaymentMinor` apenas com transações de tipo `liability_payment`, embora o motor `CashFlowEngine` já aceite `invoicePayments`. Como a associação correta entre extrato e fatura é materializada em `card_invoice_payments`, o azul podia ficar zerado mesmo com a fatura paga no extrato importado. Solução aplicada: `apps/api/src/routes/cashflow.ts` passou a ler `card_invoice_payments.paymentDate` e `allocatedAmountMinor`, mapear o mês de competência e enviar esses eventos como `invoicePayments` para o engine. Build da API validado com sucesso.  
TAGS: cashflow,extrato,card_invoice_payments,liability_payment,bugfix  
PRIORIDADE: Alta  
STATUS: Concluido

## [2026-05-01 15:52]

ID: 20260501-1552-cashflow-blue-pix-transfer  
SOURCE: previa_finance/copilot  
CATEGORIA: Bug  
TÍTULO: PIX e transferências de pagamento de fatura não entravam no azul  
DESCRIÇÃO: O gráfico do CashFlow só considerava azul claro quando a transação já chegava como `liability_payment`. Na prática, pagamentos de fatura via PIX/TED/transferência podiam entrar na importação como `expense` ou `transfer`, ficando fora da série azul. Solução aplicada: `apps/api/src/routes/transactions.ts` ganhou uma heurística adicional que classifica como `liability_payment` descrições com indícios de pagamento de fatura usando PIX/TED/transferência, e `apps/api/src/routes/cashflow.ts` deixou de somar um caminho paralelo de `invoicePayments` para evitar contagem dupla. Build da API validado com sucesso.  
TAGS: cashflow,pix,transferencia,liability_payment,extrato,bugfix  
PRIORIDADE: Alta  
STATUS: Concluido

## [2026-05-01 18:28]

ID: 20260501-1828-cashflow-blue-statement-outflows  
SOURCE: previa_finance/copilot  
CATEGORIA: Bug  
TÍTULO: Barra azul do CashFlow deve representar saídas do extrato  
DESCRIÇÃO: Ajustada a série azul do gráfico de CashFlow para somar todas as saídas reais do extrato no mês (`totalExpenseMinor + totalLiabilityPaymentMinor`), mantendo fora os movimentos neutros de investimento como `Rende Fácil`. Isso alinha a barra azul com o que saiu efetivamente da conta, sem tocar na lógica do laranja. Build do front validado com sucesso.  
TAGS: cashflow,extrato,saidas,liability_payment,frontend,bugfix  
PRIORIDADE: Alta  
STATUS: Concluido

## [2026-05-01 18:36]

ID: 20260501-1836-cashflow-orange-history-cutoff  
SOURCE: previa_finance/copilot  
CATEGORIA: Bug  
TÍTULO: Laranja histórico não deve aparecer em meses anteriores ao mês corrente  
DESCRIÇÃO: Ajustado o gráfico de CashFlow para zerar a série laranja (`cartaoProjetado`) em meses anteriores ao mês corrente. Isso evita mostrar fatura em aberto em abril quando o sistema já está em maio, mantendo o aberto visível apenas do mês corrente em diante. O azul continua vindo das saídas reais do extrato. Build do front validado com sucesso.  
TAGS: cashflow,cartaoProjetado,mescorrente,frontend,bugfix  
PRIORIDADE: Alta  
STATUS: Concluido

## [2026-05-01 18:42]

ID: 20260501-1842-cashflow-blue-current-month-only  
SOURCE: previa_finance/copilot  
CATEGORIA: Bug  
TÍTULO: Azul do CashFlow só deve aparecer até o mês corrente  
DESCRIÇÃO: Ajustada a série azul do gráfico para considerar as saídas reais do extrato apenas até o mês corrente. Meses futuros de projeção não recebem barra azul, evitando duplicar valores que já aparecem no vermelho como débitos recorrentes. O laranja histórico segue cortado nos meses anteriores ao mês corrente. Build do front validado com sucesso.  
TAGS: cashflow,azul,mescorrente,projecao,frontend,bugfix  
PRIORIDADE: Alta  
STATUS: Concluido

---
## [2026-05-02] Avaliadores IA + Notas Fiscais — Rebase sobre 3351f6c

### Contexto
Trabalho anterior foi feito sobre versão desatualizada do cashflow.ts.
O Codex subiu a versão correta (commit 3351f6c) e o Manus refez tudo sobre essa base.

### O que foi implementado (commit 3fb0823)

#### 3 Telas de Avaliação com IA
- **Orçamento (`/budget`):** Avaliação 100% automática. Removidos campos manuais. IA analisa renda, faturas, extratos e categorias. Exibe gauge de comprometimento, diagnóstico, alertas e recomendações.
- **Avaliador de Gastos (`/assess/spending`):** Tela dedicada. Seleção de categoria (pré-selecionável via `?categoryId=` na URL). Histórico, tendência, risco, impacto na renda.
- **Avaliador de Dívidas (`/assess/debt`):** Faturas em aberto, parcelas futuras, risco de atraso, pressão sobre renda.
- **API:** `apps/api/src/routes/assess.ts` — 3 endpoints com chamadas reais a `POST /v1/chat/completions` (mesmo padrão de invoices.ts).

#### Módulo receipt_documents (Notas Fiscais)
- **Migration:** `packages/db/migrations/0009_receipt_documents.sql`
- **Schema Drizzle:** `packages/db/src/schema/receipt_documents.ts`
- **API:** `apps/api/src/routes/receiptDocuments.ts` — CRUD + reconciliação manual
- **Tela:** `/receipt-documents` com botão rápido (FAB) para uso no estabelecimento

#### Integração no CashFlow (SEM alterar o CashFlowEngine)
- Notas `projected` com `expectedInvoiceMonth` → injetadas como `cardInvoice` sintética → **barra laranja**
- Notas `projected` sem `expectedInvoiceMonth` (débito) → injetadas como `expense` → **barra vermelha**
- Notas `reconciled` → ignoradas (dado real assume o controle)
- Injeção feita em `cashflow.ts` (API), NUNCA no CashFlowEngine

#### Reconciliação Automática
- **Cartão:** `invoices.ts` — após insert de `card_transactions`, cruza notas por `amount_minor` + `merchant_name` fuzzy (8 chars) + `purchase_month`
- **Débito:** `transactions.ts` — após insert de `transactions`, mesmo critério
- Best-effort: não bloqueia o import em caso de erro

#### Menu e Navegação
- Layout: "Notas Fiscais 🧾", "Aval. Gastos 📊", "Aval. Dívidas 💳"
- Botão "Avaliar" em cada categoria → `/assess/spending?categoryId=...`

### Migrations pendentes em produção
```bash
mysql -u root previa_finance < packages/db/migrations/0009_receipt_documents.sql
```

### Regras respeitadas
- CashFlowEngine NÃO foi alterado
- Lógica azul/laranja intacta
- Sem .env commitado
- git pull feito antes de iniciar o trabalho (base 3351f6c)
