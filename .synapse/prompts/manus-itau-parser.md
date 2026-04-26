# Prompt Manus — Implementar parser de faturas Itaú

Contexto:
- Projeto: Previa Finance (monorepo TypeScript)
- Backend: apps/api
- Parsers: packages/parsers
- Já existe parser de referência: packages/parsers/bb/src/index.ts
- Endpoint atual de parse/import: apps/api/src/routes/invoices.ts

Objetivo:
Implementar parser de faturas de cartão do Itaú com paridade funcional em relação ao parser BB, mantendo o contrato já esperado pelo frontend no fluxo de upload e importação.

## Escopo funcional obrigatório

1. Extrair dados da fatura (summary), incluindo:
- banco/instituição (Itaú)
- bandeira/produto do cartão
- quatro últimos dígitos do cartão
- mês de referência da fatura (invoiceMonth, YYYY-MM)
- data de vencimento (dueDate, YYYY-MM-DD)
- mês de vencimento (dueMonth, YYYY-MM)
- data de fechamento (closingDate, YYYY-MM-DD)
- valor total da fatura em centavos (totalMinor)
- saldo anterior (previousBalanceMinor)
- pagamentos/créditos (paymentsMinor)
- compras nacionais (nationalPurchasesMinor)
- compras internacionais (internationalPurchasesMinor)
- encargos/tarifas (chargesMinor)
- saldo em aberto (openBalanceMinor)

2. Extrair transações individuais:
- data (YYYY-MM-DD)
- descrição
- categoria textual (quando a fatura indicar agrupamento)
- valor em centavos (amountMinor)
- parcela no formato N/T quando existir (installment)
- país da transação (quando disponível)

3. Conversão de moeda e compras estrangeiras:
- detectar compras internacionais
- extrair valor original e moeda original quando houver
- extrair valor convertido em BRL quando houver
- calcular/registrar taxa de conversão quando possível
- garantir que amountMinor final da transação represente o valor BRL que impacta a fatura

4. Classificação nacional vs estrangeira:
- alimentar corretamente nationalPurchasesMinor e internationalPurchasesMinor
- fallback: se não houver marcação explícita, usar indícios de moeda/padrão textual para classificar

## Requisitos de integração

1. Criar novo parser em packages/parsers/itau com API semelhante ao BB:
- parseItauInvoice(buffer: Buffer)
- itauInvoiceToForecast(invoice)

2. Integrar no endpoint de parse:
- apps/api/src/routes/invoices.ts
- suportar bank=itau
- no modo auto, detectar Itaú por assinatura textual/arquivo
- não quebrar fluxo atual do BB

3. Contrato de resposta:
- manter o formato já usado pelo frontend em /api/invoices/parse
- retornar summary + transactions + forecasts

## Requisitos técnicos

1. Tipos TypeScript explícitos para summary e transaction do Itaú.
2. Normalização de valores monetários para centavos.
3. Normalização de datas para YYYY-MM-DD.
4. Tratamento robusto para variações de layout PDF.
5. Logs/erros claros quando parse falhar.

## Testes obrigatórios

1. Unit tests do parser Itaú em packages/parsers/itau:
- extrai campos principais da fatura
- extrai transações com e sem parcela
- detecta compras internacionais
- converte moeda corretamente quando dados estão disponíveis
- calcula openBalanceMinor corretamente

2. Teste de integração no endpoint:
- POST /api/invoices/parse com fatura Itaú real (fixture)
- valida shape do retorno

3. Teste de ponta-a-ponta de import:
- parse Itaú -> preview -> import
- persistência em card_invoices + card_transactions
- sem criar movement_type=card_purchase em transactions

## Critérios de aceite

1. Upload de fatura Itaú não quebra API.
2. Preview mostra dados coerentes com a fatura real.
3. Import salva corretamente em card_invoices e card_transactions.
4. Valores de compras nacionais/estrangeiras e open balance batem com a fatura.
5. Fluxo de cashflow consome os dados sem regressão do BB.

## Arquivos esperados para alteração

- packages/parsers/itau/package.json (se necessário)
- packages/parsers/itau/src/index.ts
- packages/parsers/itau/__tests__/*
- apps/api/src/routes/invoices.ts
- exports do workspace de parser, se necessário

## Comandos de validação

- pnpm --filter @previa/api build
- pnpm --filter @previa/api test (se houver)
- pnpm --filter @previa/parser-itau test (ou nome equivalente)
- fluxo manual no frontend: upload + import

## Observação importante de domínio

- Compra no cartão não é transação de extrato.
- Compra de cartão deve alimentar card_transactions/card_invoices.
- Transação de extrato só para pagamento de fatura (liability_payment).
