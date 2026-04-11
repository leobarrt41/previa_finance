-- =============================================================================
-- Migration v3 — 0001: Financial Connections, Consents e Accounts
-- Schema: Previa Finance v3
-- Substitui integralmente as tabelas do v2 0001_initial_schema.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- financial_connections
-- Representa o vínculo entre um usuário e uma instituição financeira via
-- Open Finance (Pluggy Item). Tratada como entidade robusta com estado de
-- consentimento, sincronização e produtos habilitados.
-- -----------------------------------------------------------------------------
CREATE TABLE `financial_connections` (
  `id`                   INT          NOT NULL AUTO_INCREMENT,
  `user_id`              INT          NOT NULL,           -- FK externa: users.id
  `provider`             VARCHAR(50)  NOT NULL DEFAULT 'pluggy',

  -- Identificação no provedor
  `provider_item_id`     VARCHAR(255) NULL,               -- Pluggy: itemId
  `provider_connector_id` INT         NULL,               -- Pluggy: connectorId
  `client_user_id`       VARCHAR(255) NULL,               -- ID do usuário no contexto do provedor

  -- Estado operacional
  `status`               VARCHAR(50)  NOT NULL,           -- UPDATED | UPDATING | LOGIN_ERROR | OUTDATED | WAITING_USER_INPUT
  `execution_status`     VARCHAR(50)  NULL,               -- SUCCESS | PARTIAL_SUCCESS | FAILED (granularidade da última execução)
  `last_sync_at`         TIMESTAMP    NULL,
  `next_auto_sync_at`    TIMESTAMP    NULL,               -- Agendamento de próxima sincronização automática

  -- Consentimento Open Finance
  `consent_expires_at`   TIMESTAMP    NULL,               -- Quando o consentimento expira (alerta ao usuário)
  `consent_revoked_at`   TIMESTAMP    NULL,               -- Quando o consentimento foi revogado

  -- Produtos e permissões habilitados (ex: ["ACCOUNTS","TRANSACTIONS","INVESTMENTS"])
  `products_enabled`     JSON         NULL,
  `permissions_granted`  JSON         NULL,

  -- Payload bruto do provedor para debug e reconciliação
  `provider_payload`     JSON         NULL,

  `created_at`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_fin_conn_provider_item` (`provider_item_id`),
  INDEX `idx_fin_conn_user`   (`user_id`),
  INDEX `idx_fin_conn_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- financial_connection_consents
-- Histórico de consentimentos de Open Finance. Cada renovação ou revogação
-- gera um novo registro, permitindo auditoria completa.
-- -----------------------------------------------------------------------------
CREATE TABLE `financial_connection_consents` (
  `id`                       INT          NOT NULL AUTO_INCREMENT,
  `financial_connection_id`  INT          NOT NULL,
  `provider_consent_id`      VARCHAR(255) NOT NULL,
  `status`                   VARCHAR(50)  NOT NULL,       -- AUTHORISED | AWAITING_AUTHORISATION | REJECTED | REVOKED | CONSUMED

  -- Produtos e permissões deste consentimento específico
  `products`                 JSON         NULL,
  `permissions_granted`      JSON         NULL,

  `expires_at`               TIMESTAMP    NULL,
  `revoked_at`               TIMESTAMP    NULL,

  -- Payload bruto do provedor para auditoria
  `payload`                  JSON         NULL,

  `created_at`               TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  INDEX `idx_consent_connection`  (`financial_connection_id`),
  INDEX `idx_consent_provider_id` (`provider_consent_id`),
  INDEX `idx_consent_expires`     (`expires_at`),
  CONSTRAINT `fk_consent_connection`
    FOREIGN KEY (`financial_connection_id`)
    REFERENCES `financial_connections` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- accounts
-- Unifica contas manuais e conectadas via Open Finance (corrente, poupança,
-- cartão de crédito, conta de investimento). O campo financial_connection_id
-- NULL indica conta manual; preenchido indica conta sincronizada.
-- Enriquecida com identidade do instrumento financeiro para facilitar
-- reconciliação automática entre parser de fatura e conta cadastrada.
-- -----------------------------------------------------------------------------
CREATE TABLE `accounts` (
  `id`                          INT          NOT NULL AUTO_INCREMENT,
  `user_id`                     INT          NOT NULL,
  `financial_connection_id`     INT          NULL,        -- NULL = conta manual

  -- Tipo e canal
  `type`                        VARCHAR(50)  NOT NULL,    -- CHECKING | SAVINGS | CREDIT_CARD | INVESTMENT
  `subtype`                     VARCHAR(50)  NULL,        -- CURRENT_ACCOUNT | CREDIT_CARD | etc.
  `financial_channel`           VARCHAR(50)  NOT NULL,    -- bank_account | credit_card | investment_account | cash

  -- Identidade e exibição
  `display_name`                VARCHAR(200) NOT NULL,    -- Nome amigável definido pelo usuário
  `institution_name`            VARCHAR(200) NULL,        -- Nome da instituição (ex: "Itaú", "Nubank")
  `owner_name`                  VARCHAR(200) NULL,        -- Nome do titular da conta

  -- Identificação do instrumento (cartão)
  `card_brand`                  VARCHAR(50)  NULL,        -- VISA | MASTERCARD | ELO | AMEX | etc.
  `card_last4`                  VARCHAR(4)   NULL,        -- Últimos 4 dígitos do cartão
  `masked_number`               VARCHAR(30)  NULL,        -- Número mascarado (ex: ****.****.****1234)

  -- Saldo e limites
  `currency`                    VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  `balance_minor`               BIGINT       NOT NULL DEFAULT 0,
  `credit_limit_minor`          BIGINT       NULL,
  `available_credit_limit_minor` BIGINT      NULL,

  -- Configuração de fatura (cartão de crédito)
  `closing_day`                 INT          NULL,
  `due_day`                     INT          NULL,

  -- Origem e identificação no provedor
  `source`                      VARCHAR(50)  NOT NULL DEFAULT 'manual', -- manual | pluggy | pdf_statement
  `provider`                    VARCHAR(50)  NULL,        -- pluggy | belvo | etc.
  `provider_account_id`         VARCHAR(255) NULL,        -- ID da conta no provedor
  `provider_item_id`            VARCHAR(255) NULL,        -- ID do item/conexão no provedor

  `is_active`                   BOOLEAN      NOT NULL DEFAULT TRUE,

  `created_at`                  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_accounts_provider_account` (`provider_account_id`),
  INDEX `idx_accounts_user`         (`user_id`),
  INDEX `idx_accounts_provider_item` (`provider_item_id`),
  INDEX `idx_accounts_card_identity` (`institution_name`, `card_brand`, `card_last4`),
  CONSTRAINT `fk_account_connection`
    FOREIGN KEY (`financial_connection_id`)
    REFERENCES `financial_connections` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
