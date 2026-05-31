-- ============================================================================
-- 0012_read_models_performance.sql
--
-- Tabelas intermediárias (read models) para performance do MVP.
-- Pré-calculam agregados pesados para evitar full-scan em cada request.
--
-- Tabelas criadas:
--   cashflow_monthly_summary       — saldo real + projeção por mês/conta
--   card_invoice_monthly_summary   — totais de fatura por mês/conta
--   transaction_month_summary      — receitas e despesas reais por mês/owner
--   forecast_month_summary         — projeção de cashflow por mês/owner
--   dashboard_snapshot             — snapshot diário do painel por owner
--
-- Estratégia de uso:
--   - Cada tabela tem updated_at para saber quando foi recalculada.
--   - O backend tenta ler da tabela intermediária primeiro.
--   - Se não encontrar ou se updated_at > 1h, recalcula ao vivo e persiste.
--   - Backfill inicial via POST /api/admin/backfill-read-models.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- cashflow_monthly_summary
-- Saldo real e projetado por conta e mês.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cashflow_monthly_summary (
  id                      INT           NOT NULL AUTO_INCREMENT,
  user_id                 INT           NOT NULL,                -- @external-fk
  account_id              INT           NOT NULL,
  month                   VARCHAR(7)    NOT NULL,                -- YYYY-MM
  opening_balance_minor   BIGINT        NOT NULL DEFAULT 0,      -- saldo início do mês
  closing_balance_minor   BIGINT        NOT NULL DEFAULT 0,      -- saldo fim do mês (real)
  income_minor            BIGINT        NOT NULL DEFAULT 0,      -- receitas reais
  expense_minor           BIGINT        NOT NULL DEFAULT 0,      -- despesas reais
  invoice_payments_minor  BIGINT        NOT NULL DEFAULT 0,      -- pagamentos de fatura
  projected_income_minor  BIGINT        NOT NULL DEFAULT 0,      -- receitas projetadas
  projected_expense_minor BIGINT        NOT NULL DEFAULT 0,      -- despesas projetadas
  data_state              VARCHAR(20)   NOT NULL DEFAULT 'real', -- real | projected | mixed
  updated_at              TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cashflow_monthly (user_id, account_id, month),
  KEY idx_cashflow_monthly_user_month (user_id, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- card_invoice_monthly_summary
-- Totais de fatura de cartão por conta e mês.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS card_invoice_monthly_summary (
  id                          INT         NOT NULL AUTO_INCREMENT,
  user_id                     INT         NOT NULL,
  account_id                  INT         NOT NULL,
  month                       VARCHAR(7)  NOT NULL,
  total_amount_minor          BIGINT      NOT NULL DEFAULT 0,
  paid_amount_minor           BIGINT      NOT NULL DEFAULT 0,
  open_amount_minor           BIGINT      NOT NULL DEFAULT 0,
  effective_open_amount_minor BIGINT      NOT NULL DEFAULT 0,
  invoice_count               INT         NOT NULL DEFAULT 0,
  status                      VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN | PAID | PARTIAL | OVERDUE
  due_date                    DATE        NULL,
  updated_at                  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_card_invoice_monthly (user_id, account_id, month),
  KEY idx_card_invoice_monthly_user_month (user_id, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- transaction_month_summary
-- Receitas e despesas reais por owner e mês (todas as contas).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transaction_month_summary (
  id                    INT         NOT NULL AUTO_INCREMENT,
  owner_id              INT         NOT NULL,
  month                 VARCHAR(7)  NOT NULL,
  total_income_minor    BIGINT      NOT NULL DEFAULT 0,
  total_expense_minor   BIGINT      NOT NULL DEFAULT 0,
  net_minor             BIGINT      NOT NULL DEFAULT 0,  -- income - expense
  transaction_count     INT         NOT NULL DEFAULT 0,
  top_expense_category  VARCHAR(100) NULL,               -- categoria com maior gasto
  updated_at            TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_transaction_month (owner_id, month),
  KEY idx_transaction_month_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- forecast_month_summary
-- Projeção de cashflow por owner e mês (receitas + despesas recorrentes).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forecast_month_summary (
  id                       INT         NOT NULL AUTO_INCREMENT,
  owner_id                 INT         NOT NULL,
  month                    VARCHAR(7)  NOT NULL,
  projected_income_minor   BIGINT      NOT NULL DEFAULT 0,
  projected_expense_minor  BIGINT      NOT NULL DEFAULT 0,
  projected_invoices_minor BIGINT      NOT NULL DEFAULT 0,
  projected_net_minor      BIGINT      NOT NULL DEFAULT 0,
  confidence               VARCHAR(10) NOT NULL DEFAULT 'medium', -- high | medium | low
  updated_at               TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_forecast_month (owner_id, month),
  KEY idx_forecast_month_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- dashboard_snapshot
-- Snapshot diário do painel por owner — evita recalcular tudo no load.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dashboard_snapshot (
  id                          INT         NOT NULL AUTO_INCREMENT,
  owner_id                    INT         NOT NULL,
  snapshot_date               DATE        NOT NULL,
  current_month               VARCHAR(7)  NOT NULL,
  total_balance_minor         BIGINT      NOT NULL DEFAULT 0,  -- soma saldos contas correntes
  open_invoices_total_minor   BIGINT      NOT NULL DEFAULT 0,  -- soma faturas em aberto
  open_invoices_count         INT         NOT NULL DEFAULT 0,
  next_due_date               DATE        NULL,                -- próximo vencimento
  next_due_amount_minor       BIGINT      NOT NULL DEFAULT 0,
  month_income_minor          BIGINT      NOT NULL DEFAULT 0,  -- receitas do mês actual
  month_expense_minor         BIGINT      NOT NULL DEFAULT 0,  -- despesas do mês actual
  accounts_json               JSON        NULL,                -- snapshot das contas
  invoices_json               JSON        NULL,                -- snapshot das faturas abertas
  updated_at                  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dashboard_snapshot (owner_id, snapshot_date),
  KEY idx_dashboard_snapshot_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
