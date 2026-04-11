# Novo Schema — Previa Finance (v2)

Este documento detalha as decisões arquiteturais tomadas para o novo banco de dados do Previa Finance, focado no domínio financeiro real (fluxo futuro, dívida de cartão e reconciliação de múltiplas fontes).

## 1. Visão Geral do Novo Modelo

O schema foi projetado para suportar nativamente a **hierarquia de confiabilidade** (`pluggy` > `pdf_statement` > `pdf_invoice` > `nota_fiscal` > `manual`) e a coexistência de dados **projetados**, **consolidados** e **oficiais**.

As 12 tabelas criadas estão organizadas em 3 pilares:
1. **Core e Contas:** `financial_connections`, `financial_connection_consents`, `accounts`
2. **Transações e Cartões (Obrigações):** `transactions`, `card_invoices`, `card_transactions`, `card_invoice_payments`
3. **Investimentos e Sincronização (Open Finance):** `investments`, `investment_transactions`, `provider_webhook_events`, `sync_runs`

## 2. Decisões de Modelagem e Trade-offs

### 2.1 Separação de Contas Manuais e Conectadas
**Decisão:** Unificamos `bankAccounts`, `manualBankAccounts`, `manualCards` e `connectedAccounts` (do legado) na tabela central `accounts`.
**Por quê:** Uma conta é sempre uma conta. O que muda é se ela tem um `financial_connection_id` associado (Open Finance) ou se é gerida manualmente/por upload. Isso simplifica absurdamente as queries de saldo total e dashboard.

### 2.2 Tratamento de Cartão de Crédito como Dívida
**Decisão:** Cartões de crédito também vivem em `accounts` (com `type = 'CREDIT_CARD'`). As compras no cartão vão para `card_transactions` (vinculadas a uma fatura em `card_invoices`), e não afetam o saldo da conta corrente imediatamente.
**Por quê:** A regra de negócio central dita que compra no cartão gera passivo (obrigação mensal). Apenas quando ocorre o pagamento da fatura (`card_invoice_payments`), o saldo em caixa (em `transactions`) é afetado.

### 2.3 Substituição de Enums por VARCHAR
**Decisão:** Em vez de usar `ENUM` nativo do MySQL para campos como `source`, `movement_type`, `data_state` e `financial_channel`, optamos por `VARCHAR(50)`.
**Trade-off:**
*   *Pró:* Facilita muito a evolução do produto. Adicionar um novo provedor (ex: `belvo`) ou um novo tipo de movimento não exige uma migração de alteração estrutural no banco (`ALTER TABLE ... MODIFY COLUMN`), que pode ser lenta e arriscada em produção.
*   *Contra:* Permite a inserção de strings inválidas no banco.
*   *Mitigação:* A validação **deve** ser garantida estritamente na camada de aplicação (ex: Zod schemas no Drizzle/TypeScript).

### 2.4 Fim da Redundância: `card_invoice_payments` vs `card_invoice_allocations`
**Decisão:** Removemos a tabela legado `cardInvoiceAllocations` e criamos `card_invoice_payments`.
**Por quê:** No legado, o fluxo era confuso. Agora, `card_invoice_payments` liga diretamente o ID da fatura (`card_invoice_id`) ao ID da transação na conta corrente (`transaction_id`) que realizou o débito. Isso reflete perfeitamente a saída de caixa pagando o passivo.

### 2.5 Valores Monetários (`amount_minor`)
**Decisão:** Todos os campos de valor (saldos, limites, transações) usam o sufixo `_minor` e o tipo `BIGINT`.
**Por quê:** Evita problemas de precisão de ponto flutuante. Todos os valores são armazenados em centavos (ex: R$ 10,50 = 1050). O uso de `BIGINT` garante que não haverá estouro de limite para usuários com alto patrimônio.

### 2.6 Estrutura Preparada para Open Finance
**Decisão:** Criação das tabelas `provider_webhook_events` e `sync_runs`.
**Por quê:** O Pluggy envia webhooks assíncronos. Inserir esses eventos brutos na tabela `provider_webhook_events` permite que um worker em background processe os dados de forma segura (com tentativas de repetição em caso de falha), sem bloquear a API principal ou perder eventos do banco.

## 3. Ordem das Migrations

Para executar no Drizzle ou diretamente no MySQL, a ordem é:
1. `0001_initial_schema.sql` (Conexões, Consentimentos e Contas)
2. `0002_transactions_invoices.sql` (Transações, Faturas e Compras no Cartão)
3. `0003_payments_investments_sync.sql` (Pagamentos de Fatura, Investimentos, Webhooks e Sync)

## 4. Validação Manual Necessária

*   **Categorias e Usuários:** As migrations assumem que as tabelas `users` e `categories` já existem no banco (ou serão migradas do legado sem grandes alterações estruturais). As chaves estrangeiras para estas tabelas (ex: `user_id`, `category_id`) estão configuradas como `INT`, o que deve bater com a tipagem do legado.
*   **Timezones:** Todos os campos de data utilizam `TIMESTAMP`. É crucial que o servidor MySQL e a aplicação Node.js estejam configurados para operar em UTC (ou que a aplicação trate os offsets corretamente), conforme o bug resolvido recentemente no CashFlow.
