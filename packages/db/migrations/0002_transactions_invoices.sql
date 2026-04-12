-- =============================================================================
-- Migration v3 — 0002: Transactions, Card Invoices, Card Transactions e Payments
-- Schema: Previa Finance v3
-- Substitui integralmente as tabelas do v2 0002_transactions_invoices.sql
-- e consolida card_invoice_payments do v2 0003.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- transactions
-- Movimentações em contas correntes, poupança e carteiras.
-- Regra central: compra no cartão de crédito NÃO gera registro aqui.
-- Aqui vivem: receitas, despesas em conta, transferências, pagamentos de fatura
-- e resgates/aportes de investimento que afetam o caixa.
-- Enriquecida com competency_month, fingerprint e campos de reconciliação.
-- -----------------------------------------------------------------------------
CREATE TABLE `transactions` (
  `id`                      INT          NOT NULL AUTO_INCREMENT,
  `user_id`                 INT          NOT NULL,
  `account_id`              INT          NOT NULL,

  -- -------------------------------------------------------------------------
  -- Hierarquia de confiabilidade e classificação (regra de negócio central)
  -- -------------------------------------------------------------------------
  `source`                  VARCHAR(50)  NOT NULL, -- pluggy | pdf_statement | nota_fiscal | manual
  `data_state`              VARCHAR(50)  NOT NULL, -- projected | consolidated | official
  `movement_type`           VARCHAR(50)  NOT NULL, -- income | expense | transfer | investment | liability_payment | card_purchase
  `movement_subtype`        VARCHAR(50)  NULL,     -- pix | ted | boleto | auto_debit | invoice_payment
  `financial_channel`       VARCHAR(50)  NOT NULL, -- bank_account | credit_card | investment_account | cash

  -- -------------------------------------------------------------------------
  -- Valores
  -- -------------------------------------------------------------------------
  `amount_minor`            BIGINT       NOT NULL, -- Centavos; negativo = saída, positivo = entrada
  `currency`                VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  `balance_after_minor`     BIGINT       NULL,     -- Saldo da conta após esta transação (quando disponível via Open Finance)

  -- -------------------------------------------------------------------------
  -- Datas e competência
  -- -------------------------------------------------------------------------
  `date`                    TIMESTAMP    NOT NULL, -- Data do evento (UTC)
  `competency_month`        VARCHAR(7)   NOT NULL, -- YYYY-MM — mês de competência para o CashFlow

  -- -------------------------------------------------------------------------
  -- Descrição e categoria
  -- -------------------------------------------------------------------------
  `description`             TEXT         NOT NULL,
  `normalized_description`  VARCHAR(500) NULL,     -- Descrição normalizada (maiúsculas, sem pontuação) para fingerprint
  `category_id`             INT          NULL,

  -- -------------------------------------------------------------------------
  -- Parcelamento
  -- -------------------------------------------------------------------------
  `installment_number`      INT          NULL,
  `installment_total`       INT          NULL,
  `installment_group_id`    VARCHAR(255) NULL,

  -- -------------------------------------------------------------------------
  -- Recorrência
  -- -------------------------------------------------------------------------
  `is_recurring`            BOOLEAN      NOT NULL DEFAULT FALSE,
  `recurring_rule_id`       INT          NULL,

  -- -------------------------------------------------------------------------
  -- Reconciliação entre fontes
  -- -------------------------------------------------------------------------
  `fingerprint`             VARCHAR(255) NULL,     -- Hash determinístico: date + amount + normalized_description
  `is_reconciled`           BOOLEAN      NOT NULL DEFAULT FALSE,
  `reconciled_group_id`     VARCHAR(255) NULL,     -- Agrupa registros de fontes diferentes que representam o mesmo evento

  -- -------------------------------------------------------------------------
  -- Open Finance
  -- -------------------------------------------------------------------------
  `provider_transaction_id` VARCHAR(255) NULL,
  `provider_payload`        JSON         NULL,

  `created_at`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_trans_provider_id`    (`provider_transaction_id`),
  INDEX `idx_trans_user_date`            (`user_id`, `date`),
  INDEX `idx_trans_competency`           (`competency_month`),
  INDEX `idx_trans_fingerprint`          (`fingerprint`),
  INDEX `idx_trans_reconciled_group`     (`reconciled_group_id`),
  INDEX `idx_trans_source`               (`source`),
  INDEX `idx_trans_data_state`           (`data_state`),
  CONSTRAINT `fk_trans_account`
    FOREIGN KEY (`account_id`)
    REFERENCES `accounts` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- card_invoices
-- Representa a obrigação mensal (passivo) gerada pelo uso do cartão de crédito.
-- O pagamento desta fatura é o evento que afeta o caixa (via card_invoice_payments).
-- Enriquecida com metadados de parser e identidade do cartão para suportar
-- associação automática com a conta correta ao importar um PDF.
-- -----------------------------------------------------------------------------
CREATE TABLE `card_invoices` (
  `id`                      INT          NOT NULL AUTO_INCREMENT,
  `user_id`                 INT          NOT NULL,
  `account_id`              INT          NOT NULL,        -- FK para o cartão em accounts

  -- -------------------------------------------------------------------------
  -- Período e datas
  -- -------------------------------------------------------------------------
  `invoice_month`           VARCHAR(7)   NOT NULL,        -- YYYY-MM (renomeado de month_reference para clareza)
  `closing_date`            TIMESTAMP    NULL,
  `due_date`                TIMESTAMP    NOT NULL,

  -- -------------------------------------------------------------------------
  -- Valores
  -- -------------------------------------------------------------------------
  `total_amount_minor`      BIGINT       NOT NULL DEFAULT 0,
  `minimum_payment_minor`   BIGINT       NULL,
  `previous_balance_minor`  BIGINT       NOT NULL DEFAULT 0, -- Carry: saldo não pago do mês anterior
  `paid_amount_minor`       BIGINT       NOT NULL DEFAULT 0,
  `open_amount_minor`       BIGINT       NOT NULL DEFAULT 0, -- Saldo devedor restante (renomeado de remaining_amount_minor)

  -- -------------------------------------------------------------------------
  -- Estado e origem
  -- -------------------------------------------------------------------------
  `status`                  VARCHAR(50)  NOT NULL DEFAULT 'OPEN', -- OPEN | CLOSED | PAID | PARTIALLY_PAID
  `source`                  VARCHAR(50)  NOT NULL,        -- pluggy | pdf_invoice | manual
  `data_state`              VARCHAR(50)  NOT NULL,        -- projected | consolidated | official

  -- -------------------------------------------------------------------------
  -- Identidade do cartão (populada pelo parser ou pelo Open Finance)
  -- Permite associar a fatura ao account correto mesmo sem account_id explícito
  -- -------------------------------------------------------------------------
  `institution_name`        VARCHAR(200) NULL,
  `card_brand`              VARCHAR(50)  NULL,
  `card_last4`              VARCHAR(4)   NULL,
  `card_holder_name`        VARCHAR(200) NULL,

  -- -------------------------------------------------------------------------
  -- Metadados do parser (para faturas importadas via PDF)
  -- -------------------------------------------------------------------------
  `parser_strategy`         VARCHAR(100) NULL,            -- itau_v1 | bradesco_v2 | generic_llm | ocr_vision
  `confidence_score`        DECIMAL(5,4) NULL,            -- 0.0000 a 1.0000

  -- -------------------------------------------------------------------------
  -- Open Finance
  -- -------------------------------------------------------------------------
  `provider_bill_id`        VARCHAR(255) NULL,
  `provider_account_id`     VARCHAR(255) NULL,
  `provider_item_id`        VARCHAR(255) NULL,
  `provider_payload`        JSON         NULL,

  `created_at`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_invoice_account_month`  (`account_id`, `invoice_month`),
  UNIQUE INDEX `uq_invoice_provider_bill`  (`provider_bill_id`),
  INDEX `idx_invoice_user`                 (`user_id`),
  INDEX `idx_invoice_month`                (`invoice_month`),
  INDEX `idx_invoice_card_last4`           (`card_last4`),
  CONSTRAINT `fk_invoice_account`
    FOREIGN KEY (`account_id`)
    REFERENCES `accounts` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- card_transactions
-- Compras individuais no cartão de crédito que compõem uma fatura.
-- Não afetam o caixa diretamente — apenas o passivo da fatura.
-- Enriquecida com campos de reconciliação, internacionalização e merchant.
-- -----------------------------------------------------------------------------
CREATE TABLE `card_transactions` (
  `id`                      INT          NOT NULL AUTO_INCREMENT,
  `user_id`                 INT          NOT NULL,
  `card_invoice_id`         INT          NOT NULL,

  -- -------------------------------------------------------------------------
  -- Hierarquia e classificação
  -- -------------------------------------------------------------------------
  `source`                  VARCHAR(50)  NOT NULL, -- pluggy | pdf_invoice | nota_fiscal | manual
  `data_state`              VARCHAR(50)  NOT NULL, -- projected | consolidated | official
  `movement_type`           VARCHAR(50)  NOT NULL DEFAULT 'card_purchase', -- card_purchase | refund | fee | interest
  `movement_subtype`        VARCHAR(50)  NULL,     -- installment | single | recurring

  -- -------------------------------------------------------------------------
  -- Valores
  -- -------------------------------------------------------------------------
  `amount_minor`            BIGINT       NOT NULL, -- Valor em BRL (centavos)
  `currency`                VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  `original_amount_minor`   BIGINT       NULL,     -- Valor na moeda original (compra internacional)
  `original_currency_code`  VARCHAR(3)   NULL,     -- Moeda original (ex: USD, EUR)
  `exchange_rate`           DECIMAL(12,6) NULL,    -- Taxa de câmbio aplicada

  -- -------------------------------------------------------------------------
  -- Datas e competência
  -- -------------------------------------------------------------------------
  `date`                    TIMESTAMP    NOT NULL,
  `competency_month`        VARCHAR(7)   NOT NULL, -- YYYY-MM

  -- -------------------------------------------------------------------------
  -- Descrição e categoria
  -- -------------------------------------------------------------------------
  `description`             TEXT         NOT NULL,
  `normalized_description`  VARCHAR(500) NULL,
  `category_id`             INT          NULL,

  -- -------------------------------------------------------------------------
  -- Merchant (estabelecimento)
  -- -------------------------------------------------------------------------
  `merchant_name`           VARCHAR(255) NULL,     -- Nome normalizado do estabelecimento
  `merchant_document`       VARCHAR(20)  NULL,     -- CNPJ/CPF do estabelecimento (quando disponível)

  -- -------------------------------------------------------------------------
  -- Parcelamento
  -- -------------------------------------------------------------------------
  `installment_number`      INT          NULL,
  `installment_total`       INT          NULL,
  `installment_group_id`    VARCHAR(255) NULL,

  -- -------------------------------------------------------------------------
  -- Reconciliação
  -- -------------------------------------------------------------------------
  `fingerprint`             VARCHAR(255) NULL,
  `is_reconciled`           BOOLEAN      NOT NULL DEFAULT FALSE,
  `reconciled_group_id`     VARCHAR(255) NULL,

  -- -------------------------------------------------------------------------
  -- Open Finance e documentos de origem
  -- -------------------------------------------------------------------------
  `provider_transaction_id` VARCHAR(255) NULL,
  `provider_payload`        JSON         NULL,
  `receipt_document_id`     INT          NULL,     -- FK futura para nota_fiscal / document_uploads

  `created_at`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_card_trans_provider_id`   (`provider_transaction_id`),
  INDEX `idx_card_trans_user_date`           (`user_id`, `date`),
  INDEX `idx_card_trans_competency`          (`competency_month`),
  INDEX `idx_card_trans_fingerprint`         (`fingerprint`),
  INDEX `idx_card_trans_reconciled_group`    (`reconciled_group_id`),
  CONSTRAINT `fk_card_trans_invoice`
    FOREIGN KEY (`card_invoice_id`)
    REFERENCES `card_invoices` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- card_invoice_payments
-- Liga o débito no caixa (transaction) à liquidação do passivo (card_invoice).
-- Suporta pagamento parcial: uma fatura pode ter múltiplos pagamentos parciais,
-- e um pagamento pode ser alocado a múltiplas faturas (ex: pagamento único que
-- cobre fatura atual + residual do mês anterior).
-- card_invoice_allocations do legado foi REMOVIDA — esta tabela a substitui
-- com semântica mais clara e sem redundância.
-- -----------------------------------------------------------------------------
CREATE TABLE `card_invoice_payments` (
  `id`                  INT          NOT NULL AUTO_INCREMENT,
  `user_id`             INT          NOT NULL,
  `card_invoice_id`     INT          NOT NULL,
  `transaction_id`      INT          NOT NULL,    -- Débito na conta corrente que efetivou o pagamento

  `allocated_amount_minor` BIGINT    NOT NULL,    -- Quanto desta transação foi alocado a esta fatura
  `currency_code`       VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  `payment_date`        TIMESTAMP    NOT NULL,    -- Data efetiva do pagamento (pode diferir da data da transação)

  `created_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_payment_invoice_trans`  (`card_invoice_id`, `transaction_id`),
  INDEX `idx_payment_user`                 (`user_id`),
  CONSTRAINT `fk_payment_invoice`
    FOREIGN KEY (`card_invoice_id`)
    REFERENCES `card_invoices` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_payment_transaction`
    FOREIGN KEY (`transaction_id`)
    REFERENCES `transactions` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
