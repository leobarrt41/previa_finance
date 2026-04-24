# Previa Finance

Sistema de gestão financeira pessoal com IA.

## Estrutura

- apps/web (frontend gerado pelo Manus)
- apps/api (Express.js + TypeScript - 100% funcional)
- packages/db (Drizzle ORM + MySQL)
- packages/core (CashFlowEngine, BudgetEngine, ImpactCalculator)
- packages/parsers (PDF/CSV import - em desenvolvimento)

## Status Atual

- **Backend API**: 100% completo com 5 endpoints essenciais
- **Autenticação**: Clerk (externa, sem tabela users local)
- **Frontend**: Será gerado automaticamente pelo assistente Manus
- **Database**: MySQL com schema v4 completo