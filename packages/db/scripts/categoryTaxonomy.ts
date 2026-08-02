export type CategoryTaxonomyType = "expense" | "income" | "transfer";

export type CategoryTaxonomyDef = {
  id: string;
  name: string;
  slug: string;
  type: CategoryTaxonomyType;
  sortOrder: number;
  parentId?: string;
  /** Quando true, esta categoria representa um movimento financeiro que não é gasto
   *  de consumo (ex: pagamento de fatura, transferência). Deve ser excluída dos
   *  relatórios de gastos por categoria mas incluída no fluxo de caixa. */
  isNonConsumptionExpense?: boolean;
};

// Single canonical source for the full built-in taxonomy used by the app.
// The SQL migration 0007 remains a minimal bootstrap only.
const topLevel: Array<{
  name: string;
  type: CategoryTaxonomyType;
  sortOrder: number;
  isNonConsumptionExpense?: boolean;
}> = [
  // ── Despesas de consumo ────────────────────────────────────────────────────
  { name: "Alimentação",          type: "expense", sortOrder: 10 },
  { name: "Transporte",           type: "expense", sortOrder: 20 },
  { name: "Moradia",              type: "expense", sortOrder: 30 },
  { name: "Saúde",                type: "expense", sortOrder: 40 },
  { name: "Educação",             type: "expense", sortOrder: 50 },
  { name: "Vestuário",            type: "expense", sortOrder: 60 },
  { name: "Eletrônicos",          type: "expense", sortOrder: 70 },
  { name: "Eletrodomésticos",     type: "expense", sortOrder: 80 },
  { name: "Apps e Assinaturas",   type: "expense", sortOrder: 90 },
  { name: "Lazer",                type: "expense", sortOrder: 100 },
  { name: "Pets",                 type: "expense", sortOrder: 110 },
  { name: "Beleza e Cuidados",    type: "expense", sortOrder: 120 },
  { name: "Outros",               type: "expense", sortOrder: 999 },

  // ── Movimentos financeiros (não são gastos de consumo) ────────────────────
  /**
   * Pagamento de Fatura — registado quando o utilizador paga a fatura do
   * cartão de crédito a partir da conta corrente. O movementType correspondente
   * é "liability_payment" com movementSubtype "invoice_payment".
   * NÃO deve entrar nos gráficos de gastos por categoria — é uma liquidação
   * de passivo, não uma despesa nova.
   */
  {
    name: "Pagamento de Fatura",
    type: "transfer",
    sortOrder: 500,
    isNonConsumptionExpense: true,
  },

  // ── Receitas ───────────────────────────────────────────────────────────────
  { name: "Salário",              type: "income", sortOrder: 10 },
  { name: "Freelance",            type: "income", sortOrder: 20 },
  { name: "Investimentos",        type: "income", sortOrder: 30 },
  { name: "Outras Receitas",      type: "income", sortOrder: 999 },
];

