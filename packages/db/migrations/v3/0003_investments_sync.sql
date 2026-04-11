-- =============================================================================
-- Migration v3 — 0003: Investments, Investment Transactions, Webhooks e Sync Runs
-- Schema: Previa Finance v3
-- Substitui integralmente as tabelas do v2 0003_payments_investments_sync.sql
-- (card_invoice_payments foi movido para 0002 nesta versão)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- investments
-- Posição atual de um investimento. Preparada para análises do plano Premium,
-- com suporte a múltiplas fontes (Pluggy, upload de extrato, manual) e
-- metadados ricos para análise de carteira futura.
-- -----------------------------------------------------------------------------
CREATE TABLE `investments` (
  `id`                      INT          NOT NULL AUTO_INCREMENT,
  `user_id`                 INT          NOT NULL,
  `account_id`              INT          NOT NULL,        -- Conta de investimento em accounts
  `financial_connection_id` INT          NULL,            -- NULL se manual

  -- -------------------------------------------------------------------------
  -- Hierarquia e origem
  -- -------------------------------------------------------------------------
  `source`                  VARCHAR(50)  NOT NULL DEFAULT 'manual', -- pluggy | pdf_statement | manual
  `data_state`              VARCHAR(50)  NOT NULL DEFAULT 'consolidated', -- projected | consolidated | official
  `provider`                VARCHAR(50)  NULL,            -- pluggy | belvo | etc.

  -- -------------------------------------------------------------------------
  -- Identidade do investimento
  -- -------------------------------------------------------------------------
  `name`                    VARCHAR(200) NOT NULL,
  `type`                    VARCHAR(50)  NOT NULL,        -- FIXED_INCOME | MUTUAL_FUND | EQUITY | CRYPTO | PENSION
  `investment_subtype`      VARCHAR(50)  NULL,            -- CDB | LCI | LCA | TESOURO_DIRETO | FII | etc.
  `status`                  VARCHAR(50)  NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | REDEEMED | MATURED

  -- -------------------------------------------------------------------------
  -- Emissor e instituição
  -- -------------------------------------------------------------------------
  `issuer`                  VARCHAR(200) NULL,            -- Emissor do título (ex: "Banco XYZ")
  `institution_name`        VARCHAR(200) NULL,            -- Custodiante

  -- -------------------------------------------------------------------------
  -- Datas
  -- -------------------------------------------------------------------------
  `issue_date`              DATE         NULL,
  `maturity_date`           DATE         NULL,

  -- -------------------------------------------------------------------------
  -- Valores
  -- -------------------------------------------------------------------------
  `balance_minor`           BIGINT       NOT NULL DEFAULT 0, -- Valor atual em centavos
  `currency`                VARCHAR(3)   NOT NULL DEFAULT 'BRL',

  -- -------------------------------------------------------------------------
  -- Open Finance
  -- -------------------------------------------------------------------------
  `provider_investment_id`  VARCHAR(255) NULL,
  `provider_payload`        JSON         NULL,

  -- -------------------------------------------------------------------------
  -- Metadados adicionais (taxa, indexador, etc.)
  -- -------------------------------------------------------------------------
  `metadata`                JSON         NULL,

  `created_at`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_investment_provider_id`   (`provider_investment_id`),
  INDEX `idx_investments_user`               (`user_id`),
  INDEX `idx_investments_connection`         (`financial_connection_id`),
  CONSTRAINT `fk_investment_account`
    FOREIGN KEY (`account_id`)
    REFERENCES `accounts` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_investment_connection`
    FOREIGN KEY (`financial_connection_id`)
    REFERENCES `financial_connections` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- investment_transactions
-- Histórico de movimentações de investimento (compra, venda, rendimento, IR).
-- Preparada para análise de rentabilidade e uso em relatórios de IA.
-- -----------------------------------------------------------------------------
CREATE TABLE `investment_transactions` (
  `id`                      INT          NOT NULL AUTO_INCREMENT,
  `user_id`                 INT          NOT NULL,
  `investment_id`           INT          NOT NULL,
  `financial_connection_id` INT          NULL,

  -- -------------------------------------------------------------------------
  -- Hierarquia e origem
  -- -------------------------------------------------------------------------
  `source`                  VARCHAR(50)  NOT NULL DEFAULT 'pluggy', -- pluggy | pdf_statement | manual
  `data_state`              VARCHAR(50)  NOT NULL DEFAULT 'official', -- projected | consolidated | official
  `provider`                VARCHAR(50)  NULL,

  -- -------------------------------------------------------------------------
  -- Tipo e valores
  -- -------------------------------------------------------------------------
  `type`                    VARCHAR(50)  NOT NULL, -- BUY | SELL | YIELD | TAX | TRANSFER_IN | TRANSFER_OUT
  `amount_minor`            BIGINT       NOT NULL,
  `currency`                VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  `date_occurred_at`        TIMESTAMP    NOT NULL, -- Data efetiva da movimentação

  -- -------------------------------------------------------------------------
  -- Open Finance
  -- -------------------------------------------------------------------------
  `provider_transaction_id` VARCHAR(255) NULL,
  `provider_payload`        JSON         NULL,

  `created_at`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_inv_trans_provider_id`  (`provider_transaction_id`),
  INDEX `idx_inv_trans_investment`         (`investment_id`),
  INDEX `idx_inv_trans_user`               (`user_id`),
  INDEX `idx_inv_trans_date`               (`date_occurred_at`),
  CONSTRAINT `fk_inv_trans_investment`
    FOREIGN KEY (`investment_id`)
    REFERENCES `investments` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_inv_trans_connection`
    FOREIGN KEY (`financial_connection_id`)
    REFERENCES `financial_connections` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- provider_webhook_events
-- Fila de eventos recebidos do provedor Open Finance (ex: Pluggy webhooks).
-- Processamento assíncrono: o worker lê desta tabela e marca como processado.
-- Enriquecida com event_id, provider_account_id e processing_status para
-- rastreabilidade completa e suporte a reprocessamento.
-- -----------------------------------------------------------------------------
CREATE TABLE `provider_webhook_events` (
  `id`                  INT          NOT NULL AUTO_INCREMENT,
  `provider`            VARCHAR(50)  NOT NULL DEFAULT 'pluggy',

  -- Identificação do evento
  `event_id`            VARCHAR(255) NULL,                -- ID único do evento no provedor (para deduplicação)
  `event_type`          VARCHAR(100) NOT NULL,            -- ITEM_UPDATED | ITEM_ERROR | TRANSACTION_CREATED | etc.

  -- Contexto do evento
  `provider_item_id`    VARCHAR(255) NULL,
  `provider_account_id` VARCHAR(255) NULL,

  -- Payload e processamento
  `payload`             JSON         NOT NULL,
  `processing_status`   VARCHAR(50)  NOT NULL DEFAULT 'PENDING', -- PENDING | PROCESSING | SUCCESS | FAILED | SKIPPED
  `error_message`       TEXT         NULL,
  `processed_at`        TIMESTAMP    NULL,

  `created_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_webhook_event_id`          (`event_id`),
  INDEX `idx_webhook_provider_item`           (`provider_item_id`),
  INDEX `idx_webhook_processing_status`       (`processing_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- sync_runs
-- Log de auditoria de execuções de sincronização (manual, automática ou
-- disparada por webhook). Enriquecida com sync_type para distinguir a origem
-- da execução e melhorar a observabilidade.
-- -----------------------------------------------------------------------------
CREATE TABLE `sync_runs` (
  `id`                      INT          NOT NULL AUTO_INCREMENT,
  `financial_connection_id` INT          NOT NULL,
  `provider`                VARCHAR(50)  NULL,            -- Redundante mas útil para queries de observabilidade sem JOIN

  -- Tipo e estado
  `sync_type`               VARCHAR(50)  NOT NULL,        -- MANUAL | AUTO | WEBHOOK | INITIAL
  `status`                  VARCHAR(50)  NOT NULL,        -- STARTED | SUCCESS | PARTIAL | FAILED

  -- Rastreabilidade
  `started_at`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at`             TIMESTAMP    NULL,
  `error_message`           TEXT         NULL,
  `metrics`                 JSON         NULL,            -- { "new": 12, "updated": 3, "duplicates_skipped": 1 }

  PRIMARY KEY (`id`),
  INDEX `idx_sync_run_connection`  (`financial_connection_id`),
  INDEX `idx_sync_run_started`     (`started_at`),
  INDEX `idx_sync_run_status`      (`status`),
  CONSTRAINT `fk_sync_run_connection`
    FOREIGN KEY (`financial_connection_id`)
    REFERENCES `financial_connections` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
