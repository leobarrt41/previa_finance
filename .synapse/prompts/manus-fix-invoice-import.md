# Prompt Manus — Corrigir import de fatura (Bug ID: 20260425-2145-001)

---

## Contexto do projeto

Monorepo TypeScript (pnpm workspaces). Backend Express em `apps/api`, schema Drizzle ORM em `packages/db`, regras de negócio em `packages/core`.

---

## Problema a corrigir

O arquivo `apps/api/src/routes/invoices.ts`, endpoint `POST /api/invoices/import`, está salvando as compras do cartão de crédito na tabela `transactions` com `movementType = 'card_purchase'`. **Isso está errado.**

**Regra de negócio (ETP §6.2):**
- Compra no cartão → **não** afeta o caixa → deve ir para `card_transactions`
- A tabela `transactions` só recebe o **pagamento da fatura** (evento de extrato bancário)

---

## O que deve ser implementado

Reescrever o bloco de persistência do `POST /api/invoices/import` para seguir o modelo correto:

### 1. Criar ou recuperar o `card_invoice` para o mês da fatura

```ts
import { cardInvoices, cardTransactions } from '@previa/db'
import { and } from 'drizzle-orm'

const dueDate = new Date(`${body.dueMonth ?? body.invoiceMonth}-01T12:00:00Z`)

let cardInvoiceId: number
const [existingInvoice] = await db
  .select({ id: cardInvoices.id })
  .from(cardInvoices)
  .where(and(
    eq(cardInvoices.userId, owner.id),
    eq(cardInvoices.accountId, accountId),
    eq(cardInvoices.invoiceMonth, body.invoiceMonth),
  ))
  .limit(1)

if (existingInvoice) {
  cardInvoiceId = existingInvoice.id
} else {
  await db.insert(cardInvoices).values({
    userId: owner.id,
    accountId,
    invoiceMonth: body.invoiceMonth,
    dueDate,
    totalAmountMinor: 0n,
    status: 'OPEN',
    source: 'pdf_invoice',
    dataState: 'consolidated',
  })
  const [created] = await db
    .select({ id: cardInvoices.id })
    .from(cardInvoices)
    .where(and(
      eq(cardInvoices.userId, owner.id),
      eq(cardInvoices.accountId, accountId),
      eq(cardInvoices.invoiceMonth, body.invoiceMonth),
    ))
    .limit(1)
  if (!created) throw createError('Failed to create card_invoice', 500)
  cardInvoiceId = created.id
}
```

### 2. Inserir cada compra em `card_transactions` (remover o insert em `transactions`)

```ts
for (const tx of body.transactions) {
  const occurredAt = new Date(`${tx.date}T12:00:00Z`)
  const amountMinor = BigInt(tx.amountMinor)
  const { fingerprint, normalizedDescription } = buildFingerprintFromRaw({
    competencyMonth: tx.competencyMonth,
    amountMinor,
    rawDescription: tx.description,
  })

  let installmentNumber: number | null = null
  let installmentTotal: number | null = null
  let installmentGroupId: string | null = null
  if (tx.installment) {
    const parts = tx.installment.split('/')
    installmentNumber = parseInt(parts[0], 10) || null
    installmentTotal = parseInt(parts[1], 10) || null
    installmentGroupId = `${fingerprint}-${installmentTotal}`
  }

  try {
    await db.insert(cardTransactions).values({
      userId: owner.id,
      cardInvoiceId,
      source: 'pdf_invoice',
      dataState: 'consolidated',
      movementType: 'card_purchase',
      movementSubtype: tx.installment ? 'installment' : 'single',
      amountMinor,
      currencyCode: 'BRL',
      occurredAt,
      competencyMonth: tx.competencyMonth,
      description: tx.description,
      normalizedDescription,
      categoryId: tx.categoryId ?? null,
      installmentNumber,
      installmentTotal,
      installmentGroupId,
      fingerprint,
      isReconciled: false,
    })
    imported++
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Duplicate entry') || msg.includes('ER_DUP_ENTRY')) {
      skipped++
    } else {
      console.error('[import] insert error:', msg)
      skipped++
    }
  }
}
```

### 3. Atualizar `totalAmountMinor` e `openAmountMinor` da `card_invoice`

```ts
const totalImported = body.transactions
  .reduce((sum, t) => sum + BigInt(t.amountMinor), 0n)

await db
  .update(cardInvoices)
  .set({
    totalAmountMinor: totalImported,
    openAmountMinor: totalImported,
  })
  .where(eq(cardInvoices.id, cardInvoiceId))
```

---

## Imports a ajustar

No topo de `apps/api/src/routes/invoices.ts`, adicionar `cardInvoices` e `cardTransactions` ao import de `@previa/db`. Remover o import de `transactions` que era usado para o insert errado (manter apenas se for usado em outro lugar do arquivo).

---

## Arquivo a modificar

- `apps/api/src/routes/invoices.ts` — **único arquivo a alterar**

---

## Validação após a correção

1. Subir a API: `pnpm --filter @previa/api dev`
2. Fazer upload de um PDF de fatura pelo frontend
3. Confirmar o import
4. No phpMyAdmin (`179.0.176.215/phpmyadmin`) verificar:

| Tabela | Esperado |
|---|---|
| `card_invoices` | 1 registro com o mês da fatura |
| `card_transactions` | compras vinculadas ao `card_invoice_id` correto |
| `transactions` | **nenhum** novo registro com `movement_type = card_purchase` |