const children: Record<string, string[]> = {
  // ── Alimentação ─────────────────────────────────────────────────────────────
  "Alimentação": [
    "supermercado",
    "restaurante",
    "delivery",
    "café e lanches",
    "feira e hortifruti",
    "padaria",
    "bebidas",
  ],

  // ── Transporte ──────────────────────────────────────────────────────────────
  "Transporte": [
    "combustível",
    "manutenção veicular",
    "pedágio",
    "estacionamento",
    "transporte público",
    "app de corrida",
    "táxi",
    "aluguel de veículo",
    "seguro veicular",
    "IPVA e licenciamento",
  ],

  // ── Moradia ─────────────────────────────────────────────────────────────────
  "Moradia": [
    "aluguel",
    "condomínio",
    "energia elétrica",
    "água e esgoto",
    "internet",
    "gás",
    "telefone fixo",
    "manutenção doméstica",
    "IPTU",
    "seguro residencial",
    "limpeza e zeladoria",
  ],

  // ── Saúde ───────────────────────────────────────────────────────────────────
  "Saúde": [
    "plano de saúde",
    "farmácia",
    "consulta médica",
    "exames e laboratório",
    "dentista",
    "psicólogo e terapia",
    "academia e esportes",
    "óptica",
  ],

  // ── Educação ────────────────────────────────────────────────────────────────
  "Educação": [
    "mensalidade escolar",
    "faculdade e pós-graduação",
    "cursos e certificações",
    "livros e material didático",
    "idiomas",
    "material escolar",
  ],

  // ── Vestuário ───────────────────────────────────────────────────────────────
  "Vestuário": [
    "roupas",
    "calçados",
    "acessórios",
    "moda íntima",
  ],

  // ── Eletrônicos ─────────────────────────────────────────────────────────────
  "Eletrônicos": [
    "smartphone e tablet",
    "computador e notebook",
    "acessórios e periféricos",
    "câmera e fotografia",
    "áudio e fones",
    "games e consoles",
    "smartwatch e wearables",
    "componentes e peças",
  ],

  // ── Eletrodomésticos ────────────────────────────────────────────────────────
  "Eletrodomésticos": [
    "geladeira e freezer",
    "fogão e forno",
    "máquina de lavar",
    "ar-condicionado",
    "aspirador e limpeza",
    "pequenos eletrodomésticos",
    "TV e home theater",
    "manutenção de eletrodomésticos",
  ],

  // ── Apps e Assinaturas ──────────────────────────────────────────────────────
  /**
   * Inclui qualquer cobrança recorrente digital: streaming, SaaS, jogos,
   * cloud, antivírus, produtividade, etc.
   */
  "Apps e Assinaturas": [
    "streaming de vídeo",      // Netflix, Prime, Disney+, Max, Globoplay
    "streaming de música",     // Spotify, Deezer, Apple Music
    "jogos e game pass",       // PlayStation Plus, Xbox Game Pass, Steam
    "produtividade e SaaS",    // Microsoft 365, Adobe, Notion, Canva
    "cloud e armazenamento",   // iCloud, Google One, Dropbox
    "segurança digital",       // antivírus, VPN
    "notícias e conteúdo",     // jornais, revistas digitais
    "apps de saúde e bem-estar",
    "outros apps e assinaturas",
  ],

  // ── Lazer ───────────────────────────────────────────────────────────────────
  "Lazer": [
    "cinema e teatro",
    "shows e eventos",
    "viagens e hospedagem",
    "hobbies e artesanato",
    "parques e atrações",
    "bares e baladas",
    "livros e quadrinhos",
  ],

  // ── Pets ────────────────────────────────────────────────────────────────────
  "Pets": [
    "ração e petiscos",
    "veterinário",
    "banho e tosa",
    "medicamentos pet",
    "acessórios e brinquedos pet",
  ],

  // ── Beleza e Cuidados ───────────────────────────────────────────────────────
  "Beleza e Cuidados": [
    "cabelo e barbearia",
    "cosméticos e perfumaria",
    "manicure e estética",
    "spa e massagem",
  ],

  // ── Outros ──────────────────────────────────────────────────────────────────
  "Outros": [
    "taxas e tarifas bancárias",
    "doações",
    "presentes",
    "impostos e tributos",
    "multas",
    "seguros em geral",
    "jurídico e cartório",
  ],

  // ── Pagamento de Fatura ─────────────────────────────────────────────────────
  // Sem subcategorias — é um movimento único e indivisível.
  "Pagamento de Fatura": [],

  // ── Receitas ────────────────────────────────────────────────────────────────
  "Salário": [
    "salário CLT",
    "13º salário",
    "férias",
    "PLR e bônus",
    "hora extra",
  ],
  "Freelance": [
    "consultoria",
    "projetos pontuais",
    "comissões",
  ],
  "Investimentos": [
    "dividendos",
    "rendimento de renda fixa",
    "resgate de fundo",
    "aluguel de imóvel",
  ],
  "Outras Receitas": [
    "reembolso",
    "estorno",
    "prêmios e sorteios",
    "pensão e mesada",
    "venda de bens",
  ],
};

/** IDs legados que não devem mudar para não quebrar dados existentes */
const legacyChildIds: Record<string, string> = {
  "educacao:cursos": "cursos",
};

export function slugifyCategoryName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function buildSystemCategoryTaxonomy(): CategoryTaxonomyDef[] {
  const cats: CategoryTaxonomyDef[] = [];

  for (const parent of topLevel) {
    const slug = slugifyCategoryName(parent.name);
    cats.push({
      id: slug,
      name: parent.name,
      slug,
      type: parent.type,
      sortOrder: parent.sortOrder,
      ...(parent.isNonConsumptionExpense ? { isNonConsumptionExpense: true } : {}),
    });

    const subs = children[parent.name] || [];
    for (const sub of subs) {
      const subSlug = slugifyCategoryName(sub);
      const childKey = `${slug}:${subSlug}`;
      const childId = legacyChildIds[childKey] ?? `${slug}-${subSlug}`;
      cats.push({
        id: childId,
        name: sub,
        slug: subSlug,
        type: parent.type,
        sortOrder: parent.sortOrder + 1,
        parentId: slug,
      });
    }
  }

  return cats;
}
