## [2026-04-21 14:40]

ID: 20260421-1440-001
SOURCE: previa_finance/copilot
CATEGORIA: Arquitetura
TÍTULO: Proposta — adicionar origem "previsão manual" (forecast) ao motor de cashflow
DESCRIÇÃO: Proposta para permitir que o usuário cadastre previsões manuais (ex.: previsão anual que cairá num mês X) como uma nova origem de entrada no motor de projeção. Isso permite que usuários que não têm salário recorrente registrem previsões pontuais ou recorrentes simples (mensal/anual) sem precisar criar transações reais.

MOTIVAÇÃO
- Cenário: Usuário sem salário recorrente tem uma previsão de receita anual que cairá em um mês específico; ele quer registrar isso para que projeções reflitam essa expectativa.
- Requisito: um input simples com (mês, valor, recorrência opcional) que afete as projeções como renda planejada (não transação bancária real).

IMPLICAÇÕES NA ARQUITETURA / DB
- Nova origem/entidade: `cashflow_forecasts` ou `forecasts` para separar previsões manuais de transações reais.
- Alternativa mais simples (menos normalized): adicionar colunas `origin` + `recurrence` em `transactions`/`cashflow_inputs`, mas isso mistura dados reais e previsões (menos claro para reconciliation). Recomendo tabela separada.

EXEMPLO DE MIGRATION (SQL)

-- up
CREATE TABLE cashflow_forecasts (
  id VARCHAR(36) PRIMARY KEY,
  external_owner_id VARCHAR(36) NULL,
  competency_month CHAR(7) NOT NULL, -- 'YYYY-MM'
  amount_minor BIGINT NOT NULL,
  recurrence VARCHAR(20) NOT NULL DEFAULT 'one-time', -- one-time|monthly|yearly
  recurrence_end CHAR(7) NULL, -- optional end month for recurring forecasts
  description TEXT NULL,
  created_by VARCHAR(36) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- down
DROP TABLE IF EXISTS cashflow_forecasts;

DRIZZLE / SCHEMA
- Add `packages/db/src/schema/cashflow_forecasts.ts` matching the above fields and export it.

ALTERAÇÕES DE API / TIPOS
- Atualizar `packages/core/src/cashflow/types.ts`:
  - export interface CashFlowForecast { id: string; competencyMonth: string; amountMinor: bigint; recurrence?: 'one-time' | 'monthly' | 'yearly'; recurrenceEnd?: string | null; description?: string }
  - Atualizar `CashFlowInput` (o input do engine) para incluir `forecasts?: CashFlowForecast[]`

- Atualizar contratos de API (server) para aceitar payloads de previsão:
  POST /api/cashflow/forecasts { competencyMonth, amountMinor, recurrence, recurrenceEnd, description }
  GET /api/cashflow/forecasts -> lista do usuário
  DELETE /api/cashflow/forecasts/:id

ALTERAÇÕES NO CASHFLOW ENGINE
- `CashFlowEngine.project(input: CashFlowInput)` deve considerar as previsões:
  - Para cada forecast com recurrence 'one-time': adicionar amountMinor ao mês `competencyMonth`.
  - Se 'monthly' ou 'yearly': expandir para os meses projetados até `recurrenceEnd` ou de acordo com `projectionMonths` passado no input.
  - Garantir coerência de tipos (use bigint para amounts internamente) e comportamento claro entre forecasts e transactions (forecasts são previsões — podem ter flag `isForecast` em resultados).

TESTES
- Unit tests para `CashFlowEngine` cobrindo:
  - one-time forecast: aparece no mês correto
  - monthly forecast: aparece em todos os meses entre competencyMonth e recurrenceEnd (ou até projectionMonths)
  - yearly forecast: aparece apenas no mês do ano especificado (se projetando múltiplos anos)
  - combinação forecasts + transactions: previsões não confundem saldo de transações reais (devem aparecer em `totalPlannedMinor` ou similar)

MIGRAÇÃO DE DADOS
- Nenhuma migração de dados obrigatória (é uma tabela nova). Se quisermos transformar registros existentes, fornecer script ETL.

IMPACTO NO FRONTEND
- UI: nova tela/componente para "Adicionar Previsão" com campos: Mês (competency), Valor, Recorrência (one-time/monthly/yearly), Data de término (se aplicável), Descrição.
- UX: marcar previsões claramente como "previsão" (rótulo e cor) nas projeções e permitir edição/remoção.

CRITÉRIOS DE ACEITAÇÃO
- Migracao adicionada e aplicada sem quebrar outras migrations
- `CashFlowEngine.project` aceita forecasts no input e os incorpora nas projeções
- Tests unitários cobrindo casos principais (one-time, monthly, combination) passam
- API endpoints para CRUD de forecasts documentados e protegidos por autenticação
- Frontend permite criar/editar/remover previsões e elas aparecem corretamente nas projeções

RISKS / NOTES
- Misturar previsões com transações reais pode confundir reconciliation. Por isso privilegie tabela separada e campos que deixam explícito que é "previsão".
- Valores financeiros usam `BIGINT` (minor units) para evitar problemas de float.

NEXT STEPS (sugestão de execução incremental)
1) Criar migration e schema (`packages/db`) + tests de migração
2) Atualizar `packages/core` types e `CashFlowEngine` para aceitar `forecasts` (limit scope a engine input first)
3) Adicionar unit tests no `packages/core` cobrindo forecasts
4) Expor API CRUD em `apps/api` (protegido) e documentar payloads
5) Adicionar UI simples em `apps/web` para criar forecasts (feature flag opcional)

TAGS: cashflow,db,feature,forecast
PRIORIDADE: Alta
STATUS: Proposto
