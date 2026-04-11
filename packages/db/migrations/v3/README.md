# Schema v3 — Previa Finance

Esta pasta contém a versão 3 das migrations do Previa Finance, refinada a partir da v2 para garantir suporte real ao Open Finance (Pluggy), facilitar a reconciliação entre fontes (PDF, Nota Fiscal, Open Finance) e preparar o terreno para a Inteligência Artificial.

As regras fundamentais foram mantidas:
*   Compra no cartão é dívida (passivo em `card_invoices` e `card_transactions`).
*   Pagamento de fatura é evento de caixa (via `card_invoice_payments`).
*   A separação entre `source`, `movement_type`, `movement_subtype`, `data_state` e `financial_channel` foi preservada.

## Resumo das Mudanças (Diff v2 → v3)

### 1. `financial_connections` e `financial_connection_consents`
*   **Ajuste:** Adicionados campos como `client_user_id`, `execution_status`, `next_auto_sync_at`, `consent_expires_at`, `products_enabled` e `permissions_granted`.
*   **Justificativa:** O vínculo com o Open Finance deixa de ser apenas um ID estrangeiro. Agora, a tabela reflete o estado real da conexão no Pluggy, permitindo gerir renovação de consentimentos e saber exatamente quais produtos (contas, cartões, investimentos) o usuário autorizou.

### 2. `accounts`
*   **Ajuste:** Adicionada a identidade do instrumento: `institution_name`, `owner_name`, `display_name`, `card_brand`, `card_last4`, `masked_number`.
*   **Justificativa:** Quando o usuário faz upload de um extrato em PDF, muitas vezes não temos o ID interno da conta, apenas o nome do banco e os últimos 4 dígitos do cartão. Esses campos permitem que o parser encontre a conta correta automaticamente.

### 3. `transactions` e `card_transactions`
*   **Ajuste:** Adicionados `competency_month`, `normalized_description`, `fingerprint`, `is_reconciled`, `reconciled_group_id`. Em `card_transactions`, também foram adicionados campos de câmbio e `merchant`.
*   **Justificativa:** O `competency_month` facilita queries rápidas para o motor de CashFlow sem depender de cálculos complexos de data em tempo de execução. O `fingerprint` (hash determinístico) e o `reconciled_group_id` são a base para a **reconciliação**: permitem que o sistema saiba que uma compra vinda do Pluggy e uma lida de uma Nota Fiscal referem-se ao mesmo evento, evitando duplicação no fluxo.

### 4. `card_invoices`
*   **Ajuste:** Enriquecida com `institution_name`, `card_brand`, `card_last4`, `parser_strategy`, `confidence_score` e `provider_payload`.
*   **Justificativa:** Fortalece o diferencial do produto (o parser). O sistema agora sabe *como* a fatura foi lida (ex: `generic_llm` vs `itau_v1`) e com qual grau de confiança. Isso é vital para decidir se a fatura deve sobrescrever dados projetados ou se requer revisão manual.

### 5. `card_invoice_allocations` vs `card_invoice_payments`
*   **Ajuste:** A tabela `card_invoice_allocations` foi definitivamente **removida**. A tabela `card_invoice_payments` (introduzida na v2 e movida para o arquivo `0002` na v3) cobre 100% dos casos de uso, incluindo pagamentos parciais e pagamentos que cobrem múltiplas faturas.
*   **Justificativa:** Pragmatismo. Manter ambas seria overengineering e geraria inconsistência de estado. `card_invoice_payments` é a única fonte da verdade para a ligação entre a saída de caixa e a liquidação da dívida.

### 6. `investments` e `investment_transactions`
*   **Ajuste:** Adicionados `source`, `data_state`, `provider`, `financial_connection_id`, `metadata` e detalhes de emissão/vencimento.
*   **Justificativa:** A camada de investimentos na v2 estava submodelada em comparação com contas correntes. Agora, os investimentos suportam a mesma hierarquia de confiabilidade (Pluggy vs Manual) e estão preparados para análises profundas no plano Premium.

### 7. `provider_webhook_events` e `sync_runs`
*   **Ajuste:** Em webhooks, adicionados `event_id` e `processing_status`. Em sync_runs, adicionado `sync_type`.
*   **Justificativa:** Rastreabilidade e resiliência. O `event_id` evita o processamento duplicado do mesmo webhook. O `sync_type` permite distinguir se uma sincronização foi manual (ação do usuário) ou automática (rotina de background).

## Validação Manual Necessária

1.  **Drizzle Schema:** Como na v2, estas migrations estão em SQL puro. O próximo passo da equipe deve ser a criação do arquivo `schema.ts` utilizando a sintaxe do Drizzle ORM, mapeando os tipos `VARCHAR(50)` para Enums TypeScript (ex: com Zod) para garantir a integridade dos dados na camada de aplicação.
2.  **Fingerprint Hashing:** A lógica de geração do `fingerprint` (ex: `sha256(date + amount + normalized_description)`) deve ser padronizada no pacote `core` (TypeScript) para garantir que transações idênticas vindas de fontes diferentes gerem o mesmo hash.
