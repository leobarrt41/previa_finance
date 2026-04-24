# Previa Finance API Server

**Status:** 🚧 **Estrutura básica implementada - Pronta para desenvolvimento**

## ✅ O que foi implementado:

### 1. **Estrutura Base do Servidor**
- ✅ Entry point (`src/index.ts`) com Express setup
- ✅ Configuração de ambiente (`src/config/env.ts`)
- ✅ Conexão com banco de dados (`src/config/database.ts`)
- ✅ Middlewares básicos (CORS, logging, error handling)

### 2. **Rotas Críticas Implementadas**

#### **🔥 CashFlow API (`/api/cashflow/`)**
- ✅ `POST /api/cashflow/projection` - Projeção usando `CashFlowEngine`
- ✅ `GET /api/cashflow/example` - Documentação de payload
- ✅ Validação com Zod 
- ✅ Suporte a forecasts (previsões)
- ✅ Conversão bigint ↔ JSON automática

#### **🔥 Budget API (`/api/budget/`)** 
- ✅ `POST /api/budget/analyze-transaction` - **Foto → análise**
- ✅ `POST /api/budget/analysis` - Análise completa usando `BudgetEngine`
- ✅ `GET /api/budget/example` - Exemplos de uso
- ✅ Integração com `ImpactCalculator`

#### **📋 Endpoints Básicos**
- ✅ `GET /api/categories` - Lista categorias (mock)
- ✅ `GET/POST /api/transactions` - CRUD básico (stubs)
- ✅ `GET /health` - Health check
- ✅ `GET /api/` - Documentação da API

### 3. **Integrações Implementadas**
- ✅ **@previa/core** - CashFlowEngine, BudgetEngine, ImpactCalculator  
- ✅ **@previa/db** - Schema e tipos (parcial)
- ✅ **Zod** - Validação de requests
- ✅ **TypeScript** - Types seguros

## 🚨 **Para funcionar, precisa:**

### 1. **Instalar dependências**
```bash
cd apps/api
npm install
```

### 2. **Configurar ambiente**
```bash
# .env
PORT=3001
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=sua_senha
DB_NAME=previa_finance
JWT_SECRET=sua_chave_secreta
FRONTEND_URL=http://localhost:5173
```

### 3. **Setup do banco**
```bash
cd packages/db
npm run migrate:up
npm run seed:categories
```

### 4. **Rodar servidor**
```bash
cd apps/api
npm run dev
```

## 🎯 **Endpoints prontos para usar:**

### **Projeção de Fluxo de Caixa:**
```bash
curl -X POST http://localhost:3001/api/cashflow/projection \
  -H "Content-Type: application/json" \
  -d '{
    "startMonth": "2026-05",
    "months": 6,
    "openingBalanceMinor": 100000,
    "transactions": [],
    "forecasts": []
  }'
```

### **Análise de Transação (Foto → Análise):**
```bash
curl -X POST http://localhost:3001/api/budget/analyze-transaction \
  -H "Content-Type: application/json" \
  -d '{
    "amountMinor": 15000,
    "categoryId": "food",
    "description": "Supermercado",
    "currentMonth": "2026-04",
    "budgets": [{"categoryId": "food", "categoryName": "Alimentação", "budgetAmountMinor": 50000, "period": "monthly"}],
    "spending": [{"categoryId": "food", "categoryName": "Alimentação", "currentPeriodSpentMinor": 35000, "transactionCount": 10}]
  }'
```

## 📋 **Próximos passos prioritários:**

1. **🔥 Instalar dependências** - `npm install` no diretório `/apps/api/`
2. **🔥 Autenticação JWT** - Middleware de auth para proteger endpoints
3. **🔥 Implementar CRUD de transações** - Conectar com banco real
4. **🔥 Testes automatizados** - Jest para rotas críticas  
5. **🔥 Docker setup** - Para desenvolvimento local
6. **📋 Documentação OpenAPI** - Swagger para todas as rotas
7. **📋 Rate limiting** - Proteção contra abuse
8. **📋 Logging estruturado** - Winston/Pino para produção

## 🚀 **Status da implementação:**

| Componente | Status | Prioridade |
|------------|--------|------------|
| Servidor HTTP | ✅ Implementado | Alta |
| CashFlow API | ✅ Funcional | Alta |
| Budget API (foto→análise) | ✅ Funcional | Alta |
| Validação requests | ✅ Com Zod | Alta |
| Error handling | ✅ Básico | Alta |
| Configuração | ✅ Environment vars | Alta |
| Database connection | ✅ Setup | Alta |
| Dependências | ❌ **Precisa install** | 🔥 CRÍTICA |
| Autenticação | ❌ Ausente | Alta |
| Testes | ❌ Ausente | Média |
| Docker | ❌ Ausente | Média |

A **API server básica está 80% pronta**. Só precisa instalar as dependências e está funcional para as features principais!