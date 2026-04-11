# ETP Oficial — Previa Finance  
**Versão:** 1.0  
**Status:** Documento base para reconstrução do produto  
**Data:** Abril/2026

---

# 1. Visão Geral

O **Previa Finance** é uma plataforma de gestão financeira pessoal orientada a comportamento, fluxo de caixa futuro e inteligência financeira.

Diferente de apps tradicionais focados apenas em registro histórico de gastos, o Previa Finance busca responder:

- Quanto dinheiro realmente terei nos próximos meses?
- Quanto estou comprometido com dívidas?
- Como minhas compras atuais impactam meu futuro?
- Estou evoluindo financeiramente?
- O que posso melhorar com base nos meus hábitos?

---

# 2. Problema de Mercado

Usuários geralmente enfrentam:

- Desorganização financeira
- Dificuldade em visualizar o futuro financeiro
- Uso impulsivo de cartão de crédito
- Falta de clareza entre gasto real e dívida futura
- Controle manual cansativo
- Falta de orientação prática

Apps atuais costumam:

- Mostrar extrato histórico
- Exibir gráficos passados
- Não tratar dívida de forma inteligente
- Não consolidar múltiplas fontes corretamente

---

# 3. Proposta de Valor

O Previa Finance oferece:

## 3.1 Controle Financeiro Inteligente
Não apenas registra dados. Interpreta.

## 3.2 Fluxo de Caixa Futuro
Mostra próximos meses considerando:

- receitas previstas
- contas recorrentes
- parcelas futuras
- saldo aberto de cartão
- compromissos financeiros

## 3.3 Tratamento Correto do Cartão de Crédito

**Compra no cartão não é débito imediato. É dívida futura.**

Isso permite análises mais realistas.

## 3.4 Open Finance Opcional

Usuário pode:

- operar manualmente
- importar documentos
- usar Open Finance premium

## 3.5 IA Financeira

Sugestões práticas como:

- redução de dívida
- reorganização de fluxo
- alerta de risco
- impacto de compras
- comportamento financeiro

---

# 4. Público-Alvo

## Primário

Pessoas físicas que:

- usam cartão de crédito frequentemente
- sentem desorganização financeira
- querem melhorar patrimônio
- querem praticidade

## Secundário

Usuários mais sofisticados:

- investidores
- usuários multi-banco
- pessoas com alta renda
- heavy users financeiros

---

# 5. Modelo Comercial

## Plano Basic

Inclui:

- lançamentos manuais
- importação de faturas
- importação de extratos
- dashboard principal
- IA básica
- fluxo futuro
- dívida consolidada

## Plano Premium

Inclui:

- Open Finance
- sincronização automática
- múltiplas contas/cartões
- análises avançadas
- insights personalizados
- investimentos integrados

---

# 6. Regras de Negócio Fundamentais

## 6.1 Separação Conceitual Obrigatória

Cada movimentação deve distinguir:

### source
Origem do dado:

- pluggy
- pdf_statement
- pdf_invoice
- nota_fiscal
- manual

### movement_type
Natureza econômica:

- income
- expense
- transfer
- investment
- liability_payment
- card_purchase

### movement_subtype
Detalhe operacional:

- pix
- ted
- boleto
- débito automático
- pagamento fatura

### data_state

- projected
- consolidated
- official

### financial_channel

- bank_account
- credit_card
- investment_account
- cash

---

## 6.2 Cartão de Crédito

Compra no cartão:

- gera dívida
- pode gerar parcelas
- não reduz saldo bancário imediato

Pagamento da fatura:

- reduz caixa
- liquida obrigação

---

## 6.3 Hierarquia de Fontes

Maior confiabilidade prevalece:

1. pluggy
2. pdf_statement
3. pdf_invoice
4. nota_fiscal
5. manual

---

## 6.4 Fluxo Mensal

Cada mês deve usar a melhor informação disponível.

Exemplo:

- Open Finance conectado → domina
- sem Open Finance → usa fatura atual
- sem fatura atual → usa anterior + projeções

---

# 7. Diferenciais Técnicos

## 7.1 Motor de CashFlow Próprio

Capaz de distinguir:

- previsão
- consolidado
- oficial

## 7.2 Parser Inteligente de Faturas

Suporte inicial:

- Nubank
- Banco do Brasil
- Bradesco
- PicPay
- Itaú
- Santander

Futuro:

- fallback por IA para bancos desconhecidos

## 7.3 Reconciliação de Dados

Capacidade futura de unir:

- nota fiscal
- fatura
- extrato
- Open Finance

---

# 8. Arquitetura Técnica

## Monorepo

```text
previa_finance/
  apps/
    web
    api
  packages/
    db
    core
    parsers
  docs/

apps/web

Frontend React + TypeScript

apps/api

Backend Node.js + TypeScript

packages/db

Schema + migrations + ORM

packages/core

Regras de negócio

packages/parsers

Importação de PDFs, OFX, CSV

9. Banco de Dados (Diretriz)

O novo banco deve ser reconstruído com foco em domínio correto.

Entidades principais:

users
accounts
transactions
card_invoices
card_transactions
card_invoice_payments
investments
sync_runs
provider_webhook_events
10. UX / Produto
Desktop

Visão analítica mais rica.

Mobile

Foco em:

consulta rápida
lançamento rápido
impacto imediato
alerta financeiro
11. Roadmap MVP
Fase 1
banco novo
migrations
front novo base
dashboard simples
Fase 2
fluxo mensal inteligente
parser robusto
IA básica
Fase 3
Open Finance
sincronização automática
Fase 4
IA avançada
ranking evolutivo
recomendações inteligentes
12. Filosofia do Produto

O usuário não quer apenas registrar despesas.

O usuário quer:

paz mental
clareza
evolução
controle
futuro melhor

O Previa Finance transforma dados financeiros em direção prática.

13. Estado Atual

Projeto em reconstrução arquitetural, usando aprendizados da versão anterior.

Base nova iniciada em monorepo com foco em escalabilidade, clareza de domínio e qualidade técnica.
