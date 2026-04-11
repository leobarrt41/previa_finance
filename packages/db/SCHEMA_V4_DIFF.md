# Schema v4 — Diff e Justificativas

Este documento descreve os ajustes aplicados no `schema.ts` ao passar da versão 3 para a versão 4. Nenhuma regra de domínio foi alterada. O objectivo foi exclusivamente consistência e clareza de modelagem.

---

## 1. Padronização de campos de moeda

**Problema:** O schema v3 misturava `currency` (em `accounts`, `transactions`, `card_invoices`, `investments`, `investment_transactions`) com `currencyCode` (em `card_invoice_payments`). Dois nomes para o mesmo conceito.

**Ajuste:** Todos os campos de moeda foram renomeados para `currency_code` (SQL) / `currencyCode` (TypeScript). O padrão agora é único e explícito em todas as 11 tabelas.

**Campos de câmbio:** `original_amount_minor`, `original_currency_code` e `exchange_rate` existiam apenas em `card_transactions`. Na v4, foram adicionados também em `investment_transactions`, onde fazem sentido para BDRs, ETFs em dólar e outros activos internacionais. Nas demais tabelas, estes campos não existem — não há razão para adicioná-los onde não há conversão cambial.

| Tabela | v3 | v4 |
|---|---|---|
| `accounts` | `currency` | `currency_code` |
| `transactions` | `currency` | `currency_code` |
| `card_invoices` | — (sem campo explícito) | `currency_code` não adicionado — fatura é sempre na moeda da conta |
| `card_transactions` | `currency` | `currency_code` |
| `card_invoice_payments` | `currencyCode` | `currency_code` (já correcto, apenas normalizado) |
| `investments` | `currency` | `currency_code` |
| `investment_transactions` | `currency` | `currency_code` + `original_amount_minor` + `original_currency_code` + `exchange_rate` |

**Impacto na API:** Qualquer endpoint que retorne estes campos precisará actualizar o nome da chave JSON de `currency` para `currencyCode`. Impacto mínimo — nenhum dado é perdido.

**Impacto no parser:** O parser de fatura deve popular `currency_code` em `card_invoices` e `card_transactions`. Hoje a fatura é sempre em BRL, mas o campo existe para o dia em que houver suporte a cartões internacionais.

---

## 2. Padronização de campos de data

**Problema:** O schema v3 usava nomes ambíguos para datas de ocorrência:
- `date` em `transactions` e `card_transactions` — genérico demais
- `dateOccurredAt` em `investment_transactions` — correcto, mas inconsistente com os outros
- `paymentDate`, `closingDate`, `dueDate` — estes já eram semanticamente claros

**Ajuste:** `date` foi renomeado para `occurred_at` (SQL) / `occurredAt` (TypeScript) em `transactions` e `card_transactions`. O campo `date_occurred_at` em `investment_transactions` foi mantido como estava — já estava correcto.

Os índices que referenciavam `date` foram actualizados para `occurred_at`:
- `idx_trans_user_date` → `idx_trans_user_occurred`
- `idx_card_trans_user_date` → `idx_card_trans_user_occurred`

**Impacto na API e no CashFlow:** Qualquer query que usasse `t.date` precisa ser actualizada para `t.occurredAt`. O `competency_month` continua sendo o campo primário para queries de CashFlow — `occurred_at` é apenas o timestamp de referência do evento.

---

## 3. `accounts` — `display_name` vs `name`

**Decisão:** Manter apenas `display_name`. Não foi adicionado um campo `name` canónico separado.

**Justificativa:** Para contas financeiras, o nome que o utilizador vê é o nome canónico. Não existe uma versão "interna" do nome que seja diferente da versão "para UI". Adicionar um segundo campo `name` criaria um problema de sincronização sem dono claro: quem actualiza qual? O Pluggy retorna um nome, o utilizador pode renomear — qual dos dois é o `name` e qual é o `display_name`?

Se no futuro for necessário um identificador estável para deduplicação ou matching (ex: "Nubank Crédito" vs "Cartão Nubank"), esse identificador deve ser derivado programaticamente (ex: `slug(institution_name + card_last4)`) e não armazenado como campo separado.

---

## 4. FKs externas — estratégia de integração futura

**Problema:** `user_id` e `category_id` são referências externas que o Drizzle não conhece como FKs tipadas. Isso significa que o relational query API não pode fazer JOIN automático com `users` ou `categories`.

**Decisão v4:** Manter como `int` simples, mas marcar todos os campos com o comentário `// @external-fk: users.id` ou `// @external-fk: categories.id`. Isso cria um contrato explícito no código que é fácil de encontrar com `grep @external-fk`.

**Estratégia de integração:** Quando o módulo de autenticação for integrado no monorepo, o passo correcto é:
1. Exportar a tabela `users` de `@previa/auth` (ou de um pacote `@previa/db-shared`).
2. Importar `users` no `schema.ts` e substituir os `int("user_id")` por `.references(() => users.id)`.
3. Gerar uma nova migration com `pnpm db:generate` — o Drizzle vai emitir os `ADD CONSTRAINT` correspondentes.

Não fazer isso agora evita criar uma dependência circular entre pacotes antes de a arquitectura de módulos estar definida.

---

## 5. `bigint` — consistência e serialização JSON

**Auditoria de consistência:** Todos os campos monetários usam `bigint("...", { mode: "bigint" })` de forma consistente nas 11 tabelas. Nenhum campo monetário usa `int` ou `decimal`. A auditoria confirmou que não há excepções.

**Campos marcados com `@serialize-to-string`:**

| Tabela | Campos |
|---|---|
| `accounts` | `balance_minor`, `credit_limit_minor`, `available_credit_limit_minor` |
| `transactions` | `amount_minor`, `balance_after_minor` |
| `card_invoices` | `total_amount_minor`, `minimum_payment_minor`, `previous_balance_minor`, `paid_amount_minor`, `open_amount_minor` |
| `card_transactions` | `amount_minor`, `original_amount_minor` |
| `card_invoice_payments` | `allocated_amount_minor` |
| `investments` | `balance_minor` |
| `investment_transactions` | `amount_minor`, `original_amount_minor` |

**Caminho padrão proposto para serialização:** Antes de expor qualquer endpoint de API, adicionar em `packages/core/src/serialization.ts` um utilitário `serializeMonetary(value: bigint): string` e um replacer JSON global. A abordagem recomendada é o replacer no nível do framework (ex: Fastify `serializerCompiler` ou Express `res.json` override), não conversão campo a campo. Isso garante que nenhum `bigint` escapa para o cliente sem ser convertido.

---

## Ajuste adicional — `fingerprint` VARCHAR(255) → VARCHAR(64)

SHA-256 em hexadecimal tem exactamente 64 caracteres. O campo `fingerprint` estava declarado como `VARCHAR(255)` sem necessidade. Corrigido para `VARCHAR(64)` em `transactions` e `card_transactions`. Impacto: índice ligeiramente mais compacto, sem perda de dados.
